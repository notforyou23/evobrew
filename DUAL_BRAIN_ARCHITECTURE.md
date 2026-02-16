# DUAL BRAIN ARCHITECTURE SPECIFICATION

**Version:** 1.0  
**Date:** 2026-02-16  
**Purpose:** Enable COSMO IDE to query both .brain packages AND OpenClaw memory seamlessly

---

## 1. CURRENT SYSTEM ANALYSIS

### 1.1 How COSMO Brain Currently Works

The COSMO brain system is built on a three-layer architecture:

**Layer 1: Brain Loader** (`server/brain-loader-module.js`)
- **Purpose:** Pre-loads a .brain package before server starts
- **Key function:** `loadBrain(brainPath)` → Returns `{ brainLoader, brainQueryEngine }`
- **Brain structure:**
  - `.brain` packages are directories containing:
    - `state.json.gz` - Compressed brain state (nodes, edges, metadata)
    - `outputs/` - Agent-generated files (documents, code, execution logs)
    - `manifest.json` (optional) - Brain metadata
  - Loaded state includes:
    - `memory.nodes[]` - Knowledge graph nodes
    - `memory.edges[]` - Relationships between nodes
    - `cycleCount` - Number of reasoning cycles
    - Cluster metadata (if merged brain)

**Layer 2: Query Engine** (`lib/brain-query-engine.js` wrapper → `lib/query-engine.js` core)
- **Purpose:** Execute semantic queries against brain state
- **Key methods:**
  - `executeQuery(query, options)` - Standard query with streaming
  - `executeEnhancedQuery(query, options)` - Includes file loading + action support
- **Internal flow:**
  1. Load brain state from `state.json.gz`
  2. Semantic search via `queryMemory()` (vector similarity using OpenAI embeddings)
  3. Retrieve relevant thoughts from `thoughts.jsonl`
  4. Optionally scan `outputs/` folder for documents, code, execution logs
  5. Build context (memory nodes + thoughts + files)
  6. Send to GPT-5 or Claude with specialized prompts
  7. Stream response chunks via `onChunk` callback
  8. Return structured result

**Layer 3: HTTP API** (`server/server.js`)
- **Routes:**
  - `POST /api/brain/query` - Execute query (buffered response)
  - `POST /api/brain/query/stream` - Execute query (SSE streaming)
  - `GET /api/brain/manifest` - Get brain metadata
  - `GET /api/brain/stats` - Node/edge counts
  - `GET /api/brain/info` - Brain path and admin mode status

### 1.2 Key Contracts and Interfaces

**Brain Loader Contract:**
```javascript
// INPUT
loadBrain(brainPath: string) 

// OUTPUT
{
  brainLoader: {
    brainPath: string,      // Absolute path to .brain directory
    state: Object,          // Parsed state.json.gz
    nodes: Array,           // state.memory.nodes
    edges: Array            // state.memory.edges
  },
  brainQueryEngine: BrainQueryEngine
}

// ACCESS
getBrainLoader() → brainLoader | null
getQueryEngine() → brainQueryEngine | null
```

**Query Engine Contract:**
```javascript
// INPUT
executeEnhancedQuery(query: string, options: {
  model?: string,              // 'gpt-5.2', 'claude-opus-4-5', etc.
  mode?: string,               // 'quick', 'full', 'expert', 'dive'
  includeFiles?: boolean,      // Load outputs/ folder?
  allowActions?: boolean,      // Execute detected actions?
  enablePGS?: boolean,         // Partitioned Graph Synthesis (3-6 min)
  onChunk?: (chunk) => void,   // Streaming callback
  // ... other options
})

// OUTPUT
{
  answer: string,              // Natural language response
  metadata: {
    model: string,
    mode: string,
    reasoningEffort: string,   // 'low', 'medium', 'high'
    sources: {
      memoryNodes: number,     // Nodes used in context
      thoughts: number,        // Thoughts included
      edges: number,           // Total edges in graph
      liveJournalNodes: number // Active agent findings
    },
    timestamp: string,         // ISO 8601
    filesAccessed?: {          // If includeFiles=true
      total: number,
      documents: number,
      codeFiles: number,
      executionOutputs: number,
      deliverables: number
    }
  },
  actionIntent?: Object,       // If action detected
  actionExecuted?: boolean,
  actionResult?: Object
}
```

