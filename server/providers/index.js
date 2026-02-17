/**
 * Provider Abstraction Layer for COSMO IDE
 * 
 * Model-agnostic provider system supporting:
 * - Anthropic (Claude) with OAuth stealth mode
 * - OpenAI (GPT-4o, GPT-5+) with Responses API support
 * - xAI (Grok) via OpenAI-compatible API
 * - Ollama for local models and embeddings
 * - LM Studio for local models (OpenAI-compatible)
 * 
 * Configuration Priority:
 * 1. ~/.evobrew/config.json (new config system)
 * 2. Environment variables (legacy/override)
 * 
 * Usage:
 * ```javascript
 * const { createRegistry } = require('./providers');
 * 
 * // Create and initialize the registry
 * const registry = await createRegistry();
 * 
 * // Get provider for a model
 * const provider = registry.getProvider('claude-sonnet-4-5');
 * 
 * // Use the provider
 * const response = await provider.createMessage({
 *   model: 'claude-sonnet-4-5',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 */

// Platform detection
const { getPlatform } = require('../config/platform.js');

// Types
const unified = require('./types/unified.js');

// Adapters
const { ProviderAdapter } = require('./adapters/base.js');
const { AnthropicAdapter, createAnthropicAdapter, createAnthropicAdapterWithOAuth } = require('./adapters/anthropic.js');
const { OpenAIAdapter, createOpenAIAdapter, shouldUseResponsesAPI } = require('./adapters/openai.js');
const { OllamaAdapter, createOllamaAdapter } = require('./adapters/ollama.js');

// Registry
const { ProviderRegistry } = require('./registry.js');

// Config loader
let loadConfigSafe;
try {
  loadConfigSafe = require('../../lib/config-manager').loadConfigSafe;
} catch (e) {
  // Fallback if config-manager not available
  loadConfigSafe = async () => null;
}

/**
 * Detect if Ollama is running locally
 * @param {string} [baseUrl='http://localhost:11434'] - Ollama base URL
 * @param {number} [timeoutMs=1000] - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
async function detectOllama(baseUrl = 'http://localhost:11434', timeoutMs = 1000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Detect if LM Studio is running locally
 * @param {string} [baseUrl='http://localhost:1234/v1'] - LM Studio base URL
 * @param {number} [timeoutMs=1000] - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
async function detectLMStudio(baseUrl = 'http://localhost:1234/v1', timeoutMs = 1000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const res = await fetch(`${baseUrl}/models`, {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get list of models from LM Studio
 * @param {string} [baseUrl='http://localhost:1234/v1'] - LM Studio base URL
 * @returns {Promise<string[]>}
 */
