# COSMO IDE - Installation Guide

**Get from "git clone" to working IDE in 5 minutes.**

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)

---

## System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| **Node.js** | 18.0.0 or higher |
| **npm** | 9.0.0 or higher |
| **Git** | Any recent version |
| **RAM** | 4GB |
| **Disk Space** | 500MB free |
| **Operating System** | macOS 13+, Ubuntu 22.04+, Windows 10+, Raspberry Pi OS |

### Recommended

| Component | Recommendation |
|-----------|----------------|
| **Node.js** | 20.0.0+ |
| **npm** | 10.0.0+ |
| **RAM** | 8GB+ |
| **Disk Space** | 2GB free |

### Browser Compatibility

- **Chrome** 120+
- **Safari** 17+
- **Firefox** 121+
- **Edge** 120+

### Platform Notes

- **macOS:** Full support, HTTPS with local certificate
- **Linux:** Full support, may require permissions setup
- **Windows:** Full support, may need build tools for native modules
- **Raspberry Pi:** Cloud providers only (Ollama disabled) — see [PI-DEPLOYMENT.md](PI-DEPLOYMENT.md)

---

## Quick Start (5 Minutes)

### Prerequisites Check

Before starting, verify your system meets requirements:

```bash
node --version  # Should show v18.0.0 or higher
npm --version   # Should show 9.0.0 or higher
git --version   # Any recent version
```

**If Node.js is not installed or version is too old:**