**SSE Streaming Contract (onChunk):**
```javascript
// Progress events
{ type: 'progress', message: string }

// Result event (final)
{ 
  type: 'result', 
  answer: string, 
  metadata: Object,
  ...
}

// Error event
{ type: 'error', message: string }
```

### 1.3 Response Format Details

**Standard Query Response:**
- **answer:** Rich markdown text (lists, code blocks, tables, headers)
- **metadata.sources:** Transparency about knowledge sources
- **metadata.filesAccessed:** If output files were loaded
- **Streaming:** Chunks emitted via `onChunk` callback (SSE-compatible)

**Enhanced Query Additional Fields:**
- **actionIntent:** Detected file creation, agent spawn, etc.
- **actionExecuted/actionResult:** If `allowActions=true`

**Dependencies:**
- OpenAI API (embeddings + GPT-5.2)
- Anthropic API (Claude Opus/Sonnet 4-5)
- Node.js filesystem (zlib for decompression)
- Vector similarity search (cosine distance)

---

## 2. OPENCLAW MEMORY MAPPING

### 2.1 How OpenClaw Memory Search Works

OpenClaw provides a **semantic memory search** tool that queries the agent's persistent knowledge graph:

**Tool Signature (from OpenClaw docs):**
```javascript
memory_search({
  query: string,           // Natural language query
  maxResults?: number,     // Default 10, max 100
  minScore?: number,       // Similarity threshold (0-1)
  timeRange?: {            // Optional time filter
    start?: string,        // ISO 8601
    end?: string
  }
})
```

**Expected Response Format:**
```javascript
{
  results: [
    {
      content: string,        // The memory content (markdown)
      score: number,          // Relevance score (0-1)
      timestamp: string,      // ISO 8601
      source: string,         // 'daily', 'entity', 'reflection', etc.
      entityId?: string,      // If from knowledge graph entity
      metadata?: {            // Additional context
        type?: string,        // 'fact', 'preference', 'relationship', etc.
        confidence?: number,  // 0-1 (from reflection system)
        tags?: string[]
      }
    }
  ],
  totalResults: number,
  queryTime: number          // Milliseconds
}
```

**Key Differences from COSMO Brain:**
- **Granularity:** OpenClaw returns individual memory snippets, not a full knowledge graph
- **Time-aware:** Memories have timestamps (daily notes, reflections, entities)
- **Confidence scores:** Reflection system assigns confidence to facts
- **Live data:** Always current (vs. .brain packages which are snapshots)

### 2.2 Mapping to Brain Query Format

**Conceptual Mapping:**
| COSMO Brain | OpenClaw Memory | Notes |
|-------------|-----------------|-------|
| `memory.nodes[]` | `results[]` | Nodes → Memory snippets |
| `node.content` | `result.content` | Direct mapping |
| `node.id` | `result.entityId` or hash | May need synthetic ID |
| `edges[]` | N/A (implicit) | No explicit edge data |
| `thoughts[]` | Daily notes | Filter `source='daily'` |
| `outputs/` files | N/A | No file storage in memory |
| Snapshot-based | Real-time | Always fresh data |

**Response Transformation Strategy:**
```javascript
// Transform OpenClaw memory results to brain-like structure
function transformMemoryToBrainFormat(memoryResults) {
  return {
    nodes: memoryResults.results.map((r, idx) => ({
      id: r.entityId || `mem-${idx}`,
      content: r.content,
      timestamp: r.timestamp,
      score: r.score,           // Relevance to query
      confidence: r.metadata?.confidence || r.score,
      type: r.metadata?.type || 'memory',
      source: r.source,
      tags: r.metadata?.tags || []
    })),
    edges: [],  // No edge data from memory search
    metadata: {
      source: 'openclaw',
      timestamp: new Date().toISOString(),
      totalResults: memoryResults.totalResults,
      queryTimeMs: memoryResults.queryTime
    }
  };
}
```

**Limitations:**
- ❌ **No graph structure:** OpenClaw doesn't return edges/relationships
- ❌ **No output files:** Memory is text-only
- ✅ **Richer temporal data:** Timestamp + confidence scores
- ✅ **Always current:** No need to reload

---

## 3. ADAPTER INTERFACE SPECIFICATION

### 3.1 Base Class Definition