async function getLMStudioModels(baseUrl = 'http://localhost:1234/v1') {
  try {
    const res = await fetch(`${baseUrl}/models`);
    if (res.ok) {
      const data = await res.json();
      return (data.data || []).map(m => m.id);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Create a fully-initialized provider registry for COSMO IDE
 * 
 * This helper:
 * 1. Loads configuration from ~/.evobrew/config.json
 * 2. Initializes Anthropic with COSMO IDE's OAuth service
 * 3. Initializes OpenAI from environment/config
 * 4. Initializes xAI (Grok) from environment/config
 * 5. Detects and optionally initializes Ollama
 * 6. Detects and optionally initializes LM Studio
 * 
 * @param {Object} [options]
 * @param {boolean} [options.detectOllama=true] - Auto-detect Ollama
 * @param {boolean} [options.detectLMStudio=true] - Auto-detect LM Studio
 * @param {boolean} [options.useAnthropicOAuth=true] - Use COSMO IDE's OAuth service
 * @param {Object} [options.config] - Override config (otherwise loads from file)
 * @returns {Promise<ProviderRegistry>}
 */
async function createRegistry(options = {}) {
  const registry = new ProviderRegistry();
  const detectOllamaEnabled = options.detectOllama !== false;
  const detectLMStudioEnabled = options.detectLMStudio !== false;
  const useAnthropicOAuth = options.useAnthropicOAuth !== false;
  
  // Load configuration
  const config = options.config || await loadConfigSafe() || {};
  const providers = config.providers || {};

  // Initialize Anthropic
  // Uses COSMO IDE's existing OAuth service for token management
  if (useAnthropicOAuth) {
    try {
      const anthropicAdapter = createAnthropicAdapterWithOAuth();
      registry.register(anthropicAdapter);
      console.log('[Providers] ✅ Anthropic registered (OAuth service)');
    } catch (e) {
      console.warn('[Providers] ⚠️ Anthropic OAuth service failed, trying API key:', e.message);
      // Fallback to API key (from config or env)
      const apiKey = providers.anthropic?.api_key || process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        registry.initializeProvider('anthropic', { apiKey });
        console.log('[Providers] ✅ Anthropic registered (API key)');
      }
    }
  } else {
    const apiKey = providers.anthropic?.api_key || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      registry.initializeProvider('anthropic', { apiKey });
      console.log('[Providers] ✅ Anthropic registered (API key)');
    }
  }

  // Initialize OpenAI (from config or env)
  const openaiKey = providers.openai?.api_key || process.env.OPENAI_API_KEY;
  if (openaiKey) {
    registry.initializeProvider('openai', { apiKey: openaiKey });
    console.log('[Providers] ✅ OpenAI registered');
  } else {
    console.warn('[Providers] ⚠️ OpenAI not configured');
  }

  // Initialize xAI (Grok) (from config or env)
  const xaiKey = providers.xai?.api_key || process.env.XAI_API_KEY;
  if (xaiKey) {
    registry.initializeProvider('xai', { 
      apiKey: xaiKey,
      baseUrl: 'https://api.x.ai/v1'
    });
    // Register Grok models explicitly
    registry.registerModel('grok-code-fast-1', 'xai');
    registry.registerModel('grok-2', 'xai');
    registry.registerModel('grok-beta', 'xai');
    console.log('[Providers] ✅ xAI (Grok) registered');
  }

  // Platform check for local models
  const platform = getPlatform();
  
  // Initialize Ollama (from config with auto-detect)
  const ollamaConfig = providers.ollama || {};
  const ollamaBaseUrl = ollamaConfig.base_url || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  
  if (detectOllamaEnabled && platform.supportsLocalModels) {
    // Check if explicitly enabled or auto-detect
    const shouldDetect = ollamaConfig.enabled !== false && (ollamaConfig.auto_detect !== false);
    
    if (shouldDetect) {
      const ollamaAvailable = await detectOllama(ollamaBaseUrl);
      if (ollamaAvailable) {
        registry.initializeProvider('ollama', {
          baseUrl: ollamaBaseUrl,
          embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
          defaultModel: ollamaConfig.default_model
        });
        console.log('[Providers] ✅ Ollama detected - local models available');
        if (ollamaConfig.default_model) {
          console.log(`[Providers]    Default model: ${ollamaConfig.default_model}`);
        }
      } else {
        console.log('[Providers] ℹ️ Ollama not detected - local models unavailable');
      }
    } else if (ollamaConfig.enabled === false) {
      console.log('[Providers] ℹ️ Ollama disabled in config');
    }
  } else if (detectOllamaEnabled && !platform.supportsLocalModels) {
    console.log(`[Providers] ℹ️ Skipping Ollama detection on ${platform.platform} (local models not supported)`);
  }

  // Initialize LM Studio (from config with auto-detect)
  const lmstudioConfig = providers.lmstudio || {};
  const lmstudioBaseUrl = lmstudioConfig.base_url || 'http://localhost:1234/v1';
  
  if (detectLMStudioEnabled && platform.supportsLocalModels && lmstudioConfig.enabled !== false) {
    const lmstudioAvailable = await detectLMStudio(lmstudioBaseUrl);
    
    if (lmstudioAvailable) {
      // LM Studio uses OpenAI-compatible API, so we use OpenAIAdapter
      const lmstudioAdapter = new OpenAIAdapter({
        apiKey: 'not-needed', // LM Studio doesn't require API key
        baseUrl: lmstudioBaseUrl
      });
      
      // Override adapter properties for LM Studio identification
      Object.defineProperty(lmstudioAdapter, 'id', { value: 'lmstudio', writable: false });
      Object.defineProperty(lmstudioAdapter, 'name', { value: 'LM Studio', writable: false });
      
      // Get available models from LM Studio
      const models = await getLMStudioModels(lmstudioBaseUrl);
      lmstudioAdapter.getAvailableModels = () => models;
      
      // Mark as local provider with reduced parallelism
      lmstudioAdapter.capabilities.reducedParallelism = true;
      
      registry.register(lmstudioAdapter);
      console.log('[Providers] ✅ LM Studio detected - local models available');
      if (models.length > 0) {
        console.log(`[Providers]    Models: ${models.slice(0, 3).join(', ')}${models.length > 3 ? '...' : ''}`);
      }
      if (lmstudioConfig.default_model) {
        console.log(`[Providers]    Default model: ${lmstudioConfig.default_model}`);
      }
    } else if (lmstudioConfig.enabled) {
      console.log('[Providers] ⚠️ LM Studio enabled but not detected');
    }
  }

  return registry;
}

/**
 * Singleton registry instance
 * @type {ProviderRegistry|null}
 */
let defaultRegistry = null;

/**
 * Get or create the default registry
 * @param {Object} [options]
 * @returns {Promise<ProviderRegistry>}
 */
async function getDefaultRegistry(options) {
  if (!defaultRegistry) {
    defaultRegistry = await createRegistry(options);
  }
  return defaultRegistry;
}

/**
 * Reset the default registry (useful for testing or config reload)
 */
function resetDefaultRegistry() {
  defaultRegistry = null;
}

/**
 * Get status of all local model providers
 * @returns {Promise<{ollama: {available: boolean, models: string[]}, lmstudio: {available: boolean, models: string[]}}>}
 */
async function getLocalModelsStatus() {
  const config = await loadConfigSafe() || {};
  const providers = config.providers || {};
  
  const ollamaBaseUrl = providers.ollama?.base_url || 'http://localhost:11434';
  const lmstudioBaseUrl = providers.lmstudio?.base_url || 'http://localhost:1234/v1';
  
  const result = {
    ollama: { available: false, models: [], default_model: providers.ollama?.default_model || null },
    lmstudio: { available: false, models: [], default_model: providers.lmstudio?.default_model || null }
  };
  
  // Check Ollama
  try {
    const ollamaAvailable = await detectOllama(ollamaBaseUrl);
    if (ollamaAvailable) {
      result.ollama.available = true;
      const res = await fetch(`${ollamaBaseUrl}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        result.ollama.models = (data.models || []).map(m => m.name);
      }
    }
  } catch (e) {
    // Ollama not available
  }
  
  // Check LM Studio
  try {
    const lmstudioAvailable = await detectLMStudio(lmstudioBaseUrl);
    if (lmstudioAvailable) {
      result.lmstudio.available = true;
      result.lmstudio.models = await getLMStudioModels(lmstudioBaseUrl);
    }
  } catch (e) {
    // LM Studio not available
  }
  
  return result;
}

module.exports = {
  // Registry
  ProviderRegistry,
  createRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
  
  // Adapters
  ProviderAdapter,
  AnthropicAdapter,
  OpenAIAdapter,
  OllamaAdapter,
  
  // Factory functions
  createAnthropicAdapter,
  createAnthropicAdapterWithOAuth,
  createOpenAIAdapter,
  createOllamaAdapter,
  
  // Utilities
  detectOllama,
  detectLMStudio,
  getLMStudioModels,
  getLocalModelsStatus,
  shouldUseResponsesAPI,
  
  // Platform detection
  getPlatform,
  
  // Types and constants
  ...unified
};
