# Evobrew CLI Reference

Complete command-line interface documentation for Evobrew.

---

## Installation

### Global Installation (Recommended)

```bash
npm install -g evobrew
```

Once installed globally, the `evobrew` command is available system-wide.

### Local Installation (Development)

```bash
git clone https://github.com/notforyou23/evobrew.git
cd evobrew
npm install
```

Use `npx evobrew` or `npm run` scripts for local installations.

---

## Core Commands

### `evobrew setup`

**Run the interactive setup wizard.**

```bash
evobrew setup
```

The wizard guides you through:
1. Generating encryption keys
2. Configuring API keys (OpenAI, Anthropic, xAI)
3. Setting server ports (HTTP/HTTPS)
4. Initializing the database
5. Optional OpenClaw Gateway configuration

**When to use:**
- First-time installation
- Reconfiguring the application
- Adding new API providers
- Changing ports or other settings

**Auto-run on first start:**
If you run `evobrew start` without configuring first, setup runs automatically.

---

### `evobrew start`

**Start the Evobrew server in foreground mode.**

```bash
evobrew start
```

**What happens:**
- Checks if setup is needed (runs wizard if first time)
- Starts the Express server
- Initializes AI providers
- Opens HTTP (port 3405) and HTTPS (port 3406) endpoints
- Logs output to console

**Stop the server:**
Press `Ctrl+C` to gracefully shut down.

**Access the IDE:**
- HTTP: http://localhost:3405
- HTTPS: https://localhost:3406 (recommended)

---

### `evobrew config`

**Open the configuration file in your default editor.**

```bash
evobrew config
```

**What it does:**
- Locates the `.env` file
- Opens it with:
  - **macOS:** TextEdit (`open -e`)
  - **Linux:** Default editor (`xdg-open`)
  - **Windows:** Displays path for manual editing

**File location:**
- Global install: `~/.evobrew/.env` (planned)
- Local install: `<project-root>/.env`

**After editing:**
Restart the server for changes to take effect:
```bash
evobrew start
```

---

## Database Commands

### `evobrew migrate` / `npm run db:migrate`

**Run database migrations.**

```bash
# Global install (planned)
evobrew migrate

# Local install
npm run db:migrate
```

**When to use:**
- First-time setup (run automatically by wizard)
- After updating Evobrew
- If database schema changes

**What it does:**
- Creates or updates `prisma/studio.db`
- Applies schema migrations
- Generates Prisma Client

---

### `evobrew db:studio` / `npm run db:studio`

**Open Prisma Studio (database GUI).**

```bash
# Global install (planned)
evobrew db:studio

# Local install
npm run db:studio
```

**What it does:**
- Launches Prisma Studio at http://localhost:5555
- View/edit conversations, OAuth tokens, settings
- Useful for debugging

---

## OAuth & Authentication

### `evobrew import-oauth` / `npm run import-oauth`

**Import Anthropic OAuth token from Claude CLI.**

```bash
# Global install (planned)
evobrew import-oauth

# Local install
npm run import-oauth
```

**Prerequisites:**
1. Install Claude CLI: `npm install -g @anthropic-ai/claude-cli`
2. Authenticate: `claude setup-token`

**What it does:**
- Reads OAuth token from `~/.claude/auth.json`
- Encrypts token using `ENCRYPTION_KEY` from `.env`
- Stores in database
- Enables Claude Pro/Max models without API usage charges

**When to use:**
- After subscribing to Claude Pro/Max
- If OAuth token expires (rare)
- Switching between API key and OAuth

**See also:** [docs/ANTHROPIC_OAUTH_SETUP.md](./ANTHROPIC_OAUTH_SETUP.md)

---

## Daemon Mode (Planned)

> **Note:** Daemon commands are planned for v1.1. Currently use PM2 or system services manually.

### `evobrew daemon install`

**Install Evobrew as a system service.**

```bash
evobrew daemon install
```

**Planned behavior:**
- macOS: Creates launchd plist
- Linux: Creates systemd service
- Windows: Creates Windows service
- Auto-start on boot

---

### `evobrew daemon start`

**Start the background service.**

```bash
evobrew daemon start
```

---

### `evobrew daemon stop`

**Stop the background service.**

```bash
evobrew daemon stop
```

---

### `evobrew daemon status`

**Check service status.**

```bash
evobrew daemon status
```

---

### `evobrew daemon uninstall`

**Remove the system service.**

```bash
evobrew daemon uninstall
```

---

## Workaround: Using PM2 for Daemon Mode

Until native daemon support is implemented, use PM2:

```bash
# Install PM2 globally
npm install -g pm2

# Start Evobrew in background
cd /path/to/evobrew
pm2 start server/server.js --name evobrew

# Auto-start on boot
pm2 startup
pm2 save

# Manage process
pm2 status evobrew
pm2 logs evobrew
pm2 restart evobrew
pm2 stop evobrew
pm2 delete evobrew
```

**See also:** [docs/DAEMON_MODE.md](./DAEMON_MODE.md)

---

## Diagnostics (Planned)

### `evobrew doctor`

**Run system diagnostics.**

```bash
evobrew doctor
```

**Planned checks:**
- ✅ Node.js version compatibility
- ✅ npm version
- ✅ `.env` file exists and has required keys
- ✅ Database is initialized
- ✅ API keys are valid
- ✅ Ports are available
- ✅ OpenClaw Gateway connection (if configured)
- ✅ SSL certificates valid