```javascript
/**
 * BrainAdapter - Abstract base class for brain data sources
 * 
 * Adapters normalize different knowledge sources (COSMO brains, OpenClaw memory, etc.)
 * into a unified query interface for the IDE.
 */
class BrainAdapter {
  constructor(config) {
    this.config = config;
    this.type = 'unknown';  // 'cosmo-brain' | 'openclaw-memory'
    this.initialized = false;
  }

  /**
   * Initialize the adapter (load brain, connect to service, etc.)
   * @returns {Promise<boolean>} Success
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Check if this adapter is available/applicable
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented by subclass');
  }

  /**
   * Get adapter metadata (name, source, stats, etc.)
   * @returns {Promise<Object>}
   */
  async getInfo() {
    throw new Error('getInfo() must be implemented by subclass');
  }

  /**
   * Execute a query against the knowledge source
   * @param {string} query - Natural language query
   * @param {Object} options - Query options
   * @param {string} options.model - AI model ('gpt-5.2', 'claude-opus-4-5')
   * @param {string} options.mode - Query mode ('quick', 'full', 'expert', 'dive')
   * @param {number} options.maxResults - Max memory nodes to return
   * @param {boolean} options.includeFiles - Load associated files?
   * @param {Function} options.onChunk - Streaming callback
   * @returns {Promise<BrainQueryResult>}
   */
  async query(query, options = {}) {
    throw new Error('query() must be implemented by subclass');
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async dispose() {
    this.initialized = false;
  }
}

/**
 * @typedef {Object} BrainQueryResult
 * @property {string} answer - Natural language response
 * @property {Object} metadata - Query metadata
 * @property {string} metadata.model - Model used
 * @property {string} metadata.mode - Query mode
 * @property {string} metadata.source - 'cosmo-brain' | 'openclaw-memory'
 * @property {Object} metadata.sources - Source statistics
 * @property {number} metadata.sources.memoryNodes - Nodes used
 * @property {number} metadata.sources.thoughts - Thoughts included
 * @property {number} metadata.sources.edges - Graph edges
 * @property {string} metadata.timestamp - ISO 8601
 * @property {Object} [metadata.filesAccessed] - File access stats (if applicable)
 * @property {Object} [actionIntent] - Detected action (optional)
 * @property {boolean} [actionExecuted] - Action execution status
 * @property {Object} [actionResult] - Action result (optional)
 */

module.exports = { BrainAdapter };
```

### 3.2 COSMO Brain Adapter

```javascript
/**
 * COSMOBrainAdapter - Adapter for .brain packages
 */
class COSMOBrainAdapter extends BrainAdapter {
  constructor(brainPath) {
    super({ brainPath });
    this.type = 'cosmo-brain';
    this.brainPath = brainPath;
    this.brainLoader = null;
    this.queryEngine = null;
  }

  async isAvailable() {
    if (!this.brainPath) return false;
    const stateFile = path.join(this.brainPath, 'state.json.gz');
    return fsSync.existsSync(stateFile);
  }

  async initialize() {
    const { loadBrain } = require('./brain-loader-module');
    const result = await loadBrain(this.brainPath);
    this.brainLoader = result.brainLoader;
    this.queryEngine = result.brainQueryEngine;
    this.initialized = true;
    return true;
  }

  async getInfo() {
    if (!this.brainLoader) throw new Error('Adapter not initialized');
    
    return {
      hasBrain: true,
      source: 'cosmo-brain',
      brainPath: this.brainLoader.brainPath,
      brainName: path.basename(this.brainLoader.brainPath),
      stats: {
        nodes: this.brainLoader.nodes.length,
        edges: this.brainLoader.edges.length,
        cycles: this.brainLoader.state.cycleCount || 0
      },
      outputsPath: path.join(this.brainLoader.brainPath, 'outputs'),
      hasOutputs: fsSync.existsSync(path.join(this.brainLoader.brainPath, 'outputs'))
    };
  }

  async query(query, options = {}) {
    if (!this.queryEngine) throw new Error('Adapter not initialized');
    
    // Map generic options to COSMO-specific options
    const cosmoOptions = {
      model: options.model || 'gpt-5.2',
      mode: options.mode || 'full',
      includeFiles: options.includeFiles !== false,
      allowActions: options.allowActions || false,
      onChunk: options.onChunk,
      ...options  // Pass through any COSMO-specific options
    };

    const result = await this.queryEngine.executeEnhancedQuery(query, cosmoOptions);
    
    // Ensure consistent metadata
    result.metadata.source = 'cosmo-brain';
    return result;
  }

  async dispose() {
    const { unloadBrain } = require('./brain-loader-module');
    unloadBrain();
    await super.dispose();
  }
}
```

