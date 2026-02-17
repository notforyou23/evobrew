# Local Models Guide

Run AI models locally with Evobrew using **Ollama** or **LM Studio**. Local models provide:

- 🔒 **Privacy** - Data never leaves your machine
- ⚡ **Speed** - No network latency for small models
- 💰 **Cost** - No API fees
- 🔌 **Offline** - Works without internet

## Quick Start

### Option 1: Ollama (Recommended)

Ollama is a simple CLI-based model runner that works great for development.

**Install:**
```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Or download from: https://ollama.com/download
```

**Pull a model:**
```bash
# General purpose chat
ollama pull llama3.2

# Coding assistant
ollama pull qwen2.5-coder:7b

# Lightweight (fast)
ollama pull phi3:mini
```

**Start Ollama:**
```bash
ollama serve
```

Evobrew auto-detects Ollama on `http://localhost:11434`.

### Option 2: LM Studio

LM Studio is a GUI-based model runner with a visual interface for downloading and managing models.

1. Download from [https://lmstudio.ai/](https://lmstudio.ai/)
2. Open LM Studio and download a model from the Discover tab
3. Go to the Local Server tab and start the server
4. Evobrew auto-detects LM Studio on `http://localhost:1234`

## Configuration

After running `evobrew setup`, your config at `~/.evobrew/config.json` will include:

```json
{
  "providers": {
    "ollama": {
      "enabled": true,
      "base_url": "http://localhost:11434",
      "default_model": "llama3.2",
      "auto_detect": true
    },
    "lmstudio": {
      "enabled": false,
      "base_url": "http://localhost:1234/v1",
      "default_model": null
    }
  },
  "preferences": {
    "prefer_local": false
  }
}
```

### Config Options

| Option | Description |
|--------|-------------|
| `enabled` | Enable/disable the provider |
| `base_url` | Custom URL if running on different port |
| `default_model` | Model to use when none specified |
| `auto_detect` | (Ollama only) Auto-detect on startup |
| `prefer_local` | Use local models before cloud providers |

## Recommended Models

### For Chat / General Use
| Model | Size | Description |
|-------|------|-------------|
| `llama3.2` | 3B | Fast, good quality |
| `llama3.3:70b` | 70B | Best quality (needs 48GB+ RAM) |
| `mistral` | 7B | Balanced speed/quality |
| `qwen2.5:14b` | 14B | Great multilingual support |

### For Coding
| Model | Size | Description |
|-------|------|-------------|
| `qwen2.5-coder:7b` | 7B | Best coding model for size |
| `deepseek-coder:6.7b` | 6.7B | Strong code completion |
| `codellama:13b` | 13B | Good for code generation |

### Lightweight / Fast
| Model | Size | Description |
|-------|------|-------------|
| `phi3:mini` | 3.8B | Very fast, good quality |
| `gemma2:2b` | 2B | Smallest, fastest |
| `llama3.2:1b` | 1B | Ultra-light |

## API Endpoints

### GET /api/local-models

Returns status of all local providers:

```json
{
  "success": true,
  "ollama": {
    "available": true,
    "models": ["llama3.2", "qwen2.5-coder:7b"],
    "default_model": "llama3.2"
  },
  "lmstudio": {
    "available": false,
    "models": [],
    "default_model": null
  }
}
```

### GET /api/ollama/models

Returns just Ollama models (legacy endpoint):

```json
{
  "success": true,
  "models": [
    { "id": "llama3.2", "label": "llama3.2" }
  ]
}
```

## Using Local Models in Chat

In the Evobrew chat interface:

1. Open the model dropdown
2. Local models show with a 🖥️ icon
3. Select your preferred model
4. Your selection is remembered

Or specify in API calls:
```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    model: 'ollama/llama3.2',  // prefix with provider
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

## Troubleshooting

### "Cannot connect to Ollama"

**Check if Ollama is running:**
```bash
curl http://localhost:11434/api/tags
```

**Start Ollama:**
```bash
ollama serve
```

### "Model not found"

**List installed models:**
```bash
ollama list
```

**Pull the model:**
```bash
ollama pull <model-name>
```

### "Connection refused on port 1234"

LM Studio server isn't running:
1. Open LM Studio
2. Go to Local Server tab
3. Click "Start Server"

### Models are slow

Local models need RAM. Requirements:

| Model Size | RAM Required |
|------------|--------------|
| 1-3B | 4-8 GB |
| 7B | 8-16 GB |
| 13-14B | 16-24 GB |
| 70B | 48-64 GB |

**Tips:**
- Close other memory-heavy apps
- Use quantized models (q4_0, q4_K_M)
- Use smaller models for simple tasks

### Tool calling not working

Not all local models support function calling. Models that work:
- `qwen2.5:14b` - Best tool support
- `llama3.2` - Basic tool support
- `mistral` - Partial support

Models that don't:
- Most smaller models (< 7B)
- Older models

## Mixing Local and Cloud

You can use both! In your config:

```json
{
  "providers": {
    "openai": { "enabled": true, "api_key": "sk-..." },
    "ollama": { "enabled": true, "default_model": "llama3.2" }
  },
  "preferences": {
    "prefer_local": true  // Local first, cloud as fallback
  }
}
```

With `prefer_local: true`:
- Simple questions → Local model (fast, free)
- Complex reasoning → Automatically falls back to cloud
- Offline → Local only

## Environment Variables

Override config with env vars:

```bash
# Ollama base URL
export OLLAMA_BASE_URL=http://localhost:11434

# Embedding model
export OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

## Further Reading

- [Ollama Documentation](https://ollama.com/docs)
- [LM Studio Documentation](https://lmstudio.ai/docs)
- [Evobrew Configuration](./CONFIG_SYSTEM.md)