**Output example:**
```
🔍 Evobrew System Diagnostics

Node.js:     ✅ v20.11.0 (required: >= 18.0.0)
npm:         ✅ 10.2.4 (required: >= 9.0.0)
Config:      ✅ .env file found
Encryption:  ✅ ENCRYPTION_KEY set (64 chars)
API Keys:    ✅ OpenAI configured
             ✅ Anthropic (OAuth) configured
Database:    ✅ studio.db initialized
Ports:       ✅ 3405 available (HTTP)
             ✅ 3406 available (HTTPS)
OpenClaw:    ⚠️  Not configured (optional)

All critical checks passed! Run: evobrew start
```

---

## Updates (Planned)

### `evobrew update`

**Update Evobrew to the latest version.**

```bash
evobrew update
```

**Planned behavior:**
- Checks npm registry for latest version
- Shows changelog
- Prompts for confirmation
- Updates package
- Runs database migrations if needed
- Preserves configuration

**Workaround (global install):**
```bash
npm update -g evobrew
```

**Workaround (local install):**
```bash
git pull origin main
npm install
npm run db:migrate
```

---

### `evobrew version`

**Show current version.**

```bash
evobrew version
```

**Planned output:**
```
Evobrew v1.0.0
Node.js v20.11.0
Platform: darwin-arm64
```

**Workaround:**
```bash
npm list evobrew        # global
cat package.json | grep version  # local
```

---

## Environment Variables

All configuration is stored in `.env`. The setup wizard creates this file, but you can edit it manually:

### Required

```bash
# Encryption key for OAuth token storage (64 hex characters)
ENCRYPTION_KEY=your_generated_key_here
```

### API Keys (at least one required)

```bash
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
XAI_API_KEY=xai-...
```

### Server Ports

```bash
PORT=3405          # HTTP port
HTTPS_PORT=3406    # HTTPS port
BROWSER_PORT=4398  # Brain browser port (optional)
```

### OpenClaw Gateway (Optional)

```bash
OPENCLAW_GATEWAY_HOST=localhost
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_GATEWAY_TOKEN=your_token
OPENCLAW_GATEWAY_PASSWORD=your_password
```

**See also:** [OPENCLAW-INTEGRATION.md](../OPENCLAW-INTEGRATION.md)

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Configuration error (missing .env, invalid keys, etc.) |
| `2` | Database error |
| `3` | Port already in use |
| `4` | Network error |

---

## Troubleshooting

### "Command not found: evobrew"

**Problem:** CLI not installed globally or not in PATH.

**Solution:**
```bash
# Reinstall globally
npm install -g evobrew

# Or use npx (local)
npx evobrew start
```

---

### "Port 3405 already in use"

**Problem:** Another process is using the default HTTP port.

**Solution:**
```bash
# Find what's using the port
lsof -i:3405  # macOS/Linux
netstat -ano | findstr :3405  # Windows

# Change port via setup wizard
evobrew setup
# Or edit .env manually
echo 'PORT=3410' >> .env
```

---

### ".env file not found"

**Problem:** Setup not complete.

**Solution:**
```bash
evobrew setup
```

---

### "Database schema out of sync"

**Problem:** Database needs migration.

**Solution:**
```bash
npm run db:migrate
```

---

## File Locations

### Global Installation

**Planned structure:**
```
~/.evobrew/
├── .env                 # Configuration
├── prisma/
│   └── studio.db        # Database
├── ssl/
│   ├── cert.pem         # HTTPS certificate
│   └── key.pem          # HTTPS key
└── storage/
    └── brains/          # Knowledge graphs
```

### Local Installation

```
<project-root>/
├── .env                 # Configuration
├── prisma/
│   └── studio.db        # Database
├── ssl/                 # HTTPS certificates
├── storage/             # Brains, runs, etc.
├── server/              # Server code
└── public/              # Frontend assets
```

---

## Advanced Usage

### Custom Workspace Path

```bash
# Planned
evobrew start --workspace /path/to/workspace

# Workaround: Edit .env
WORKSPACE_PATH=/path/to/workspace
```

---

### Run on Custom Ports

```bash
# Via setup wizard
evobrew setup

# Or edit .env
PORT=5405
HTTPS_PORT=5406
```

---

### Debug Mode

```bash
# Planned
evobrew start --debug

# Workaround
DEBUG=* node server/server.js
```

---

### Export Configuration

```bash
# Planned
evobrew config export > evobrew-config.json
evobrew config import < evobrew-config.json
```

---

## npm Scripts (Local Development)

If you're developing or contributing to Evobrew, these npm scripts are available:

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `npm start` | Start server (production mode) |
| `dev` | `npm run dev` | Start with auto-reload (nodemon) |
| `import-oauth` | `npm run import-oauth` | Import Anthropic OAuth token |
| `db:migrate` | `npm run db:migrate` | Run database migrations |
| `db:studio` | `npm run db:studio` | Open Prisma Studio GUI |
| `db:generate` | `npm run db:generate` | Regenerate Prisma Client |

---

## See Also

- [README.md](../README.md) - Feature overview
- [INSTALL.md](../INSTALL.md) - Installation guide
- [QUICKSTART.md](../QUICKSTART.md) - Quick start guide
- [DAEMON_MODE.md](./DAEMON_MODE.md) - Running as a service
- [OPENCLAW-INTEGRATION.md](../OPENCLAW-INTEGRATION.md) - OpenClaw Gateway setup
- [ANTHROPIC_OAUTH_SETUP.md](./ANTHROPIC_OAUTH_SETUP.md) - OAuth configuration

---

## Contributing

To add new CLI commands:

1. Edit `bin/evobrew` to add command handler
2. Update this documentation
3. Add tests (when test suite exists)
4. Submit pull request

**Planned commands welcome:**
- `evobrew doctor` - System diagnostics
- `evobrew daemon *` - Service management
- `evobrew update` - Auto-update
- `evobrew backup` - Export configuration/data
- `evobrew restore` - Import configuration/data

---

**Built with 🔥 for developers who ship.**
