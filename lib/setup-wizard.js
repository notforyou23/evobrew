/**
 * First-Run Setup Wizard
 * Guides users through initial Evobrew configuration
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// ============================================================================
// Local Model Detection
// ============================================================================

/**
 * Detect if Ollama is running and get available models
 * @returns {Promise<{available: boolean, models: string[], error?: string}>}
 */
async function detectOllama() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json();
      const models = (data.models || []).map(m => m.name);
      return { available: true, models };
    }
    return { available: false, models: [], error: 'Ollama returned error' };
  } catch (err) {
    return { available: false, models: [], error: err.message };
  }
}

/**
 * Detect if LM Studio is running and get available models
 * @returns {Promise<{available: boolean, models: string[], error?: string}>}
 */
async function detectLMStudio() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch('http://localhost:1234/v1/models', {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json();
      const models = (data.data || []).map(m => m.id);
      return { available: true, models };
    }
    return { available: false, models: [], error: 'LM Studio returned error' };
  } catch (err) {
    return { available: false, models: [], error: err.message };
  }
}

/**
 * Display model selection menu
 * @param {string[]} models - List of available models
 * @returns {Promise<string|null>} Selected model or null
 */
async function selectModel(models) {
  if (models.length === 0) return null;
  
  console.log('\n   Available models:');
  models.slice(0, 10).forEach((model, i) => {
    console.log(`   ${i + 1}. ${model}`);
  });
  if (models.length > 10) {
    console.log(`   ... and ${models.length - 10} more`);
  }
  
  const choice = await question('\n   Select default model (number) or press Enter to skip: ');
  const idx = parseInt(choice, 10) - 1;
  
  if (idx >= 0 && idx < models.length) {
    return models[idx];
  }
  return models[0]; // Default to first model
}

// ============================================================================
// Config File Management
// ============================================================================

const { 
  getConfigDir, 
  getConfigPath, 
  saveConfig, 
  loadConfigSafe,
  getDefaultConfig 
} = require('./config-manager');

