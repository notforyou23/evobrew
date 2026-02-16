# Codex / OpenAI OAuth Integration Spec

## Overview

This spec documents how to integrate OpenAI/Codex OAuth (ChatGPT subscription-based authentication) into any application. This allows users to leverage their ChatGPT Pro/Plus subscription for API access instead of using prepaid API credits.

**Benefits:**
- Uses existing ChatGPT subscription (no separate API billing)
- Higher rate limits than API keys for Pro subscribers
- Access to Codex models (gpt-5.3-codex, etc.)

---

## Token Storage Location

**Codex CLI stores OAuth tokens at:**
```
~/.codex/auth.json
```

**Structure:**
```json
{
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "<JWT>",
    "access_token": "<JWT>", 
    "refresh_token": "<opaque-token>",
    "account_id": "<uuid>"
  },
  "last_refresh": "2026-02-12T00:35:49.058705Z"
}
```

| Field | Description |
|-------|-------------|
| `OPENAI_API_KEY` | `null` when using OAuth (set when using API key instead) |
| `tokens.id_token` | JWT containing user identity claims |
| `tokens.access_token` | JWT for API authentication (this is what you use for requests) |
| `tokens.refresh_token` | Opaque token for refreshing expired access tokens |
| `tokens.account_id` | ChatGPT account UUID |
| `last_refresh` | ISO timestamp of last token refresh |

---

## Access Token Details

The `access_token` is a signed JWT with these key claims:

```json
{
  "aud": ["https://api.openai.com/v1"],
  "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
  "exp": 1771720549,
  "iss": "https://auth.openai.com",
  "scp": ["openid", "profile", "email", "offline_access"],
  "https://api.openai.com/auth": {
    "chatgpt_account_id": "<uuid>",
    "chatgpt_plan_type": "pro",
    "chatgpt_user_id": "user-xxx"
  }
}
```

**Key points:**
- Audience is `https://api.openai.com/v1`
- Contains `chatgpt_plan_type` (pro, plus, free)
- Tokens expire (check `exp` claim)
- Issued by `https://auth.openai.com`

---

## How to Use the Token

### Making API Requests

Use the `access_token` as a Bearer token:

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.3-codex",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### In Code (Node.js)

```javascript
const fs = require('fs');
const path = require('path');

function getCodexOAuthToken() {
  const authPath = path.join(process.env.HOME, '.codex', 'auth.json');
  
  if (!fs.existsSync(authPath)) {
    return null;
  }
  
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  
  // Check if using OAuth (not API key)
  if (auth.OPENAI_API_KEY) {
    return { type: 'api_key', token: auth.OPENAI_API_KEY };
  }
  
  if (!auth.tokens?.access_token) {
    return null;
  }
  
  // Check expiration
  const payload = JSON.parse(
    Buffer.from(auth.tokens.access_token.split('.')[1], 'base64').toString()
  );
  
  const expiresAt = payload.exp * 1000;
  const isExpired = Date.now() > expiresAt;
  
  return {
    type: 'oauth',
    token: auth.tokens.access_token,
    refreshToken: auth.tokens.refresh_token,
    accountId: auth.tokens.account_id,
    expiresAt: new Date(expiresAt).toISOString(),
    isExpired,
    planType: payload['https://api.openai.com/auth']?.chatgpt_plan_type
  };
}
```

---

## Token Refresh Flow

Access tokens expire. When expired, use the refresh token to get a new one.

### Refresh Endpoint

```
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
refresh_token=<refresh_token>
client_id=app_EMoamEEZ73f0CkXaXp7hrann
```

### Refresh Implementation

```javascript
async function refreshCodexToken(refreshToken) {
  const response = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token, // May be rotated
    id_token: data.id_token
  };
}
```

### Auto-Refresh Wrapper

