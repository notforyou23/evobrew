# Evobrew Setup Redesign - OpenClaw-Style

## Problem Statement

Current Evobrew setup is too hands-on:
- Local project (not global install)
- Manual start (`npx evobrew start`)
- Stops when terminal closes
- User manages lifecycle

**Goal:** Match OpenClaw's "set and forget" experience:
- Global install
- System service (runs in background)
- Auto-starts on boot
- User never thinks about it

---

## Proposed Flow

### 1. Global Installation

```bash
npm install -g evobrew
```

This installs:
- `evobrew` CLI globally
- Creates `~/.evobrew/` config directory
- NOT a local project

### 2. First-Run Onboarding

```bash
evobrew setup
```

Interactive wizard:
1. **API Keys Setup**
   - Prompt for OpenAI / Anthropic / xAI
   - Save to `~/.evobrew/config.json` (encrypted)
   - Option: Run Anthropic OAuth flow

2. **Port Configuration**
   - Default: 3405 (HTTP), 3406 (HTTPS)
   - Check if ports available
   - Offer alternatives if conflicts

3. **OpenClaw Integration** (optional)
   - Detect if OpenClaw installed
   - Prompt for Gateway URL/token
   - Test connection

4. **System Service Install**
   - Create launchd (macOS) / systemd (Linux) service
   - Enable auto-start on boot
   - Start immediately

### 3. Done

Server runs in background. Access at http://localhost:3405

---

## Commands

```bash
evobrew setup          # First-time wizard + service install
evobrew start          # Start service manually
evobrew stop           # Stop service
evobrew restart        # Restart service
evobrew status         # Check if running
evobrew logs           # View logs
evobrew config         # Edit config
evobrew uninstall      # Remove service + config
```

---

## File Structure

```
~/.evobrew/
├── config.json          # Encrypted API keys, settings
├── database.db          # SQLite (OAuth tokens, conversations)
├── logs/
│   └── evobrew.log
└── ssl/                 # Auto-generated certs
    ├── cert.pem
    └── key.pem
```

---

## Service Management

### macOS (launchd)

```xml
<!-- ~/Library/LaunchAgents/com.evobrew.server.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.evobrew.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/usr/local/lib/node_modules/evobrew/server/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/Users/USER/.evobrew/logs/error.log</string>
    <key>StandardOutPath</key>
    <string>/Users/USER/.evobrew/logs/output.log</string>
</dict>
</plist>
```

### Linux (systemd)

```ini
# ~/.config/systemd/user/evobrew.service
[Unit]
Description=Evobrew AI Development Workspace
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/local/lib/node_modules/evobrew/server/server.js
Restart=always
RestartSec=10
StandardOutput=append:/home/USER/.evobrew/logs/output.log
StandardError=append:/home/USER/.evobrew/logs/error.log

[Install]
WantedBy=default.target
```

---

## Config File (`~/.evobrew/config.json`)

```json
{
  "version": "1.0.0",
  "server": {
    "http_port": 3405,
    "https_port": 3406,
    "host": "localhost"
  },
  "providers": {
    "openai": {
      "enabled": true,
      "key_encrypted": "..."
    },
    "anthropic": {
      "enabled": true,
      "oauth": true,
      "key_encrypted": "..."
    },
    "xai": {
      "enabled": false
    }
  },
  "openclaw": {
    "enabled": true,
    "gateway_url": "ws://localhost:18789",
    "token_encrypted": "..."
  },
  "features": {
    "brain_browser": true,
    "function_calling": true,
    "https": false
  }
}
```

---

## Migration Path

For existing local installs:

```bash
# 1. Export current config
cd /path/to/old/evobrew
evobrew export-config > ~/evobrew-backup.json

# 2. Uninstall old (local)
npm uninstall

# 3. Install new (global)
npm install -g evobrew

# 4. Import config
evobrew import-config ~/evobrew-backup.json

# 5. Setup service
evobrew setup --skip-wizard  # Uses imported config
```

---

## Key Differences from OpenClaw

**Same:**
- Global install
- System service
- Auto-start on boot
- Config in home directory

**Different:**
- OpenClaw is message-based (Gateway + channels)
- Evobrew is HTTP server (web UI)
- Evobrew needs port management (OpenClaw uses WS on one port)

---

## Implementation Checklist

- [ ] Refactor to support global install
- [ ] Create service installer (launchd/systemd)
- [ ] Move config to ~/.evobrew/
- [ ] Encrypted credential storage
- [ ] Setup wizard with service install
- [ ] Status/logs commands
- [ ] Migration tool for local → global
- [ ] Update docs for new flow

---

**Estimated work:** 1-2 days for full refactor
**Result:** True "set and forget" like OpenClaw