- **macOS:** `brew install node` or download from [nodejs.org](https://nodejs.org/)
- **Windows:** Download installer from [nodejs.org](https://nodejs.org/)
- **Linux:** `sudo apt install nodejs npm` or use [nvm](https://github.com/nvm-sh/nvm)

### Installation Steps

```bash
# 1. Get the repository (30 seconds)
# Option A: Clone from repository (if you have git access)
git clone <repository-url>
cd cosmo_ide

# Option B: Navigate to extracted directory (if you downloaded a zip)
cd cosmo_ide

# 2. Install dependencies (2 minutes)
npm install

# 3. Generate encryption key (5 seconds)
openssl rand -hex 32
# Copy the output - you'll need it for .env

# 4. Create environment file (1 minute)
cp .env.example .env
# Edit .env and add:
#   - ENCRYPTION_KEY=<paste the key from step 3>
#   - OPENAI_API_KEY=sk-proj-... (or other provider API key)

# 5. Initialize database (30 seconds)
npm run db:migrate

# 6. Start server (10 seconds)
npm start
```

**✅ Success!** Open your browser to:
- **HTTP:** http://localhost:4405
- **HTTPS:** https://localhost:4406 (recommended for full features)

**First time using HTTPS?** Your browser will show a security warning. Click "Advanced" → "Continue to localhost" to trust the self-signed certificate. See [Platform-Specific Setup](#platform-specific-setup) for details.

---

## Detailed Installation

### Step 1: Prerequisites

#### Check Current Versions

```bash
node --version
npm --version
git --version
```

**Expected output:**
```
v20.11.0  # or any version >= 18.0.0
10.2.4    # or any version >= 9.0.0
git version 2.39.0
```

#### Install or Update Node.js (if needed)

**macOS (using Homebrew):**
```bash
brew install node
```

**Windows:**
1. Download installer from https://nodejs.org/
2. Run installer and follow prompts
3. Restart terminal

**Linux (Ubuntu/Debian):**
```bash
# Option 1: Official repository (may be older version)
sudo apt update
sudo apt install nodejs npm

# Option 2: NodeSource repository (latest version)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**Using nvm (recommended for managing multiple versions):**
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install latest Node.js LTS
nvm install --lts
nvm use --lts
```

**⏱️ Time:** 2-5 minutes depending on method

---

### Step 2: Get the Repository

**Option A: Clone from Git (if you have repository access)**

```bash
git clone <repository-url>
cd cosmo_ide
```

**Expected output:**
```
Cloning into 'cosmo_ide'...
remote: Enumerating objects: 1247, done.
remote: Counting objects: 100% (1247/1247), done.
remote: Compressing objects: 100% (856/856), done.
remote: Total 1247 (delta 423), reused 1102 (delta 305), pack-reused 0
Receiving objects: 100% (1247/1247), 2.84 MiB | 5.21 MiB/s, done.
Resolving deltas: 100% (423/423), done.
```

**Option B: Extract from Archive (if you downloaded a .zip/.tar.gz)**

```bash
# Extract the archive (adjust filename as needed)
unzip cosmo_ide.zip
# OR
tar -xzf cosmo_ide.tar.gz

# Navigate into directory
cd cosmo_ide
```

**What this does:** Gets the complete IDE source code onto your machine.

**If this fails:**
- **"git: command not found"** → Install Git: https://git-scm.com/downloads
- **Permission denied** → Check your internet connection and repository access
- **Repository not found** → Verify you have the correct repository URL or download link

**⏱️ Time:** 30 seconds (depends on network speed)

---

### Step 3: Install Dependencies

```bash
npm install
```

**Expected output:**
```
npm WARN deprecated <package>@<version>: ...  # Warnings are normal
added 247 packages, and audited 248 packages in 45s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

**What this does:**
- Installs all required Node.js packages (Express, OpenAI SDK, Anthropic SDK, Prisma, etc.)
- Downloads and compiles native modules (hnswlib-node for vector search)
- Sets up Prisma Client for database access

**If this fails:**

**"EACCES: permission denied"** (Linux/macOS):
```bash
# Fix npm permissions (don't use sudo with npm install!)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install
```

**"gyp ERR! build error"** (Windows):
```bash
# Install Windows build tools
npm install --global windows-build-tools
npm install
```

**"Cannot find module 'node-gyp'"**:
```bash
npm install -g node-gyp
npm install
```

**General troubleshooting:**
```bash
# Clear npm cache and retry
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

**⏱️ Time:** 1-3 minutes (depends on network and CPU)

---

### Step 4: Generate Encryption Key

The IDE uses encryption to securely store OAuth tokens in the database. You need to generate a random 64-character hexadecimal key.

```bash
openssl rand -hex 32
```

**Expected output:**
```
a7f3e9d2c8b1a4f6e9d7c3b8a2f5e1d9c4b7a3f8e2d6c9b5a1f4e8d3c7b2a6f9
```

**Copy this entire string** — you'll need it in the next step.

**What this does:** Generates a cryptographically secure random key for encrypting sensitive data (OAuth tokens, API keys) stored in the database.

**If openssl is not installed:**

**macOS:** Already included  
**Windows:** Install [Git for Windows](https://gitforwindows.org/) (includes OpenSSL) or use:
```powershell
# PowerShell alternative
-join ((48..57) + (97..102) | Get-Random -Count 64 | % {[char]$_})
```

**Linux:** `sudo apt install openssl`

**⏱️ Time:** 5 seconds

---

### Step 5: Configure Environment

```bash
# Copy the example configuration
cp .env.example .env

# Edit the file with your preferred editor
nano .env
# OR
code .env
# OR
vim .env
```

**Minimum required configuration:**

```bash
# Required: Encryption key from Step 4
ENCRYPTION_KEY=a7f3e9d2c8b1a4f6e9d7c3b8a2f5e1d9c4b7a3f8e2d6c9b5a1f4e8d3c7b2a6f9

# Required: At least one AI provider API key
OPENAI_API_KEY=sk-proj-your_key_here
# OR
ANTHROPIC_API_KEY=sk-ant-your_key_here
# OR both

# Optional: Additional providers
XAI_API_KEY=xai-your_key_here

# Server ports (defaults shown, change if needed)
PORT=4405
HTTPS_PORT=4406
```

**Where to get API keys:**

| Provider | Signup URL | Notes |
|----------|------------|-------|
| **OpenAI** | https://platform.openai.com/api-keys | GPT-4o, GPT-4, etc. Pay-as-you-go |
| **Anthropic** | https://console.anthropic.com/settings/keys | Claude Sonnet/Opus. Use OAuth for Pro/Max subscriptions (see below) |
| **xAI** | https://console.x.ai/ | Grok models (optional) |

**What this does:** Configures the IDE with your credentials and preferences. The `.env` file is gitignored so your secrets never get committed to version control.

**See also:**
- Full configuration guide: [Configuration Reference](#configuration-reference)
- API key setup: Next steps section below

**⏱️ Time:** 1-2 minutes (excluding getting API keys)

---

### Step 6: Initialize Database

```bash
npm run db:migrate
```

**Expected output:**
```
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "studio.db" at "file:./prisma/studio.db"

SQLite database studio.db created at file:./prisma/studio.db

Applying migration `20240101000000_init`

The following migration(s) have been applied:

migrations/
  └─ 20240101000000_init/
    └─ migration.sql

Your database is now in sync with your schema.

✔ Generated Prisma Client (5.0.0) to ./node_modules/@prisma/client in 123ms
```

**What this does:**
- Creates a SQLite database file at `prisma/studio.db`
- Sets up tables for conversations, OAuth tokens, and IDE settings
- Generates Prisma Client for database access

**If this fails:**

**"Environment variable not found: DATABASE_URL":**
```bash
# DATABASE_URL should be auto-set by Prisma, but you can add it manually:
echo 'DATABASE_URL="file:./prisma/studio.db"' >> .env
npm run db:migrate
```

**"Prisma CLI not found":**
```bash
# Reinstall dependencies
npm install
npm run db:migrate
```

**⏱️ Time:** 30 seconds

---

### Step 7: Start the Server

```bash
npm start
```

**Expected output:**
```
🚀 COSMO IDE Studio (Standalone)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 Workspace:  /Users/you/cosmo_ide
🏠 Hostname:   your-machine.local

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔌 HTTP:  http://localhost:4405
🔒 HTTPS: https://localhost:4406 (recommended)
🌐 Network: http://192.168.1.123:4405
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Providers initialized:
  ✓ OpenAI (GPT-4o, GPT-4)
  ✓ Anthropic (Claude Sonnet, Claude Opus)

✅ Server ready - listening on port 4405 (HTTP) and 4406 (HTTPS)
```

**What this does:**
- Starts the Express server
- Initializes AI provider connections
- Generates self-signed HTTPS certificate (if not present)
- Makes the IDE accessible via browser

**If this fails:**

**"Error: listen EADDRINUSE: address already in use :::4405":**
```bash
# Option 1: Change port in .env
echo 'PORT=3410' >> .env
npm start

# Option 2: Kill the process using port 4405
lsof -ti:4405 | xargs kill
npm start

# Option 3: Find what's using the port
lsof -i:4405
```

**"ENCRYPTION_KEY not set":**
```bash
# Go back to Step 4 and add the key to .env
```

**"Cannot find module 'xyz'":**
```bash
# Reinstall dependencies
npm install
npm start
```

**⏱️ Time:** 10 seconds to start

**Keep this terminal window open** — the server logs will appear here. To stop the server later, press `Ctrl+C`.

---

### Step 8: Open the IDE

Open your web browser and navigate to:

- **HTTP:** http://localhost:4405
- **HTTPS (recommended):** https://localhost:4406

**First-time HTTPS certificate warning:**

When you visit the HTTPS URL for the first time, your browser will show a security warning because the certificate is self-signed (not from a trusted authority). This is normal for local development.

**How to proceed:**
- **Chrome/Edge:** Click "Advanced" → "Proceed to localhost (unsafe)"
- **Firefox:** Click "Advanced" → "Accept the Risk and Continue"
- **Safari:** Click "Show Details" → "Visit this website" → "Visit Website"

**Why HTTPS?** It enables full clipboard functionality in Monaco Editor and other modern browser APIs. For local development, self-signed certificates are perfectly safe.

**See [Platform-Specific Setup](#platform-specific-setup)** for how to permanently trust the certificate.

---

## Verification

### Test the Installation

Once the IDE loads in your browser, verify everything works:

#### 1. File Tree Loads ✅

**What to see:**
- Left sidebar shows a file tree
- Root folder shows your system directory or project folder

**If empty:**
- Click "Browse" at the top of the file tree
- Navigate to any project folder (e.g., the cosmo_ide folder itself)

---

#### 2. AI Model Available ✅

**What to see:**
- Top toolbar has a dropdown labeled "Select Model"
- Dropdown shows available models (e.g., "GPT-4o", "Claude Sonnet 4.5")

**If no models appear:**
- Check that you added at least one API key in `.env`
- Restart the server (`Ctrl+C` then `npm start`)
- Check server console for errors

---

#### 3. Send Test Message ✅

**Steps:**
1. Click "New Chat" button
2. Select a model from dropdown
3. Type: `Hello! Can you confirm you're working?`
4. Press Enter or click Send

**Expected result:**
- Message appears in chat
- AI response streams in (you see text appearing word-by-word)
- Response includes confirmation

**Example response:**
```
Hello! Yes, I'm working correctly. I'm connected to the COSMO IDE and ready to help you with coding tasks. I can read files, search your codebase, make edits, and more. What would you like to work on?
```

---

#### 4. Test Code Reading (Optional) ✅

**Steps:**
1. Click on a file in the file tree (e.g., `package.json`)
2. File content loads in Monaco editor
3. Select some text
4. In chat, ask: `What does this code do?`

**Expected result:**
- AI explains the selected code
- Demonstrates that function calling is working (AI can read file content)

---

#### 5. Access from Another Device (Optional) ✅

If you want to access the IDE from your phone, tablet, or another computer on the same network:

1. Note the **Network URL** from the server startup output (e.g., `http://192.168.1.123:4405`)
2. Open that URL on the other device
3. Same IDE loads, same workspace

**For HTTPS from other devices:** See [Platform-Specific Setup](#platform-specific-setup) for certificate installation steps.

---

## Configuration Reference

### Environment Variables (.env)

Here's a complete breakdown of all available configuration options:

#### Required

```bash
# Encryption key for OAuth token storage (generated with: openssl rand -hex 32)
ENCRYPTION_KEY=your_64_character_hex_string_here
```

#### API Keys (at least one required)

```bash
# OpenAI (GPT-4o, GPT-4, etc.)
OPENAI_API_KEY=sk-proj-your_key_here

# Anthropic (Claude Sonnet, Claude Opus)
# Note: If you have Claude Pro/Max, use OAuth instead (see below)
ANTHROPIC_API_KEY=sk-ant-your_key_here

# xAI (Grok)
XAI_API_KEY=xai-your_key_here
```

#### Server Ports

```bash
# HTTP port for main IDE
PORT=4405

# HTTPS port for main IDE
HTTPS_PORT=4406

# Brain Browser port (separate lightweight interface)
BROWSER_PORT=4398
```

**Note:** If ports are already in use on your system, change these values to any available ports (e.g., 5405, 5406, 5398).

#### OpenClaw Gateway (Optional)

If you're integrating with OpenClaw (COZ agent with persistent memory):

```bash
# OpenClaw Gateway connection
OPENCLAW_GATEWAY_HOST=localhost
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_GATEWAY_TOKEN=your_gateway_token_here
OPENCLAW_GATEWAY_PASSWORD=your_gateway_password_here
```

**See:** [OPENCLAW-INTEGRATION.md](OPENCLAW-INTEGRATION.md) for details.

#### Storage Paths (Optional)

By default, the IDE stores data in `./storage/`. Override if needed:

```bash
# Custom storage locations
BRAIN_STORAGE_PATH=/custom/path/to/brains
RUNS_PATH=/custom/path/to/runs
```

#### Database URL (Managed by Prisma)

You typically don't need to set this — Prisma auto-configures it. But if you want to use a different database location:

```bash
DATABASE_URL="file:./custom-path/studio.db"
```

---

### OAuth Setup (Recommended for Claude Pro/Max Users)

If you have a **Claude Pro or Claude Max subscription**, you can use OAuth authentication instead of API keys. This gives you access to your subscription models without paying for additional API usage.

**How it works:** COSMO IDE imports your OAuth token from the Claude CLI and stores it encrypted in the database using the "Token Sink Pattern."

#### Step 1: Install Claude CLI

```bash
npm install -g @anthropic-ai/claude-cli
```

#### Step 2: Authenticate with Claude

```bash
claude setup-token
```

**Expected flow:**
1. Opens browser to Anthropic authentication page
2. You log in with your Claude Pro/Max account
3. CLI stores token in `~/.claude/auth.json`

#### Step 3: Import Token into IDE

```bash
npm run import-oauth
```

**Expected output:**
```
✅ Successfully imported OAuth token for Anthropic
Token type: sk-ant-oat*************
Stored encrypted in database
```

#### Step 4: Verify

Restart the server and check the startup output:

```bash
npm start
```

**Look for:**
```
✅ Providers initialized:
  ✓ Anthropic (OAuth) - Claude Sonnet, Claude Opus
```

**"(OAuth)" indicates OAuth is active.**

#### Fallback Behavior

If OAuth token is not available or expired, the IDE automatically falls back to `ANTHROPIC_API_KEY` from `.env`. No manual switching needed.

**Token expiration:** OAuth tokens (sk-ant-oat*) are long-lived and don't require refresh in most cases. If expired, run `claude setup-token && npm run import-oauth` again.

**See also:** [OAUTH-TOKEN-SINK.md](OAUTH-TOKEN-SINK.md) for technical details.

---

### HTTPS vs HTTP Mode

**HTTPS (Port 4406) — Recommended**

Pros:
- ✅ Full clipboard functionality in Monaco Editor
- ✅ Modern browser APIs (Service Workers, etc.)
- ✅ More secure for network access

Cons:
- ⚠️ Requires trusting self-signed certificate (one-time setup per device)

**HTTP (Port 4405) — Fallback**

Pros:
- ✅ No certificate warnings
- ✅ Works immediately

Cons:
- ❌ Clipboard APIs may not work
- ❌ Some modern browser features disabled
- ❌ Less secure if accessed over network

**Recommendation:** Use HTTPS for best experience. The certificate trust is a one-time setup (see below).

---

## Platform-Specific Setup

### macOS

#### Trust HTTPS Certificate (One-Time)

**Option 1: Browser Trust (Quick)**

1. Open https://localhost:4406
2. Click "Show Details" → "Visit this website" → "Visit Website"
3. Done — certificate trusted for this browser

**Option 2: System Keychain (Permanent)**

1. Open **Keychain Access** app
2. File → Import Items → Select `ssl/cert.pem` from your COSMO IDE directory
3. Find the certificate in the list (look for "localhost" or your IP address)
4. Double-click the certificate
5. Expand **"Trust"** section
6. Set "When using this certificate" to **"Always Trust"**
7. Close (enter password when prompted)
8. Certificate now trusted system-wide (all browsers)

#### Firewall

If accessing from other devices on your network:

1. System Settings → Network → Firewall (if enabled)
2. Click "Options"
3. Ensure "Block all incoming connections" is **unchecked**
4. Add Node.js to allowed apps if prompted

---

### Windows

#### Trust HTTPS Certificate

**Option 1: Browser Trust (Quick)**

1. Open https://localhost:4406
2. Click "Advanced" → "Continue to localhost (unsafe)"
3. Done for Chrome/Edge

**Option 2: Certificate Store (Permanent)**

1. Copy `ssl/cert.pem` from COSMO IDE directory to Desktop
2. Rename to `cert.crt` (Windows recognizes .crt extension)
3. Double-click `cert.crt`
4. Click "Install Certificate"
5. Store Location: **Local Machine** (requires admin) or **Current User**
6. Click "Next"
7. Select "Place all certificates in the following store"
8. Click "Browse" → Select **"Trusted Root Certification Authorities"**
9. Click "Next" → "Finish"
10. Accept security warnings

#### Firewall

If accessing from other devices:

1. Windows Defender Firewall → Allow an app through firewall
2. Click "Change settings" (requires admin)
3. Click "Allow another app"
4. Browse to Node.js executable (usually `C:\Program Files\nodejs\node.exe`)
5. Check both "Private" and "Public" networks
6. Click "Add"

#### Build Tools (for npm install)

If you see "gyp ERR!" errors during `npm install`:

```bash
npm install --global windows-build-tools
```

This installs Python and Visual Studio Build Tools needed for native modules.

---

### Linux (Ubuntu/Debian)

#### Trust HTTPS Certificate

**Option 1: Browser Trust (Quick)**

- **Chrome/Chromium:** Navigate to https://localhost:4406 → Click "Advanced" → "Proceed to localhost"
- **Firefox:** Navigate → Click "Advanced" → "Accept the Risk and Continue"

**Option 2: System Trust (Permanent)**

```bash
# Copy certificate to system trust store
sudo cp ssl/cert.pem /usr/local/share/ca-certificates/cosmo-ide.crt

# Update certificate store
sudo update-ca-certificates

# Restart browser
```

#### Permissions

If you get permission errors:

```bash
# Ensure npm doesn't require sudo
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

#### Dependencies

Some Linux distributions may need additional dependencies for native modules:

```bash
# Build tools
sudo apt install build-essential

# Python (for node-gyp)
sudo apt install python3
```

#### Firewall

```bash
# Allow Node.js through firewall
sudo ufw allow 4405/tcp
sudo ufw allow 4406/tcp
sudo ufw reload
```

---

### Raspberry Pi

COSMO IDE runs on Raspberry Pi with **cloud providers only**. Local AI models (Ollama) are automatically disabled.

**What works:**
- ✅ OpenAI (GPT-4o, GPT-4)
- ✅ Anthropic (Claude Sonnet/Opus via OAuth or API key)
- ✅ xAI (Grok)
- ✅ All IDE features (file tree, editing, semantic search)

**What's disabled:**
- ❌ Ollama (local models not practical on Pi hardware)
- ❌ Local embeddings

**Platform detection:** The IDE automatically detects Pi and skips Ollama initialization (saves startup time).

**Full guide:** See [PI-DEPLOYMENT.md](PI-DEPLOYMENT.md) for detailed Pi-specific setup, memory configuration, and deployment options.

---

## Common Issues

### Installation Problems

#### ❌ "Port 4405 already in use"

**Error:**
```
Error: listen EADDRINUSE: address already in use :::4405
```

**Solutions:**

**Option 1: Change port**
```bash
# Edit .env
echo 'PORT=5405' >> .env
npm start
```

**Option 2: Kill existing process**
```bash
# macOS/Linux
lsof -ti:4405 | xargs kill

# Windows
netstat -ano | findstr :4405
taskkill /PID <PID> /F
```

**Option 3: Find what's using the port**
```bash
# macOS/Linux
lsof -i:4405

# Windows
netstat -ano | findstr :4405
```

---

#### ❌ "ENOENT: no such file or directory, open '.env'"

**Error:** Server can't find `.env` file

**Solution:**
```bash
# Copy example file
cp .env.example .env

# Edit and add required values
nano .env
```

---

#### ❌ "Cannot find module 'xyz'"

**Error:** Missing dependency

**Solution:**
```bash
# Reinstall all dependencies
npm install

# If still fails, clear cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

---

#### ❌ "Prisma Client not generated"

**Error:** Database not initialized

**Solution:**
```bash
# Run migrations
npm run db:migrate

# If fails, regenerate client
npm run db:generate
```

---

#### ❌ "gyp ERR! build error" (Windows)

**Error:** Windows build tools missing

**Solution:**
```bash
# Install build tools (requires admin)
npm install --global windows-build-tools

# Then reinstall
npm install
```

---

### Runtime Problems

#### ❌ "Invalid API key"

**Symptoms:** AI doesn't respond, error in console

**Solution:**
```bash
# Verify key format in .env:
# OpenAI: sk-proj-...
# Anthropic: sk-ant-...
# xAI: xai-...

# Check for typos, trailing spaces
# Restart server after editing .env
```

---

#### ❌ "Rate limit exceeded"

**Symptoms:** API error after multiple requests

**Solution:**
- Wait 60 seconds
- Upgrade your API plan with the provider
- Switch to a different model

---

#### ❌ "Cannot connect to localhost:4405"

**Symptoms:** Browser can't load IDE

**Checklist:**
1. Is server running? (check terminal for "Server ready" message)
2. Correct URL? (http://localhost:4405 not https)
3. Correct port? (check `.env` for custom PORT)
4. Firewall blocking? (temporarily disable to test)

**Solution:**
```bash
# Check server is running
ps aux | grep "node server/server.js"

# Check port is listening
lsof -i:4405  # macOS/Linux
netstat -ano | findstr :4405  # Windows

# Restart server
# Ctrl+C then npm start
```

---

#### ❌ "Mixed content blocked" (HTTPS)

**Symptoms:** Some features don't work on HTTPS

**Solution:**
- Use the HTTPS URL (port 4406) consistently
- Trust the certificate (see platform-specific setup above)
- Don't mix HTTP and HTTPS resources

---

#### ❌ "File tree won't load"

**Symptoms:** Left sidebar empty or showing errors

**Solution:**
1. Click "Browse" and select a valid folder
2. Check folder permissions (read access required)
3. Check server console for error messages
4. Try a different folder (e.g., the cosmo_ide folder itself)

---

#### ❌ "WebSocket connection failed" (OpenClaw)

**Symptoms:** COZ model not available

**Solution:**
```bash
# Check if OpenClaw Gateway is running
curl http://localhost:18789

# If not running, start it:
openclaw gateway start

# Verify token in .env matches Gateway config
# Check: ~/.openclaw/config.json
```

---

### OAuth Errors

#### ❌ "Claude CLI auth file not found"

**Error:** OAuth import can't find token

**Solution:**
```bash
# Run OAuth setup first
claude setup-token

# Then import
npm run import-oauth
```

---

#### ❌ "ENCRYPTION_KEY not set"

**Error:** Can't encrypt OAuth token

**Solution:**
```bash
# Generate key
openssl rand -hex 32

# Add to .env
echo 'ENCRYPTION_KEY=<generated_key>' >> .env
```

---

#### ❌ "OAuth authentication is currently not supported"

**Error:** Token expired or invalid

**Solution:**
```bash
# Re-authenticate
claude setup-token

# Re-import
npm run import-oauth

# Restart server
npm start
```

---

### Browser/Network Errors

#### ❌ SSL certificate errors on mobile devices

**Symptoms:** Can't access HTTPS on iPhone/Android

**Solution:** Install certificate on device

**iPhone/iPad:**
1. Email yourself `ssl/cert.pem` from the IDE directory
2. Open email on device → Tap attachment
3. Settings → Profile Downloaded → Install
4. Settings → General → About → Certificate Trust Settings → Enable

**Android:**
1. Transfer `ssl/cert.pem` to device
2. Settings → Security → Install from storage
3. Select cert.pem
4. Name it "COSMO IDE"

**See also:** [HTTPS-SETUP.md](HTTPS-SETUP.md)

---

### Database Errors

#### ❌ "Unique constraint failed"

**Error:** Usually caused by corrupted data

**Solution:**
```bash
# Option 1: Reset database (⚠️ deletes conversations)
rm prisma/studio.db
npm run db:migrate

# Option 2: Inspect with Prisma Studio
npm run db:studio
# Opens database viewer at http://localhost:5555
```

---

#### ❌ "Database schema out of sync"

**Error:** Migrations not applied

**Solution:**
```bash
# Re-run migrations
npm run db:migrate

# If fails, reset database
rm prisma/studio.db
npm run db:migrate
```

---

### Still Stuck?

If you've tried the solutions above and still have issues:

1. **Check server logs:** Look in the terminal where you ran `npm start` for error messages
2. **Check browser console:** Open DevTools (F12) → Console tab for JavaScript errors
3. **Review documentation:** Check [README.md](README.md) and other docs in the repository
4. **Contact support:** Include in your report:
   - Error message (full text)
   - Your OS and Node.js version (`node --version`)
   - Steps to reproduce
   - Server logs (if relevant)

---

## Next Steps

### 🎯 Getting Started

- **Learn the features:** [README.md](README.md) — Full feature overview
- **First chat:** Try asking the AI to explain a file, refactor code, or implement a feature
- **Explore tools:** The AI can read files, search code, make edits — just ask naturally!

### 🔑 API Key Setup

Get API keys for more AI models:

- **OpenAI:** https://platform.openai.com/api-keys
  - Create account → Billing → Add payment method → Create API key
  - Models: GPT-4o, GPT-4 Turbo
  - Cost: ~$0.01-0.10 per request (pay-as-you-go)

- **Anthropic:** https://console.anthropic.com/settings/keys
  - Create account → Create API key
  - **OR** use OAuth if you have Claude Pro/Max subscription (see [Configuration Reference](#oauth-setup-recommended-for-claude-promax-users))
  - Models: Claude Sonnet 4.5, Claude Opus 4.5
  - Cost: Claude Pro ($20/mo) OR pay-as-you-go API

- **xAI:** https://console.x.ai/
  - Models: Grok (experimental)

### 🔒 HTTPS Setup

For full clipboard and modern API features:

- **Quick trust:** Click through browser warning (works immediately)
- **Permanent trust:** [HTTPS-SETUP.md](HTTPS-SETUP.md) — Install certificate on all devices
- **Access from other devices:** Use network URL from server startup (e.g., https://192.168.1.123:4406)

### 🤖 OpenClaw Integration

Connect COZ agent for persistent memory and advanced tools:

- **Setup:** [OPENCLAW-INTEGRATION.md](OPENCLAW-INTEGRATION.md)
- **Features:** Memory across sessions, 50+ integrated tools, stateful agent

### 🥧 Raspberry Pi Deployment

Deploy on Pi for 24/7 access:

- **Guide:** [PI-DEPLOYMENT.md](PI-DEPLOYMENT.md)
- **What works:** All cloud providers (OpenAI, Anthropic, xAI)
- **What's disabled:** Ollama (local models not practical on Pi)

### 💬 Conversation Management

- **Save chats:** Click "Save" in chat toolbar
- **Load previous:** Click "Load" and select from list
- **Export:** Conversations saved as JSON in `conversations/` directory

### 🧠 Brain Browser

Explore knowledge graphs (.brain packages):

- **Separate interface:** http://localhost:4398
- **Lightweight:** Just for browsing/querying .brain files
- **See:** [README.md](README.md) for details

### 📚 Advanced Topics

- **Architecture:** [AGENT-NOTES.md](AGENT-NOTES.md) — Internal developer notes
- **Office Files:** [IMAGE-SUPPORT.md](IMAGE-SUPPORT.md) — Read/edit Word/Excel/Outlook files
- **Snapshots:** [SNAPSHOT-SYSTEM.md](SNAPSHOT-SYSTEM.md) — File versioning

---

## Updates & Maintenance

### Update COSMO IDE

```bash
cd cosmo_ide
git pull origin main
npm install
npm run db:migrate
npm start
```

### Check for Dependency Updates

```bash
npm outdated
npm update
```

### Regenerate HTTPS Certificate

If your local IP changes or certificate expires (365 days):

```bash
cd ssl
rm cert.pem key.pem

# Replace YOUR_LOCAL_IP with your actual IP
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/C=US/ST=Local/L=Local/O=COSMO IDE/OU=Dev/CN=YOUR_LOCAL_IP" \
  -addext "subjectAltName=IP:YOUR_LOCAL_IP,DNS:localhost"

# Restart server
cd ..
npm start
```

---

## Security Notes

- ✅ `.env` is gitignored — your API keys never get committed
- ✅ OAuth tokens encrypted in database (using ENCRYPTION_KEY)
- ✅ Conversations stored locally — not sent to external services
- ✅ Self-signed HTTPS certificates for local development only
- ✅ No telemetry or analytics — completely private

**Production deployment:** Use environment variables instead of `.env` files, enable proper HTTPS with trusted certificates, and consider firewall rules for network access.

---

## Support & Contributing

### Get Help

- **Documentation:** See other `.md` files in the repository for detailed guides
- **Troubleshooting:** See [Common Issues](#common-issues) above
- **README:** [README.md](README.md) for feature overview and architecture

### Contribute

This is a personal project, but suggestions and bug reports are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## License

MIT License - See [LICENSE](LICENSE) file for details

---

**Built with 🔥 by an agent that doesn't take shortcuts.**

Ready to code? Open http://localhost:4405 and start chatting!
