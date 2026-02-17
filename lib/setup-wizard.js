/**
 * Evobrew Setup Wizard
 *
 * First-run onboarding that discovers available providers, gathers credentials,
 * builds a clean provider model registry, and initializes local services.
 *
 * This flow mirrors OpenClaw's setup style: discover providers, register them
 * with their available models, and persist everything in ~/.evobrew/config.json.
 */

const fs = require('fs');
const os = require('os');
const readline = require('readline');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

const { loginWithOpenAICodex } = require('./oauth-codex');
const configManager = require('./config-manager');

const DEFAULT_LM_STUDIO_PORTS = [1234, 1235, 8080];
const CODEX_MODELS = [
  'openai-codex/gpt-5.2',
  'openai-codex/gpt-5.3-codex',
  'openai-codex/gpt-5.3-codex-spark'
];
const LMSTUDIO_PATH = '/v1';

let rl = null;

function initReadline() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.on('SIGINT', () => {
    console.log('\n\nSetup cancelled.');
    process.exit(0);
  });

  return rl;
}

function closeReadline() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

function ask(prompt) {
  return new Promise((resolve) => {
    if (process.stdin.isPaused && process.stdin.isPaused()) process.stdin.resume();

    initReadline().question(`${prompt}: `, (answer) => {
      resolve(String(answer || '').trim());
    });
  });
}

async function confirm(message, defaultYes = true) {
  const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
  const answer = await ask(`${message}${suffix}`);
  if (!answer) return defaultYes;
  return /^y(es)?$/i.test(answer);
}

async function readHidden(prompt) {
  closeReadline();
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  process.stdout.write(`${prompt}: `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let value = '';

    const cleanup = () => {
      stdin.removeAllListeners('data');
      stdin.setRawMode(wasRaw || false);
      console.log('');
      initReadline();
    };

    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        cleanup();
        resolve(value.trim());
      } else if (char === '\u0003') {
        cleanup();
        process.exit(0);
      } else if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        process.stdout.write('\b \b');
      } else {
        value += char;
        process.stdout.write('•');
      }
    };

    stdin.on('data', onData);
  });
}

function normalizeProviderModels(rawModels = []) {
  return Array.from(new Set((rawModels || []).map((m) => String(m || '').trim()).filter(Boolean)));
}

function normalizeUrl(baseUrl) {
  if (!baseUrl) return baseUrl;
  const trimmed = String(baseUrl).trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

async function detectModelsFromHttpJson(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const target = new URL(url);
      const client = target.protocol === 'https:' ? https : http;
      const req = client.get(target.href, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({ ok: false, status: res.statusCode, models: [] });
            return;
          }
          try {
            const payload = JSON.parse(data || '{}');
            const models = payload?.models || payload?.data || [];
            if (Array.isArray(models)) {
              const names = models.map((m) => {
                if (typeof m === 'string') return m;
                return m?.name || m?.id;
              });
              resolve({ ok: true, models: normalizeProviderModels(names) });
              return;
            }
            resolve({ ok: false, status: 'invalid-payload', models: [] });
          } catch (err) {
            resolve({ ok: false, status: err.message, models: [] });
          }
        });
      });

      req.on('error', () => resolve({ ok: false, status: 'connection-error', models: [] }));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ ok: false, status: 'timeout', models: [] });
      });
    } catch {
      resolve({ ok: false, status: 'bad-url', models: [] });
    }
  });
}

async function detectOllama(baseUrl = 'http://localhost:11434') {
  const normalized = normalizeUrl(baseUrl).replace(/\/v1$/i, '');
  return detectModelsFromHttpJson(`${normalized}/api/tags`);
}

async function detectLMStudio(baseUrl) {
  const normalized = normalizeUrl(baseUrl).replace(/\/v1$/i, '');
  return detectModelsFromHttpJson(`${normalized}${LMSTUDIO_PATH}/models`);
}

async function detectAnthropicModels(apiKey) {
  if (!apiKey) return [];
  try {
    const result = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/models',
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: 1500
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve({ ok: false, models: [] });
          try {
            const parsed = JSON.parse(body);
            resolve({ ok: true, models: normalizeProviderModels(parsed?.data?.map((m) => m?.id)) });
          } catch {
            resolve({ ok: false, models: [] });
          }
        });
      });
      req.on('error', () => resolve({ ok: false, models: [] }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, models: [] });
      });
      req.end();
    });

    return result.ok ? result.models : [];
  } catch {
    return [];
  }
}

