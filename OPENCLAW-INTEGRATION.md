# OpenClaw Integration - Technical Documentation

## Overview

COSMO IDE integrates OpenClaw (COZ) as a **selectable AI model** in the model picker dropdown. When selected, chat requests route through the OpenClaw Gateway instead of direct API calls to OpenAI/Anthropic/xAI.

**Key Benefit:** COZ has persistent memory, tools, and session context that survive across IDE restarts. It's not just another LLM — it's a stateful agent.

---

## Architecture

### Two Integration Points

1. **COZ Tab (Sidebar)** - Direct chat with COZ in a dedicated panel
   - Session: `cosmo-ide:sidebar`
   - Standalone conversation
   - History persistence via Gateway

2. **Main Chat (Model Picker)** - COZ as an AI assistant option
   - Model ID: `openclaw:coz`
   - Session: `cosmo-ide:main`
   - Context-enriched prompts (file content, selection, file tree)
   - Streaming response with real-time rendering

---

## Connection Flow

### WebSocket Connection

**HTTPS Mode (Production):**
```
Browser (wss://) → COSMO IDE Server → ws://localhost:18789 (Gateway)
```

**HTTP Mode (Dev):**
```
Browser (ws://) → ws://localhost:18789 (Gateway)
```

The IDE proxies WebSocket connections through `/api/gateway-ws` when served over HTTPS to avoid mixed-content security blocks.

### Authentication

**Server-side credential injection:**
- IDE fetches `/api/gateway-auth` to get credentials
- Server returns `{ token: "...", password: "..." }` from `.env`
- Browser never sees raw credentials
- Connect request includes auth in params

**Environment Variables:**
```bash
OPENCLAW_GATEWAY_TOKEN=1e4e91f5554986f64ac7761fe6d05e46e734992a96d838ce
OPENCLAW_GATEWAY_PASSWORD=_cosmo23_
```

**Connect Request:**
```javascript
{
  id: "<uuid>",
  type: "req",
  method: "connect",
  params: {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "webchat",        // REQUIRED - Gateway only accepts "webchat" client
      version: "dev",
      platform: "web",
      mode: "webchat",
      instanceId: "<persistent-uuid>"
    },
    role: "operator",
    scopes: ["operator.admin"],
    auth: { token: "...", password: "..." }
  }
}
```

---

## Model Selection Integration

### Registration

File: `server/server.js` (lines 2179-2183)

```javascript
// Add OpenClaw (COZ) as a virtual provider option
models.push({
  id: 'openclaw:coz',
  provider: 'openclaw',
  label: 'COZ — Agent with Memory'
});
```

This shows up in the model dropdown alongside GPT-4o, Claude Sonnet, etc.

### Request Routing

File: `public/index.html` (line 8723)

```javascript
const selectedModel = document.getElementById('ai-model-select')?.value;

if (selectedModel.startsWith('openclaw:')) {
    // Route to OpenClaw Gateway
    await sendViaOpenClaw(message, context);
    return;
}

// Normal API call for other models
const response = await fetch('/api/chat', { ... });
```

---

## Context Enrichment

When you send a message through COZ, the IDE automatically enriches it with:

### Context Payload

```javascript
{
  fileName: "server.js",
  language: "javascript",
  documentContent: "...",         // Full file content (if <30k chars)
  selectedText: "...",             // Highlighted code
  currentFolder: "/path/to/project",
  fileTreeContext: "...",          // Directory structure
  brainEnabled: true/false,
  brainPath: "/path/to/brain.brain",
  conversationHistory: [...]       // Last 12 messages
}
```

### Enriched Message Format

```
[COSMO IDE Context]
File: server.js (javascript)
```javascript
// full file content here
```

Selected code:
```
highlighted section
```

File tree:
server/
  server.js
  ai-handler.js
  ...

[End Context]

{user's actual message}
```

---

## Streaming Response

### Event Flow

1. **Send Request**
   ```javascript
   {
     id: "<uuid>",
     type: "req",
     method: "chat.send",
     params: {
       sessionKey: "cosmo-ide:main",
       message: "<enriched-message>",
       idempotencyKey: "<uuid>"
     }
   }
   ```

2. **Gateway Events**

   **Streaming Deltas:**
   ```javascript
   {
     type: "event",
     event: "agent",
     payload: {
       sessionKey: "cosmo-ide:main",
       stream: "assistant",
       data: { delta: "chunk of text" }
     }
   }
   ```

   **Lifecycle End:**
   ```javascript
   {
     type: "event",
     event: "agent",
     payload: {
       stream: "lifecycle",
       data: { phase: "end" }
     }
   }
   ```

   **Final Message:**
   ```javascript
   {
     type: "event",
     event: "chat",
     payload: {
       state: "final",
       message: {
         role: "assistant",
         content: "full response text"
       }
     }
   }
   ```

### UI Rendering