### 3.3 OpenClaw Memory Adapter

```javascript
/**
 * OpenClawMemoryAdapter - Adapter for OpenClaw memory search
 */
class OpenClawMemoryAdapter extends BrainAdapter {
  constructor(gatewayConfig) {
    super({ gatewayConfig });
    this.type = 'openclaw-memory';
    this.gatewayConfig = gatewayConfig || {
      url: process.env.OPENCLAW_GATEWAY_URL,
      token: process.env.OPENCLAW_GATEWAY_TOKEN
    };
  }

  async isAvailable() {
    // Check if OpenClaw gateway is accessible
    try {
      // Attempt a minimal health check or test query
      // For now, just check if credentials exist
      return !!(this.gatewayConfig.url && this.gatewayConfig.token);
    } catch (error) {
      return false;
    }
  }

  async initialize() {
    // Verify gateway connectivity
    // Could do a test memory_search call here
    this.initialized = true;
    return true;
  }

  async getInfo() {
    return {
      hasBrain: true,
      source: 'openclaw-memory',
      gatewayUrl: this.gatewayConfig.url,
      stats: {
        // Would need to query OpenClaw for actual stats
        // For now, return placeholder
        nodes: null,
        edges: null
      },
      hasOutputs: false  // Memory doesn't have file outputs
    };
  }

  async query(query, options = {}) {
    if (!this.initialized) throw new Error('Adapter not initialized');

    const {
      model = 'gpt-5.2',
      mode = 'full',
      maxResults = 100,
      onChunk
    } = options;

    // Emit progress
    if (onChunk) {
      onChunk({ type: 'progress', message: 'Searching OpenClaw memory...' });
    }

    // Call OpenClaw memory_search
    const memoryResults = await this.searchMemory(query, { 
      maxResults,
      minScore: 0.3  // Filter low-relevance results
    });

    if (onChunk) {
      onChunk({ 
        type: 'progress', 
        message: `Found ${memoryResults.totalResults} memories (${memoryResults.queryTime}ms)` 
      });
    }

    // Transform to brain-like structure
    const brainData = this.transformMemoryToBrainFormat(memoryResults);

    if (onChunk) {
      onChunk({ type: 'progress', message: 'Generating response with AI...' });
    }

    // Build context and query AI
    const context = this.buildContext(brainData, query, mode);
    const answer = await this.generateAnswer(query, context, { model, mode, onChunk });

    return {
      answer,
      metadata: {
        model,
        mode,
        source: 'openclaw-memory',
        sources: {
          memoryNodes: memoryResults.results.length,
          thoughts: memoryResults.results.filter(r => r.source === 'daily').length,
          edges: 0  // No edge data from memory
        },
        timestamp: new Date().toISOString(),
        queryTimeMs: memoryResults.queryTime
      }
    };
  }

  async searchMemory(query, options) {
    // Call OpenClaw memory_search tool
    // This would be implemented as an HTTP request to gateway
    // or via OpenClaw SDK if available
    
    // PLACEHOLDER - actual implementation needed
    throw new Error('searchMemory() requires OpenClaw gateway integration');
  }

  transformMemoryToBrainFormat(memoryResults) {
    return {
      nodes: memoryResults.results.map((r, idx) => ({
        id: r.entityId || `mem-${idx}`,
        content: r.content,
        timestamp: r.timestamp,
        score: r.score,
        confidence: r.metadata?.confidence || r.score,
        type: r.metadata?.type || 'memory',
        source: r.source,
        tags: r.metadata?.tags || []
      })),
      edges: [],
      metadata: {
        source: 'openclaw',
        timestamp: new Date().toISOString(),
        totalResults: memoryResults.totalResults,
        queryTimeMs: memoryResults.queryTime
      }
    };
  }

  buildContext(brainData, query, mode) {
    // Similar to COSMO's buildContext but adapted for memory format
    // Simplified version - no file outputs, no cluster data
    
    const nodes = brainData.nodes.slice(0, this.getNodeLimit(mode));
    
    let context = `# OpenClaw Memory Context\n\n`;
    context += `Query: ${query}\n\n`;
    context += `## Relevant Memories (${nodes.length} of ${brainData.metadata.totalResults})\n\n`;
    
    nodes.forEach((node, idx) => {
      context += `### Memory ${idx + 1} [Score: ${node.score.toFixed(2)}, Source: ${node.source}]\n`;
      context += `${node.content}\n\n`;
      if (node.timestamp) {
        context += `*Recorded: ${node.timestamp}*\n\n`;
      }
    });
    
    return context;
  }

  getNodeLimit(mode) {
    const limits = {
      quick: 20,
      full: 50,
      expert: 100,
      dive: 150
    };
    return limits[mode] || 50;
  }

  async generateAnswer(query, context, options) {
    // Call AI model (GPT-5 or Claude) with context
    // Similar to COSMO's approach but simplified
    
    const { model, mode, onChunk } = options;
    
    // PLACEHOLDER - actual implementation needed
    // Would use OpenAI or Anthropic SDK
    throw new Error('generateAnswer() requires AI model integration');
  }
}
```

### 3.4 Error Handling

**Adapter-level errors:**
- `AdapterNotInitializedError` - Thrown when querying before initialization
- `AdapterUnavailableError` - Thrown when data source is not accessible
- `QueryExecutionError` - Wraps underlying query errors with adapter context

**Implementation:**
```javascript
class AdapterError extends Error {
  constructor(message, adapterType, originalError = null) {
    super(message);
    this.name = 'AdapterError';
    this.adapterType = adapterType;
    this.originalError = originalError;
  }
}

