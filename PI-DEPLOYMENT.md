# Evobrew - Raspberry Pi Deployment

## Overview

Evobrew runs on Raspberry Pi with **cloud providers only**. Local AI models (Ollama) are automatically disabled because Pi hardware cannot run them effectively.

## Automatic Platform Detection

Evobrew automatically detects when running on Raspberry Pi and:
- **Skips Ollama detection** (saves startup time)
- **Disables local model options** in the UI
- **Uses cloud-only model assignments**

No configuration changes required - the system adapts automatically.

## Pi-Specific Behavior

### What Works
- ✅ **Anthropic (Claude)** - OAuth and API key auth
- ✅ **OpenAI (GPT-4, GPT-5+)** - Full support with Responses API
- ✅ **xAI (Grok)** - Via OpenAI-compatible API
- ✅ **All cloud features** - Tool calling, streaming, vision, etc.

### What's Disabled
- ❌ **Ollama** - Local models not practical on Pi
- ❌ **Local embeddings** - Use cloud alternatives if needed

## Configuration (Optional)

The system works without configuration, but you can customize:

### Option 1: Use Default Pi Config
```bash
# In /home/jtr/cosmo_ide/server/config/
cp model-config-pi.js model-config.js
```

### Option 2: Environment Variables
Ensure these are set on Pi:
```bash
# Required for cloud providers
ANTHROPIC_API_KEY=...    # Or use OAuth (preferred)
OPENAI_API_KEY=...       # Optional
XAI_API_KEY=...          # Optional
```

## Platform Detection API

Check platform info via API:
```bash
curl http://localhost:4405/api/providers/platform
```

Response:
```json
{
  "success": true,
  "platform": {
    "platform": "pi",
    "hostname": "jtrpi",
    "supportsLocalModels": false,
    "isRaspberryPi": true,
    "totalMemoryGB": 4
  }
}
```

## Troubleshooting

### "Ollama provider not initialized" Error
This happens if a saved configuration references an Ollama model. Fix:
1. Change model selection in UI to a cloud model
2. Or reset config: `rm server/config/model-config.js`

### Slow Startup
If startup seems slow, verify Ollama detection is skipped:
```bash
pm2 logs cosmo-ide | grep -i "ollama\|platform"
```

You should see:
```
[Platform] Detected: pi (jtrpi)
[Providers] ℹ️ Skipping Ollama detection on pi (local models not supported)
```

### Missing API Keys
For Anthropic OAuth (recommended), import a token:
```bash
node import-oauth-token.js
```

Or set environment variable:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Architecture Notes

The provider abstraction layer (Phase 1-4) ensures:
1. **Graceful degradation** - System works with any subset of providers
2. **No crashes** - Missing Ollama doesn't cause errors
3. **Dynamic model list** - UI only shows available providers
4. **Fallback chains** - Can define cloud fallback for local models

## Files Changed for Pi Compatibility

```
server/config/platform.js        # New: Platform detection
server/config/model-config-pi.js # New: Pi-specific defaults
server/providers/index.js        # Modified: Skips Ollama on Pi
server/server.js                 # Modified: Platform info endpoint
```
