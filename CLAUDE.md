# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Evobrew — model-agnostic AI workspace (Node.js/Express + vanilla JS frontend). Global npm package that provides an IDE-like environment with multi-provider AI chat, semantic knowledge graphs (.brain packages), function calling, PTY terminal sessions, and persistent memory via OpenClaw. Also branded "COSMO IDE" in some docs.

## Commands

```bash
npm start                # Run server (node server/server.js)
npm run dev              # Run with nodemon auto-restart
node --check <file>      # Syntax-check a file (always do this before committing)
npm run db:migrate       # Run Prisma migrations
npm run db:generate      # Regenerate Prisma client
npm run security:test    # Security smoke tests (spawns server, tests auth/boundary)
```

CLI (when installed globally): `evobrew start`, `evobrew setup`, `evobrew daemon install|start|stop`, `evobrew doctor`, `evobrew config show|edit|reset`, `evobrew update`, `evobrew version`

No formal linter or test suite — validate with `node --check` on all modified files.

**Repo:** https://github.com/notforyou23/evobrew
**Default ports:** HTTP 3405, HTTPS 3406

## Rules

- Never commit `.env` — contains ENCRYPTION_KEY and all API keys
- Never hardcode absolute paths like `/Users/jtr/` — app must be portable
- Never restructure `server.js` — too large and interconnected, surgical edits only
- Never change `openai-codex` routing — intentionally bypasses the registry for OAuth reasons (ChatGPT OAuth tokens lack Platform API scopes)
- Never modify `~/.evobrew/config.json` directly — use the wizard or `config-manager.js`
- Never break the `getAvailableModels()` + `listModels()` contract — UI dropdown depends on both
- Never add a provider without also adding a setup wizard step in `lib/setup-wizard.js`
- Never kill the PM2 `evobrew` process without asking — it may be live on Pi
- Always `node --check` modified files before committing
- Always update `.env.example` when adding new env vars
- Always follow existing patterns — xAI adapter is the cleanest reference for new providers
- Always use seed list + `listModels()` for cloud providers — seed as fallback, live fetch as primary
- Always check `platform.js` when adding features that differ by Mac/Pi/Linux
- Export new wizard helpers from `module.exports` — they're tested externally
- Commit changes — git is the source of truth; unsaved work gets lost on restart

---

## Startup & Boot Sequence

### CLI Entrypoint (`bin/evobrew`)

Hand-rolled command dispatch from `process.argv[2]`. No argument parsing library. Key commands: `start` (foreground server), `setup` (interactive wizard), `daemon <action>` (service lifecycle), `config`, `doctor`, `update`.

The `start` path calls `checkAndKillStaleProcess(3405)` from `lib/process-utils.js` (interactive port-conflict resolution), then checks `needsSetup()` (at least one configured provider required), then spawns `node server/server.js` with inherited stdio.

### Server Boot Phases (`server/server.js`)

1. **Config loading (synchronous, before any imports):** `loadConfigurationSync()` from `lib/config-loader-sync.js` reads `~/.evobrew/config.json`, decrypts secrets, applies to `process.env`. Falls back to `.env` via dotenv.
2. **Security profile:** `loadSecurityProfile()` — the only hard exit at startup. Internet profile requires `EVOBREW_PROXY_SHARED_SECRET`, `WORKSPACE_ROOT`, `COLLABORA_SECRET`, `ONLYOFFICE_CALLBACK_ALLOWLIST` or exits.
3. **Module imports and middleware:** Express app, CORS, body parsers, security headers, proxy auth middleware, static files.
4. **Route registration:** All routes registered synchronously (~200 endpoints).
5. **HTTP server listen:** Binds `0.0.0.0:PORT`. No EADDRINUSE handler — port conflict here crashes.
6. **HTTPS + WebSocket:** If `ssl/cert.pem` exists, creates HTTPS server. Attaches terminal WS and gateway proxy WS to both servers.
7. **Signal handlers:** SIGINT/SIGTERM call `shutdownTerminalSessions()` then `process.exit(0)`. No graceful HTTP drain.

