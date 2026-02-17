const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const PROFILE_KEY = 'openai-codex:default';

const PROFILE_DIR = path.join(os.homedir(), '.evobrew');
const PROFILE_PATH = path.join(PROFILE_DIR, 'auth-profiles.json');
const LOCAL_AUTH_PORT = 1455;
const LOCAL_AUTH_PATH = '/auth/callback';

function base64UrlEncode(input) {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('hex');
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;

  const segments = token.split('.');
  if (segments.length < 2) return null;

  const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);

  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function extractAccountIdFromJwt(jwt) {
  const parsed = decodeJwtPayload(jwt);
  return parsed?.['https://api.openai.com/auth']?.chatgpt_account_id || null;
}

function getProfilePath() {
  return PROFILE_PATH;
}

function readProfiles() {
  if (!fs.existsSync(getProfilePath())) {
    return { profiles: {} };
  }

  try {
    const raw = fs.readFileSync(getProfilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { profiles: {} };
  } catch {
    return { profiles: {} };
  }
}

function writeProfiles(payload) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(getProfilePath(), JSON.stringify(payload, null, 2), {
    mode: 0o600
  });
}

function loadOpenAICodexProfile() {
  const store = readProfiles();
  return store?.profiles?.[PROFILE_KEY] || null;
}

function saveOpenAICodexProfile(profile) {
  const store = readProfiles();
  if (!store.profiles || typeof store.profiles !== 'object') {
    store.profiles = {};
  }

  store.profiles[PROFILE_KEY] = {
    ...store.profiles[PROFILE_KEY],
    ...profile,
    updatedAt: Date.now()
  };

  writeProfiles(store);
}

function requestTokens(formData) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(formData).toString();

    const req = https.request(TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      let responseText = '';
      res.on('data', (chunk) => {
        responseText += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Token request failed: ${res.statusCode} ${responseText}`));
          return;
        }

        try {
          resolve(JSON.parse(responseText || '{}'));
        } catch (error) {
          reject(new Error(`Token response parse failure: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Token request failed: ${error.message}`));
    });

    req.write(body);
    req.end();
  });
}

function openBrowser(targetUrl) {
  if (process.platform === 'darwin') {
    exec(`open ${JSON.stringify(targetUrl)}`);
    return;
  }

  if (process.platform === 'win32') {
    exec(`start \"\" ${JSON.stringify(targetUrl)}`);
    return;
  }

  exec(`xdg-open ${JSON.stringify(targetUrl)} >/dev/null 2>&1 || true`);
}

function waitForAuthCallback(state) {
  return new Promise((resolve, reject) => {
    let cleanupCalled = false;

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '', 'http://localhost:1455');
        if (url.pathname !== LOCAL_AUTH_PATH) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Not found');
          return;
        }

        const returnedCode = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description') || '';

        if (error) {
          cleanup(errorDescription || error || 'OAuth authorization failed');
          return;
        }

        if (!returnedCode || !returnedState) {
          cleanup('OAuth callback missing code/state');
          return;
        }

        if (returnedState !== state) {
          cleanup('OAuth callback state mismatch');
          return;
        }

        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><h2>OAuth complete</h2><p>You may close this tab.</p></body></html>');
        cleanup(null, returnedCode);
      } catch (error) {
        cleanup(error.message || 'OAuth callback handler failed');
      }
    });

    const timeout = setTimeout(() => {
      cleanup('OAuth callback timeout');
    }, 10 * 60 * 1000);

    const finalize = () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      clearTimeout(timeout);
      server.close();
    };

    const cleanup = (error, code) => {
      finalize();
      if (error) {
        reject(typeof error === 'string' ? new Error(error) : error);
      } else {
        resolve(code);
      }
    };

    server.on('error', (error) => {
      cleanup(`Local callback server failed: ${error.message}`);
    });

    server.listen(LOCAL_AUTH_PORT, '127.0.0.1', () => {
      // Waiting for callback; no action needed here.
    });

  });
}

function normalizeAccountProfile(profile) {
  return {
    accessToken: profile.accessToken,
    refreshToken: profile.refreshToken,
    expires: Number(profile.expires || 0),
    accountId: profile.accountId || extractAccountIdFromJwt(profile.accessToken)
  };
}

async function exchangeCodeForTokens({ code, codeVerifier }) {
  const payload = await requestTokens({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier
  });

  if (!payload?.access_token) {
    throw new Error(payload?.error || 'Token response missing access_token');
  }

  const parsed = normalizeAccountProfile({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expires: Date.now() + Number(payload.expires_in || 3600) * 1000,
    accountId: extractAccountIdFromJwt(payload.access_token)
  });

  if (!parsed.accountId) {
    throw new Error('Missing chatgpt_account_id in token claims');
  }

  saveOpenAICodexProfile(parsed);
  return parsed;
}

async function refreshOpenAICodexToken(refreshToken) {
  const payload = await requestTokens({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken
  });

  if (!payload?.access_token) {
    throw new Error(payload?.error || 'Token response missing access_token');
  }

  const parsed = normalizeAccountProfile({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expires: Date.now() + Number(payload.expires_in || 3600) * 1000,
    accountId: extractAccountIdFromJwt(payload.access_token)
  });

  if (!parsed.accountId) {
    throw new Error('Missing chatgpt_account_id in refresh token response');
  }

  saveOpenAICodexProfile(parsed);
  return parsed;
}

function needsRefresh(expiresAt) {
  return !expiresAt || Number(expiresAt) - Date.now() <= TOKEN_REFRESH_WINDOW_MS;
}

async function getOpenAICodexCredentials() {
  const profile = loadOpenAICodexProfile();
  if (!profile?.accessToken) return null;

  const normalized = normalizeAccountProfile(profile);

  if (needsRefresh(normalized.expires)) {
    if (!normalized.refreshToken) {
      return null;
    }

    return refreshOpenAICodexToken(normalized.refreshToken);
  }

  return normalized;
}

async function loginWithOpenAICodex() {
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  const authorizationUrl = new URL(AUTHORIZE_URL);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', CLIENT_ID);
  authorizationUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizationUrl.searchParams.set('scope', SCOPE);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('state', state);

  openBrowser(authorizationUrl.toString());
  const code = await waitForAuthCallback(state);

  return exchangeCodeForTokens({ code, codeVerifier: verifier });
}

module.exports = {
  CLIENT_ID,
  AUTHORIZE_URL,
  TOKEN_URL,
  REDIRECT_URI,
  SCOPE,
  generatePKCE,
  extractAccountIdFromJwt,
  getOpenAICodexCredentials,
  refreshOpenAICodexToken,
  loginWithOpenAICodex
};
