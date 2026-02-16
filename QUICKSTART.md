# Evobrew Quick Start

## One-Time Setup (5 minutes)

```bash
# 1. Clone and install
git clone https://github.com/notforyou23/evobrew.git
cd evobrew
npm install

# 2. Configure
cp .env.example .env
nano .env  # Add your API keys

# 3. Initialize database
npm run db:migrate

# 4. Start
npx evobrew start
```

## What to Add in `.env`

**Required:**
- `ENCRYPTION_KEY` - Run: `openssl rand -hex 32`
- At least one API key (OpenAI, Anthropic, or xAI)

**Optional:**
- OpenClaw Gateway settings (for persistent memory)
- Custom ports

## First Launch

Open http://localhost:3405 (or your custom port)

## Commands

```bash
npx evobrew start   # Start server
npx evobrew setup   # Show setup guide
npx evobrew config  # Open .env file
```

## Anthropic Setup

**Option A: API Key (simpler)**
```bash
# In .env:
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_OAUTH_ONLY=false
```

**Option B: OAuth (better rate limits)**
```bash
node import-oauth.js
# Opens browser for authorization
```

See [docs/ANTHROPIC_OAUTH_SETUP.md](./docs/ANTHROPIC_OAUTH_SETUP.md) for details.

## Troubleshooting

**Port already in use:**
- Change `HTTP_PORT` in `.env` to a different port (e.g., 3410)

**Database errors:**
- Run: `npm run db:migrate`

**API key errors:**
- Check `.env` has valid keys
- For Anthropic: Either use OAuth OR set `ANTHROPIC_OAUTH_ONLY=false`

## Full Documentation

- [Installation Guide](./INSTALL.md)
- [OpenClaw Integration](./OPENCLAW-INTEGRATION.md)
- [Configuration](./README.md#configuration)