**AI clients are lazy** — none instantiated at startup. `getOpenAI()`, `getAnthropic()`, `getXAI()` create on first call. Provider registry is also lazy — `getDefaultRegistry()` creates singleton on first API hit.

### Daemon Modes (`lib/daemon-manager.js`)

- **macOS:** launchd plist at `~/Library/LaunchAgents/com.evobrew.server.plist` — `KeepAlive: true`, 10s restart throttle
- **Linux:** systemd user service with hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`)
- **PM2:** `pm2 start` — takes precedence in status display when both PM2 and native service exist
- Log rotation: 10MB max, 7-day retention, gzip compression (not auto-triggered — must be called externally)

---

## Configuration System

### Precedence (highest to lowest)

1. Shell/Docker environment variables (never overwritten by config)
2. `~/.evobrew/config.json` (decrypted, applied via `applyConfigToEnv()` only if env var not already set)
3. `.env` file in project root (legacy fallback via dotenv)
4. `DEFAULT_CONFIG` hardcoded defaults

### Config File Structure (`~/.evobrew/config.json`)

Sections: `server` (ports, bind), `providers` (per-provider enabled/api_key/oauth), `openclaw` (gateway), `features` (https, brains, function_calling), `terminal`, `security` (encryption_key, profile).

Secrets (any key containing `api_key`, `token`, `password`, `secret`) are AES-256-GCM encrypted at rest. The `encryption_key` itself is stored in plaintext (it encrypts everything else).

### Encryption — Two Separate Modules

- **`lib/encryption.js`** — Config-layer encryption. Key priority: `ENCRYPTION_KEY` env var → `config.json security.encryption_key` → machine-derived key (PBKDF2 from `hostname:username:evobrew-v1-config-salt`, 100K iterations). Wire format: `encrypted:<IV>:<AuthTag>:<Ciphertext>`. Machine-derived key means config is **not portable between machines**.
- **`server/services/encryption.js`** — Database-layer encryption for OAuth tokens. Requires explicit `ENCRYPTION_KEY` env var (no fallback). Wire format: `<IV>:<AuthTag>:<Ciphertext>` (no prefix).

### Setup Wizard (`lib/setup-wizard.js`)

6-step interactive onboarding: (1) AI Providers — multiSelect UI, per-provider test via raw HTTPS POST, (2) OpenClaw, (3) Brains, (4) Server ports, (5) Service installation, (6) Verification. Config saved incrementally after each step. Secret inputs use raw terminal mode with `*` echo.

### Config Loaders

- `lib/config-loader-sync.js` — Used at server startup (before event loop). **Inlines its own decryption** to avoid circular dependency.
- `lib/config-loader.js` — Async version for runtime use.
- `lib/config-manager.js` — Read/write/validate `~/.evobrew/config.json`. Path constants, `initConfigDir()`, `migrateFromEnv()`.

### Platform Detection (`server/config/platform.js`)

Returns `{ type, supportsLocalModels }`. Pi detected via `/proc/device-tree/model` or `/proc/cpuinfo`. Pi: `supportsLocalModels: false`. Linux with <16GB RAM: `supportsLocalModels: false`.

---

## Model & Provider System

### Routing Chain

```
getProvider(modelId)
  1. Explicit model map (Map<modelId, providerId>) — checked first, wins immediately
  2. parseProviderId(modelId) — checks for "/" prefix, then heuristic chain:
     claude → anthropic | gpt/o1/o3 → openai | grok → xai
     nemotron/kimi/cogito/minimax/devstral → ollama-cloud
     llama/mistral/qwen/deepseek or contains ":" → ollama
  3. Capability scan — iterates all providers, calls supportsModel() (substring match)