// Usage in adapters
try {
  // ... query logic
} catch (error) {
  throw new AdapterError(
    `Query failed: ${error.message}`,
    this.type,
    error
  );
}
```

---

## 4. SOURCE DETECTION LOGIC

### 4.1 Detection Flowchart

```
START
  │
  ├─> Check environment variable: COSMO_BRAIN_SOURCE
  │   ├─> 'cosmo-brain' → Use COSMOBrainAdapter (if brain path set)
  │   ├─> 'openclaw-memory' → Use OpenClawMemoryAdapter
  │   └─> Not set → Continue auto-detection
  │
  ├─> Check for COSMO_BRAIN_PATH environment variable
  │   └─> If set and valid → Use COSMOBrainAdapter
  │
  ├─> Check for .brain package in project
  │   ├─> Look for state.json.gz in known locations:
  │   │   - ./brain/*.brain/state.json.gz
  │   │   - ../brains/*.brain/state.json.gz
  │   │   - User-specified path in config.json
  │   └─> If found → Use COSMOBrainAdapter
  │
  ├─> Check for OpenClaw gateway availability
  │   ├─> Environment variables:
  │   │   - OPENCLAW_GATEWAY_URL
  │   │   - OPENCLAW_GATEWAY_TOKEN
  │   ├─> Test gateway connection (HTTP HEAD request)
  │   └─> If available → Use OpenClawMemoryAdapter
  │
  ├─> Check for fallback configuration
  │   └─> config/brain-sources.json
  │
  └─> No source available → Return null (No Brain mode)
```

### 4.2 Detection Implementation

```javascript
/**
 * Brain Source Detector
 * Automatically detects available brain sources and creates appropriate adapter
 */
class BrainSourceDetector {
  constructor() {
    this.detectedSource = null;
    this.adapter = null;
  }

  /**
   * Auto-detect and initialize best available brain source
   * @returns {Promise<BrainAdapter|null>}
   */
  async detect() {
    // 1. Check explicit environment override
    const explicitSource = process.env.COSMO_BRAIN_SOURCE;
    if (explicitSource) {
      console.log(`[Brain Source] Explicit source set: ${explicitSource}`);
      return await this.detectExplicitSource(explicitSource);
    }

    // 2. Try COSMO brain first (brain packages are snapshots, good for analysis)
    const cosmoBrain = await this.detectCOSMOBrain();
    if (cosmoBrain) {
      console.log('[Brain Source] Using COSMO brain package');
      return cosmoBrain;
    }

    // 3. Try OpenClaw memory (live data, good for current context)
    const openclawMemory = await this.detectOpenClawMemory();
    if (openclawMemory) {
      console.log('[Brain Source] Using OpenClaw memory');
      return openclawMemory;
    }

    // 4. No source available
    console.log('[Brain Source] No brain source detected');
    return null;
  }