async function setupWizard(projectRoot) {
  console.log('\n════════════════════════════════════════════════');
  console.log('🚀 Evobrew First-Time Setup');
  console.log('════════════════════════════════════════════════\n');

  const envPath = path.join(projectRoot, '.env');
  const envExamplePath = path.join(projectRoot, '.env.example');
  const dbPath = path.join(projectRoot, 'prisma', 'studio.db');
  
  // Load existing config or create default
  let config = await loadConfigSafe() || getDefaultConfig();

  // Step 1: Create .env if missing (for legacy compatibility)
  if (!fs.existsSync(envPath)) {
    console.log('📝 No configuration found. Creating .env file...\n');
    
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created .env from template\n');
    } else {
      console.log('❌ Error: .env.example not found');
      process.exit(1);
    }
  }

  // Step 2: Generate encryption key if needed
  const envContent = fs.readFileSync(envPath, 'utf8');
  const hasValidKey = envContent.match(/ENCRYPTION_KEY=[a-f0-9]{64}/);
  
  if (!hasValidKey) {
    
    console.log('🔐 Generating encryption key...');
    try {
      const { stdout } = await execAsync('openssl rand -hex 32');
      const encryptionKey = stdout.trim();
      
      const updatedEnv = envContent.replace(
        /ENCRYPTION_KEY=.*/,
        `ENCRYPTION_KEY=${encryptionKey}`
      );
      fs.writeFileSync(envPath, updatedEnv);
      console.log('✅ Encryption key generated\n');
    } catch (err) {
      console.log('⚠️  Could not auto-generate encryption key');
      console.log('   Please run: openssl rand -hex 32');
      console.log('   And add to .env as ENCRYPTION_KEY\n');
    }
  }

  // Step 3: Check for API keys (detect actual keys, not placeholders)
  console.log('🔑 API Key Configuration');
  console.log('─────────────────────────────────────────────\n');
  
  const hasOpenAI = envContent.match(/OPENAI_API_KEY=sk-proj-[^\s]+/) && 
                    !envContent.includes('your_openai_key_here');
  const hasAnthropic = envContent.match(/ANTHROPIC_API_KEY=sk-ant-[^\s]+/) && 
                       !envContent.includes('your_anthropic_key_here');
  const hasXAI = envContent.match(/XAI_API_KEY=xai-[^\s]+/) && 
                 !envContent.includes('your_xai_key_here');
  
  // Update config with detected providers
  if (hasOpenAI) {
    config.providers.openai.enabled = true;
  }
  if (hasAnthropic) {
    config.providers.anthropic.enabled = true;
  }
  if (hasXAI) {
    config.providers.xai.enabled = true;
  }
  
  if (!hasOpenAI && !hasAnthropic && !hasXAI) {
    console.log('⚠️  No cloud API keys found in .env');
    console.log('\nYou can add cloud providers OR use local models:\n');
    console.log('  Cloud providers:');
    console.log('  • OpenAI API key     (https://platform.openai.com/api-keys)');
    console.log('  • Anthropic API key  (https://console.anthropic.com/settings/keys)');
    console.log('  • xAI API key        (https://console.x.ai/)\n');
  } else {
    console.log('✅ Cloud API keys configured:');
    if (hasOpenAI) console.log('   • OpenAI');
    if (hasAnthropic) console.log('   • Anthropic');
    if (hasXAI) console.log('   • xAI (Grok)');
    console.log('');
  }

  // =========================================================================
  // Step 3.5: Local Model Detection (NEW!)
  // =========================================================================
  
  console.log('🖥️  Local Models (Ollama / LM Studio)');
  console.log('─────────────────────────────────────────────\n');
  
  const ollama = await detectOllama();
  const lmstudio = await detectLMStudio();
  
  let hasLocalProvider = false;
  
  // Ollama detection
  if (ollama.available) {
    hasLocalProvider = true;
    console.log(`✅ Ollama detected with ${ollama.models.length} models`);
    
    if (ollama.models.length > 0) {
      const selectedModel = await selectModel(ollama.models);
      
      config.providers.ollama = {
        enabled: true,
        base_url: 'http://localhost:11434',
        default_model: selectedModel,
        auto_detect: true
      };
      
      console.log(`   Default model: ${selectedModel}\n`);
    } else {
      console.log('   No models installed yet.');
      console.log('   Pull a model with: ollama pull llama3.2\n');
      
      config.providers.ollama = {
        enabled: true,
        base_url: 'http://localhost:11434',
        default_model: null,
        auto_detect: true
      };
    }
  } else {
    console.log('❌ Ollama not detected (not running or not installed)');
    config.providers.ollama = {
      enabled: false,
      base_url: 'http://localhost:11434',
      default_model: null,
      auto_detect: true
    };
  }
  
  // LM Studio detection
  if (lmstudio.available) {
    hasLocalProvider = true;
    console.log(`✅ LM Studio detected with ${lmstudio.models.length} models`);
    
    if (lmstudio.models.length > 0) {
      const selectedModel = await selectModel(lmstudio.models);
      
      config.providers.lmstudio = {
        enabled: true,
        base_url: 'http://localhost:1234/v1',
        default_model: selectedModel
      };
      
      console.log(`   Default model: ${selectedModel}\n`);
    } else {
      config.providers.lmstudio = {
        enabled: true,
        base_url: 'http://localhost:1234/v1',
        default_model: null
      };
    }
  } else {
    console.log('❌ LM Studio not detected (not running or not installed)');
    config.providers.lmstudio = {
      enabled: false,
      base_url: 'http://localhost:1234/v1',
      default_model: null
    };
  }
  
  // Neither cloud nor local providers
  if (!hasOpenAI && !hasAnthropic && !hasXAI && !hasLocalProvider) {
    console.log('\n⚠️  No AI providers configured!');
    console.log('   You need at least one provider to use Evobrew.\n');
    
    const wantLocal = await question('Would you like to set up local models? (y/n): ');
    
    if (wantLocal.toLowerCase() === 'y') {
      console.log('\n📦 Local Model Installation');
      console.log('─────────────────────────────────────────────\n');
      
      console.log('Option 1: Ollama (recommended)');
      console.log('  • Simple CLI-based model runner');
      console.log('  • Install: curl -fsSL https://ollama.com/install.sh | sh');
      console.log('  • Or download: https://ollama.com/download\n');
      
      console.log('Option 2: LM Studio');
      console.log('  • GUI-based model runner');
      console.log('  • Download: https://lmstudio.ai/\n');
      
      console.log('Recommended starter models (for Ollama):');
      console.log('  • General chat: ollama pull llama3.2');
      console.log('  • Coding:       ollama pull qwen2.5-coder:7b');
      console.log('  • Lightweight:  ollama pull phi3:mini\n');
      
      const proceed = await question('Press Enter after installing, or type "skip" to continue: ');
      
      if (proceed.toLowerCase() !== 'skip') {
        // Re-detect after user might have installed
        const ollamaRetry = await detectOllama();
        const lmstudioRetry = await detectLMStudio();
        
        if (ollamaRetry.available) {
          console.log(`\n✅ Ollama now detected with ${ollamaRetry.models.length} models!`);
          config.providers.ollama.enabled = true;
          if (ollamaRetry.models.length > 0) {
            config.providers.ollama.default_model = ollamaRetry.models[0];
          }
        }
        
        if (lmstudioRetry.available) {
          console.log(`\n✅ LM Studio now detected with ${lmstudioRetry.models.length} models!`);
          config.providers.lmstudio.enabled = true;
          if (lmstudioRetry.models.length > 0) {
            config.providers.lmstudio.default_model = lmstudioRetry.models[0];
          }
        }
      }
    } else {
      // Still need some provider
      const openEnv = await question('\nOpen .env file to add cloud API keys? (y/n): ');
      if (openEnv.toLowerCase() === 'y') {
        console.log(`\n📝 Opening ${envPath}...\n`);
        console.log('Add your API keys, save, and run: npx evobrew start\n');
        
        if (process.platform === 'darwin') {
          exec(`open -e "${envPath}"`);
        } else if (process.platform === 'linux') {
          exec(`xdg-open "${envPath}"`);
        } else {
          console.log(`Manually open: ${envPath}`);
        }
        
        rl.close();
        process.exit(0);
      }
    }
  }
  
  // Ask about local vs cloud preference if both available
  if (hasLocalProvider && (hasOpenAI || hasAnthropic || hasXAI)) {
    console.log('\n📊 Provider Preference');
    console.log('─────────────────────────────────────────────\n');
    
    const prefLocal = await question('Use local models as primary (faster, private)? (y/n): ');
    
    config.preferences = config.preferences || {};
    config.preferences.prefer_local = prefLocal.toLowerCase() === 'y';
    
    if (config.preferences.prefer_local) {
      console.log('   ✅ Local models will be used by default');
      console.log('   💡 Cloud models available as fallback\n');
    } else {
      console.log('   ✅ Cloud models will be used by default');
      console.log('   💡 Local models available for offline use\n');
    }
  }

  // Step 4: Database initialization
  if (!fs.existsSync(dbPath)) {
    console.log('🗄️  Database not initialized\n');
    const initDB = await question('Initialize database now? (y/n): ');
    
    if (initDB.toLowerCase() === 'y') {
      console.log('\n⏳ Running migrations...\n');
      try {
        await execAsync('npm run db:migrate', { cwd: projectRoot });
        console.log('✅ Database initialized\n');
      } catch (err) {
        console.log('❌ Migration failed:', err.message);
        console.log('   Try manually: npm run db:migrate\n');
      }
    }
  }

  // Step 5: Anthropic OAuth check
  const envContentFresh = fs.readFileSync(envPath, 'utf8');
  const oauthOnly = envContentFresh.match(/ANTHROPIC_OAUTH_ONLY=true/);
  const hasAnthropicKey = envContentFresh.match(/ANTHROPIC_API_KEY=sk-ant-[^\s]+/) && 
                          !envContentFresh.includes('your_anthropic_key_here');
  
  if (oauthOnly && !hasAnthropicKey) {
    console.log('\n⚠️  Warning: ANTHROPIC_OAUTH_ONLY=true but no API key found');
    console.log('    You need to set up OAuth to use Anthropic models.\n');
    
    const setupOAuth = await question('Set up Anthropic OAuth now? (y/n): ');
    
    if (setupOAuth.toLowerCase() === 'y') {
      console.log('\n⏳ Launching OAuth setup...\n');
      
      // Save config before potentially exiting
      try {
        await saveConfig(config);
        console.log('✅ Configuration saved to ~/.evobrew/config.json\n');
      } catch (err) {
        console.log('⚠️  Could not save config:', err.message);
      }
      
      rl.close();
      
      try {
        const { spawn } = require('child_process');
        const oauth = spawn('node', ['import-oauth.js'], {
          stdio: 'inherit',
          cwd: projectRoot
        });
        
        oauth.on('close', (code) => {
          if (code === 0) {
            console.log('\n✅ OAuth setup complete!\n');
            console.log('Run: npx evobrew start\n');
          } else {
            console.log('\n⚠️  OAuth setup cancelled or failed');
            console.log('   You can run it later: node import-oauth.js');
            console.log('   Or use API keys: set ANTHROPIC_OAUTH_ONLY=false in .env\n');
          }
          process.exit(code);
        });
        
        return;
      } catch (err) {
        console.log('❌ Could not launch OAuth setup:', err.message);
        console.log('   Try manually: node import-oauth.js\n');
      }
    } else {
      console.log('\n💡 To use Anthropic without OAuth:');
      console.log('   1. Add ANTHROPIC_API_KEY=sk-ant-... to .env');
      console.log('   2. Set ANTHROPIC_OAUTH_ONLY=false in .env\n');
    }
  } else if (oauthOnly && hasAnthropicKey) {
    console.log('🔐 Anthropic OAuth Configuration');
    console.log('─────────────────────────────────────────────\n');
    console.log('Your .env has ANTHROPIC_OAUTH_ONLY=true');
    console.log('This requires OAuth token setup for Anthropic models.\n');
    
    const setupOAuth = await question('Set up Anthropic OAuth now? (y/n): ');
    
    if (setupOAuth.toLowerCase() === 'y') {
      console.log('\n⏳ Launching OAuth setup...\n');
      
      // Save config before potentially exiting
      try {
        await saveConfig(config);
        console.log('✅ Configuration saved to ~/.evobrew/config.json\n');
      } catch (err) {
        console.log('⚠️  Could not save config:', err.message);
      }
      
      rl.close();
      
      try {
        const { spawn } = require('child_process');
        const oauth = spawn('node', ['import-oauth.js'], {
          stdio: 'inherit',
          cwd: projectRoot
        });
        
        oauth.on('close', (code) => {
          if (code === 0) {
            console.log('\n✅ OAuth setup complete!\n');
            console.log('Run: npx evobrew start\n');
          } else {
            console.log('\n⚠️  OAuth setup cancelled or failed');
            console.log('   You can run it later: node import-oauth.js');
            console.log('   Or use API keys: set ANTHROPIC_OAUTH_ONLY=false in .env\n');
          }
          process.exit(code);
        });
        
        return;
      } catch (err) {
        console.log('❌ Could not launch OAuth setup:', err.message);
        console.log('   Try manually: node import-oauth.js\n');
      }
    } else {
      console.log('\n💡 To use Anthropic without OAuth:');
      console.log('   Set ANTHROPIC_OAUTH_ONLY=false in .env\n');
    }
  }

  // Save configuration to ~/.evobrew/config.json
  try {
    await saveConfig(config);
    console.log('✅ Configuration saved to ~/.evobrew/config.json\n');
  } catch (err) {
    console.log('⚠️  Could not save config:', err.message);
  }

  // Done!
  rl.close();
  console.log('════════════════════════════════════════════════');
  console.log('✅ Setup Complete!');
  console.log('════════════════════════════════════════════════\n');
  console.log('Start Evobrew:   npx evobrew start');
  console.log('View config:     npx evobrew config\n');
  
  return true;
}

module.exports = { setupWizard, detectOllama, detectLMStudio };