```

`extractModelName()` strips provider prefix before API calls.

### ProviderAdapter Contract (`server/providers/adapters/base.js`)

Required: `get id()`, `get name()`, `get capabilities()`, `getAvailableModels()`, `_initClient()`, `createMessage()`, `streamMessage()`, `convertTools()`, `parseToolCalls()`.

Capabilities shape: `{ tools, vision, thinking, streaming, caching, maxOutputTokens, contextWindow }`.

Error classification: `isRateLimitError` → retry (60s default), `isServerError` → retry (5s), `isBillingError`/`isAuthError` → no retry.

### Adapter Specifics

**AnthropicAdapter** — OAuth stealth headers (`anthropic-beta: claude-code-20250219,...`, user-agent spoof as `claude-cli/2.1.32`). System prompt injection required for OAuth tokens. Thinking levels: low→2000, medium→8000, high→32000 budget tokens.

**OpenAIAdapter** — Dual API: `shouldUseResponsesAPI(model)` forks on `gpt-5`/`o3`/`o4` prefix. Responses API is stateful (`previousResponseId` tracked across turns). GPT-5.2 gets `reasoning: { effort: 'none' }`, `text: { verbosity: 'medium' }`.

**OllamaAdapter** — Dual protocol: embeddings via native `/api/embeddings`, chat via OpenAI-compatible `/v1`. XML fallback for tool calls (`<tool_call>{...}</tool_call>` parsing for models like qwen2.5-coder). **Stream format differs** from other adapters (`content_delta` instead of `text`) — requires special handling in consumers.

### OpenAI Codex Special Case

ChatGPT OAuth tokens can't use the Platform API. The registry registers model IDs (`gpt-5.2`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`) but **no adapter is instantiated**. Actual requests bypass the registry entirely, using a raw `fetch()` client against `chatgpt.com/backend-api/codex/responses`. Detection via `isCodexModelSelection()` in `lib/model-selection.js`.

### Two Parallel Client Layers

**Adapter layer** (`server/providers/`) — the formal abstraction with unified types. Used by registry consumers.

**Legacy client layer** (`lib/anthropic-client.js`, `lib/openai-client.js`) — older SDK wrappers used directly by `ai-handler.js`. `AnthropicClient` has OAuth refresh (50-min window), GPT-name-to-Claude-model mapping, OpenAI-to-Anthropic format translation. Both layers coexist — `ai-handler.js` was not fully migrated to the adapter layer.

### Provider Initialization Order (`providers/index.js` `createRegistry()`)

Anthropic (OAuth or API key) → OpenAI → OpenAI Codex (model IDs only, no adapter) → xAI → Ollama Cloud → Ollama local (auto-detect `/api/tags`, skipped on Pi) → LMStudio (if enabled)

### Registered Providers

| ID | Adapter | Auth | Dynamic models |
|----|---------|------|----------------|
| `anthropic` | AnthropicAdapter | OAuth or API key | No (static list) |
| `openai` | OpenAIAdapter | API key | No |
| `openai-codex` | (legacy client) | ChatGPT OAuth | No |
| `xai` | OpenAIAdapter + override | API key | No |
| `ollama` | OllamaAdapter | None (local) | Yes — `/api/tags` |
| `ollama-cloud` | OpenAIAdapter + override | API key | Yes — `/v1/models` |
| `lmstudio` | OpenAIAdapter + override | None (local) | Via listModels() |

### Available Models

