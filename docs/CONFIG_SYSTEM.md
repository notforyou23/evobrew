# Evobrew Configuration System

This document describes the global configuration system that enables Evobrew to be installed and used as a system service, similar to OpenClaw.

## Overview

The config system supports two modes:
1. **Global Config** (preferred): `~/.evobrew/config.json` with encrypted secrets
2. **Legacy Mode**: `.env` file in the project directory

The server automatically detects which mode to use at startup, with global config taking priority.

## Directory Structure

```
~/.evobrew/
├── config.json          # Main configuration (encrypted secrets)
├── database.db          # SQLite database (OAuth tokens, etc.)
├── logs/
│   ├── server.log       # Application logs
│   └── error.log        # Error logs
└── ssl/                 # Auto-generated SSL certificates
    ├── cert.pem
    └── key.pem
```

## Configuration Schema

```json
{
  "version": "1.0.0",
  "server": {
    "http_port": 3405,
    "https_port": 3406,
    "bind": "localhost"
  },
  "providers": {
    "openai": {
      "enabled": true,
      "api_key": "encrypted:..."
    },
    "anthropic": {
      "enabled": true,
      "oauth": true,
      "api_key": "encrypted:..."
    },
    "xai": {
      "enabled": false,
      "api_key": ""
    }
  },
  "openclaw": {
    "enabled": true,
    "gateway_url": "ws://localhost:18789",
    "token": "encrypted:...",
    "password": "encrypted:..."
  },
  "features": {
    "https": false,
    "brain_browser": true,
    "function_calling": true
  },
  "terminal": {
    "enabled": true,
    "max_sessions_per_client": 6,
    "idle_timeout_ms": 1800000,
    "max_buffer_bytes": 2097152
  },
  "security": {
    "profile": "local",
    "internet_enable_terminal": false,
    "internet_enable_mutations": false,
    "internet_enable_gateway_proxy": false,
    "workspace_root": "",
    "proxy_shared_secret": "",
    "onlyoffice_callback_allowlist": "",
    "collabora_secret": ""
  }
}
```

## Security

### Encryption

Secrets (API keys, tokens, passwords) are encrypted using AES-256-GCM with a machine-specific key derived from:
- Hostname
- Username
- Fixed salt

This means:
- Secrets are encrypted at rest in `config.json`
- Secrets can only be decrypted on the same machine
- If you copy config to another machine, you need to re-enter secrets

### Encrypted Fields

The following fields are automatically encrypted when saving:
- `*.api_key`
- `*.token`
- `*.password`
- `*.secret`

Encrypted values are prefixed with `encrypted:` for identification.

## Migration from .env

For existing installations using `.env`:

```bash
# Run the migration script
node scripts/migrate-config.js

# Or do a dry run first
node scripts/migrate-config.js --dry-run
```

The migration script will:
1. Parse your existing `.env` file
2. Convert settings to `config.json` format
3. Encrypt secrets
4. Create the `~/.evobrew/` directory structure
5. Migrate the database if present

## API

### lib/config-manager.js

```javascript
const configManager = require('./lib/config-manager');

// Initialize config directory
await configManager.initConfigDir();

// Load config (decrypts secrets)
const config = await configManager.loadConfig();

// Save config (encrypts secrets)
await configManager.saveConfig(config);

// Get default config
const defaults = configManager.getDefaultConfig();

// Migrate from .env
const config = await configManager.migrateFromEnv('/path/to/.env');

// Validate config
const { valid, errors } = configManager.validateConfig(config);

// Apply to process.env (for backward compatibility)
configManager.applyConfigToEnv(config);
```

### lib/encryption.js

```javascript
const encryption = require('./lib/encryption');

// Encrypt a secret
const encrypted = encryption.encrypt('my-api-key');
// Returns: "encrypted:iv:authtag:ciphertext"

// Decrypt a secret
const decrypted = encryption.decrypt(encrypted);
// Returns: "my-api-key"

// Check if value is encrypted
encryption.isEncrypted(value); // true/false

// Mask a secret for display
encryption.mask('sk-ant-api01-12345');
// Returns: "sk-a...2345"

// Encrypt all secrets in a config object
encryption.encryptConfigSecrets(config);

// Decrypt all secrets in a config object
const decrypted = encryption.decryptConfigSecrets(config);
```

### lib/config-loader-sync.js

Used by the server for synchronous config loading at startup:

```javascript
const { loadConfigurationSync } = require('./lib/config-loader-sync');

const { config, source } = loadConfigurationSync({
  projectRoot: __dirname,
  applyToEnv: true,
  silent: false
});

// source is one of: 'global', 'env', 'defaults'
```

## Health Check

The server exposes config information in the health endpoint:

```bash
curl http://localhost:3405/api/health
```

Response includes:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "config": {
    "source": "global",
    "http_port": 3405,
    "https_port": 3406
  }
}
```

## Testing

Run the test suite:

```bash
node scripts/test-config-system.js
```

## File Permissions

- `~/.evobrew/` directory: `0700` (owner only)
- `config.json`: `0600` (owner read/write only)
- `database.db`: `0600` (owner read/write only)

## Backward Compatibility

The system maintains full backward compatibility:

1. If `~/.evobrew/config.json` exists, it's used
2. Otherwise, `.env` file is loaded via `dotenv`
3. Config values are applied to `process.env` so existing code works unchanged
4. The `DATABASE_URL` environment variable is automatically set based on config mode

## Troubleshooting

### "Config file not found"

Run the setup wizard or migration script:
```bash
evobrew setup
# or
node scripts/migrate-config.js
```

### Decryption fails on new machine

Secrets are machine-specific. Re-enter your API keys:
```bash
evobrew config
```

### Database not found

The database is created automatically on first run. If migrating:
```bash
node scripts/migrate-config.js
```

This will copy your existing database to `~/.evobrew/database.db`.
