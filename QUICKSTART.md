# Evobrew Quick Start

## One-Time Setup (2 minutes)

```bash
# 1. Install globally
npm install -g evobrew

# 2. Run setup wizard
evobrew setup
```

The wizard will:
- Generate encryption keys
- Configure API keys (OpenAI, Anthropic, or xAI)
- Set server ports
- Initialize the database
- Optionally configure OpenClaw Gateway

## First Launch

```bash
evobrew start
```

Open http://localhost:3405 (or your configured port)

## Commands

```bash
evobrew start    # Start server
evobrew setup    # Re-run setup wizard
evobrew daemon   # Run as background service
evobrew doctor   # Check configuration
evobrew version  # Show version
```

See [docs/CLI.md](./docs/CLI.md) for complete command reference.

## Anthropic Setup

**Option A: API Key**
The setup wizard will prompt for your API key.

**Option B: OAuth (Claude Pro/Max users)**
```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-cli

# Authenticate
claude setup-token

# Import into Evobrew
evobrew import-oauth
```

See [docs/ANTHROPIC_OAUTH_SETUP.md](./docs/ANTHROPIC_OAUTH_SETUP.md) for details.

## Troubleshooting

**Port already in use:**
- Re-run `evobrew setup` and choose a different port

**Configuration errors:**
- Run `evobrew doctor` to diagnose issues
- Re-run `evobrew setup` to reconfigure

**API key errors:**
- Verify keys with `evobrew doctor`
- For Anthropic: Use OAuth (see above) or add API key via setup

## Full Documentation

- [Installation Guide](./INSTALL.md)
- [OpenClaw Integration](./OPENCLAW-INTEGRATION.md)
- [Configuration](./README.md#configuration)
