# OAuth Token Sink Pattern

This document explains how OAuth authentication works in the IDE Studio (standalone).

## Overview

The IDE uses the **Token Sink Pattern** from the reference implementation at `/Users/jtr/_JTR23_/COZMO/coz`. Instead of handling OAuth flows directly, it imports tokens from the official Claude CLI.

## Why Token Sink Pattern?

1. **No Web Flow Complexity**: The official Claude CLI handles all OAuth complexity
2. **Security**: OAuth flow handled by trusted official client
3. **Simplicity**: Just import the token after running `claude setup-token`
4. **Reliability**: Uses same pattern as claude-code CLI

## How It Works

### 1. Token Import Flow

```
┌─────────────────┐
│  User runs:     │
│ claude setup-   │
│    token        │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ Claude CLI handles OAuth    │
│ Stores token in:             │
│ ~/.claude/auth.json          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  User runs:                  │
│  npm run import-oauth        │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ IDE imports token from       │
│ ~/.claude/auth.json          │
│ Stores encrypted in SQLite   │
└─────────────────────────────┘
```

### 2. OAuth Token Detection

OAuth tokens are detected by their format:
- OAuth tokens: `sk-ant-oat*` (from setup-token flow)
- API keys: `sk-ant-api*` (regular API keys)

```javascript
function isOAuthToken(token) {
  return token && token.includes('sk-ant-oat');
}
```

### 3. Stealth Mode for OAuth

OAuth tokens require special headers to impersonate Claude Code CLI:

```javascript
{
  'accept': 'application/json',
  'anthropic-dangerous-direct-browser-access': 'true',
  'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,...',
  'user-agent': 'claude-cli/2.1.2 (external, cli)',
  'x-app': 'cli'
}
```

These headers tell Anthropic's API that the request is coming from Claude Code CLI.

### 4. System Prompt Injection

OAuth tokens also require a special system prompt prefix:

```javascript
{
  type: 'text',
  text: "You are Claude Code, Anthropic's official CLI for Claude.",
  cache_control: { type: 'ephemeral' }
}
```

This is prepended to all system prompts when using OAuth mode.

### 5. Anthropic SDK Usage

For OAuth tokens:
```javascript
new Anthropic({
  authToken: token,               // OAuth token
  defaultHeaders: stealthHeaders, // Stealth mode headers
  dangerouslyAllowBrowser: true   // Required for OAuth
});
```

For regular API keys:
```javascript
new Anthropic({
  apiKey: token  // Regular API key
});
```

## Implementation Files

### Core OAuth Service
- **`server/services/anthropic-oauth.js`** - Token management, import, storage
  - `importFromClaudeCLI()` - Reads from ~/.claude/auth.json
  - `getAnthropicApiKey()` - Returns credentials in correct format
  - `prepareSystemPrompt()` - Injects Claude Code identity

### AI Handler Integration
- **`server/ai-handler.js`** - Imports prepareSystemPrompt
  - Detects OAuth mode at start of handleFunctionCalling
  - Prepares system prompts with Claude Code identity when needed

### Server Integration
- **`server/server.js`** - Initializes Anthropic client
  - `getAnthropic()` - Creates client with correct auth mode
  - Uses stealth headers for OAuth tokens

### CLI Tools
- **`import-oauth.js`** - User-facing import script
  - Runs `importFromClaudeCLI()`
  - Shows status and helpful error messages
  - npm script: `npm run import-oauth`

## Usage

### Setup OAuth

```bash
# 1. Install Claude CLI
npm install -g @anthropic-ai/claude-cli

# 2. Run OAuth setup
claude setup-token

# 3. Import token into IDE
cd /Users/jtr/_JTR23_/cosmo_ide_v2_dev
npm run import-oauth
```

### Check Status

In your code:
```javascript
const { getOAuthStatus } = require('./server/services/anthropic-oauth');

const status = await getOAuthStatus();
console.log(status);
// {
//   configured: true,
//   source: 'oauth',  // or 'api_key' or 'env_fallback'
//   valid: true,
//   expiresAt: '2026-02-02T10:18:38.699Z'
// }
```

### Clear Token

```javascript
const { clearToken } = require('./server/services/anthropic-oauth');
await clearToken();
```

## Token Storage

Tokens are stored encrypted in SQLite:

```prisma
model SystemConfig {
  key       String    @id
  value     String    // Encrypted token
  expiresAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
```

Key: `anthropic_oauth`
Value: AES-256-GCM encrypted JSON:
```json
{
  "token": "sk-ant-oat...",
  "expiresAt": 1738493918699,
  "updatedAt": 1738407518699,
  "type": "oauth"
}
```

## Fallback Behavior

Priority order:
1. **OAuth token from database** (if valid)
2. **API key from .env** (`ANTHROPIC_API_KEY`)
3. **Error thrown** (no credentials available)

The IDE automatically falls back to `.env` API key if:
- No OAuth token imported
- OAuth token expired
- OAuth token invalid
- Database read error

## Differences from Web OAuth Flow

### Old Approach (Removed)
- ❌ Web-based OAuth UI (oauth-setup.html)
- ❌ Manual copy/paste of callback URL
- ❌ Direct token exchange with Anthropic API
- ❌ Complex PKCE flow in server

### New Approach (Token Sink)
- ✅ Uses official Claude CLI
- ✅ Simple import from ~/.claude/auth.json
- ✅ No web UI needed
- ✅ Matches reference implementation

## Reference Implementation

Based on:
- `/Users/jtr/_JTR23_/COZMO/coz/auth.js` - Auth module
- `/Users/jtr/_JTR23_/COZMO/coz/agent/loop.js` - Provider integration
- `/Users/jtr/_JTR23_/COZMO/lib/providers/adapters/anthropic.js` - OAuth stealth mode

## Security Notes

- Tokens encrypted with AES-256-GCM
- Encryption key in `.env` (ENCRYPTION_KEY)
- Database file permissions: 0600
- No tokens in logs (only prefixes shown)
- Stealth headers required to prevent OAuth rejection

## Troubleshooting

### "Claude CLI auth file not found"
```bash
# Run Claude CLI setup first
claude setup-token
```

### "OAuth authentication is currently not supported"
- Ensure stealth headers are enabled
- Verify system prompt has Claude Code identity
- Check token format (should be sk-ant-oat*)

### Token expired
```bash
# Re-run Claude CLI setup
claude setup-token

# Re-import
npm run import-oauth
```

### Fallback to API key
- This is normal and automatic
- IDE will use ANTHROPIC_API_KEY from .env
- No error unless both OAuth and .env key missing

## Future Enhancements

Possible improvements (not implemented):
- Auto-import on server start if ~/.claude/auth.json exists
- Token refresh (if Claude supports refresh tokens)
- Multiple profile support (multiple OAuth accounts)
- Status endpoint in server API

## Conclusion

The Token Sink Pattern is simpler, more reliable, and matches the reference implementation. It leverages the official Claude CLI for OAuth complexity while keeping the IDE code clean and maintainable.