async function detectOpenAIModels(apiKey) {
  if (!apiKey) return [];
  try {
    const result = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/models',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        timeout: 1500
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve({ ok: false, models: [] });
          try {
            const parsed = JSON.parse(body);
            const models = (parsed?.data || []).map((m) => m?.id).filter((id) => {
              const lower = String(id || '').toLowerCase();
              return lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower === 'grok';
            });
            resolve({ ok: true, models: normalizeProviderModels(models) });
          } catch {
            resolve({ ok: false, models: [] });
          }
        });
      });
      req.on('error', () => resolve({ ok: false, models: [] }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, models: [] });
      });
      req.end();
    });

    return result.ok ? result.models : [];
  } catch {
    return [];
  }
}

function printHeader() {
  const divider = '='.repeat(70);
  console.log('\n' + divider);
  console.log('                 Evobrew Setup');
  console.log(divider);
  console.log('Match OpenClaw-style onboarding: discover providers, fetch local models, save config.\n');
}

function printSection(title) {
  const divider = '-'.repeat(64);
  console.log('\n' + title);
  console.log(divider);
}

function resolveModelFromChoices(choice, fallback = '') {
  const normalized = String(choice || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized;
}

async function runDatabaseMigrations(projectRoot, dbPath) {
  if (fs.existsSync(dbPath)) {
    return;
  }

  console.log('\nDatabase migration: setting up ~/.evobrew database...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    execSync(`${npm} run db:migrate`, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`
      }
    });
    console.log('✓ Database migration completed.');
  } catch (error) {
    console.warn('⚠ Database migration failed to run automatically:');
    console.warn(error.message);
    console.warn('You can run it later with: npm run db:migrate');
  }
}

