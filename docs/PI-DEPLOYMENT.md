# Evobrew on Raspberry Pi (Headless) — Deployment Guide

This guide documents a **known-working** headless Evobrew deployment on a Raspberry Pi (“Axiom”) with:

- Evobrew UI + API running on the Pi (PM2)
- **OpenAI Codex OAuth** working in a headless-friendly way
- **Local models** available via **Mac mini inference** (Ollama on Mac, tunneled to Pi)
- Brain picker + locations working (with cache/fast estimates)

> Goal: make Pi a 24/7 headless “file + brain operator” while heavier inference runs elsewhere.

---

## Target topology (known-working)

- **Pi (Axiom)**
  - Evobrew repo: `~/src/evobrew`
  - PM2 app: `evobrew`
  - HTTP: `http://<pi-ip>:3405` (example: `http://192.168.7.136:3405`)
  - HTTPS: optional (not required for LAN)
  - Evobrew state/config: `~/.evobrew/`

- **Mac mini (COZ host)**
  - Ollama running on Mac (bound to localhost)
  - Accessed from Pi via SSH tunnel (so you do **not** need to expose Ollama to LAN)

---

## Prereqs

### On the Pi

- Node.js >= 18 (tested with Node 22)
- `git`, `python3`, `build-essential` (for native deps)
- PM2 installed and working

Quick checks:

```bash
node -v
npm -v
pm2 -v
```

### Pi → Mac SSH

Pi must be able to SSH to the Mac mini (key-based preferred):

```bash
ssh jtr@<mac-ip> 'echo mac_ok'
```

---

## Install Evobrew on Pi

```bash
mkdir -p ~/src
cd ~/src
git clone https://github.com/notforyou23/evobrew.git
cd evobrew
npm install --omit=dev
```

### Database (SQLite)

Evobrew uses Prisma + SQLite in this deployment.

```bash
export DATABASE_URL="file:$HOME/.evobrew/database.db"
cd ~/src/evobrew
npx prisma generate
npx prisma migrate deploy
```

---

## Create Pi config: `~/.evobrew/config.json`

Minimum known-working config shape (edit brain directories to match your mounts):

```json
{
  "features": {
    "brains": {
      "enabled": true,
      "directories": [
        "/mnt/cozmac/_JTR23_/cosmo-home/runs/",
        "/mnt/cozmac/websites/cosmos.evobrew.com/data/users/<user-id>/runs/"
      ]
    }
  },
  "providers": {
    "ollama": {
      "enabled": true,
      "auto_detect": true,
      "base_url": "http://127.0.0.1:11434",
      "force_enable_on_pi": true
    }
  },
  "security": {
    "profile": "local",
    "internet_enable_terminal": true,
    "encryption_key": "<64-hex-chars>"
  }
}
```

Notes:
- `encryption_key` is required for encrypted provider secrets in SQLite.
- `providers.ollama.base_url` points at **localhost** on the Pi, because we tunnel Mac Ollama → Pi.
- `force_enable_on_pi` is required because the platform is `pi` and local-model support is normally disabled.

---

## Run Evobrew under PM2

```bash
export DATABASE_URL="file:$HOME/.evobrew/database.db"
export HTTP_PORT=3405
export HTTPS_PORT=3406

cd ~/src/evobrew
pm2 delete evobrew 2>/dev/null || true
pm2 start npm --name evobrew -- start
pm2 save
```

Verify:

```bash
curl -s http://127.0.0.1:3405/api/config
```

---

## OpenAI Codex OAuth (Headless)

On headless Pi, do OAuth with a 2-step flow:

### Step 1 — generate auth URL on Pi

```bash
cd ~/src/evobrew
node bin/codex-oauth-headless.cjs start
```

### Step 2 — complete in Mac browser

1. Open the printed URL on your Mac.
2. After login, copy the final **redirect URL** (it may fail to load; copy it anyway).
3. Paste it back into the Pi:

```bash
cd ~/src/evobrew
node bin/codex-oauth-headless.cjs finish "<PASTE_REDIRECT_URL_HERE>"
pm2 restart evobrew --update-env
```

Verification:

```bash
curl -s http://127.0.0.1:3405/api/providers/status | python3 -m json.tool
```

Expect `openai-codex` to be `healthy: true`.

### Important implementation note

Codex OAuth is validated and used against the **ChatGPT Codex backend**:

- `https://chatgpt.com/backend-api/codex/responses`

This is intentional because Codex OAuth tokens often **do not** have OpenAI Platform scopes like `api.responses.write`.

---

## Local models via Mac inference (Ollama tunnel)

If Ollama runs on the Mac bound to localhost, tunnel it to the Pi:

### Create PM2 tunnel process

```bash
pm2 delete mac-ollama-tunnel 2>/dev/null || true
pm2 start "ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=60 \
  -o ServerAliveCountMax=3 \
  -L 11434:127.0.0.1:11434 \
  jtr@<mac-ip>" \
  --name mac-ollama-tunnel
pm2 save
```

Verify from Pi:

```bash
curl -s http://127.0.0.1:11434/api/tags
```

Then restart Evobrew (it auto-detects Ollama):

```bash
pm2 restart evobrew --update-env
curl -s http://127.0.0.1:3405/api/providers/models | python3 -m json.tool
```

Expect Ollama models to appear (e.g. `qwen2.5-coder:7b`, `qwen3:14b`, etc.).

---

## Troubleshooting

### Provider status says Codex OAuth unhealthy
- Confirm `~/.evobrew/auth-profiles.json` exists and contains `openai-codex:default`.
- Re-run headless OAuth start/finish.
- If you see Cloudflare/403 errors contacting `chatgpt.com`, run Codex calls through a Mac relay (future enhancement).

### Brains location missing
- Ensure Pi has the mount paths listed in `features.brains.directories`.
- Each brain directory must contain a `state.json.gz`.

### Ollama models not listed
- Check tunnel process: `pm2 logs mac-ollama-tunnel --lines 50 --nostream`
- Confirm `curl http://127.0.0.1:11434/api/tags` works.
- Ensure config includes:
  - `providers.ollama.base_url = http://127.0.0.1:11434`
  - `providers.ollama.force_enable_on_pi = true`

---

## Next: turn this into `--profile pi`

Recommended packaging:
- Add a `--profile pi` path in the setup wizard that:
  - writes the Pi defaults to `~/.evobrew/config.json`
  - creates `mac-ollama-tunnel` PM2 entry
  - runs `codex-oauth-headless.cjs start` and prompts for redirect URL
  - validates `/api/providers/status` and `/api/providers/models`
