/**
 * Provider Abstraction Layer for COSMO IDE
 * 
 * Model-agnostic provider system supporting:
 * - Anthropic (Claude) with OAuth stealth mode
 * - OpenAI (GPT-4o, GPT-5+) with Responses API support
 * - xAI (Grok) via OpenAI-compatible API
 * - Ollama for local embeddings (Mac only, skipped on Pi)
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

/**
 * Detect if Ollama is running locally
 * @param {number} [timeoutMs=1000] - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
async function detectOllama(timeoutMs = 1000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create a fully-initialized provider registry for COSMO IDE
 * 
 * This helper:
 * 1. Initializes Anthropic with COSMO IDE's OAuth service
 * 2. Initializes OpenAI from environment
 * 3. Initializes xAI (Grok) from environment
 * 4. Detects and optionally initializes Ollama
 * 
 * @param {Object} [options]
 * @param {boolean} [options.detectOllama=true] - Auto-detect Ollama
 * @param {boolean} [options.useAnthropicOAuth=true] - Use COSMO IDE's OAuth service
 * @returns {Promise<ProviderRegistry>}
 */
async function createRegistry(options = {}) {
  const registry = new ProviderRegistry();
  const detectOllamaEnabled = options.detectOllama !== false;
  const useAnthropicOAuth = options.useAnthropicOAuth !== false;

  // Initialize Anthropic
  // Uses COSMO IDE's existing OAuth service for token management
  if (useAnthropicOAuth) {
    try {
      const anthropicAdapter = createAnthropicAdapterWithOAuth();
      registry.register(anthropicAdapter);
      console.log('[Providers] ✅ Anthropic registered (OAuth service)');
    } catch (e) {
      console.warn('[Providers] ⚠️ Anthropic OAuth service failed, trying API key:', e.message);
      // Fallback to API key
      if (process.env.ANTHROPIC_API_KEY) {
        registry.initializeProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
        console.log('[Providers] ✅ Anthropic registered (API key)');
      }
    }
  } else if (process.env.ANTHROPIC_API_KEY) {
    registry.initializeProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
    console.log('[Providers] ✅ Anthropic registered (API key)');
  }

  // Initialize OpenAI
  if (process.env.OPENAI_API_KEY) {
    registry.initializeProvider('openai', { apiKey: process.env.OPENAI_API_KEY });
    console.log('[Providers] ✅ OpenAI registered');
  } else {
    console.warn('[Providers] ⚠️ OPENAI_API_KEY not set, OpenAI provider unavailable');
  }

  // Initialize OpenAI Codex (ChatGPT OAuth)
  try {
    const { getCredentials } = require('../../lib/oauth-codex.cjs');
    const creds = await getCredentials();
    if (creds) {
      registry.initializeProvider('openai-codex', {
        apiKey: creds.accessToken,
        baseUrl: 'https://chatgpt.com/backend-api',
        defaultHeaders: {
          'chatgpt-account-id': creds.accountId,
        }
      });
      // Register Codex models explicitly
      registry.registerModel('gpt-5.2', 'openai-codex');
      registry.registerModel('gpt-5.3-codex', 'openai-codex');
      registry.registerModel('gpt-5.3-codex-spark', 'openai-codex');
      console.log('[Providers] ✅ OpenAI Codex registered (OAuth)');
    }
  } catch (e) {
    console.warn('[Providers] ⚠️ OpenAI Codex OAuth unavailable:', e.message);
  }

  // Initialize xAI (Grok)
  if (process.env.XAI_API_KEY) {
    registry.initializeProvider('xai', { 
      apiKey: process.env.XAI_API_KEY,
      baseUrl: 'https://api.x.ai/v1'
    });
    // Register Grok models explicitly
    registry.registerModel('grok-code-fast-1', 'xai');
    registry.registerModel('grok-2', 'xai');
    registry.registerModel('grok-beta', 'xai');
    console.log('[Providers] ✅ xAI (Grok) registered');
  }

  // Detect and initialize Ollama (for local embeddings)
  // Skip on Raspberry Pi - no local model support
  const platform = getPlatform();
  if (detectOllamaEnabled && platform.supportsLocalModels) {
    const ollamaAvailable = await detectOllama();
    if (ollamaAvailable) {
      registry.initializeProvider('ollama', {
        baseUrl: 'http://localhost:11434',
        embeddingModel: 'nomic-embed-text'
      });
      console.log('[Providers] ✅ Ollama detected - local embeddings available');
    } else {
      console.log('[Providers] ℹ️ Ollama not detected - local embeddings unavailable');
    }
  } else if (detectOllamaEnabled && !platform.supportsLocalModels) {
    console.log(`[Providers] ℹ️ Skipping Ollama detection on ${platform.platform} (local models not supported)`);
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
 * Reset the default registry (useful for testing)
 */
function resetDefaultRegistry() {
  defaultRegistry = null;
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
  shouldUseResponsesAPI,
  
  // Platform detection
  getPlatform,
  
  // Types and constants
  ...unified
};