  async detectExplicitSource(sourceType) {
    if (sourceType === 'cosmo-brain') {
      return await this.detectCOSMOBrain();
    } else if (sourceType === 'openclaw-memory') {
      return await this.detectOpenClawMemory();
    } else {
      throw new Error(`Unknown brain source type: ${sourceType}`);
    }
  }

  async detectCOSMOBrain() {
    // Check environment variable first
    const envPath = process.env.COSMO_BRAIN_PATH;
    if (envPath) {
      const adapter = new COSMOBrainAdapter(envPath);
      if (await adapter.isAvailable()) {
        await adapter.initialize();
        return adapter;
      }
    }

    // Search known locations
    const searchPaths = [
      path.join(__dirname, '..', 'brain'),
      path.join(__dirname, '..', '..', 'brains'),
      process.env.HOME ? path.join(process.env.HOME, 'cosmo-brains') : null
    ].filter(Boolean);

    for (const searchPath of searchPaths) {
      if (!fsSync.existsSync(searchPath)) continue;
      
      const entries = fsSync.readdirSync(searchPath, { withFileTypes: true });
      const brainDirs = entries
        .filter(e => e.isDirectory() && e.name.endsWith('.brain'))
        .map(e => path.join(searchPath, e.name));

      for (const brainPath of brainDirs) {
        const adapter = new COSMOBrainAdapter(brainPath);
        if (await adapter.isAvailable()) {
          await adapter.initialize();
          console.log(`[Brain Source] Found brain: ${brainPath}`);
          return adapter;
        }
      }
    }

    return null;
  }

  async detectOpenClawMemory() {
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

    if (!gatewayUrl || !gatewayToken) {
      return null;
    }

    const adapter = new OpenClawMemoryAdapter({ 
      url: gatewayUrl, 
      token: gatewayToken 
    });

    if (await adapter.isAvailable()) {
      await adapter.initialize();
      return adapter;
    }

    return null;
  }

  /**
   * Get current adapter (cached)
   */
  getAdapter() {
    return this.adapter;
  }

  /**
   * Force re-detection (useful for hot-reloading)
   */
  async refresh() {
    if (this.adapter) {
      await this.adapter.dispose();
    }
    this.adapter = await this.detect();
    return this.adapter;
  }
}
```

### 4.3 Integration with Server

```javascript
// In server.js startup

const { BrainSourceDetector } = require('./lib/brain-source-detector');

// Auto-detect brain source on startup
const detector = new BrainSourceDetector();
let brainAdapter = null;

async function initializeBrainSource() {
  console.log('\n🧠 Detecting brain source...');
  brainAdapter = await detector.detect();
  
  if (brainAdapter) {
    const info = await brainAdapter.getInfo();
    console.log(`✅ Brain source: ${info.source}`);
    if (info.stats) {
      console.log(`   Nodes: ${info.stats.nodes?.toLocaleString() || 'N/A'}`);
      console.log(`   Edges: ${info.stats.edges?.toLocaleString() || 'N/A'}`);
    }
  } else {
    console.log('⚠️  No brain source available - running in No Brain mode');
  }
}