**Anthropic:** `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-sonnet-5`
**OpenAI:** `gpt-5.4`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1`, `gpt-4o`, `gpt-4o-mini`
**xAI:** `grok-code-fast-1`, `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`, `grok-2`, `grok-beta`
**Ollama Cloud:** dynamic — seed list includes `nemotron-3-super:cloud`, `qwen3.5:397b`, `deepseek-v3.1:671b`, `kimi-k2:1t`
**Ollama (local):** dynamic — whatever is installed (`ollama list`)
**OpenAI Codex:** `gpt-5.2`, `gpt-5.3-codex`, `gpt-5.3-codex-spark` (via ChatGPT OAuth)

### Adding a New Provider

Pattern used by every cloud provider (xAI, Ollama Cloud):

1. **`registry.js`** — Add factory in `_registerBuiltinFactories()`:
   ```js
   this.adapterFactories.set('my-provider', (config) => {
     const adapter = new OpenAIAdapter({ ...config, baseUrl: 'https://api.example.com/v1' });
     Object.defineProperty(adapter, 'id', { value: 'my-provider', writable: false });
     Object.defineProperty(adapter, 'name', { value: 'My Provider', writable: false });
     adapter.getAvailableModels = () => ['model-a', 'model-b'];
     return adapter;
   });
   ```
   Also add model name heuristics to `parseProviderId()` if models have unique prefixes.

2. **`providers/index.js`** — Init block in `createRegistry()`:
   ```js
   const myKey = process.env.MY_PROVIDER_API_KEY
     || evobrewConfig?.providers?.['my-provider']?.api_key;
   if (myKey) {
     registry.initializeProvider('my-provider', { apiKey: myKey });
   }
   ```

3. **`setup-wizard.js`** — Add to `providerOptions` array, add `if (provider === 'my-provider')` case in `stepProviders()`. Follow the xAI pattern: prompt for key, call test helper, save to `config.providers['my-provider']`.

4. **`server.js`** — Only needed for dynamic model fetching (see Ollama/Ollama Cloud pattern in `/api/providers/models` endpoint around line 3140).

### Dynamic vs Static Model Lists

Static: Anthropic, OpenAI, xAI, Codex. Dynamic: Ollama local (`/api/tags`), Ollama Cloud (`ollama.com/v1/models`, 5-min TTL cache with seed list fallback), LMStudio (`listModels()`).

---

## AI Handler & Function Calling

### The Agentic Loop (`server/ai-handler.js` `handleFunctionCalling()`)

**Init:** Registry lookup → provider flags → tool filtering (capability + security policy + terminal policy) → run context injection (walks up for `run-metadata.json`) → system prompt assembly (~4000 chars) → brain context injection (if enabled, top nodes scoring ≥0.20) → message array construction.

**Loop (max 75 iterations):** Each iteration: prune ephemeral messages → dispatch to provider branch → if tool calls present, execute all in parallel via `Promise.all()` → store results → continue. Loop exits when provider returns no tool calls.

### Provider Branches in the Loop

Each provider has its own streaming branch in `handleFunctionCalling()`:
- **Claude** — Anthropic SDK `messages.stream()`, max_tokens 64000, temp 0.1. Orphaned tool results (no matching tool_use id) are skipped.
- **OpenAI** — `responses.create()` (Responses API), stateful via `previousResponseId`. Subsequent tool-call turns send only function outputs, not full history.
- **Grok/xAI** — `responses.create()` (OpenAI-compatible), system prompt as first input item (xAI doesn't support `instructions`).
- **Ollama/Ollama Cloud** — `provider.streamMessage()` from registry. Gemma models: tools disabled entirely.

### Token Management

- `smartTruncate()` — For text >75K chars: keeps 60% beginning + 40% end (beginning has imports/declarations, end has recent code).
- `trimMessages()` — When estimated tokens (chars/4) exceed 200K: keeps all system messages (truncated at 80K), last 18 non-system messages. Tool results not in last 2 positions get base64 stripped and content truncated.
- `sanitizeToolResult()` — Deep clean: removes circular refs, strips functions/symbols, truncates arrays to 500 items, strings to 75K, replaces image base64 with placeholder.
- History messages from client: capped at 12K chars each, data URLs truncated at 20K.

### SSE Event Types

`iteration`, `status`, `brain_search`, `thinking`, `tool_preparing`, `tool_progress` (throttled 200ms), `response_chunk`, `tools_start`, `tool_start`, `tool_complete`, `tool_result`, `info`, `error`, `complete` (includes `fullResponse`, `tokensUsed`, `iterations`, `pendingEdits`).

---

## Tool System

### All 30 Tools (`server/tools.js`)

**Read-only (safe in any profile):** `file_read` (text/docx/xlsx/msg), `list_directory`, `grep_search` (rg with grep fallback), `codebase_search` (semantic)

**Edit tools (queue-based, never write to disk directly):** `edit_file`, `edit_file_range`, `search_replace`, `insert_lines`, `delete_lines` — all return `{ action: 'queue_edit', code_edit: <full new content> }`. Fed into `pendingEdits[]` array, delivered to frontend in `complete` SSE event, shown in diff review UI. Actual disk write only on user approval.

**Direct write (no approval queue):** `create_file` (mkdir + writeFile), `delete_file` (unlink), `create_docx`, `create_xlsx`, `create_image` (GPT-Image-1.5), `edit_image`

**Terminal tools:** `terminal_open`, `terminal_write`, `terminal_wait`, `terminal_resize`, `terminal_close`, `terminal_list`, `run_terminal` (compat wrapper: PTY with exit-marker detection, falls back to synchronous `execSync` with 30s timeout — blocks event loop)

**Brain tools:** `brain_search`, `brain_node`, `brain_thoughts`, `brain_coordinator_insights`, `brain_stats`

### ToolExecutor Security

Three-level path validation: (1) `allowedToolNames` whitelist, (2) `resolveAndValidatePath()` — resolves to absolute, (3) `isPathAllowed()` — dual check: string-normalized containment AND `realpathSync` canonical check (catches symlink escapes). Null bytes rejected. Admin mode (`COSMO_ADMIN_MODE=true`) bypasses all path restrictions.

---

## Frontend / UI / UX

### Architecture

Single-page app from `public/index.html` (~6400 lines). No bundler, no framework. Three code styles coexist:
- **Massive inline `<script>` block** (~8000 lines of inline JS) — the bulk of the IDE logic
- **ES6 modules** (`ai-chat.js`, `editor.js`, `file-tree.js`, `edit-queue.js`) — loaded via `<script type="module">`
- **IIFEs** (`ui-shell.js`, `ui-panels.js`, `ui-shortcuts.js`, `terminal.js`, `ui-onboarding.js`) — expose `window.*` globals

Cross-module communication via `window.*` globals and custom events (`cosmo:folderChanged`).

### Tab System

5 tabs: `readme` (docs), `query` (semantic search), `files` (Agent IDE, default), `explore` (D3 graph), `openclaw` (COZ chat). Switched via `switchBrainTab(tabName)`. Each lazy-initialized on first visit.

### Agent IDE Layout (files tab)

Left sidebar (280px, resizable) | Center editor (Monaco, flex:1) | Right AI panel (400px, resizable) | Bottom terminal dock (280px, collapsible). Tablet (≤900px): sidebar/AI become fixed overlays with backdrop.

### Theme System

Dark (default, VS Code-like) / Light (via `?theme=light` URL param). No runtime toggle. CSS custom properties in `:root`. UI Refresh system adds a parallel CSS layer gated by `body.ui-refresh-enabled` class.

### Backend Communication

- **REST:** `fetch()` for file ops, brain queries, terminal session CRUD
- **SSE:** Custom implementation via `ReadableStream` reader for AI chat (not `EventSource` API). Manual `\n` split + `data:` prefix strip + JSON parse per event.
- **WebSocket:** Terminal I/O (`/api/terminal/ws`), OpenClaw gateway proxy (`/api/gateway-ws`)

### Chat Rendering Pipeline

User message → `escapeHtml()` (no markdown). Assistant message → `marked.parse()` → `DOMPurify.sanitize()`. Full re-render on every SSE chunk (no incremental DOM). Per-folder conversation history in localStorage (60 messages max, 8K chars max each).

### Edit Approval Flow

1. AI tool returns `{ action: 'queue_edit', code_edit }` (full new file content)
2. Accumulated in `pendingEdits[]` during agentic loop
3. Sent in `complete` SSE event
4. `edit-queue.js` re-fetches current file content, shows pending card with Accept/Reject/Preview
5. Accept: `PUT /api/folder/write` + updates Monaco model if file is open
6. Preview: naive line-by-line diff in `alert()` (known weak point)
7. Queue is in-memory only — lost on page refresh

### Keyboard Shortcuts

Two systems: legacy (Monaco `addCommand()`, hardcoded) and UI Refresh (`ui-shortcuts.js`, capture-phase keydown listener with chord support, user-remappable via settings, persisted to localStorage).

### State Management

All global or module-level. No central store. Key localStorage keys: `evobrew.ui.layout.v2`, `evobrew.ui.shortcuts.v2`, `evobrew-settings`, `evobrew.terminal.*`, `cosmo.aiChat.history:<path>`, `evobrew-brain-*`.

---

## Research / Query / Brain System

### What a .brain Package Is

A directory containing serialized COSMO research output. Required: `state.json.gz` (gzip JSON with `memory.nodes[]`, `memory.edges[]`, `cycleCount`, `goals`). Optional: `thoughts.jsonl`, `embeddings-cache.json`, `coordinator/review_NNN.md`, `partitions.json` (PGS cache), `pgs-sessions/`, `agents/agent_N/findings.jsonl`.

Nodes have: `id`, `concept` (text content), `tag`, `weight`, `activation`, `embedding` (512-dim float array), `cluster`.

### Brain Loading

`POST /api/brain/load` or CLI arg → `server/brain-loader-module.js` singleton → gunzips `state.json.gz` → instantiates `QueryEngine(brainPath, openaiKey)`. Path validated against `BRAIN_DIRS` allowlist.

`COSMO_BRAIN_DIRS`: comma-separated paths in env, or `config.json → features.brains.directories[]`. Each directory recursively scanned for subdirs containing `state.json.gz`.

### Semantic Search (`lib/query-engine.js`, ~4000 lines)

**Embedding model:** `text-embedding-3-small` with `dimensions: 512`. Must match brain file embeddings.

**Scoring:** `combined = (semanticScore * 0.7 + keywordScore * 0.3) * (0.5 + activation * weight)`. Tag boosts: `agent_finding` ×1.5, `breakthrough` ×1.6. De-boosts: `meta` ×0.5, `agent_insight` ×0.6. Pre-filter removes `dream`/`reasoning`/`introspection` nodes.

**Context assembly (`buildContext`):** Model-aware node limits (Claude Opus: 4000, GPT-5: 3000, default: 2500). Tiered truncation: top 20 nodes at 2000 chars, 21-100 at 1000, 101-200 at 700, 201+ at 500. Includes goals, thoughts, coordinator reviews, agent output files.

**Live journal merge:** Scans `agents/agent_N/findings.jsonl` for active runs. Baseline nodes take priority; live entries only added if not already captured.

### PGS — Partitioned Graph Synthesis (`lib/pgs-engine.js`)

For brains too large for single-pass context. Decomposes graph into communities via Louvain, runs parallel LLM sweeps per community, then synthesizes.

**Phases:** (0) Partition — Louvain community detection, cached in `partitions.json` (hash-validated by node/edge count + timestamp). Target partition sizes: 200-1800 nodes. (1) Route — cosine similarity of query embedding vs partition centroid embeddings. (2) Sweep — parallel batches of 5, **hardcoded to `claude-sonnet-4-6`** regardless of user model. Each partition's nodes formatted with IDs/tags/weights, 6000 max output tokens. (3) Synthesize — user-selected model, `reasoningEffort: high`, 16000 output tokens.

**Sweep depth chips:** Skim (10%), Sample (25%, default), Deep (50%), Full (100%). Fraction applies to routed partitions only, not all partitions.

**Session modes:** `full` (default, reset), `continue` (skip already-swept), `targeted` (re-route among unsearched).

### Codebase Indexer (`server/codebase-indexer.js`)

Separate from brain search. Uses `text-embedding-3-small` at **default 1536 dimensions** (different vector space from brain 512d — not compatible). String-prefix chunking by function/class declarations. In-memory index only — lost on restart. Max 100 files per folder.

---

## IDE Features

### Terminal System

**Server:** `server/terminal/session-manager.js` — `node-pty` sessions with 24-char hex IDs. Rolling buffer capped at 2MB. Idle sweep every 30s, kills sessions with 0 connections after 30 min. `runCompatibilityCommand()` provides AI a sync "run and get output" interface via PTY + exit-marker pattern.

**WebSocket protocol** (`server/terminal/ws-protocol.js`): Messages: `attach`, `input`, `resize`, `close`, `ping`, `list` (inbound); `ready` (with scrollback replay), `output`, `exit`, `state`, `error`, `pong`, `sessions` (outbound). Backpressure: 256KB high watermark, queues messages and pauses PTY via `pty.pause()`.

**Frontend** (`public/js/terminal.js`): xterm.js with FitAddon/WebLinksAddon/SearchAddon. Client ID persisted in localStorage. Auto-reconnects on WS close (1200ms debounce). Session restore on page refresh via `GET /api/terminal/sessions`.

### File Operations

REST endpoints at `/api/folder/*`: `browse` (recursive with configurable depth, max 12K entries), `read`, `write`, `create`, `delete`, `upload-binary`, `write-docx`. No rename/move endpoint.

### Editor (`public/js/editor.js`)

Monaco Editor from CDN. Single instance, multi-file via `openFiles` Map. View state (scroll, cursor) saved per file on tab switch. `Cmd+S` saves, `Cmd+W` closes tab.

---

## Security

### Two Profiles (`lib/security-profile.js`)

**Local (default):** CORS restricted to localhost/RFC-1918/.local. File boundary is the loaded brain folder (or unrestricted for admin). Terminal always allowed. All write endpoints open.

**Internet:** Reverse proxy required. Every `/api/` route (except `/api/health`) requires `x-evobrew-proxy-secret` header (timing-safe comparison) + authenticated user header. CORS fully open (proxy is the trust boundary). File paths hard-clamped to `WORKSPACE_ROOT`. Three opt-in flags (all false by default): `INTERNET_ENABLE_MUTATIONS`, `INTERNET_ENABLE_GATEWAY_PROXY`, `INTERNET_ENABLE_TERMINAL`.

### Path Traversal Prevention

Dual-layer on every file operation: (1) string-normalized containment check against allowed root, (2) `realpathSync` canonical check (catches symlink escapes). Null bytes rejected explicitly.

### OAuth Flows

**Anthropic:** PKCE flow via Claude CLI token import (`~/.claude/auth.json` → encrypted in SQLite). Auto-refresh via `refreshAccessToken()`. Stealth headers required (impersonates Claude Code CLI). System prompt prefix mandatory for OAuth tokens.

**OpenAI Codex:** Separate PKCE implementation in `lib/oauth-codex.cjs`. Local HTTP server on port 1455 catches callback. Tokens stored in `~/.evobrew/auth-profiles.json`. Account ID extracted from JWT for `chatgpt-account-id` header.

### Security Headers

`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Resource-Policy: same-origin`, CSP with `unsafe-inline`/`unsafe-eval` (required for inline-heavy UI).

---

## Cross-Cutting Connections

### OpenClaw/COZ Integration

Two integration points: (1) COZ as virtual AI model (`openclaw:coz` in dropdown) — frontend detects prefix, bypasses `/api/chat`, sends directly to Gateway WebSocket with IDE context. (2) WebSocket proxy at `/api/gateway-ws` — raw TCP pipe to `OPENCLAW_GATEWAY_HOST:OPENCLAW_GATEWAY_PORT` for HTTPS mixed-content bypass.

### OnlyOffice / Collabora

Dual document editor integration. Server acts as WOPI host. OnlyOffice: download/save callbacks with HMAC-SHA-256 token verification and callback URL allowlist (anti-SSRF). Collabora: WOPI CheckFileInfo/GetFile/PutFile endpoints. Both share the same signing secret and proxy path.

### WebSocket Architecture

Two WS servers + one raw TCP proxy, all attached to both HTTP and HTTPS:
- `/api/terminal/ws` — `WebSocketServer({ noServer: true })` on `upgrade` event, PTY I/O
- `/api/gateway-ws` — raw `net.connect()` TCP pipe (not ws-to-ws relay), transparent frame passthrough

---

## server.js Line Map

Key sections in the 4200+ line monolith:
- `~line 100–300` — startup, provider init, middleware
- `~line 800–1200` — file operation endpoints (`/api/folder/*`)
- `~line 1500–2500` — AI chat endpoint (`POST /api/chat`) — calls `ai-handler.js`
- `~line 2800–3200` — brain/PGS endpoints
- `~line 3139–3220` — `GET /api/providers/models` — dropdown model list with dynamic fetching
- `~line 3600+` — terminal WebSocket, OpenClaw proxy

## Key API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/chat` | Main AI endpoint — SSE streaming |
| `GET` | `/api/providers/models` | Model list for UI dropdown |
| `GET` | `/api/providers/status` | Provider health check |
| `GET` | `/api/folder/browse` | List directory |
| `GET` | `/api/folder/read` | Read file |
| `PUT` | `/api/folder/write` | Write file |
| `POST` | `/api/folder/create` | Create file/directory |
| `DELETE` | `/api/folder/delete` | Delete file |
| `POST` | `/api/brain/query` | Query a .brain package |
| `POST` | `/api/brain/query/stream` | SSE streaming brain query |
| `POST` | `/api/brain/load` | Load a brain by path |
| `GET` | `/api/brains/list` | List all brains across BRAIN_DIRS |
| `POST` | `/api/index-folder` | Index codebase for semantic search |
| `POST` | `/api/codebase-search` | Semantic code search |
| `GET` | `/api/conversations` | List saved conversations |
| `WS` | `/api/terminal/ws` | PTY terminal WebSocket |
| `WS` | `/api/gateway-ws` | OpenClaw gateway proxy |

---

## Common Pitfalls

- **Provider not in dropdown** — Verify `initializeProvider()` called in `providers/index.js` AND `getAvailableModels()` returns non-empty
- **Model routes to wrong provider** — Check `parseProviderId()` heuristics in `registry.js`. Models with colons default to Ollama; cloud models with colons need explicit heuristics
- **Wizard missing provider** — Check `providerOptions` array in `stepProviders()` in `setup-wizard.js`
- **Terminal broken on Pi** — `node-pty` needs native ARM compilation
- **Brain not loading** — Check `COSMO_BRAIN_DIRS` in config (comma-separated paths). Path must be in BRAIN_DIRS allowlist
- **Ollama stream format mismatch** — OllamaAdapter emits `content_delta` not `text`, and batches tool calls at end. Consumers need special handling
- **Codex tools breaking** — `ai-handler.js`'s `buildOpenAIResponsesToolsFromChatTools()` does stricter JSON Schema normalization than `OpenAIAdapter._convertToolsForResponses()`. Check the handler version first
- **Registry singleton stale** — Provider registration state determined once at first call, never re-evaluated unless `resetDefaultRegistry()` called
- **OAuth token refresh** — AnthropicClient has 50-min refresh window. AnthropicAdapter does not have periodic refresh. Legacy client handles OAuth lifecycle better
- **Port conflict on direct server start** — `node server/server.js` has no EADDRINUSE handler; only `evobrew start` does the pre-flight port check
- **Edit queue lost on refresh** — Pending edits are in-memory only, not persisted to localStorage
- **`create_file` bypasses approval** — Unlike edit tools, `create_file` writes directly to disk without user review
- **PGS sweeps always use Claude** — Hardcoded to `claude-sonnet-4-6` regardless of user model selection (synthesis uses user model)
- **Codebase indexer vs brain embeddings** — Codebase uses 1536d, brain uses 512d. Different vector spaces, not interchangeable
