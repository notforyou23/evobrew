# Evobrew

**AI development workspace with semantic knowledge graphs, function calling, and persistent memory.**

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## What Is Evobrew?

Evobrew is an AI-powered development environment where knowledge becomes action:

- **Query knowledge graphs** (.brain packages) through conversational AI
- **Execute code** with function calling (read, edit, search files)
- **Persistent memory** across sessions via OpenClaw integration
- **Multi-model support** (GPT-4o, Claude Sonnet/Opus, Grok)
- **Semantic search** that understands meaning, not just keywords

Think of it as a workspace where you and AI build together — with memory, tools, and evolving knowledge.

---

## Quick Start

```bash
# Clone
git clone https://github.com/notforyou23/evobrew.git
cd evobrew

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Initialize database
npm run db:migrate

# Start
npm start
```

Open http://localhost:3405 (or https://localhost:3406 for HTTPS)

Full installation guide: [INSTALL.md](./INSTALL.md)

---

## Features

### 🧠 **Knowledge Graph Browser**
- Load and query .brain packages (semantic knowledge graphs)
- Vector similarity search with embeddings
- Context-aware answers from structured knowledge

### 🤖 **AI Function Calling**
- AI can read, edit, and search your codebase
- Real-time streaming responses
- Tool execution with diff preview
- Shared PTY terminal tools (`terminal_*`, `run_terminal` compatibility wrapper)

### 💻 **Real Terminal Dock**
- True PTY-backed terminal sessions (not one-shot command exec)
- Multi-session tabs with reconnect/resume after refresh
- AI and user can target the same terminal client/session model

### 📁 **Office File Support**
- Read Word (.docx), Excel (.xlsx), Outlook (.msg)
- AI analyzes formulas, comments, structured data
- Generate professional documents

### 🔌 **OpenClaw Integration**
- Connect to OpenClaw Gateway for persistent agent memory
- Session continuity across restarts
- Full tool and skill access

### ✂️ **Surgical Code Edits**
- Targeted changes without full file rewrites
- Edit queue with approve/reject workflow
- Line-range operations, search/replace

### 🔒 **Security First**
- OAuth token encryption (Prisma + crypto)
- Path traversal protection
- CORS locked to localhost/LAN by default
- Optional HTTPS with self-signed certs

---

## Architecture

**Frontend:** Vanilla JS, no framework  
**Backend:** Node.js + Express  
**Database:** SQLite (Prisma ORM)  
**AI:** OpenAI, Anthropic, xAI  
**Search:** HNSW vector index (hnswlib-node)

---

## Use Cases

- **Research assistant:** Query knowledge graphs conversationally
- **Code companion:** AI that can read and edit your code
- **Document processor:** Extract and analyze Office files
- **Knowledge evolution:** Build and refine .brain packages over time

---

## Documentation

- [Installation Guide](./INSTALL.md)
- [OpenClaw Integration](./OPENCLAW-INTEGRATION.md)
- [Dual Brain Architecture](./DUAL_BRAIN_ARCHITECTURE.md)
- [OAuth Setup](./OAUTH-TOKEN-SINK.md)

---

## Configuration

Edit `.env`:

```bash
# Required: Encryption key for OAuth tokens (64 hex characters)
ENCRYPTION_KEY=your_64_character_hex_key_here

# API Keys (at least one required)
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
XAI_API_KEY=xai-...  # Optional (Grok)

# Server (defaults shown)
HTTP_PORT=3405
HTTPS_PORT=3406

# Optional: OpenClaw Gateway
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_GATEWAY_TOKEN=your_token
OPENCLAW_GATEWAY_PASSWORD=your_password

# Terminal feature flags
TERMINAL_ENABLED=true
TERMINAL_MAX_SESSIONS_PER_CLIENT=6
TERMINAL_IDLE_TIMEOUT_MS=1800000
TERMINAL_MAX_BUFFER_BYTES=2097152

# Internet profile only (default-off terminal in internet mode)
INTERNET_ENABLE_TERMINAL=false
```

---

## Development

```bash
# Run with auto-restart
npm run dev

# Access Prisma Studio (database GUI)
npm run db:studio

# Update dependencies
npm update
```

---

## Requirements

- **Node.js:** 18.0.0 or higher
- **npm:** 9.0.0 or higher
- **OS:** macOS, Linux, Windows
- **API Keys:** OpenAI, Anthropic, or xAI (at least one)

---

## License

MIT — see [LICENSE](./LICENSE)

---

## Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create a feature branch
3. Submit a pull request with clear description

---

## Support

- **Issues:** [GitHub Issues](https://github.com/notforyou23/evobrew/issues)
- **Discussions:** [GitHub Discussions](https://github.com/notforyou23/evobrew/discussions)

---

**Built with ❤️ for developers who want AI that remembers, learns, and executes.**