// Update routes to use adapter
app.post('/api/brain/query', async (req, res) => {
  if (!brainAdapter) {
    return res.status(404).json({ error: 'No brain source available' });
  }

  try {
    const { query, ...options } = req.body;
    const result = await brainAdapter.query(query, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/brain/info', async (req, res) => {
  if (!brainAdapter) {
    return res.json({ hasBrain: false });
  }

  const info = await brainAdapter.getInfo();
  res.json(info);
});
```

---

## 5. IMPLEMENTATION PLAN

### 5.1 File Structure

**New Files to Create:**
```
lib/
  brain-adapters/
    base-adapter.js           # BrainAdapter base class
    cosmo-brain-adapter.js    # COSMOBrainAdapter implementation
    openclaw-memory-adapter.js # OpenClawMemoryAdapter implementation
    adapter-errors.js         # Error classes
    index.js                  # Exports all adapters
  brain-source-detector.js    # Auto-detection logic
```

**Files to Modify:**
```
server/server.js              # Replace direct brain-loader calls with adapter
server/brain-loader-module.js # Keep for backward compatibility (used by adapter)
lib/brain-query-engine.js     # Keep as-is (used by COSMO adapter)
lib/query-engine.js           # Keep as-is (core logic unchanged)
```

**Files to Keep Unchanged:**
```
lib/query-engine.js           # Core query logic (adapter-agnostic)
lib/evidence-analyzer.js      # Enhancement modules
lib/insight-synthesizer.js
lib/coordinator-indexer.js
lib/pgs-engine.js
```

### 5.2 Minimal Changes to Existing Code

**Change 1: Server initialization**
```javascript
// OLD (server.js)
const { loadBrain, getBrainLoader, getQueryEngine } = require('./brain-loader-module');
let brainLoader = null;
let brainQueryEngine = null;
if (process.env.COSMO_BRAIN_PATH) {
  await loadBrain(process.env.COSMO_BRAIN_PATH);
}

// NEW (server.js)
const { BrainSourceDetector } = require('./lib/brain-source-detector');
const detector = new BrainSourceDetector();
let brainAdapter = await detector.detect();
```

**Change 2: Query routes**
```javascript
// OLD
app.post('/api/brain/query', async (req, res) => {
  const queryEngine = getQueryEngine();
  if (!queryEngine) return res.status(404).json({ error: 'No brain loaded' });
  const result = await queryEngine.executeEnhancedQuery(query, options);
  res.json(result);
});

// NEW
app.post('/api/brain/query', async (req, res) => {
  if (!brainAdapter) return res.status(404).json({ error: 'No brain source available' });
  const result = await brainAdapter.query(query, options);
  res.json(result);
});
```

**Change 3: Info route**
```javascript
// OLD
app.get('/api/brain/info', (req, res) => {
  const loader = getBrainLoader();
  if (!loader) return res.json({ hasBrain: false });
  res.json({ hasBrain: true, brainPath: loader.brainPath, ... });
});

// NEW
app.get('/api/brain/info', async (req, res) => {
  if (!brainAdapter) return res.json({ hasBrain: false });
  const info = await brainAdapter.getInfo();
  res.json(info);
});
```

### 5.3 Testing Approach

**Phase 1: COSMO Brain Adapter (Regression Testing)**
- ✅ Existing brain packages should work unchanged
- ✅ All query modes (quick, full, expert, dive) functional
- ✅ Streaming (SSE) works
- ✅ File loading (outputs/) functional
- ✅ PGS (Partitioned Graph Synthesis) works
- ✅ Action detection/execution works

**Test Cases:**
```javascript
// Test 1: Basic query
const adapter = new COSMOBrainAdapter('./test-brain.brain');
await adapter.initialize();
const result = await adapter.query('What did we learn about X?');
assert(result.answer);
assert(result.metadata.source === 'cosmo-brain');

// Test 2: Streaming
let chunks = [];
await adapter.query('Explain Y', {
  onChunk: (chunk) => chunks.push(chunk)
});
assert(chunks.length > 0);
assert(chunks[chunks.length - 1].type === 'result');

// Test 3: Files included
const result = await adapter.query('Show me code examples', {
  includeFiles: true
});
assert(result.metadata.filesAccessed);
```

**Phase 2: OpenClaw Memory Adapter (New Feature)**
- ✅ Memory search integration
- ✅ Response transformation
- ✅ Context building
- ✅ AI generation

**Test Cases:**
```javascript
// Test 1: Memory search
const adapter = new OpenClawMemoryAdapter({
  url: 'ws://localhost:18789',
  token: 'test-token'
});
await adapter.initialize();
assert(await adapter.isAvailable());

// Test 2: Query execution
const result = await adapter.query('What do you remember about project X?');
assert(result.answer);
assert(result.metadata.source === 'openclaw-memory');
assert(result.metadata.sources.memoryNodes > 0);
```

**Phase 3: Auto-Detection**
- ✅ Correct source selected in different scenarios
- ✅ Fallback logic works
- ✅ Environment variable overrides respected

**Test Scenarios:**
```javascript
// Scenario 1: Brain package present
process.env.COSMO_BRAIN_PATH = './test-brain.brain';
const detector = new BrainSourceDetector();
const adapter = await detector.detect();
assert(adapter.type === 'cosmo-brain');

// Scenario 2: Only OpenClaw available
delete process.env.COSMO_BRAIN_PATH;
process.env.OPENCLAW_GATEWAY_URL = 'ws://localhost:18789';
process.env.OPENCLAW_GATEWAY_TOKEN = 'test-token';
const adapter = await detector.detect();
assert(adapter.type === 'openclaw-memory');

// Scenario 3: Explicit override
process.env.COSMO_BRAIN_SOURCE = 'openclaw-memory';
const adapter = await detector.detect();
assert(adapter.type === 'openclaw-memory');
```

**Phase 4: Integration Testing**
- ✅ Server starts correctly with each source type
- ✅ Frontend UI works with both adapters
- ✅ Hot-reload works (changing brain source without restart)
- ✅ Error handling graceful

**Manual Testing Checklist:**
- [ ] Load COSMO IDE with .brain package
- [ ] Execute queries in all modes (quick, full, expert, dive)
- [ ] Test streaming queries
- [ ] Test file loading
- [ ] Switch to OpenClaw memory mode (env variable)
- [ ] Execute queries against OpenClaw memory
- [ ] Test with no brain source (No Brain mode)
- [ ] Verify error messages are helpful

### 5.4 Migration Path

**Step 1: Create adapter infrastructure (no breaking changes)**
- Add `lib/brain-adapters/` directory
- Implement base adapter and COSMO adapter
- Keep existing `brain-loader-module.js` unchanged

**Step 2: Add detection logic (opt-in)**
- Implement `BrainSourceDetector`
- Add environment variable support
- Test with existing brains

**Step 3: Update server.js (breaking change)**
- Replace `brain-loader-module` imports with detector
- Update route handlers to use adapter interface
- Deploy with backward compatibility flag

**Step 4: Implement OpenClaw adapter (new feature)**
- Add `OpenClawMemoryAdapter` class
- Integrate memory_search tool
- Test in isolation

**Step 5: Enable auto-detection (production ready)**
- Remove backward compatibility flag
- Update documentation
- Add to COSMO IDE README

---

## 6. FUTURE ENHANCEMENTS

**Potential Additional Adapters:**
- `HybridBrainAdapter` - Query both COSMO brain AND OpenClaw memory, merge results
- `RemoteBrainAdapter` - Query COSMO brains over HTTP (multi-user scenarios)
- `FilesystemBrainAdapter` - Query arbitrary document collections
- `VectorDBAdapter` - Query external vector databases (Pinecone, Weaviate, etc.)

**Performance Optimizations:**
- Cache memory search results (time-based invalidation)
- Parallel queries across multiple adapters
- Lazy loading of brain data (don't load full state upfront)

**Developer Experience:**
- CLI tool: `cosmo-brain switch <source>` to change adapter
- Admin UI: Dropdown to select active brain source
- Hot-reload: Watch for brain file changes, auto-refresh adapter

---

## SUMMARY

This architecture enables COSMO IDE to:
1. ✅ Continue using .brain packages (existing functionality preserved)
2. ✅ Query OpenClaw memory when no brain package present
3. ✅ Auto-detect best available source
4. ✅ Extend to new sources in future (hybrid, remote, etc.)

**Key Benefits:**
- **Backward compatible:** Existing brains work unchanged
- **Flexible:** Easy to add new data sources
- **Testable:** Each adapter isolated, easy to unit test
- **Maintainable:** Clean separation of concerns (detection → adapter → query)

**Implementation Effort:**
- **Phase 1 (COSMO adapter):** ~4 hours (mostly refactoring)
- **Phase 2 (Detection logic):** ~2 hours
- **Phase 3 (OpenClaw adapter):** ~6 hours (new integration)
- **Phase 4 (Testing):** ~4 hours
- **Total:** ~16 hours (2 days)

**Next Steps:**
1. Review this architecture with jtr
2. Create `lib/brain-adapters/base-adapter.js`
3. Implement `COSMOBrainAdapter` (minimal wrapper)
4. Test with existing brains
5. Implement `OpenClawMemoryAdapter`
6. Integrate into server.js
7. Deploy and validate

---

*Architecture designed by: Axiom (OpenClaw subagent)*  
*Date: 2026-02-16*  
*Status: Ready for review and implementation*
