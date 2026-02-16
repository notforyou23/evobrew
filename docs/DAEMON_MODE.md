# Evobrew Daemon Mode

Evobrew can run in two modes:

## Mode 1: Project Mode (Default)

Run Evobrew as a local project:

```bash
cd ~/projects/my-brain-workspace
npm install evobrew
npx evobrew start
```

**Use when:**
- You want multiple Evobrew instances with different configs
- You're actively developing/experimenting
- You want manual control

## Mode 2: Daemon Mode ✅ IMPLEMENTED

Install Evobrew as a background service that runs automatically:

```bash
npm install -g evobrew
evobrew daemon install
```

**Use when:**
- You want one always-running Evobrew instance
- You want it to auto-start on boot
- You want "set and forget" like OpenClaw

---

## Daemon Installation

### macOS

```bash
# Install globally
npm install -g evobrew

# Run setup wizard (first time only)
evobrew setup

# Install as launchd service
evobrew daemon install

# Service is now running and will auto-start on boot
```

**What happens:**
1. Creates plist at `~/Library/LaunchAgents/com.evobrew.server.plist`
2. Loads service with `launchctl load`
3. Starts service immediately
4. Service auto-restarts if it crashes (`KeepAlive`)
5. Service auto-starts on login (`RunAtLoad`)

### Linux

```bash
# Install globally
npm install -g evobrew

# Run setup wizard (first time only)
evobrew setup

# Install as systemd user service
evobrew daemon install

# Service is now running
```

**What happens:**
1. Creates unit at `~/.config/systemd/user/evobrew.service`
2. Enables lingering so service runs without login session
3. Enables and starts service
4. Service auto-restarts on failure

### Windows

Windows is not directly supported. Use WSL2 with systemd enabled:

```bash
# In WSL2
wsl --update
# Enable systemd in /etc/wsl.conf

# Then follow Linux instructions
npm install -g evobrew
evobrew daemon install
```

---

## Commands

```bash
# Lifecycle
evobrew daemon install     # Install + start service
evobrew daemon uninstall   # Stop + remove service
evobrew daemon start       # Start service manually
evobrew daemon stop        # Stop service
evobrew daemon restart     # Restart service

# Monitoring
evobrew daemon status      # Check if running (PID, uptime, port)
evobrew daemon logs        # Tail logs (Ctrl+C to stop)
evobrew daemon logs -n 100 # Show last 100 lines
evobrew daemon logs --error # Show error logs
```

---

## File Locations

### macOS

| File | Location |
|------|----------|
| Config | `~/.evobrew/config.json` |
| Server Log | `~/.evobrew/logs/server.log` |
| Error Log | `~/.evobrew/logs/error.log` |
| Plist | `~/Library/LaunchAgents/com.evobrew.server.plist` |

### Linux

| File | Location |
|------|----------|
| Config | `~/.evobrew/config.json` |
| Server Log | `~/.evobrew/logs/server.log` |
| Error Log | `~/.evobrew/logs/error.log` |
| Unit | `~/.config/systemd/user/evobrew.service` |

---

## Log Rotation

Logs are automatically managed:
- **Max size:** 10MB per log file
- **Retention:** 7 days
- **Compression:** Old logs are gzip'd

Run manually if needed:
```bash
node -e "require('./lib/daemon-manager').maintainLogs()"
```

---

## Daemon vs Project Mode Comparison

| Feature | Project Mode | Daemon Mode |
|---------|--------------|-------------|
| **Install** | `npm install` (local) | `npm install -g evobrew` |
| **Start** | `npx evobrew start` | Automatic (on boot) |
| **Stop** | Ctrl+C | `evobrew daemon stop` |
| **Config** | `.env` in project | `~/.evobrew/config.json` |
| **Multiple instances** | ✅ Yes | ❌ One per user |
| **Auto-start on boot** | ❌ No | ✅ Yes |
| **Runs in background** | ❌ Terminal only | ✅ Always |
| **Use case** | Development | Production |

---

## Troubleshooting

### Service won't start

1. Check logs:
   ```bash
   evobrew daemon logs
   evobrew daemon logs --error
   ```

2. Verify Node.js is accessible:
   ```bash
   which node
   node -v
   ```

3. Check plist/unit manually:
   
   **macOS:**
   ```bash
   cat ~/Library/LaunchAgents/com.evobrew.server.plist
   launchctl list | grep evobrew
   ```
   
   **Linux:**
   ```bash
   cat ~/.config/systemd/user/evobrew.service
   systemctl --user status evobrew
   journalctl --user -u evobrew -n 50
   ```

### Port already in use

1. Check what's using the port:
   ```bash
   lsof -i :3405
   ```

2. Change port in config:
   ```json
   // ~/.evobrew/config.json
   {
     "server": {
       "http_port": 3407
     }
   }
   ```

3. Restart:
   ```bash
   evobrew daemon restart
   ```

### Reinstall fresh

```bash
evobrew daemon uninstall
rm -rf ~/.evobrew/logs/*
evobrew daemon install
```

---

## Manual Service Management (Advanced)

### macOS (launchctl)

```bash
# View service status
launchctl list | grep com.evobrew

# Load service manually
launchctl load ~/Library/LaunchAgents/com.evobrew.server.plist

# Unload service
launchctl unload ~/Library/LaunchAgents/com.evobrew.server.plist

# Start/stop
launchctl start com.evobrew.server
launchctl stop com.evobrew.server
```

### Linux (systemctl)

```bash
# View service status
systemctl --user status evobrew

# Enable/disable
systemctl --user enable evobrew
systemctl --user disable evobrew

# Start/stop/restart
systemctl --user start evobrew
systemctl --user stop evobrew
systemctl --user restart evobrew

# View logs
journalctl --user -u evobrew -f
```

---

## Migration: Project → Daemon

```bash
# 1. Export your current .env
cd /path/to/evobrew-project
cat .env > ~/evobrew-backup.env

# 2. Install daemon globally
npm install -g evobrew
evobrew setup

# 3. Import settings (manual)
# Copy API keys from evobrew-backup.env to ~/.evobrew/config.json

# 4. Install service
evobrew daemon install

# 5. Verify it works
evobrew daemon status
curl http://localhost:3405

# 6. Remove old project (optional)
rm -rf /path/to/evobrew-project
```

---

## Which Mode Should I Use?

**Choose Daemon Mode if:**
- You want one stable Evobrew instance
- You want it always available
- You don't need multiple workspaces
- You want OpenClaw-like experience

**Choose Project Mode if:**
- You want to experiment with different configs
- You want multiple Evobrew instances
- You prefer manual control
- You're developing/testing

**You can use both!** Run daemon for your main workspace, plus local projects for experiments.