```javascript
async function makeOpenAIRequest(endpoint, body, auth) {
  // Check if token needs refresh (with 5 min buffer)
  if (auth.isExpired || (auth.expiresAt && Date.now() > new Date(auth.expiresAt).getTime() - 300000)) {
    const newTokens = await refreshCodexToken(auth.refreshToken);
    auth.token = newTokens.access_token;
    // Persist new tokens to ~/.codex/auth.json
    await updateStoredTokens(newTokens);
  }
  
  const response = await fetch(`https://api.openai.com/v1${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  return response.json();
}
```

---

## Initial OAuth Flow (Device Auth)

If the user doesn't have tokens yet, they need to authenticate. Codex CLI uses Device Authorization flow.

### Step 1: Request Device Code

```
POST https://auth.openai.com/oauth/device/code
Content-Type: application/x-www-form-urlencoded

client_id=app_EMoamEEZ73f0CkXaXp7hrann
scope=openid profile email offline_access
audience=https://api.openai.com/v1
```

**Response:**
```json
{
  "device_code": "xxx",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://auth.openai.com/activate",
  "verification_uri_complete": "https://auth.openai.com/activate?user_code=ABCD-EFGH",
  "expires_in": 900,
  "interval": 5
}
```

### Step 2: User Authorizes

Direct user to `verification_uri_complete` or have them enter `user_code` at `verification_uri`.

### Step 3: Poll for Token

```
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code
device_code=<device_code>
client_id=app_EMoamEEZ73f0CkXaXp7hrann
```

Poll every `interval` seconds until user authorizes or `device_code` expires.

**Success Response:**
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<token>",
  "id_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 864000
}
```

---

## Integration Patterns

### Pattern 1: Import from Codex CLI (Recommended)

If user has Codex CLI installed and logged in, just import their existing tokens.

```javascript
async function importFromCodexCLI() {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  
  if (!fs.existsSync(authPath)) {
    return { success: false, error: 'Codex CLI not configured. Run: codex login' };
  }
  
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  
  if (!auth.tokens?.access_token) {
    return { success: false, error: 'No OAuth tokens found. Run: codex login' };
  }
  
  // Validate token is not expired
  const tokenInfo = getCodexOAuthToken();
  
  if (tokenInfo.isExpired) {
    // Attempt refresh
    try {
      const newTokens = await refreshCodexToken(tokenInfo.refreshToken);
      // Update stored tokens
      auth.tokens = { ...auth.tokens, ...newTokens };
      auth.last_refresh = new Date().toISOString();
      fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
    } catch (e) {
      return { success: false, error: 'Token expired and refresh failed. Run: codex login' };
    }
  }
  
  return {
    success: true,
    planType: tokenInfo.planType,
    accountId: tokenInfo.accountId,
    expiresAt: tokenInfo.expiresAt
  };
}
```

### Pattern 2: Full OAuth Flow

Implement the device auth flow in your app:

```javascript
async function startCodexOAuth() {
  // Step 1: Get device code
  const codeResponse = await fetch('https://auth.openai.com/oauth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      scope: 'openid profile email offline_access',
      audience: 'https://api.openai.com/v1'
    })
  });
  
  const { device_code, user_code, verification_uri_complete, interval, expires_in } = await codeResponse.json();
  
  console.log(`\nOpen this URL to authorize: ${verification_uri_complete}`);
  console.log(`Or go to https://auth.openai.com/activate and enter code: ${user_code}\n`);
  
  // Step 2: Poll for token
  const startTime = Date.now();
  while (Date.now() - startTime < expires_in * 1000) {
    await new Promise(r => setTimeout(r, interval * 1000));
    
    const tokenResponse = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device_code,
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann'
      })
    });
    
    const data = await tokenResponse.json();
    
    if (data.error === 'authorization_pending') {
      continue; // Keep polling
    }
    
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }
    
    // Success!
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token
    };
  }
  
  throw new Error('Authorization timed out');
}
```

---

## Evobrew Integration Plan

### Setup Wizard Addition

In `lib/setup-wizard.js`, add Codex OAuth as a provider option:

```javascript
// In provider selection
const providers = await multiSelect('Select providers to configure:', [
  { value: 'openai', label: 'OpenAI', hint: 'API Key' },
  { value: 'openai-codex', label: 'OpenAI (ChatGPT OAuth)', hint: 'Use ChatGPT subscription' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude OAuth or API Key' },
  { value: 'xai', label: 'xAI', hint: 'Grok API Key' },
  { value: 'local', label: 'Local Models', hint: 'Ollama/LMStudio' }
]);

// For openai-codex provider
if (provider === 'openai-codex') {
  info('OpenAI ChatGPT OAuth uses your ChatGPT Pro/Plus subscription.');
  
  const result = await importFromCodexCLI();
  
  if (result.success) {
    success(`ChatGPT OAuth configured (${result.planType} plan)`);
    config.providers['openai-codex'] = {
      enabled: true,
      type: 'oauth',
      source: 'codex-cli'
    };
  } else {
    warning(result.error);
    
    if (await confirm('Run OAuth flow now?', true)) {
      const tokens = await startCodexOAuth();
      // Store tokens
      config.providers['openai-codex'] = {
        enabled: true,
        type: 'oauth',
        tokens: tokens // Encrypt before storing!
      };
      success('ChatGPT OAuth configured');
    }
  }
}
```

### Server Integration

In `server/providers/`, add OpenAI OAuth adapter:

```javascript
// server/providers/adapters/openai-oauth.js

const fs = require('fs');
const path = require('path');
const os = require('os');

class OpenAIOAuthAdapter {
  constructor(config) {
    this.config = config;
    this.tokenCache = null;
  }
  
  async getAccessToken() {
    // Try Codex CLI first
    const codexAuth = path.join(os.homedir(), '.codex', 'auth.json');
    if (fs.existsSync(codexAuth)) {
      const auth = JSON.parse(fs.readFileSync(codexAuth, 'utf8'));
      if (auth.tokens?.access_token) {
        // Check expiration and refresh if needed
        return this.ensureValidToken(auth.tokens);
      }
    }
    
    // Fall back to stored config tokens
    if (this.config.tokens?.access_token) {
      return this.ensureValidToken(this.config.tokens);
    }
    
    throw new Error('No OpenAI OAuth tokens available');
  }
  
  async ensureValidToken(tokens) {
    const payload = JSON.parse(
      Buffer.from(tokens.access_token.split('.')[1], 'base64').toString()
    );
    
    // Refresh if expires within 5 minutes
    if (Date.now() > (payload.exp * 1000) - 300000) {
      const newTokens = await this.refreshToken(tokens.refresh_token);
      // Update stored tokens
      await this.updateStoredTokens(newTokens);
      return newTokens.access_token;
    }
    
    return tokens.access_token;
  }
  
  async refreshToken(refreshToken) {
    const response = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann'
      })
    });
    
    if (!response.ok) {
      throw new Error('Token refresh failed');
    }
    
    return response.json();
  }
  
  async chat(messages, options = {}) {
    const token = await this.getAccessToken();
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: options.model || 'gpt-5.3-codex',
        messages,
        ...options
      })
    });
    
    return response.json();
  }
}

module.exports = OpenAIOAuthAdapter;
```

---

## Security Considerations

1. **Token Storage**: Encrypt tokens at rest (like Anthropic OAuth tokens)
2. **Token Refresh**: Handle refresh failures gracefully (re-auth flow)
3. **Client ID**: The `client_id` is public (embedded in Codex CLI), but don't abuse it
4. **Scope Limitation**: Only request necessary scopes
5. **Token Expiration**: Always check `exp` claim before use

---

## Available Models via ChatGPT OAuth

When authenticated via ChatGPT subscription:

| Model | Description |
|-------|-------------|
| `gpt-5.3-codex` | Latest Codex model |
| `gpt-5.2-codex` | Previous Codex |
| `gpt-4o` | GPT-4o |
| `gpt-4o-mini` | Faster/cheaper GPT-4o |
| `o3-mini` | Reasoning model |
| `o3` | Full reasoning model (Pro only) |

---

## Testing

```bash
# Check if Codex CLI is logged in
codex login status

# Test API access with OAuth token
ACCESS_TOKEN=$(jq -r '.tokens.access_token' ~/.codex/auth.json)
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.data[].id' | head -10
```

---

## References

- Codex CLI: https://github.com/openai/codex
- OpenAI OAuth: https://platform.openai.com/docs/guides/authentication
- Device Auth RFC: https://datatracker.ietf.org/doc/html/rfc8628