**Streaming:**
- Creates message div with `▋` cursor
- Appends deltas incrementally
- Renders as Markdown with syntax highlighting

**Finalization:**
- Removes cursor
- Adds to conversation history
- Re-enables send button
- Stops timeout timer

---

## Code References

### Server-Side

**WebSocket Proxy** (`server/server.js:2050-2096`)
- Handles `/api/gateway-ws` upgrade
- Injects auth credentials
- Pipes bidirectional traffic

**Gateway Auth Endpoint** (`server/server.js:2131-2138`)
- Returns token/password from `.env`
- Keeps credentials server-side

**Model Registration** (`server/server.js:2179-2183`)
- Adds `openclaw:coz` to model list

### Client-Side

**Model Selection Check** (`public/index.html:8723`)
- Routes `openclaw:*` to Gateway

**sendViaOpenClaw()** (`public/index.html:11698-11769`)
- Enriches message with IDE context
- Sends `chat.send` request
- Sets up response handlers

**handleCozMessage()** (`public/index.html:11353-11503`)
- Processes all Gateway events
- Routes to main chat vs sidebar
- Handles streaming + final states

**handleOpenClawStream()** (`public/index.html:11828-11848`)
- Appends streaming deltas
- Updates UI with cursor

**finalizeOpenClawStream()** (`public/index.html:11850-11876`)
- Removes cursor
- Saves to history
- Resets UI state

---

## Session Keys

| Context | Session Key | Purpose |
|---------|-------------|---------|
| **Sidebar Chat** | `cosmo-ide:sidebar` | Standalone COZ conversation |
| **Main Chat** | `cosmo-ide:main` | COZ as AI assistant (context-enriched) |

**Important:** Session keys may have prefix like `<gateway-id>:cosmo-ide:main`. Event handlers check with `endsWith()` to handle both formats.

---

## Debugging

### Check WebSocket Connection

```javascript
// Browser console
console.log('WS State:', cozWebSocket?.readyState);
console.log('Authenticated:', cozAuthenticated);
```

**States:**
- `0` - CONNECTING
- `1` - OPEN
- `2` - CLOSING
- `3` - CLOSED

### Enable Gateway Logs

```bash
# On Mac
openclaw gateway logs --follow

# Check if Gateway is running
curl http://localhost:18789
```

### Common Issues

**"OpenClaw Gateway not connected"**
- Gateway not running → `openclaw gateway start`
- Wrong token in `.env` → Check `OPENCLAW_GATEWAY_TOKEN`
- Firewall blocking port 18789

**Messages not streaming**
- Check event handler session key matching
- Verify `client.id` is `"webchat"`
- Look for errors in browser console

**Authentication failed**
- Token mismatch between IDE `.env` and Gateway config
- Check `/api/gateway-auth` response

---

## Environment Setup

### Required Variables

```bash
# OpenClaw Gateway Connection
OPENCLAW_GATEWAY_TOKEN=1e4e91f5554986f64ac7761fe6d05e46e734992a96d838ce
OPENCLAW_GATEWAY_PASSWORD=_cosmo23_

# Optional: Override defaults
OPENCLAW_GATEWAY_HOST=localhost
OPENCLAW_GATEWAY_PORT=18789
```

### Gateway Configuration

File: `~/.openclaw/config.json`

```json
{
  "gateway": {
    "port": 18789,
    "auth": {
      "token": "1e4e91f5554986f64ac7761fe6d05e46e734992a96d838ce"
    }
  }
}
```

---

## Feature Comparison

| Feature | Direct API (GPT/Claude) | OpenClaw (COZ) |
|---------|------------------------|----------------|
| **Memory** | None (within convo only) | Persistent across sessions |
| **Tools** | Function calling (single run) | 50+ integrated tools |
| **Context** | Message history | Full workspace knowledge |
| **State** | Stateless | Stateful agent |
| **Cost** | Per-token API pricing | Gateway handles routing |
| **Speed** | Fast (direct) | Slightly slower (proxy) |

---

## Next Steps

### Planned Improvements

1. **Multi-Agent Support**
   - Add other OpenClaw agents to model picker
   - Route to different sessions (e.g., `openclaw:axiom`)

2. **Tool Visibility**
   - Show tool calls in chat UI (like native function calling)
   - Progress indicators for long-running operations

3. **History Sync**
   - Load `cosmo-ide:main` history on startup
   - Persist across IDE restarts

4. **Error Handling**
   - Better timeout UX
   - Reconnect on disconnect
   - Fallback to direct API if Gateway unavailable

---

## Related Documentation

- `README.md` - Full IDE feature overview
- `PI-DEPLOYMENT.md` - Raspberry Pi setup
- `OAUTH-TOKEN-SINK.md` - Claude OAuth integration
- OpenClaw Docs: https://docs.openclaw.ai

---

*Last updated: 2026-02-16 by COZ*