async function setupWizard(projectRoot) {
  try {
    printHeader();

    await configManager.initConfigDir();
    const dbPath = configManager.getDatabasePath();

    const existingConfig = await configManager.loadConfigSafe();
    const config = existingConfig || configManager.getDefaultConfig();

    const discovery = {
      ollama: await detectOllama(),
      lmStudio: await (async () => {
        for (const p of DEFAULT_LM_STUDIO_PORTS) {
          const detected = await detectLMStudio(`http://localhost:${p}`);
          if (detected.ok) return { ok: true, url: `http://localhost:${p}`, models: detected.models };
        }
        return { ok: false, url: `http://localhost:1234`, models: [] };
      })(),
      envAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()),
      envOpenAIKey: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()),
      envXAIKey: Boolean(process.env.XAI_API_KEY && process.env.XAI_API_KEY.trim())
    };

    if (!config.providers) config.providers = {};

    // Build providers
    printSection('Provider setup');

    // Ollama
    const ollamaModels = normalizeProviderModels(discovery.ollama.models);
    let ollamaEnabled = false;
    if (discovery.ollama.ok) {
      const list = ollamaModels.slice(0, 5).join(', ') + (ollamaModels.length > 5 ? '...' : '');
      console.log(`Ollama detected with ${ollamaModels.length} model${ollamaModels.length === 1 ? '' : 's'}${list ? ` (${list})` : ''}`);
      ollamaEnabled = await confirm('Ollama detected. Enable', true);
    } else {
      ollamaEnabled = await confirm('Enable Ollama manually if it is running at localhost:11434', false);
    }

    if (ollamaEnabled) {
      const urlAnswer = await confirm('Use default Ollama URL (http://localhost:11434)', true)
        ? 'http://localhost:11434'
        : await ask('Enter Ollama base URL');
      const detected = await detectOllama(urlAnswer || 'http://localhost:11434');
      config.providers.ollama = {
        enabled: true,
        type: 'openai-compatible',
        base_url: normalizeUrl(urlAnswer || 'http://localhost:11434'),
        models: detected.ok ? normalizeProviderModels(detected.models) : []
      };
      if (!config.providers.ollama.models.length && ollamaModels.length) {
        config.providers.ollama.models = ollamaModels;
      }
    } else {
      config.providers.ollama = { ...config.providers.ollama, enabled: false };
      if (!config.providers.ollama.base_url) config.providers.ollama.base_url = 'http://localhost:11434/v1';
      if (!Array.isArray(config.providers.ollama.models)) config.providers.ollama.models = [];
    }

    // LM Studio (optional)
    if (discovery.lmStudio.ok) {
      const lmEnable = await confirm(`LMStudio detected with ${discovery.lmStudio.models.length} model(s). Enable`, true);
      if (lmEnable) {
        config.providers.lmstudio = {
          enabled: true,
          type: 'openai-compatible',
          base_url: normalizeUrl(discovery.lmStudio.url),
          models: normalizeProviderModels(discovery.lmStudio.models)
        };
      } else {
        config.providers.lmstudio = { ...config.providers.lmstudio, enabled: false };
      }
    }

    // Anthropic
    printSection('Anthropic setup');
    console.log('1) OAuth flow\n2) API key\n3) Skip');
    const anthropicChoice = resolveModelFromChoices(await ask('Anthropic account setup'));

    if (anthropicChoice === '1' || /^1/.test(anthropicChoice)) {
      config.providers.anthropic = {
        enabled: true,
        oauth: true,
        api_key: '',
        models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5']
      };
      console.log('✓ Anthropic OAuth selected. You can complete OAuth in the web UI when needed.');
    } else if (anthropicChoice === '2' || /^2$/.test(anthropicChoice)) {
      const key = discovery.envAnthropicKey
        ? process.env.ANTHROPIC_API_KEY
        : await readHidden('Anthropic API key (press Enter to skip)');
      if (key) {
        const models = await detectAnthropicModels(key);
        config.providers.anthropic = {
          enabled: true,
          oauth: false,
          api_key: key,
          models: models.length ? models : ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5']
        };
      } else {
        config.providers.anthropic = {
          ...config.providers.anthropic,
          enabled: false
        };
      }
    } else {
      config.providers.anthropic = {
        ...config.providers.anthropic,
        enabled: false,
        oauth: false
      };
    }

    if (discovery.envAnthropicKey) {
      console.log('Detected ANTHROPIC_API_KEY in environment; enabling Anthropic API mode as default.');
      const key = process.env.ANTHROPIC_API_KEY;
      const useEnv = await confirm('Use ANTHROPIC_API_KEY from environment', true);
      if (useEnv) {
        const models = await detectAnthropicModels(key);
        config.providers.anthropic = {
          enabled: true,
          oauth: false,
          api_key: key,
          models: models.length ? models : ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5']
        };
      }
    }

    // OpenAI + ChatGPT Subscription (OAuth)
    printSection('OpenAI setup');
    console.log('1) ChatGPT Subscription (OAuth)');
    console.log('2) OpenAI API key');
    console.log('3) Skip');

    let openaiChoice = '';
    if (discovery.envOpenAIKey) {
      const useEnv = await confirm('Detected OPENAI_API_KEY in environment. Use as OpenAI API mode', false);
      if (useEnv) openaiChoice = '2';
    }

    if (!openaiChoice) {
      openaiChoice = await ask('Choose OpenAI setup mode');
    }

    let openaiDefaultProvider = false;
    config.providers['openai-codex'] = {
      ...config.providers['openai-codex'],
      enabled: false,
      models: []
    };

    if (openaiChoice === '1') {
      try {
        const profile = await loginWithOpenAICodex();
        config.providers['openai-codex'] = {
          enabled: true,
          models: CODEX_MODELS,
          accountId: profile.accountId
        };
        config.defaultProvider = 'openai-codex';
        console.log(`✓ ChatGPT subscription connected for account ${profile.accountId || 'unknown'}.`);
        openaiDefaultProvider = true;
      } catch (error) {
        console.error('OAuth login failed:', error.message);
        console.log('Falling back to OpenAI API mode for this setup step.');
        openaiChoice = '2';
      }
    }

    if (openaiChoice === '2' && !openaiDefaultProvider) {
      let openaiKey = '';
      if (discovery.envOpenAIKey) {
        openaiKey = process.env.OPENAI_API_KEY;
      } else {
        const ans = await readHidden('OpenAI API key (enter key or skip)');
        if (ans) openaiKey = ans;
      }

      if (openaiKey) {
        const models = await detectOpenAIModels(openaiKey);
        config.providers.openai = {
          enabled: true,
          api_key: openaiKey,
          models: models.length
            ? models
            : ['gpt-4o', 'gpt-4.1', 'gpt-5', 'o3-mini', 'o1']
        };
      } else {
        config.providers.openai = {
          ...config.providers.openai,
          enabled: false
        };
      }
    } else if (!openaiDefaultProvider) {
      config.providers.openai = {
        ...config.providers.openai,
        enabled: false
      };
    }

    // xAI
    printSection('xAI setup');
    let xaiKey = '';
    if (discovery.envXAIKey) {
      const useEnv = await confirm('Detected XAI_API_KEY in environment. Use it', true);
      if (useEnv) xaiKey = process.env.XAI_API_KEY;
    }
    if (!xaiKey) {
      const ans = await readHidden('xAI API key (enter key or skip)');
      if (ans) xaiKey = ans;
    }
    config.providers.xai = {
      ...config.providers.xai,
      enabled: Boolean(xaiKey),
      api_key: xaiKey,
      models: xaiKey ? ['grok-code-fast-1', 'grok-2', 'grok-beta'] : (config.providers.xai?.models || [])
    };

    config.providers = {
      ...(config.providers || {}),
      openai: config.providers.openai || { enabled: false, api_key: '', models: [] },
      'openai-codex': config.providers['openai-codex'] || { enabled: false, models: [] },
      anthropic: config.providers.anthropic || { enabled: false, oauth: false, api_key: '', models: [] },
      xai: config.providers.xai || { enabled: false, api_key: '', models: [] },
      ollama: config.providers.ollama || { enabled: false, type: 'openai-compatible', base_url: 'http://localhost:11434/v1', models: [] },
      lmstudio: config.providers.lmstudio || { enabled: false, type: 'openai-compatible', base_url: 'http://localhost:1234/v1', models: [] }
    };

    // Server defaults can still be tuned on demand later.
    config.server = {
      ...(config.server || {}),
      http_port: parseInt(await ask('HTTP port (default 3405)') || '3405', 10)
    };
    if (!Number.isFinite(config.server.http_port) || config.server.http_port < 1) config.server.http_port = 3405;

    const providerCount = ['openai', 'openai-codex', 'anthropic', 'xai', 'ollama', 'lmstudio']
      .reduce((acc, key) => acc + (config.providers[key]?.enabled ? 1 : 0), 0);

    const configuredModels = ['openai', 'openai-codex', 'anthropic', 'xai', 'ollama', 'lmstudio']
      .flatMap((key) => normalizeProviderModels(config.providers[key]?.models || []));

    if (providerCount === 0) {
      console.warn('\n⚠ No providers enabled.');
      const proceed = await confirm('Continue anyway', false);
      if (!proceed) {
        console.log('Setup cancelled. You can re-run with: evobrew setup');
        return;
      }
    }

    await configManager.saveConfig(config);
    await runDatabaseMigrations(projectRoot, dbPath);

    console.log('\n' + '='.repeat(70));
    console.log(`✓ Setup complete. Enabled ${providerCount} providers, ${configuredModels.length} model(s) available.`);
    console.log('Summary:');
    Object.entries(config.providers).forEach(([name, entry]) => {
      if (!entry?.enabled) return;
      const key = normalizeProviderModels(entry.models).length;
      const displayName = String(name).replace(/openai-codex/g, 'openai-codex (OAuth)');
      console.log(`  - ${displayName}: ${key} model${key === 1 ? '' : 's'}`);
    });
    console.log('\nNext:');
    console.log('  - Run: npm run dev');
    console.log('  - Open UI and choose a model from the dropdown.');

  } catch (error) {
    console.error('\nSetup failed:', error.message);
    throw error;
  } finally {
    closeReadline();
    if (process.stdin.setRawMode) {
      try { process.stdin.setRawMode(false); } catch (_) {}
    }
  }
}

async function needsSetup() {
  await configManager.initConfigDir();
  if (!configManager.configDirExists()) return true;

  const config = await configManager.loadConfigSafe();
  if (!config) return true;

  const providers = config.providers || {};
  const hasEnabled = [
    providers.openai?.enabled,
    providers.anthropic?.enabled,
    providers.xai?.enabled,
    providers.ollama?.enabled,
    providers.lmstudio?.enabled
  ].some(Boolean);

  return !hasEnabled;
}

module.exports = {
  setupWizard,
  needsSetup
};
