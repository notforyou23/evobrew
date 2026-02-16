# Anthropic OAuth Setup

Evobrew supports Anthropic OAuth for enhanced security and higher rate limits.

## Quick Setup

```bash
# After npm install and .env configuration:
node import-oauth.js
```

This will:
1. Open browser to Anthropic authorization
2. You authorize the app
3. Token is encrypted and stored in database
4. Models work automatically

## Manual Token Import (if you have a token)

```bash
node import-oauth-token.js
# Paste your OAuth token when prompted
```

## Using API Keys Instead

Don't want OAuth? That's fine:

**In `.env`:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_OAUTH_ONLY=false  # Important!
```

This uses regular API keys instead of OAuth.

## Troubleshooting

**"OAuth token required" error:**
- Either run `node import-oauth.js` to set up OAuth
- OR set `ANTHROPIC_OAUTH_ONLY=false` in `.env` to use API keys

**Token expired:**
```bash
node import-oauth.js  # Re-authorize
```

## See Also

- [OAUTH-TOKEN-SINK.md](../OAUTH-TOKEN-SINK.md) - Full OAuth architecture
- [QUICKSTART.md](../QUICKSTART.md) - Initial setup guide
