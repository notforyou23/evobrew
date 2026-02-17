#!/usr/bin/env node
/**
 * Evobrew Server (formerly COSMO IDE v2)
 * AI-powered development workspace
 * 
 * Configuration loading priority:
 * 1. ~/.evobrew/config.json (global config)
 * 2. .env file in project root (legacy/fallback)
 */

// ============================================================================
// CONFIGURATION - Load before anything else
// ============================================================================

let configSource = 'defaults';
let serverConfig = null;

try {
  // Use synchronous config loader for startup
  const { loadConfigurationSync, ConfigSource } = require('../lib/config-loader-sync');
  
  const result = loadConfigurationSync({
    projectRoot: __dirname,
    applyToEnv: true,
    silent: false
  });
  
  configSource = result.source;
  serverConfig = result.config;
} catch (err) {
  // Fall back to dotenv if new config system not available
  console.log('[CONFIG] Config loader not available:', err.message);
  require('dotenv').config();
  configSource = 'env';
  console.log('[CONFIG] Using .env file (legacy mode)');
}

// ============================================================================
// IMPORTS
// ============================================================================

const express = require('express');
const https = require('https');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const { execFile } = require('child_process');
const cors = require('cors');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const CodebaseIndexer = require('./codebase-indexer');
const { handleFunctionCalling } = require('./ai-handler');
const { getAnthropicApiKey } = require('./services/anthropic-oauth');
const { loadSecurityProfile, isOnlyOfficeCallbackUrlAllowed } = require('../lib/security-profile');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const MsgReader = require('msgreader').default || require('msgreader');

const app = express();

// Placeholder middleware for OnlyOffice routes (kept for explicit route grouping).
// Authentication still flows through profile middleware below.
app.use('/api/onlyoffice/download', (req, res, next) => next());
app.use('/api/onlyoffice/save', (req, res, next) => next());

// Port configuration (from config or env)
const PORT = process.env.PORT || 3405;
const HTTPS_PORT = process.env.HTTPS_PORT || 3406;

let securityConfig;
try {
  securityConfig = loadSecurityProfile(process.env);
} catch (error) {
  console.error(`[SECURITY] Startup blocked: ${error.message}`);
  process.exit(1);
}

const LOCAL_EPHEMERAL_COLLABORA_SECRET = (!securityConfig.isInternetProfile && !process.env.COLLABORA_SECRET && !process.env.JWT_SECRET)
  ? crypto.randomBytes(32).toString('hex')
  : null;
if (LOCAL_EPHEMERAL_COLLABORA_SECRET) {
  console.warn('[SECURITY] Using ephemeral local Collabora signing secret. Set COLLABORA_SECRET for stable sessions.');
}
function getCollaboraSigningSecret() {
  return securityConfig.collaboraSecret || process.env.JWT_SECRET || LOCAL_EPHEMERAL_COLLABORA_SECRET;
}

const READ_ONLY_CHAT_TOOLS = new Set([
  'file_read',
  'list_directory',
  'grep_search',
  'codebase_search',
  'brain_search',
  'brain_node',
  'brain_thoughts',
  'brain_coordinator_insights',
  'brain_stats'
]);

// ============================================================================
// NETWORK UTILITIES
// ============================================================================

/**
 * Auto-detect local network IP address
 * Returns the first non-internal IPv4 address found
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (127.0.0.1) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null; // No network IP found
}

// Initialize AI clients (lazy - only when API key available)
const getOpenAI = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null; // OpenAI not configured
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};
// Anthropic uses OAuth service (Token Sink Pattern from Claude CLI)
const getAnthropic = async () => {
  const credentials = await getAnthropicApiKey();

  // For OAuth tokens (sk-ant-oat*), use stealth mode
  if (credentials.isOAuth) {
    return new Anthropic({
      authToken: credentials.authToken,
      defaultHeaders: credentials.defaultHeaders,
      dangerouslyAllowBrowser: credentials.dangerouslyAllowBrowser
    });
  }

  // For regular API keys (sk-ant-api*)
  return new Anthropic({ apiKey: credentials.apiKey });
};
const getXAI = () => {
  if (!process.env.XAI_API_KEY) {
    return null; // xAI not configured
  }
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1'
  });
};

// Lazy-init codebase indexer (requires OpenAI)
let codebaseIndexer = null;
const getCodebaseIndexer = () => {
  if (!codebaseIndexer && getOpenAI()) {
    codebaseIndexer = new CodebaseIndexer(getOpenAI());
  }
  return codebaseIndexer;
};

function getHeaderValue(req, headerName) {
  const value = req.headers?.[headerName];
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function timingSafeEqualStrings(a, b) {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getAuthenticatedProxyUser(req) {
  for (const headerName of securityConfig.proxyUserHeaderCandidates) {
    const candidate = getHeaderValue(req, headerName).trim();
    if (candidate) return candidate;
  }
  return '';
}

function hasValidProxySecret(req) {
  if (!securityConfig.proxySharedSecret) return false;
  const provided = getHeaderValue(req, 'x-evobrew-proxy-secret').trim();
  return timingSafeEqualStrings(provided, securityConfig.proxySharedSecret);
}

function isProtectedRoutePath(pathName) {
  return pathName.startsWith('/api/') || pathName.startsWith('/wopi/');
}

function isAuthExemptPath(pathName) {
  return pathName === '/api/health';
}

function proxyAuthMiddleware(req, res, next) {
  if (!securityConfig.isInternetProfile) return next();
  if (!isProtectedRoutePath(req.path) || isAuthExemptPath(req.path)) return next();

  if (!hasValidProxySecret(req)) {
    return res.status(401).json({ error: 'Missing or invalid proxy authentication secret' });
  }

  const proxyUser = getAuthenticatedProxyUser(req);
  if (!proxyUser) {
    return res.status(401).json({ error: 'Missing authenticated user header from reverse proxy' });
  }

  req.authenticatedProxyUser = proxyUser;
  next();
}

function mutationGuard(req, res, next) {
  if (!securityConfig.isInternetProfile) return next();
  if (securityConfig.internetEnableMutations) return next();
  return res.status(403).json({
    error: 'Mutation endpoints are disabled in internet profile (set INTERNET_ENABLE_MUTATIONS=true to override)'
  });
}

function shouldDisableGatewayProxy() {
  return securityConfig.isInternetProfile && !securityConfig.internetEnableGatewayProxy;
}

function sanitizeHostHeader(hostValue) {
  const raw = String(hostValue || '').trim();
  if (!raw) return '';
  if (!/^[A-Za-z0-9.:[\]-]+$/.test(raw)) return '';
  return raw;
}

function getRequestBaseUrl(req) {
  const trustedForwarded = securityConfig.isInternetProfile && Boolean(req.authenticatedProxyUser);
  const forwardedHost = getHeaderValue(req, 'x-forwarded-host').split(',')[0].trim();
  const forwardedProto = getHeaderValue(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const hostHeader = getHeaderValue(req, 'host');

  const host = sanitizeHostHeader(trustedForwarded ? (forwardedHost || hostHeader) : hostHeader) || `localhost:${PORT}`;
  const protocol = trustedForwarded && (forwardedProto === 'https' || forwardedProto === 'http')
    ? forwardedProto
    : (req.socket?.encrypted ? 'https' : 'http');

  return `${protocol}://${host}`;
}

function getEffectiveAllowedRoot() {
  if (securityConfig.isInternetProfile) {
    return securityConfig.workspaceRoot;
  }
  return getAllowedRoot();
}

function resolveCanonicalPathForBoundary(absolutePath) {
  let candidate = path.resolve(absolutePath);
  while (!fsSync.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return fsSync.realpathSync(candidate);
}

async function resolvePathWithinAllowedRoot(inputPath, options = {}) {
  const {
    mustExist = false,
    expectFile = false,
    expectDirectory = false
  } = options;

  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new Error('Path required');
  }
  if (inputPath.includes('\0')) {
    throw new Error('Invalid path');
  }

  const allowedRoot = getEffectiveAllowedRoot();
  const resolutionBase = allowedRoot || process.cwd();
  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(resolutionBase, inputPath);
  if (allowedRoot) {
    const normalizedRoot = path.resolve(allowedRoot);
    if (!(resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep))) {
      throw new Error('Access denied: outside allowed directory');
    }

    const canonicalRoot = resolveCanonicalPathForBoundary(normalizedRoot);
    const canonicalTarget = resolveCanonicalPathForBoundary(resolved);
    if (!(canonicalTarget === canonicalRoot || canonicalTarget.startsWith(canonicalRoot + path.sep))) {
      throw new Error('Access denied: symlink escapes allowed directory');
    }
  }

  if (mustExist || expectFile || expectDirectory) {
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) {
      throw new Error('Path not found');
    }
    if (expectFile && !stat.isFile()) {
      throw new Error('Expected a file path');
    }
    if (expectDirectory && !stat.isDirectory()) {
      throw new Error('Expected a directory path');
    }
  }

  return resolved;
}

// Middleware
app.disable('x-powered-by');

app.use((req, res, next) => {
  // Pragmatic hardening headers compatible with the current inline-heavy UI.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' data: blob: https:; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; " +
      "style-src 'self' 'unsafe-inline' https:; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data: https:; " +
      "connect-src 'self' ws: wss: https:; " +
      "frame-ancestors 'self'; " +
      "object-src 'none'; base-uri 'self'"
  );
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // same-origin and non-browser clients

    if (securityConfig.isInternetProfile) {
      // Internet deployments rely on reverse-proxy auth boundary.
      return callback(null, true);
    }

    const allowed = [
      'http://localhost:4410',
      'https://localhost:4411',
      /^http:\/\/localhost:\d+$/,
      /^https:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
      /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
      /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:\d+$/
    ];

    const isAllowed = allowed.some((pattern) =>
      pattern instanceof RegExp ? pattern.test(origin) : pattern === origin
    );

    if (isAllowed) return callback(null, true);
    return callback(new Error(`CORS policy: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Evobrew-Proxy-Secret']
}));

// Large limit for saving big documents/code files - local mode still supports heavy payloads.
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(proxyAuthMiddleware);
app.use(express.static('public'));

// ============================================================================
// PATH SECURITY - Restrict file access to brain folder
// ============================================================================

/**
 * Check if a requested path is within the allowed root directory
 * Prevents directory traversal attacks and limits access to brain folder
 */
function isPathAllowed(requestedPath, allowedRoot) {
  if (!allowedRoot) return true; // No restriction if no root set
  try {
    const normalized = path.resolve(requestedPath);
    const normalizedRoot = path.resolve(allowedRoot);
    if (!(normalized === normalizedRoot || normalized.startsWith(normalizedRoot + path.sep))) {
      return false;
    }

    const canonicalRoot = resolveCanonicalPathForBoundary(normalizedRoot);
    const canonicalTarget = resolveCanonicalPathForBoundary(normalized);
    return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(canonicalRoot + path.sep);
  } catch (e) {
    return false;
  }
}

/**
 * Get the allowed root path from the brain loader
 * Returns the brain's folder path, or null if no brain loaded
 * Returns null for admin mode (unrestricted access)
 */
function getAllowedRoot() {
  if (securityConfig.isInternetProfile) {
    return securityConfig.workspaceRoot;
  }

  // Admin bypass via environment variable
  if (process.env.COSMO_ADMIN_MODE === 'true') {
    return null;
  }

  try {
    const { getBrainLoader } = require('./brain-loader-module');
    const loader = getBrainLoader();
    return loader?.brainPath || null;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// FILE OPERATIONS (Restricted to brain folder when loaded)
// ============================================================================

app.get('/api/folder/browse', async (req, res) => {
  try {
    const {
      path: folderPath,
      recursive,
      depth,
      includeFiles
    } = req.query;

    if (!folderPath) {
      return res.status(400).json({ success: false, error: 'Path required' });
    }

    const resolvedFolderPath = await resolvePathWithinAllowedRoot(folderPath, {
      mustExist: true,
      expectDirectory: true
    });

    const includeFilesFlag = includeFiles !== 'false';
    const hasDepthParam = typeof depth !== 'undefined';
    const legacyRecursive = recursive === 'true';

    let maxDepth = parseInt(depth, 10);
    if (Number.isNaN(maxDepth)) {
      // Backward-compat: recursive=true maps to a bounded traversal.
      maxDepth = legacyRecursive ? 8 : 1;
    }
    maxDepth = Math.max(0, Math.min(maxDepth, 20));

    // Legacy behavior: no depth + no recursive means one-level listing.
    if (!hasDepthParam && !legacyRecursive) {
      const entries = await fs.readdir(resolvedFolderPath, { withFileTypes: true });
      const files = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .filter(e => includeFilesFlag || e.isDirectory())
        .map(e => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          path: path.join(resolvedFolderPath, e.name)
        }));

      return res.json({
        success: true,
        files,
        partialErrors: [],
        truncated: false
      });
    }

    const traversalState = {
      includeFiles: includeFilesFlag,
      maxDepth,
      maxEntries: 12000,
      entryCount: 0,
      partialErrors: [],
      truncated: false
    };

    const files = await readDirRecursiveSafe(resolvedFolderPath, 1, traversalState);
    return res.json({
      success: true,
      files,
      partialErrors: traversalState.partialErrors,
      truncated: traversalState.truncated
    });
  } catch (error) {
    console.error('[BROWSE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function readDirRecursiveSafe(dirPath, currentDepth, state) {
  if (state.truncated || currentDepth > state.maxDepth) {
    return [];
  }

  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    state.partialErrors.push({
      path: dirPath,
      code: error.code || 'READDIR_FAILED',
      message: error.message
    });
    return [];
  }

  const files = [];

  for (const entry of entries) {
    if (state.truncated) break;

    // Skip hidden files and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const isDirectory = entry.isDirectory();

    if (isDirectory || state.includeFiles) {
      files.push({
        name: entry.name,
        isDirectory,
        path: fullPath
      });
      state.entryCount += 1;
      if (state.entryCount >= state.maxEntries) {
        state.truncated = true;
        break;
      }
    }

    if (isDirectory && currentDepth < state.maxDepth) {
      const children = await readDirRecursiveSafe(fullPath, currentDepth + 1, state);
      files.push(...children);
    }
  }

  return files;
}

app.get('/api/folder/read', async (req, res) => {
  try {
    const { path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    const content = await fs.readFile(resolvedFilePath, 'utf-8');
    res.json({ success: true, content });
    
  } catch (error) {
    console.error('[READ] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/folder/write', mutationGuard, async (req, res) => {
  try {
    const { path: filePath, content } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath);

    console.log(`[WRITE] Writing file: ${resolvedFilePath} (${content?.length || 0} chars)`);
    await fs.writeFile(resolvedFilePath, content, 'utf-8');
    console.log(`[WRITE] ✓ File written successfully: ${resolvedFilePath}`);
    res.json({ success: true });
    
  } catch (error) {
    console.error('[WRITE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save text content as DOCX file
app.put('/api/folder/write-docx', mutationGuard, async (req, res) => {
  try {
    const { path: filePath, content, contentType = 'auto' } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath);

    let buffer;
    const trimmedContent = (content || '').trim();
    
    // Detect if content is HTML (from round-trip editing)
    const isHtml = contentType === 'html' || 
                   trimmedContent.startsWith('<') || 
                   trimmedContent.includes('</p>') || 
                   trimmedContent.includes('</h1>') ||
                   trimmedContent.includes('</div>');
    
    if (isHtml) {
      // HTML content - use html-to-docx for proper conversion preserving formatting
      const HTMLtoDOCX = require('html-to-docx');
      
      // Wrap in proper HTML document if it's just fragments
      let htmlContent = trimmedContent;
      if (!htmlContent.toLowerCase().includes('<!doctype') && !htmlContent.toLowerCase().includes('<html')) {
        htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 16pt; font-weight: bold; margin: 12pt 0 6pt 0; }
    h2 { font-size: 14pt; font-weight: bold; margin: 12pt 0 6pt 0; }
    h3 { font-size: 12pt; font-weight: bold; margin: 12pt 0 6pt 0; }
    p { margin: 0 0 6pt 0; }
    ul, ol { margin: 6pt 0; padding-left: 24pt; }
    li { margin: 3pt 0; }
    table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
    td, th { border: 1px solid #000; padding: 6pt; }
    th { background-color: #f0f0f0; font-weight: bold; }
    strong, b { font-weight: bold; }
    em, i { font-style: italic; }
    u { text-decoration: underline; }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`;
      }
      
      // Convert HTML to DOCX with proper options
      buffer = await HTMLtoDOCX(htmlContent, null, {
        table: { row: { cantSplit: true } },
        footer: false,
        header: false,
        pageNumber: false,
        font: 'Calibri',
        fontSize: 22, // Half-points: 22 = 11pt
        margins: {
          top: 1440,    // 1 inch in twips
          right: 1440,
          bottom: 1440,
          left: 1440
        }
      });
      
      console.log(`[WRITE-DOCX] ✓ Converted HTML to DOCX: ${resolvedFilePath}`);
      
    } else {
      // Plain text or markdown - use docx library for basic conversion
      const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');
      
      const lines = trimmedContent.split('\n');
      const children = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('### ')) {
          children.push(new Paragraph({
            children: [new TextRun({ text: trimmed.slice(4), bold: true })],
            heading: HeadingLevel.HEADING_3
          }));
        } else if (trimmed.startsWith('## ')) {
          children.push(new Paragraph({
            children: [new TextRun({ text: trimmed.slice(3), bold: true })],
            heading: HeadingLevel.HEADING_2
          }));
        } else if (trimmed.startsWith('# ')) {
          children.push(new Paragraph({
            children: [new TextRun({ text: trimmed.slice(2), bold: true })],
            heading: HeadingLevel.HEADING_1
          }));
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          children.push(new Paragraph({
            children: [new TextRun({ text: '• ' + trimmed.slice(2) })]
          }));
        } else if (trimmed === '') {
          children.push(new Paragraph({ children: [] }));
        } else {
          children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
        }
      }
      
      const doc = new Document({
        sections: [{
          properties: {},
          children: children.length > 0 ? children : [new Paragraph({ children: [] })]
        }]
      });
      
      buffer = await Packer.toBuffer(doc);
      console.log(`[WRITE-DOCX] ✓ Converted text/markdown to DOCX: ${resolvedFilePath}`);
    }
    
    // Ensure directory exists
    const dir = path.dirname(resolvedFilePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(resolvedFilePath, buffer);
    console.log(`[WRITE-DOCX] ✓ Saved: ${resolvedFilePath} (${buffer.length} bytes)`);
    
    res.json({ success: true, size: buffer.length });
    
  } catch (error) {
    console.error('[WRITE-DOCX] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/folder/create', mutationGuard, async (req, res) => {
  try {
    const { path: filePath, content = '' } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath);

    const dir = path.dirname(resolvedFilePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolvedFilePath, content, 'utf-8');
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('[CREATE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload binary file (for replacing Office files after local editing)
app.put('/api/folder/upload-binary', mutationGuard, async (req, res) => {
  try {
    const { path: filePath, content, encoding = 'base64' } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Content required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath);

    // Convert base64 to buffer
    const buffer = Buffer.from(content, encoding);
    
    // Ensure directory exists
    const dir = path.dirname(resolvedFilePath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write binary file
    await fs.writeFile(resolvedFilePath, buffer);
    console.log(`[UPLOAD-BINARY] ✓ Replaced: ${resolvedFilePath} (${buffer.length} bytes)`);
    
    res.json({ success: true, size: buffer.length });
    
  } catch (error) {
    console.error('[UPLOAD-BINARY] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/folder/delete', mutationGuard, async (req, res) => {
  try {
    const { path: filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    await fs.unlink(resolvedFilePath);
    res.json({ success: true });
    
  } catch (error) {
    console.error('[DELETE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve file for preview in browser
app.get('/api/serve-file', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    console.log('[SERVE] Serving file:', resolvedFilePath);
    
    // Detect MIME type from extension
    const ext = path.extname(resolvedFilePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.svg': 'image/svg+xml',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      // Images
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon'
    };
    
    const contentType = mimeTypes[ext] || 'text/plain';
    
    // Check if it's an image
    const isImage = contentType.startsWith('image/');
    
    if (isImage) {
      // Serve image as binary
      const buffer = await fs.readFile(resolvedFilePath);
      console.log(`[SERVE] ✅ Image served: ${path.basename(resolvedFilePath)} (${buffer.length} bytes)`);
      res.type(contentType).send(buffer);
    } else {
      // Serve text files as UTF-8
      const content = await fs.readFile(resolvedFilePath, 'utf-8');
      console.log(`[SERVE] ✅ File served: ${path.basename(resolvedFilePath)}`);
      res.type(contentType).send(content);
    }
    
  } catch (error) {
    console.error('[SERVE] ❌ Error serving file:', error.message);
    res.status(500).send('Failed to serve file');
  }
});

// Extract text from Office files for editor
app.get('/api/extract-office-text', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    const ext = path.extname(resolvedFilePath).toLowerCase();
    let textContent = '';
    let metadata = {};
    
    if (ext === '.docx') {
      const buffer = await fs.readFile(resolvedFilePath);
      // Convert to HTML to preserve formatting (not raw text)
      const result = await mammoth.convertToHtml({ buffer });
      textContent = result.value;
      metadata.format = 'docx';
      metadata.contentType = 'html'; // Signal to frontend this is HTML
      metadata.warnings = result.messages.length > 0 ? result.messages.map(m => m.message) : undefined;
      
    } else if (ext === '.xlsx' || ext === '.xls') {
      if (securityConfig.isInternetProfile) {
        return res.status(403).json({ error: 'Spreadsheet parsing is disabled in internet profile' });
      }

      const buffer = await fs.readFile(resolvedFilePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        textContent += `\n=== Sheet: ${sheetName} ===\n\n`;
        
        jsonData.forEach((row) => {
          if (row.some(cell => cell !== '')) {
            const rowText = row.map(cell => {
              const cellValue = cell === null || cell === undefined ? '' : String(cell);
              return cellValue.replace(/\t/g, ' ').replace(/\n/g, ' ');
            }).join(' | ');
            textContent += `${rowText}\n`;
          }
        });
        
        textContent += '\n';
      });
      
      metadata.format = ext.substring(1);
      metadata.sheetCount = workbook.SheetNames.length;
      
    } else if (ext === '.msg') {
      const buffer = await fs.readFile(resolvedFilePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const msgReader = new MsgReader(arrayBuffer);
      const msg = msgReader.getFileData();
      
      if (msg.error) {
        return res.status(400).json({ error: msg.error });
      }
      
      const getField = (fieldName) => {
        if (!msg || typeof msg !== 'object') return null;
        if (msg[fieldName] !== undefined) return msg[fieldName];
        const lowerKey = Object.keys(msg).find(k => k.toLowerCase() === fieldName.toLowerCase());
        return lowerKey ? msg[lowerKey] : null;
      };
      
      const senderName = getField('senderName') || getField('from') || getField('sender') || '';
      const senderEmail = getField('senderEmail') || getField('fromEmail') || '';
      const subject = getField('subject') || '(No Subject)';
      const to = getField('to') || getField('recipient') || '';
      const cc = getField('cc') || '';
      const date = getField('date') || getField('sentDate') || getField('receivedDate') || '';
      const body = getField('body') || getField('bodyText') || getField('text') || '';
      const bodyHtml = getField('bodyHtml') || getField('htmlBody') || '';
      const attachments = getField('attachments') || [];
      
      if (senderName || senderEmail) {
        textContent += `From: ${senderName}`;
        if (senderEmail) {
          textContent += senderName ? ` <${senderEmail}>` : senderEmail;
        }
        textContent += '\n';
      }
      
      if (subject) textContent += `Subject: ${subject}\n`;
      if (to) textContent += `To: ${to}\n`;
      if (cc) textContent += `CC: ${cc}\n`;
      if (date) textContent += `Date: ${date}\n`;
      
      textContent += '\n--- Message Body ---\n\n';
      
      if (body) {
        textContent += body;
      } else if (bodyHtml) {
        textContent += bodyHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      } else {
        textContent += '(No body content found)';
      }
      
      const attachmentList = Array.isArray(attachments) ? attachments : [];
      if (attachmentList.length > 0) {
        textContent += `\n\n--- Attachments (${attachmentList.length}) ---\n`;
        attachmentList.forEach((att, idx) => {
          const fileName = (att && att.fileName) ? att.fileName : (typeof att === 'string' ? att : 'Unknown');
          textContent += `${idx + 1}. ${fileName}\n`;
        });
      }
      
      metadata.format = 'msg';
      metadata.hasAttachments = attachmentList.length > 0;
      metadata.attachmentCount = attachmentList.length;
      
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
    
    res.json({
      success: true,
      content: textContent.trim(),
      metadata
    });
    
  } catch (error) {
    console.error('[EXTRACT TEXT] Error:', error);
    res.status(500).json({ error: `Failed to extract text: ${error.message}` });
  }
});

// Preview Office files (convert to HTML)
app.get('/api/preview-office-file', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    const ext = path.extname(resolvedFilePath).toLowerCase();
    let html = '';
    
    if (ext === '.docx') {
      // Convert DOCX to HTML
      const buffer = await fs.readFile(resolvedFilePath);
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
      
      // Wrap in styled container
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
              color: #333;
            }
            h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
            p { margin: 1em 0; }
            table { border-collapse: collapse; width: 100%; margin: 1em 0; }
            table td, table th { border: 1px solid #ddd; padding: 8px; }
            table th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          ${html}
        </body>
        </html>
      `;
      
    } else if (ext === '.xlsx' || ext === '.xls') {
      if (securityConfig.isInternetProfile) {
        return res.status(403).json({ error: 'Spreadsheet preview is disabled in internet profile' });
      }

      // Convert Excel to HTML table
      const buffer = await fs.readFile(resolvedFilePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      
      let tablesHtml = '';
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        if (jsonData.length > 0) {
          tablesHtml += `<h2>Sheet: ${sheetName}</h2>`;
          tablesHtml += '<table>';
          
          jsonData.forEach((row) => {
            if (row.some(cell => cell !== '')) {
              tablesHtml += '<tr>';
              row.forEach(cell => {
                const cellValue = cell === null || cell === undefined ? '' : String(cell);
                const isHeader = jsonData.indexOf(row) === 0;
                tablesHtml += isHeader ? `<th>${cellValue}</th>` : `<td>${cellValue}</td>`;
              });
              tablesHtml += '</tr>';
            }
          });
          
          tablesHtml += '</table>';
        }
      });
      
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 1200px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
              color: #333;
            }
            h2 { margin-top: 2em; margin-bottom: 1em; color: #555; }
            table { border-collapse: collapse; width: 100%; margin: 1em 0; }
            table td, table th { border: 1px solid #ddd; padding: 8px; text-align: left; }
            table th { background-color: #f2f2f2; font-weight: 600; }
            table tr:nth-child(even) { background-color: #f9f9f9; }
          </style>
        </head>
        <body>
          <h1>${path.basename(resolvedFilePath)}</h1>
          ${tablesHtml}
        </body>
        </html>
      `;
      
    } else if (ext === '.msg') {
      // Convert MSG to HTML email format
      const buffer = await fs.readFile(resolvedFilePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const msgReader = new MsgReader(arrayBuffer);
      const msg = msgReader.getFileData();
      
      if (msg.error) {
        return res.status(400).json({ error: msg.error });
      }
      
      const getField = (fieldName) => {
        if (!msg || typeof msg !== 'object') return null;
        if (msg[fieldName] !== undefined) return msg[fieldName];
        const lowerKey = Object.keys(msg).find(k => k.toLowerCase() === fieldName.toLowerCase());
        return lowerKey ? msg[lowerKey] : null;
      };
      
      const senderName = getField('senderName') || getField('from') || getField('sender') || '';
      const senderEmail = getField('senderEmail') || getField('fromEmail') || '';
      const subject = getField('subject') || '(No Subject)';
      const to = getField('to') || getField('recipient') || '';
      const cc = getField('cc') || '';
      const date = getField('date') || getField('sentDate') || getField('receivedDate') || '';
      const body = getField('body') || getField('bodyText') || getField('text') || '';
      const bodyHtml = getField('bodyHtml') || getField('htmlBody') || '';
      const attachments = getField('attachments') || [];
      
      const fromLine = senderName + (senderEmail ? ` <${senderEmail}>` : '');
      const bodyContent = bodyHtml || body.replace(/\n/g, '<br>');
      
      let attachmentsHtml = '';
      if (Array.isArray(attachments) && attachments.length > 0) {
        attachmentsHtml = '<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">';
        attachmentsHtml += `<strong>Attachments (${attachments.length}):</strong><ul>`;
        attachments.forEach((att, idx) => {
          const fileName = (att && att.fileName) ? att.fileName : (typeof att === 'string' ? att : 'Unknown');
          attachmentsHtml += `<li>${fileName}</li>`;
        });
        attachmentsHtml += '</ul></div>';
      }
      
      html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
              color: #333;
              background: #f5f5f5;
            }
            .email-container {
              background: white;
              border: 1px solid #ddd;
              border-radius: 4px;
              padding: 20px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .email-header {
              border-bottom: 2px solid #eee;
              padding-bottom: 15px;
              margin-bottom: 20px;
            }
            .email-header div {
              margin: 5px 0;
              color: #666;
            }
            .email-header strong {
              color: #333;
              display: inline-block;
              width: 80px;
            }
            .email-body {
              color: #333;
            }
            .email-body pre {
              white-space: pre-wrap;
              font-family: inherit;
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="email-header">
              <div><strong>From:</strong> ${fromLine || '(Unknown)'}</div>
              ${to ? `<div><strong>To:</strong> ${to}</div>` : ''}
              ${cc ? `<div><strong>CC:</strong> ${cc}</div>` : ''}
              <div><strong>Subject:</strong> ${subject}</div>
              ${date ? `<div><strong>Date:</strong> ${date}</div>` : ''}
            </div>
            <div class="email-body">
              ${bodyContent || '(No body content)'}
            </div>
            ${attachmentsHtml}
          </div>
        </body>
        </html>
      `;
      
    } else {
      return res.status(400).json({ error: 'Unsupported file type for preview' });
    }
    
    res.type('text/html').send(html);
    
  } catch (error) {
    console.error('[PREVIEW OFFICE] Error:', error);
    res.status(500).json({ error: `Failed to preview file: ${error.message}` });
  }
});

// Reveal file in system file explorer (cross-platform)
app.post('/api/reveal-in-finder', mutationGuard, async (req, res) => {
  try {
    const { path: filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true
    });

    const platform = os.platform();

    let command;
    let args;
    switch (platform) {
      case 'darwin': // macOS
        command = 'open';
        args = ['-R', resolvedFilePath];
        break;
      case 'win32': // Windows
        command = 'explorer';
        args = [`/select,${resolvedFilePath.replace(/\//g, '\\')}`];
        break;
      case 'linux':
        command = 'xdg-open';
        args = [path.dirname(resolvedFilePath)];
        break;
      default:
        return res.status(501).json({ 
          success: false, 
          error: `Platform '${platform}' not supported for file reveal` 
        });
    }

    execFile(command, args, (error) => {
      if (error) {
        console.error('[REVEAL] Error:', error);
        res.json({ success: false, error: error.message });
      } else {
        res.json({ success: true });
      }
    });
    
  } catch (error) {
    console.error('[REVEAL] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// OnlyOffice Document Server configuration endpoint
function createOnlyOfficeCallbackToken(filePath, userId, ttlMs = 10 * 60 * 1000) {
  const payload = {
    p: filePath,
    u: userId || 'local-user',
    exp: Date.now() + ttlMs
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getCollaboraSigningSecret())
    .update(payloadB64)
    .digest('hex');
  return `${payloadB64}.${signature}`;
}

function verifyOnlyOfficeCallbackToken(token, filePath, userId) {
  if (!token) return false;
  const [payloadB64, signature] = String(token).split('.');
  if (!payloadB64 || !signature) return false;

  const secret = getCollaboraSigningSecret();
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (err) {
    return false;
  }

  if (!payload || payload.p !== filePath || Date.now() > payload.exp) return false;
  if (securityConfig.isInternetProfile && payload.u !== (userId || '')) return false;
  return true;
}

app.post('/api/onlyoffice/config', async (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    const BASE_URL = getRequestBaseUrl(req);
    
    // OnlyOffice server URL
    const ONLYOFFICE_SERVER = `${BASE_URL}/onlyoffice`;
    
    const fileName = path.basename(resolvedFilePath);
    const fileExt = path.extname(fileName).toLowerCase().replace('.', '');
    
    // Determine document type
    const wordExts = ['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'fodt', 'ott', 'rtf', 'txt', 'html', 'htm', 'mht', 'pdf', 'djvu', 'fb2', 'epub', 'xps'];
    const cellExts = ['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm', 'ods', 'fods', 'ots', 'csv'];
    const slideExts = ['pps', 'ppsx', 'ppsm', 'ppt', 'pptx', 'pptm', 'pot', 'potx', 'potm', 'odp', 'fodp', 'otp'];
    
    let documentType = 'word';
    if (cellExts.includes(fileExt)) documentType = 'cell';
    else if (slideExts.includes(fileExt)) documentType = 'slide';
    
    // Generate unique document key (force fresh session to clear ghost cache)
    const crypto = require('crypto');
    const docKey = crypto.createHash('md5')
      .update(resolvedFilePath + Date.now().toString())
      .digest('hex');
    
    console.log('[ONLYOFFICE-CONFIG] File:', resolvedFilePath);
    console.log('[ONLYOFFICE-CONFIG] Extension:', fileExt, 'Type:', documentType);
    
    // Use the detected public URL for OnlyOffice to "call back" to the server
    const INTERNAL_SERVER = BASE_URL;
    const callbackToken = createOnlyOfficeCallbackToken(
      resolvedFilePath,
      req.authenticatedProxyUser || 'local-user'
    );
    
    // OnlyOffice configuration
    const config = {
      documentServerUrl: ONLYOFFICE_SERVER,
      documentType: documentType,
      document: {
        fileType: fileExt,
        key: docKey,
        title: fileName,
        url: `${INTERNAL_SERVER}/api/onlyoffice/download/${encodeURIComponent(fileName)}?path=${encodeURIComponent(resolvedFilePath)}`,
        permissions: {
          edit: true,
          download: true,
          print: true,
          review: true,
          comment: true
        }
      },
      editorConfig: {
        mode: 'edit',
        lang: 'en',
        callbackUrl: `${INTERNAL_SERVER}/api/onlyoffice/save?path=${encodeURIComponent(resolvedFilePath)}&cb_token=${encodeURIComponent(callbackToken)}`,
        user: {
          id: 'user1',
          name: 'User'
        },
        customization: {
          autosave: true,
          forcesave: true,
          comments: true,
          chat: false,
          compactHeader: true,
          compactToolbar: true
        }
      },
      width: '100%',
      height: '100%'
    };
    
    console.log('[ONLYOFFICE-CONFIG] Generated config:', JSON.stringify(config, null, 2));
    res.json(config);
    
  } catch (error) {
    console.error('[ONLYOFFICE-CONFIG] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// OnlyOffice download endpoint (serves file to Document Server)
// Accepts both /api/onlyoffice/download/filename.docx?path=... and /api/onlyoffice/download?path=...
app.get('/api/onlyoffice/download/:filename?', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    
    if (!filePath) {
      console.error('[ONLYOFFICE-DOWNLOAD] Missing path parameter');
      return res.status(400).send('File path required');
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    console.log('[ONLYOFFICE-DOWNLOAD] Request for:', resolvedFilePath);
    console.log('[ONLYOFFICE-DOWNLOAD] URL filename param:', req.params.filename);
    
    const buffer = await fs.readFile(resolvedFilePath);
    const fileName = path.basename(resolvedFilePath);
    const ext = path.extname(fileName).toLowerCase();
    
    // Determine proper MIME type
    const mimeTypes = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pdf': 'application/pdf'
    };
    
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    
    console.log('[ONLYOFFICE-DOWNLOAD] Serving:', fileName, 'Type:', mimeType, 'Size:', buffer.length);
    
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache'
    });
    
    res.send(buffer);
    console.log('[ONLYOFFICE-DOWNLOAD] ✓ Sent:', fileName);
    
  } catch (error) {
    console.error('[ONLYOFFICE-DOWNLOAD] Error:', error);
    res.status(500).send('Failed to download file');
  }
});

// OnlyOffice save callback endpoint
app.post('/api/onlyoffice/save', mutationGuard, async (req, res) => {
  try {
    const { status, url } = req.body;
    const { path: filePath, cb_token: callbackToken } = req.query;
    
    if (!filePath) {
      console.error('[ONLYOFFICE-SAVE] Missing path in query params');
      return res.json({ error: 1 });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    if (!verifyOnlyOfficeCallbackToken(callbackToken, resolvedFilePath, req.authenticatedProxyUser || 'local-user')) {
      console.error('[ONLYOFFICE-SAVE] Invalid callback token');
      return res.json({ error: 1 });
    }
    
    // Status codes: 2=ready for save, 3=save error, 6=editing, 7=force save
    if (status === 2 || status === 6 || status === 7) {
      if (url) {
        if (securityConfig.isInternetProfile && !isOnlyOfficeCallbackUrlAllowed(url, securityConfig.onlyOfficeAllowlist)) {
          console.error('[ONLYOFFICE-SAVE] Blocked callback URL outside allowlist:', url);
          return res.json({ error: 1 });
        }

        console.log(`[ONLYOFFICE-SAVE] Downloading updated file for: ${resolvedFilePath}`);
        
        const https = require('https');
        const http = require('http');
        const protocol = url.startsWith('https') ? https : http;
        
        protocol.get(url, (downloadRes) => {
          if (downloadRes.statusCode !== 200) {
            console.error(`[ONLYOFFICE-SAVE] Download failed with status ${downloadRes.statusCode}`);
            return res.json({ error: 1 });
          }
          
          const chunks = [];
          downloadRes.on('data', chunk => chunks.push(chunk));
          downloadRes.on('end', async () => {
            try {
              const buffer = Buffer.concat(chunks);
              
              // Ensure directory exists
              const dir = path.dirname(resolvedFilePath);
              await fs.mkdir(dir, { recursive: true });
              
              // Write the file
              await fs.writeFile(resolvedFilePath, buffer);
              
              console.log(`[ONLYOFFICE-SAVE] ✓ Successfully saved ${resolvedFilePath} (${buffer.length} bytes)`);
              res.json({ error: 0 });
            } catch (err) {
              console.error('[ONLYOFFICE-SAVE] Write error:', err);
              res.json({ error: 1 });
            }
          });
        }).on('error', (err) => {
          console.error('[ONLYOFFICE-SAVE] Download error:', err);
          res.json({ error: 1 });
        });
      } else {
        res.json({ error: 0 }); // No changes to save
      }
    } else {
      // Just acknowledge other statuses
      res.json({ error: 0 });
    }
    
  } catch (error) {
    console.error('[ONLYOFFICE-SAVE] Error:', error);
    res.json({ error: 1 });
  }
});

// ============================================================================
// Collabora Online (WOPI) - Replacement for OnlyOffice
// ============================================================================

const COLLABORA_SECRET = getCollaboraSigningSecret();

function encodeFileId(filePath) {
  return Buffer.from(filePath).toString('base64url');
}

function decodeFileId(fileId) {
  try {
    return Buffer.from(decodeURIComponent(fileId), 'base64url').toString('utf8');
  } catch (err) {
    return null;
  }
}

function createCollaboraToken(filePath, userId, ttlMs = 15 * 60 * 1000) {
  const payload = { p: filePath, u: userId || 'local-user', exp: Date.now() + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', COLLABORA_SECRET).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

function verifyCollaboraToken(token) {
  if (!token) return null;
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expected = crypto.createHmac('sha256', COLLABORA_SECRET).update(payloadB64).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }

  if (!payload || !payload.p || !payload.u || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// Collabora config - returns iframe URL and tokenized WOPI source
app.post('/api/collabora/config', async (req, res) => {
  try {
    const { filePath } = req.body || {};
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true,
      expectFile: true
    });

    const fileStat = await fs.stat(resolvedFilePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const BASE_URL = getRequestBaseUrl(req);

    const COLLABORA_BASE = `${BASE_URL}/onlyoffice`; // Caddy proxies /onlyoffice -> 8090
    const fileName = path.basename(resolvedFilePath);
    const fileId = encodeFileId(resolvedFilePath);

    const tokenTtlSeconds = 15 * 60; // 15 minutes
    const accessToken = createCollaboraToken(
      resolvedFilePath,
      req.authenticatedProxyUser || 'local-user',
      tokenTtlSeconds * 1000
    );
    const wopiSrc = `${BASE_URL}/wopi/files/${encodeURIComponent(fileId)}`;

    const iframeUrl = `${COLLABORA_BASE}/loleaflet/dist/loleaflet.html?WOPISrc=${encodeURIComponent(wopiSrc)}&title=${encodeURIComponent(fileName)}&closebutton=1&revisionhistory=1&lang=en&permission=edit&access_token=${encodeURIComponent(accessToken)}&access_token_ttl=${tokenTtlSeconds}`;

    res.json({
      iframeUrl,
      wopiSrc,
      accessToken,
      accessTokenTtl: tokenTtlSeconds,
      fileName,
      filePath: resolvedFilePath
    });
  } catch (error) {
    console.error('[COLLABORA-CONFIG] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// WOPI CheckFileInfo
app.get('/wopi/files/:id', async (req, res) => {
  try {
    const tokenPayload = verifyCollaboraToken(req.query.access_token);
    if (!tokenPayload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (securityConfig.isInternetProfile && tokenPayload.u !== (req.authenticatedProxyUser || '')) {
      return res.status(403).json({ error: 'User mismatch' });
    }

    const decodedPath = decodeFileId(req.params.id);
    if (!decodedPath || decodedPath !== tokenPayload.p) {
      return res.status(403).json({ error: 'File mismatch' });
    }

    const resolvedPath = await resolvePathWithinAllowedRoot(decodedPath, {
      mustExist: true,
      expectFile: true
    });

    const fileStat = await fs.stat(resolvedPath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const BASE_URL = getRequestBaseUrl(req);
    const fileName = path.basename(resolvedPath);

    res.json({
      BaseFileName: fileName,
      Size: fileStat.size,
      OwnerId: 'evobrew',
      UserId: 'evobrew-user',
      UserFriendlyName: 'Evobrew User',
      Version: String(fileStat.mtimeMs || Date.now()),
      UserCanWrite: true,
      SupportsUpdate: true,
      SupportsLocks: false,
      SupportsGetLock: false,
      SupportsExtendedLockLength: false,
      SupportsRename: false,
      SupportsDeleteFile: false,
      BreadcrumbBrandName: 'Evobrew',
      BreadcrumbBrandUrl: BASE_URL,
      CloseUrl: BASE_URL
    });
  } catch (error) {
    console.error('[WOPI-CHECKFILEINFO] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// WOPI GetFile
app.get('/wopi/files/:id/contents', async (req, res) => {
  try {
    const tokenPayload = verifyCollaboraToken(req.query.access_token);
    if (!tokenPayload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (securityConfig.isInternetProfile && tokenPayload.u !== (req.authenticatedProxyUser || '')) {
      return res.status(403).json({ error: 'User mismatch' });
    }

    const decodedPath = decodeFileId(req.params.id);
    if (!decodedPath || decodedPath !== tokenPayload.p) {
      return res.status(403).json({ error: 'File mismatch' });
    }

    const resolvedPath = await resolvePathWithinAllowedRoot(decodedPath, {
      mustExist: true,
      expectFile: true
    });

    const fileStat = await fs.stat(resolvedPath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileStat.size
    });

    const stream = fsSync.createReadStream(resolvedPath);
    stream.on('error', (err) => {
      console.error('[WOPI-GETFILE] Stream error:', err);
      res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[WOPI-GETFILE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// WOPI PutFile
app.post('/wopi/files/:id/contents', mutationGuard, express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  try {
    const tokenPayload = verifyCollaboraToken(req.query.access_token);
    if (!tokenPayload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (securityConfig.isInternetProfile && tokenPayload.u !== (req.authenticatedProxyUser || '')) {
      return res.status(403).json({ error: 'User mismatch' });
    }

    const decodedPath = decodeFileId(req.params.id);
    if (!decodedPath || decodedPath !== tokenPayload.p) {
      return res.status(403).json({ error: 'File mismatch' });
    }

    const resolvedPath = await resolvePathWithinAllowedRoot(decodedPath, {
      mustExist: true,
      expectFile: true
    });

    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Request body missing' });
    }

    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, req.body);

    res.status(200).end();
  } catch (error) {
    console.error('[WOPI-PUTFILE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Open file in default system application (Word, Excel, Outlook, etc.)
app.post('/api/open-in-app', mutationGuard, async (req, res) => {
  try {
    const { path: filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Path required' });
    }

    const resolvedFilePath = await resolvePathWithinAllowedRoot(filePath, {
      mustExist: true
    });

    const platform = os.platform();

    let command;
    let args;
    switch (platform) {
      case 'darwin': // macOS - open with default app
        command = 'open';
        args = [resolvedFilePath];
        break;
      case 'win32': // Windows - start with default app
        command = 'cmd';
        args = ['/c', 'start', '', resolvedFilePath.replace(/\//g, '\\')];
        break;
      case 'linux':
        command = 'xdg-open';
        args = [resolvedFilePath];
        break;
      default:
        return res.status(501).json({ 
          success: false, 
          error: `Platform '${platform}' not supported` 
        });
    }

    execFile(command, args, (error) => {
      if (error) {
        console.error('[OPEN-APP] Error:', error);
        res.json({ success: false, error: error.message });
      } else {
        console.log(`[OPEN-APP] ✓ Opened: ${resolvedFilePath}`);
        res.json({ success: true });
      }
    });
    
  } catch (error) {
    console.error('[OPEN-APP] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// AI CHAT - Function Calling with SSE Streaming
// ============================================================================

app.post('/api/chat', async (req, res) => {
  try {
    const params = req.body;
    const { message, stream } = params;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Security: enforce root boundary and tool policy by deployment profile
    params.allowedRoot = getEffectiveAllowedRoot();
    params.disableSpreadsheetParsing = securityConfig.isInternetProfile;
    if (securityConfig.isInternetProfile && !securityConfig.internetEnableMutations) {
      params.allowedToolNames = Array.from(READ_ONLY_CHAT_TOOLS);
    }

    // Log brain status for debugging
    const brainEnabled = params.brainEnabled || false;
    console.log(`[CHAT] "${message.substring(0, 60)}..." (brainEnabled: ${brainEnabled})`);

    if (stream) {
      // SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Disable Nagle's algorithm so SSE events are sent immediately
      // Without this, small writes (tool_start, tool_result) get batched by TCP
      if (req.socket) req.socket.setNoDelay(true);

      const eventEmitter = (event) => {
        try {
          // DEBUG: Log all events being sent
          if (event.type === 'tool_result' || event.type === 'thinking') {
            console.log(`[SSE] Sending event:`, event.type, JSON.stringify(event).substring(0, 150));
          }

          // JSON.stringify handles all string escaping properly - no manual replacement needed
          // The replacer is only used to handle potential circular references
          const jsonString = JSON.stringify(event, (key, value) => {
            // Handle circular references or non-serializable values
            if (typeof value === 'object' && value !== null) {
              if (value instanceof Error) {
                return { message: value.message, name: value.name };
              }
            }
            return value;
          });
          res.write(`data: ${jsonString}\n\n`);
        } catch (err) {
          console.error('[SSE] Failed to send event:', err.message);
          // Use a safe, simple error message
          try {
            res.write(`data: {"type":"error","error":"Event encoding failed"}\n\n`);
          } catch (writeErr) {
            console.error('[SSE] Failed to write error event:', writeErr.message);
          }
        }
      };
      
      try {
        const result = await handleFunctionCalling(
          getOpenAI(),
          await getAnthropic(),
          getXAI(),
          codebaseIndexer,
          params,
          eventEmitter
        );

        if (!result.success) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: result.error })}\n\n`);
          res.end();
          return;
        }

        // Stream final response
        const response = result.response;
        const chunkSize = 80;

        for (let i = 0; i < response.length; i += chunkSize) {
          const chunk = response.substring(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ type: 'response_chunk', chunk })}\n\n`);
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        // Done
        console.log(`[SERVER] Sending complete event with ${result.pendingEdits?.length || 0} pendingEdits:`,
          result.pendingEdits?.map(e => ({ file: e.file, hasEdit: !!e.edit, editLength: e.edit?.length })));

        res.write(`data: ${JSON.stringify({
          type: 'complete',
          fullResponse: response,
          tokensUsed: result.tokensUsed,
          iterations: result.iterations,
          pendingEdits: result.pendingEdits || []
        })}\n\n`);
        res.end();

        console.log(`[CHAT] ✅ ${result.iterations} iterations, ${result.pendingEdits?.length || 0} edits`);

      } catch (error) {
        console.error('[CHAT] Error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      }

    } else {
      // Non-streaming
      const result = await handleFunctionCalling(
        getOpenAI(),
        await getAnthropic(),
        getXAI(),
        codebaseIndexer,
        params
      );
      
      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }
      
      res.json({
        success: true,
        response: result.response,
        tokensUsed: result.tokensUsed,
        iterations: result.iterations,
        pendingEdits: result.pendingEdits || []
      });
    }
    
  } catch (error) {
    console.error('[CHAT] Fatal error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// ============================================================================
// CONVERSATION MANAGEMENT
// ============================================================================
// OLLAMA MODELS ENDPOINT
// ============================================================================

// Get available Ollama models
app.get('/api/ollama/models', async (req, res) => {
  try {
    const { getDefaultRegistry } = require('./providers');
    const registry = await getDefaultRegistry();
    const ollamaProvider = registry.getProviderById('ollama');

    if (!ollamaProvider) {
      return res.json({
        success: false,
        error: 'Ollama not available',
        models: []
      });
    }

    // Check if Ollama is running
    const health = await ollamaProvider.healthCheck();
    if (!health.healthy) {
      return res.json({
        success: false,
        error: health.error || 'Ollama not running',
        models: []
      });
    }

    // Get installed models
    const installedModels = await ollamaProvider.listModels();

    res.json({
      success: true,
      models: installedModels.map(m => ({
        id: m,
        label: m
      }))
    });

  } catch (error) {
    console.error('[Ollama] Error fetching models:', error);
    res.json({
      success: false,
      error: error.message,
      models: []
    });
  }
});

/**
 * GET /api/local-models
 * Returns status and available models for all local model providers (Ollama, LM Studio)
 */
app.get('/api/local-models', async (req, res) => {
  try {
    const { getLocalModelsStatus } = require('./providers');
    const status = await getLocalModelsStatus();
    
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('[LocalModels] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      ollama: { available: false, models: [] },
      lmstudio: { available: false, models: [] }
    });
  }
});

// ============================================================================
// CONVERSATION MANAGEMENT
// ============================================================================

const conversationsDir = path.join(__dirname, '../conversations');

// Ensure conversations directory exists
fs.mkdir(conversationsDir, { recursive: true }).catch(() => {});

app.get('/api/conversations', async (req, res) => {
  try {
    const files = await fs.readdir(conversationsDir);
    const conversations = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(conversationsDir, file), 'utf-8');
          const data = JSON.parse(content);

          // Normalize timestamp to ISO string if needed
          let normalizedTimestamp = data.timestamp;
          if (typeof data.timestamp === 'number') {
            normalizedTimestamp = new Date(data.timestamp).toISOString();
          } else if (!data.timestamp) {
            normalizedTimestamp = new Date().toISOString();
          }

          conversations.push({
            id: file.replace('.json', ''),
            title: data.title || 'Untitled',
            timestamp: normalizedTimestamp,
            folder: data.folder,
            brainPath: data.brainPath,
            messageCount: data.messages?.length || 0
          });
        } catch (error) {
          console.error(`[CONVERSATIONS] Error loading ${file}:`, error.message);
          // Skip corrupted conversation files
        }
      }
    }

    // Sort by timestamp descending with error handling
    conversations.sort((a, b) => {
      try {
        const timeA = new Date(a.timestamp);
        const timeB = new Date(b.timestamp);

        // Check for invalid dates
        if (isNaN(timeA.getTime())) return 1;  // Invalid dates go to end
        if (isNaN(timeB.getTime())) return -1;

        return timeB - timeA;
      } catch (error) {
        return 0;  // Keep original order on error
      }
    });
    
    res.json({ success: true, conversations });
  } catch (error) {
    console.error('[CONVERSATIONS] Error listing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = path.join(conversationsDir, `${id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    res.json({ success: true, conversation: data });
  } catch (error) {
    console.error('[CONVERSATIONS] Error loading:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/conversations', async (req, res) => {
  try {
    const { title, messages, folder, summary } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    const id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    const conversation = {
      id,
      title: title || `Conversation ${new Date().toLocaleString()}`,
      timestamp,
      folder: folder || null,
      brainPath: req.body.brainPath || null,
      summary: summary || null, // Store conversation summary
      messages
    };

    const filePath = path.join(conversationsDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8');

    res.json({ success: true, id, conversation });
  } catch (error) {
    console.error('[CONVERSATIONS] Error saving:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, messages, folder, summary } = req.body;

    // Normalize message timestamps to ISO strings
    if (messages && Array.isArray(messages)) {
      messages.forEach(msg => {
        if (msg.timestamp && typeof msg.timestamp === 'number') {
          msg.timestamp = new Date(msg.timestamp).toISOString();
        } else if (!msg.timestamp) {
          msg.timestamp = new Date().toISOString();
        }
      });
    }

    const filePath = path.join(conversationsDir, `${id}.json`);
    const existing = JSON.parse(await fs.readFile(filePath, 'utf-8'));

    const updated = {
      ...existing,
      title: title !== undefined ? title : existing.title,
      messages: messages !== undefined ? messages : existing.messages,
      folder: folder !== undefined ? folder : existing.folder,
      brainPath: req.body.brainPath !== undefined ? req.body.brainPath : existing.brainPath,
      summary: summary !== undefined ? summary : existing.summary, // Preserve/update summary
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');

    res.json({ success: true, conversation: updated });
  } catch (error) {
    console.error('[CONVERSATIONS] Error updating:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = path.join(conversationsDir, `${id}.json`);
    await fs.unlink(filePath);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[CONVERSATIONS] Error deleting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CONVERSATION SUMMARIZATION - Context Window Management
// ============================================================================

app.post('/api/summarize', async (req, res) => {
  try {
    const { messages, existingSummary } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'Messages array required' });
    }

    console.log(`[SUMMARIZE] Summarizing ${messages.length} messages`);

    // Build the conversation text
    const conversationText = messages.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n\n');

    // Calculate tokens before summary
    const tokensBefore = Math.ceil(conversationText.length / 4);

    // Build summary prompt
    const summaryPrompt = existingSummary
      ? `You are summarizing a conversation. There was already a previous summary:\n\n"${existingSummary}"\n\nNow summarize the following additional messages, incorporating key context from the previous summary. Be concise but preserve important details, decisions, and context that would help continue the conversation.\n\n${conversationText}`
      : `Summarize the following conversation concisely. Preserve key decisions, technical details, file paths, code snippets mentioned, and important context that would help continue this conversation later. Be thorough but concise.\n\n${conversationText}`;

    // Use Anthropic for summarization (fast, reliable)
    const anthropic = await getAnthropic();
    const { prepareSystemPrompt, getAnthropicApiKey: getCredentials } = require('./services/anthropic-oauth');
    const creds = await getCredentials();
    const summarySystem = prepareSystemPrompt(
      'You are a helpful assistant that creates concise but comprehensive conversation summaries. Focus on preserving actionable context, technical details, and key decisions.',
      creds.isOAuth
    );
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      temperature: 0,
      messages: [{
        role: 'user',
        content: summaryPrompt
      }],
      system: summarySystem
    });

    const summary = response.content[0]?.text || '';
    const tokensAfter = Math.ceil(summary.length / 4);
    const tokensSaved = tokensBefore - tokensAfter;

    console.log(`[SUMMARIZE] Done: ${tokensBefore} -> ${tokensAfter} tokens (saved ${tokensSaved})`);

    res.json({
      success: true,
      summary,
      tokensBefore,
      tokensAfter,
      tokensSaved
    });

  } catch (error) {
    console.error('[SUMMARIZE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// FILE SNAPSHOTS (Auto-backup before AI edits)
// ============================================================================

const snapshotsDir = path.join(__dirname, '../snapshots');

// Ensure snapshots directory exists
fs.mkdir(snapshotsDir, { recursive: true }).catch(() => {});

// Create a snapshot of a file
app.post('/api/snapshots', async (req, res) => {
  try {
    const { filePath, content, reason } = req.body;
    
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'File path and content required' });
    }
    
    const timestamp = Date.now();
    const id = `snap_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    
    const snapshot = {
      id,
      filePath,
      content,
      reason: reason || 'Manual snapshot',
      timestamp: new Date(timestamp).toISOString(),
      size: content.length
    };
    
    // Create file-specific subdirectory to organize snapshots
    const fileHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_');
    const fileSnapshotDir = path.join(snapshotsDir, fileHash);
    await fs.mkdir(fileSnapshotDir, { recursive: true });
    
    const snapshotPath = path.join(fileSnapshotDir, `${id}.json`);
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    
    console.log(`[SNAPSHOT] Created for ${filePath}: ${reason}`);
    res.json({ success: true, id, snapshot: { id, filePath, timestamp: snapshot.timestamp, reason, size: snapshot.size } });
  } catch (error) {
    console.error('[SNAPSHOT] Error creating:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all snapshots for a specific file
app.get('/api/snapshots', async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }
    
    const fileHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_');
    const fileSnapshotDir = path.join(snapshotsDir, fileHash);
    
    try {
      const files = await fs.readdir(fileSnapshotDir);
      const snapshots = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(fileSnapshotDir, file), 'utf-8');
          const data = JSON.parse(content);
          // Don't include content in list (too large), only metadata
          snapshots.push({
            id: data.id,
            filePath: data.filePath,
            timestamp: data.timestamp,
            reason: data.reason,
            size: data.size
          });
        }
      }
      
      // Sort by timestamp descending (newest first)
      snapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      res.json({ success: true, snapshots });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // No snapshots yet for this file
        res.json({ success: true, snapshots: [] });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('[SNAPSHOT] Error listing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a specific snapshot (with content)
app.get('/api/snapshots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }
    
    const fileHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_');
    const fileSnapshotDir = path.join(snapshotsDir, fileHash);
    const snapshotPath = path.join(fileSnapshotDir, `${id}.json`);
    
    const content = await fs.readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content);
    
    res.json({ success: true, snapshot });
  } catch (error) {
    console.error('[SNAPSHOT] Error loading:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a specific snapshot
app.delete('/api/snapshots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }
    
    const fileHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_');
    const fileSnapshotDir = path.join(snapshotsDir, fileHash);
    const snapshotPath = path.join(fileSnapshotDir, `${id}.json`);
    
    await fs.unlink(snapshotPath);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[SNAPSHOT] Error deleting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete all snapshots for a file
app.delete('/api/snapshots', async (req, res) => {
  try {
    const { filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }
    
    const fileHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_');
    const fileSnapshotDir = path.join(snapshotsDir, fileHash);
    
    try {
      await fs.rm(fileSnapshotDir, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Directory doesn't exist, that's fine
        res.json({ success: true });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('[SNAPSHOT] Error deleting all:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SEMANTIC SEARCH
// ============================================================================

app.post('/api/index-folder', async (req, res) => {
  try {
    const { folderPath, files } = req.body;
    
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path required' });
    }
    
    const indexer = getCodebaseIndexer();
    if (!indexer) {
      return res.status(400).json({ error: 'OpenAI API key required for semantic search' });
    }
    await indexer.indexFolder(folderPath, files);
    
    res.json({ success: true, message: 'Indexing started' });
    
  } catch (error) {
    console.error('[INDEX] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/codebase-search', async (req, res) => {
  try {
    const { query, folderPath, limit = 10 } = req.body;
    
    if (!query || !folderPath) {
      return res.status(400).json({ error: 'Query and folder path required' });
    }
    
    const indexer = getCodebaseIndexer();
    if (!indexer) {
      return res.status(400).json({ error: 'OpenAI API key required for semantic search' });
    }
    const result = await indexer.searchCode(folderPath, query, limit);
    
    res.json({
      success: true,
      results: result.results || [],
      count: result.results?.length || 0
    });
    
  } catch (error) {
    console.error('[SEARCH] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// START SERVER (HTTP + HTTPS)
// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

app.get('/api/health', (req, res) => {
  const pkg = require('../package.json');
  res.json({
    status: 'ok',
    version: pkg.version || '1.0.0',
    name: 'evobrew',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    config: {
      source: configSource,
      http_port: PORT,
      https_port: HTTPS_PORT
    }
  });
});

// ============================================================================
// START SERVER
// ============================================================================

// Start HTTP server
const localIP = getLocalIP();

const httpServer = http.createServer(app);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 Evobrew - Model-Agnostic AI Workspace');
  console.log('='.repeat(60));
  console.log(`\n✓ HTTP:  http://localhost:${PORT}`);
  if (localIP) {
    console.log(`✓ HTTP:  http://${localIP}:${PORT} (network)`);
  }
});

// Start HTTPS server if certificates exist
const certPath = path.join(__dirname, '../ssl/cert.pem');
const keyPath = path.join(__dirname, '../ssl/key.pem');

if (fsSync.existsSync(certPath) && fsSync.existsSync(keyPath)) {
  const httpsOptions = {
    key: fsSync.readFileSync(keyPath),
    cert: fsSync.readFileSync(certPath)
  };
  
  const httpsServer = https.createServer(httpsOptions, app);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`✓ HTTPS: https://localhost:${HTTPS_PORT}`);
    if (localIP) {
      console.log(`✓ HTTPS: https://${localIP}:${HTTPS_PORT} 🔒 (network)`);
    }
    console.log('\n🤖 AI Models:');
    console.log('   - GPT-5.2 ✅');
    console.log('   - Claude Sonnet 4.5 ✅');
    console.log('   - Claude Opus 4.5 ✅');
    console.log('\n🧠 Semantic Search: ENABLED');
    console.log('🔧 Function Calling: ENABLED');
    console.log(`🌍 Access Profile: ${securityConfig.securityProfile.toUpperCase()}`);
    if (localIP) {
      console.log(`\n💡 Network URL: https://${localIP}:${HTTPS_PORT}`);
    }
    console.log('💡 Use HTTPS URL for full clipboard support!');
    console.log('\n' + '='.repeat(60) + '\n');
  });

  // WebSocket proxy: browser → wss://this-server/api/gateway-ws → ws://localhost:18789
  // Solves mixed-content block when IDE is served over HTTPS
  function attachGatewayWsProxy(server) {
    const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789', 10);
    const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || 'localhost';
    const GATEWAY_PASSWORD = process.env.OPENCLAW_GATEWAY_PASSWORD || '';
    const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

    server.on('upgrade', (req, clientSocket, head) => {
      const upgradePath = String(req.url || '').split('?')[0];
      if (upgradePath !== '/api/gateway-ws') return;

      if (shouldDisableGatewayProxy()) {
        clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }

      if (securityConfig.isInternetProfile) {
        if (!hasValidProxySecret(req) || !getAuthenticatedProxyUser(req)) {
          clientSocket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
          return;
        }
      }

      const gatewaySocket = net.connect({ host: GATEWAY_HOST, port: GATEWAY_PORT }, () => {
        // Reconstruct WebSocket upgrade request for the Gateway
        // Proxy is the trust boundary: rewrite Origin, inject auth server-side
        const params = [];
        if (GATEWAY_PASSWORD) params.push(`password=${encodeURIComponent(GATEWAY_PASSWORD)}`);
        if (GATEWAY_TOKEN) params.push(`token=${encodeURIComponent(GATEWAY_TOKEN)}`);
        const gwPath = params.length ? `/?${params.join('&')}` : '/';
        let fwd = `GET ${gwPath} HTTP/1.1\r\n`;
        fwd += `Host: ${GATEWAY_HOST}:${GATEWAY_PORT}\r\n`;
        fwd += `Origin: http://${GATEWAY_HOST}:${GATEWAY_PORT}\r\n`;
        for (const key of ['upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol']) {
          if (req.headers[key]) {
            fwd += `${key}: ${req.headers[key]}\r\n`;
          }
        }
        fwd += '\r\n';

        gatewaySocket.write(fwd);
        if (head.length > 0) gatewaySocket.write(head);

        // Pipe everything bidirectionally (101 response + WebSocket frames)
        gatewaySocket.pipe(clientSocket);
        clientSocket.pipe(gatewaySocket);
      });

      gatewaySocket.on('error', (err) => {
        console.error('[WS-PROXY] Gateway connection failed:', err.message);
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });

      clientSocket.on('error', () => gatewaySocket.destroy());
      clientSocket.on('close', () => gatewaySocket.destroy());
      gatewaySocket.on('close', () => clientSocket.destroy());
    });

    console.log(`✓ WS Proxy: /api/gateway-ws → ws://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  }

  attachGatewayWsProxy(httpsServer);
  attachGatewayWsProxy(httpServer);
} else {
  console.log('\n⚠️  HTTPS: Not configured (certificates not found)');
  console.log('\n🤖 AI Models:');
  console.log('   - GPT-5.2 ✅');
  console.log('   - Claude Sonnet 4.5 ✅');
  console.log('   - Claude Opus 4.5 ✅');
  console.log('\n🧠 Semantic Search: ENABLED');
  console.log('🔧 Function Calling: ENABLED');
  console.log(`🌍 Access Profile: ${securityConfig.securityProfile.toUpperCase()}`);
  console.log('\n' + '='.repeat(60) + '\n');
}


// ============================================================================
// BRAIN STUDIO ADDITIONS
// Load brain and add routes
// ============================================================================

const { loadBrain, unloadBrain, getBrainLoader, getQueryEngine } = require('./brain-loader-module');
let brainLoadingInProgress = false;

// ============================================================================
// PROVIDER ROUTES - Model-agnostic provider abstraction layer
// ============================================================================

/**
 * GET /api/gateway-auth - Return Gateway connect-level auth params
 * Browser fetches this at connect time so credentials stay server-side.
 * Supports both token auth (remote relay) and password-mode pairing bypass.
 */
app.get('/api/gateway-auth', (req, res) => {
  if (shouldDisableGatewayProxy()) {
    return res.status(403).json({ error: 'Gateway proxy is disabled in internet profile' });
  }

  const auth = {};
  if (process.env.OPENCLAW_GATEWAY_PASSWORD) auth.password = process.env.OPENCLAW_GATEWAY_PASSWORD;
  if (process.env.OPENCLAW_GATEWAY_TOKEN) auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
  res.json(auth);
});

/**
 * GET /api/providers/models - List available models across all providers
 * Returns models for UI dropdown selection
 */
app.get('/api/providers/models', async (req, res) => {
  try {
    const { getDefaultRegistry } = require('./providers');
    const registry = await getDefaultRegistry();
    let models = registry.listModels();

    // For Ollama, fetch actually installed models instead of defaults
    const ollamaProvider = registry.getProviderById('ollama');
    if (ollamaProvider) {
      try {
        const ollamaHealth = await ollamaProvider.healthCheck();
        if (ollamaHealth.healthy) {
          const installedModels = await ollamaProvider.listModels();

          // Remove default Ollama models from list
          models = models.filter(m => m.provider !== 'ollama');

          // Add actually installed Ollama models
          installedModels.forEach(modelId => {
            models.push({
              id: modelId,
              provider: 'ollama',
              label: `${modelId} (Ollama)`
            });
          });

          console.log(`[PROVIDERS] Fetched ${installedModels.length} installed Ollama models`);
        } else {
          console.log('[PROVIDERS] Ollama not running, using default model list');
        }
      } catch (ollamaErr) {
        console.warn('[PROVIDERS] Failed to fetch Ollama models:', ollamaErr.message);
      }
    }

    // Add OpenClaw (COZ) as a virtual provider option
    models.push({
      id: 'openclaw:coz',
      provider: 'openclaw',
      label: 'COZ \u2014 Agent with Memory'
    });

    // Include platform info for UI awareness
    const { getPlatform } = require('./providers');
    const platform = getPlatform();

    res.json({
      success: true,
      models,
      providerCount: registry.getProviderIds().length,
      platform: {
        type: platform.platform,
        supportsLocalModels: platform.supportsLocalModels,
        hostname: platform.hostname
      }
    });
  } catch (error) {
    console.error('[PROVIDERS] Error listing models:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/providers/status - Provider health check
 * Returns status of all registered providers
 */
app.get('/api/providers/status', async (req, res) => {
  try {
    const { getDefaultRegistry } = require('./providers');
    const registry = await getDefaultRegistry();
    const status = await registry.healthCheck();
    const capabilities = registry.getCapabilities();
    res.json({ 
      success: true, 
      providers: status,
      capabilities,
      providerIds: registry.getProviderIds()
    });
  } catch (error) {
    console.error('[PROVIDERS] Error checking status:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/providers/capabilities - Get provider capabilities
 * Returns detailed capabilities for each provider (tools, vision, streaming, etc.)
 */
app.get('/api/providers/capabilities', async (req, res) => {
  try {
    const { getDefaultRegistry } = require('./providers');
    const registry = await getDefaultRegistry();
    const capabilities = registry.getCapabilities();
    res.json({ 
      success: true, 
      capabilities
    });
  } catch (error) {
    console.error('[PROVIDERS] Error getting capabilities:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/providers/platform - Get platform information
 * Returns platform details including local model support
 */
app.get('/api/providers/platform', async (req, res) => {
  try {
    const { getPlatform } = require('./providers');
    const platform = getPlatform();
    res.json({ 
      success: true, 
      platform
    });
  } catch (error) {
    console.error('[PROVIDERS] Error getting platform info:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Brain routes
app.get('/api/brain/manifest', (req, res) => {
  const loader = getBrainLoader();
  if (!loader) return res.status(404).json({ error: 'No brain loaded' });
  
  const manifestPath = path.join(loader.brainPath, 'manifest.json');
  if (fsSync.existsSync(manifestPath)) {
    res.json(JSON.parse(fsSync.readFileSync(manifestPath, 'utf8')));
  } else {
    res.json({ brain: { name: path.basename(loader.brainPath) } });
  }
});

app.get('/api/brain/stats', (req, res) => {
  const loader = getBrainLoader();
  if (!loader) return res.status(404).json({ error: 'No brain loaded' });
  
  res.json({
    nodes: loader.nodes.length,
    edges: loader.edges.length,
    cycles: loader.state.cycleCount || 0
  });
});

app.get('/api/brain/info', (req, res) => {
  const loader = getBrainLoader();
  // Default to admin mode for local connections; explicit env var overrides
  const isLocalRequest = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(req.ip || req.connection?.remoteAddress);
  const isAdmin = process.env.COSMO_ADMIN_MODE === 'true' || (process.env.COSMO_ADMIN_MODE !== 'false' && isLocalRequest);

  if (!loader) {
    return res.json({
      hasBrain: false,
      brainPath: null,
      outputsPath: null,
      isAdmin
    });
  }

  const outputsPath = path.join(loader.brainPath, 'outputs');
  const outputsExists = fsSync.existsSync(outputsPath);

  res.json({
    hasBrain: true,
    brainPath: loader.brainPath,
    brainName: path.basename(loader.brainPath),
    outputsPath: outputsExists ? outputsPath : loader.brainPath,
    hasOutputs: outputsExists,
    isAdmin  // Admin mode bypasses path restrictions
  });
});

// ── Streaming SSE query endpoint ──────────────────────────────────
app.post('/api/brain/query/stream', async (req, res) => {
  const queryEngine = getQueryEngine();
  if (!queryEngine) {
    return res.status(404).json({ error: 'No brain loaded' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (event, data) => {
    try {
      const json = JSON.stringify(data);
      // SSE data lines cannot contain literal newlines. JSON.stringify should handle this,
      // but large results might have edge cases. Use multi-line data format per SSE spec.
      const lines = json.split('\n');
      res.write(`event: ${event}\n${lines.map(l => `data: ${l}`).join('\n')}\n\n`);
    } catch (e) {
      console.error('[SSE] Failed to serialize event:', event, e.message);
    }
  };

  const {
    query,
    enablePGS = false,
    ...otherOptions
  } = req.body;

  if (enablePGS) {
    req.setTimeout(600000);
  }

  // Keep-alive ping
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  try {
    const result = await queryEngine.executeEnhancedQuery(query, {
      ...otherOptions,
      enablePGS,
      onChunk: (chunk) => {
        try {
          const eventType = chunk.type || 'progress';
          sendEvent(eventType, chunk);
        } catch (e) {
          // Client disconnected
        }
      }
    });

    // Server-side export if requested
    if (otherOptions.exportFormat && result.answer) {
      try {
        const filepath = await queryEngine.exportResult(
          query, result.answer, otherOptions.exportFormat, result.metadata || {}
        );
        result.exportedTo = filepath;
        sendEvent('progress', { message: `📁 Exported to ${filepath}` });
      } catch (exportErr) {
        sendEvent('progress', { message: `⚠️ Export failed: ${exportErr.message}` });
      }
    }

    sendEvent('result', result);
  } catch (error) {
    sendEvent('error', { message: error.message });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

app.post('/api/brain/query', async (req, res) => {
  const queryEngine = getQueryEngine();
  if (!queryEngine) return res.status(404).json({ error: 'No brain loaded' });

  try {
    const {
      query,
      enablePGS = false,  // Partitioned Graph Synthesis
      ...otherOptions
    } = req.body;

    // PGS queries take 3-6 minutes - extend timeout
    if (enablePGS) {
      req.setTimeout(600000); // 10 minutes
    }

    const result = await queryEngine.executeEnhancedQuery(query, {
      ...otherOptions,
      enablePGS
    });

    // Server-side export if requested
    if (otherOptions.exportFormat && result.answer) {
      try {
        const filepath = await queryEngine.exportResult(
          query, result.answer, otherOptions.exportFormat, result.metadata || {}
        );
        result.exportedTo = filepath;
      } catch (exportErr) {
        result.exportError = exportErr.message;
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export a query result to disk (brain's exports folder)
app.post('/api/brain/export', async (req, res) => {
  try {
    const { query, answer, format = 'markdown', metadata = {} } = req.body;
    if (!query || !answer) {
      return res.status(400).json({ error: 'query and answer are required' });
    }
    const queryEngine = getQueryEngine();
    if (!queryEngine) {
      return res.status(400).json({ error: 'No brain loaded' });
    }
    const filepath = await queryEngine.exportResult(query, answer, format, metadata);
    res.json({ exportedTo: filepath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alias for query-tab.js compatibility
// UPDATED: Now uses AI handler with full tool support (file_read, list_directory, etc.)
app.post('/api/query', async (req, res) => {
  try {
    const { query, model, mode, includeOutputs, includeThoughts, allowActions } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    console.log(`[QUERY TAB] Query: "${query.substring(0, 100)}..."`);

    // Get brain info for context
    const loader = getBrainLoader();
    const brainPath = loader?.brainPath;
    const brainEnabled = !!brainPath;

    // Build comprehensive system prompt for research queries
    let systemPrompt = `You are a research AI assistant with access to a knowledge base (brain).
Your goal is to answer questions by searching the brain, reading relevant files, and synthesizing information.

IMPORTANT CAPABILITIES:
- Use brainSearch tool to find relevant knowledge nodes
- Use file_read tool to read full documents from outputs/
- Use list_directory to explore available files
- Use brain_stats to understand what's available

ALWAYS cite your sources with file paths and node IDs when possible.`;

    // Map query modes to AI behavior hints
    if (mode === 'deep' || mode === 'grounded') {
      systemPrompt += `\n\nMODE: Deep analysis - be thorough, cite all evidence, explore multiple angles.`;
    } else if (mode === 'fast') {
      systemPrompt += `\n\nMODE: Fast extraction - be concise, get to the answer quickly.`;
    } else if (mode === 'report' || mode === 'executive') {
      systemPrompt += `\n\nMODE: Report format - structure your answer with sections, executive summary if appropriate.`;
    }

    // Prepare AI handler params
    const params = {
      message: query,
      model: model || 'claude-sonnet-4-5', // Default to Claude for research
      fileName: null,
      language: null,
      documentContent: null,
      fileTreeContext: null,
      selectedText: null,
      conversationHistory: [],
      systemPromptOverride: systemPrompt,
      brainEnabled,
      brainPath
    };

    params.allowedRoot = getAllowedRoot();

    // Call AI handler with tools enabled
    const result = await handleFunctionCalling(
      getOpenAI(),
      await getAnthropic(),
      getXAI(),
      codebaseIndexer,
      params,
      null  // No event emitter for query tab (non-streaming)
    );

    if (!result.success) {
      return res.status(500).json({
        error: result.error,
        answer: `Error: ${result.error}`
      });
    }

    // Format response for query-tab.js expectations
    res.json({
      success: true,
      answer: result.response,
      query,
      metadata: {
        tokensUsed: result.tokensUsed,
        iterations: result.iterations,
        model: model || 'claude-sonnet-4-5'
      }
    });

  } catch (error) {
    console.error('[QUERY TAB] Error:', error);
    res.status(500).json({
      error: error.message,
      answer: `Error: ${error.message}`
    });
  }
});

// Second alias just in case of path resolution issues
app.post('/query', async (req, res) => {
  const queryEngine = getQueryEngine();
  if (!queryEngine) return res.status(404).json({ error: 'No brain loaded' });

  try {
    const {
      query,
      enablePGS = false,  // Partitioned Graph Synthesis
      ...otherOptions
    } = req.body;

    // PGS queries take 3-6 minutes - extend timeout
    if (enablePGS) {
      req.setTimeout(600000); // 10 minutes
    }

    const result = await queryEngine.executeEnhancedQuery(query, {
      ...otherOptions,
      enablePGS
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dummy handler for compiled-docs/all to prevent 404s in standalone mode
app.get('/api/compiled-docs/all', (req, res) => {
  res.json({ success: true, systems: [] });
});

// Get all unique tags from brain nodes
app.get('/api/tags', (req, res) => {
  const loader = getBrainLoader();
  if (!loader) return res.status(404).json({ error: 'No brain loaded' });
  
  const tagCounts = {};
  loader.nodes.forEach(node => {
    const tags = node.tags || [];
    tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  
  const tags = Object.entries(tagCounts).map(([tag, count]) => ({ tag, count }));
  res.json(tags);
});

// Get nodes with optional search and tag filtering
app.get('/api/nodes', (req, res) => {
  const loader = getBrainLoader();
  if (!loader) return res.status(404).json({ error: 'No brain loaded' });
  
  const { search, tag, limit } = req.query;
  let nodes = loader.nodes;
  
  // Filter by tag
  if (tag) {
    nodes = nodes.filter(n => (n.tags || []).includes(tag));
  }
  
  // Filter by search query
  if (search) {
    const searchLower = search.toLowerCase();
    nodes = nodes.filter(n => {
      const content = (n.content || '').toLowerCase();
      const id = (n.id || '').toLowerCase();
      return content.includes(searchLower) || id.includes(searchLower);
    });
  }
  
  // Limit results (if limit is provided and not 'all')
  if (limit && limit !== 'all') {
    nodes = nodes.slice(0, parseInt(limit));
  }
  
  res.json({ nodes, total: nodes.length });
});

// Get all edges from brain memory
app.get('/api/edges', (req, res) => {
  const loader = getBrainLoader();
  if (!loader) return res.status(404).json({ error: 'No brain loaded' });
  
  const { limit } = req.query;
  let edges = loader.edges;
  
  if (limit && limit !== 'all') {
    edges = edges.slice(0, parseInt(limit));
  }
  
  res.json({ edges, total: edges.length });
});

// Get a single node by ID with full details
app.get('/api/nodes/:id', (req, res) => {
  const loader = getBrainLoader();
  if (!loader) return res.status(404).json({ error: 'No brain loaded' });
  
  // Try string ID first (V2 style), fallback to number if it's purely numeric
  const paramId = req.params.id;
  const nodeId = isNaN(paramId) ? paramId : parseInt(paramId);
  const node = loader.nodes.find(n => n.id === nodeId || String(n.id) === String(paramId));
  
  if (!node) {
    return res.status(404).json({ error: 'Node not found' });
  }
  
  // Get all connected edges (both incoming and outgoing) with full details
  const outgoingConnections = [];
  const incomingConnections = [];
  
  loader.edges.forEach(edge => {
    // Compare source/target with both numeric and string IDs for maximum compatibility
    if (edge.source === nodeId || String(edge.source) === String(nodeId)) {
      const targetNode = loader.nodes.find(n => n.id === edge.target || String(n.id) === String(edge.target));
      outgoingConnections.push({
        nodeId: edge.target,
        weight: edge.weight || 0,
        edgeType: edge.type || 'unknown',
        direction: 'outgoing',
        targetConcept: targetNode ? (targetNode.concept || '').substring(0, 100) : 'Unknown',
        targetTag: targetNode ? targetNode.tag : 'unknown',
        created: edge.created,
        accessed: edge.accessed
      });
    }
    if (edge.target === nodeId || String(edge.target) === String(nodeId)) {
      const sourceNode = loader.nodes.find(n => n.id === edge.source || String(n.id) === String(edge.source));
      incomingConnections.push({
        nodeId: edge.source,
        weight: edge.weight || 0,
        edgeType: edge.type || 'unknown',
        direction: 'incoming',
        sourceConcept: sourceNode ? (sourceNode.concept || '').substring(0, 100) : 'Unknown',
        sourceTag: sourceNode ? sourceNode.tag : 'unknown',
        created: edge.created,
        accessed: edge.accessed
      });
    }
  });
  
  // Sort by weight
  outgoingConnections.sort((a, b) => b.weight - a.weight);
  incomingConnections.sort((a, b) => b.weight - a.weight);
  
  res.json({
    ...node,
    stats: {
      outgoingCount: outgoingConnections.length,
      incomingCount: incomingConnections.length,
      totalConnections: outgoingConnections.length + incomingConnections.length
    },
    outgoingConnections,
    incomingConnections
  });
});

// ============================================================================
// ANTHROPIC OAUTH ENDPOINTS
// ============================================================================

const {
  getOAuthStatus,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  storeToken,
  clearToken
} = require('./services/anthropic-oauth');

const oauthPkceStateStore = new Map();
function pruneOAuthStateStore(maxAgeMs = 10 * 60 * 1000) {
  const now = Date.now();
  for (const [state, data] of oauthPkceStateStore.entries()) {
    if (!data || (now - data.createdAt) > maxAgeMs) {
      oauthPkceStateStore.delete(state);
    }
  }
}

// Initiate OAuth flow (uses PKCE from anthropic-oauth module)
app.get('/api/oauth/anthropic/start', (req, res) => {
  const { authUrl, verifier } = getAuthorizationUrl();
  const state = (() => {
    try {
      return new URL(authUrl).searchParams.get('state');
    } catch {
      return null;
    }
  })();

  pruneOAuthStateStore();
  const flowId = crypto.randomUUID();
  if (state) {
    oauthPkceStateStore.set(state, {
      verifier,
      flowId,
      createdAt: Date.now()
    });
  }

  res.json({
    success: true,
    authUrl,
    flowId,
    expiresInSeconds: 600,
    message: 'Open this URL in your browser to authenticate with Anthropic'
  });
});

// OAuth callback handler
app.get('/api/oauth/anthropic/callback', async (req, res) => {
  const { code, state, code_verifier } = req.query;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Missing authorization code'
    });
  }

  if (!state) {
    return res.status(400).json({
      success: false,
      error: 'Missing OAuth state'
    });
  }

  try {
    pruneOAuthStateStore();
    const stored = oauthPkceStateStore.get(state);
    const verifier = code_verifier || stored?.verifier;
    if (!verifier) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired OAuth flow. Start a new OAuth session.'
      });
    }
    oauthPkceStateStore.delete(state);

    // Exchange authorization code for tokens via PKCE flow
    const data = await exchangeCodeForTokens(code, state, verifier);

    // Store tokens in database (encrypted)
    await storeToken(data.accessToken, data.expiresAt, data.refreshToken);

    res.json({
      success: true,
      message: 'OAuth authentication successful! Tokens stored securely.',
      expiresAt: new Date(data.expiresAt).toISOString()
    });
  } catch (error) {
    console.error('[OAuth] Token exchange error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get OAuth status
app.get('/api/oauth/anthropic/status', async (req, res) => {
  try {
    const status = await getOAuthStatus();
    res.json({
      success: true,
      oauth: status,
      fallbackAvailable: !!process.env.ANTHROPIC_API_KEY
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      fallbackAvailable: !!process.env.ANTHROPIC_API_KEY
    });
  }
});

// Clear OAuth tokens (logout)
app.post('/api/oauth/anthropic/logout', async (req, res) => {
  try {
    await clearToken();
    res.json({
      success: true,
      message: 'OAuth tokens cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// BRAIN PICKER - Browse and load brains at runtime
// ============================================================================

// Check if brains feature is enabled in config
const brainsConfig = serverConfig?.features?.brains || { enabled: false, directories: [] };
const BRAINS_ENABLED = brainsConfig.enabled;

// Get brain directories from config, fallback to env var for backwards compat
const BRAIN_DIRS = BRAINS_ENABLED 
  ? (brainsConfig.directories?.length > 0 
      ? brainsConfig.directories 
      : (process.env.COSMO_BRAIN_DIRS || '').split(',').map(s => s.trim()).filter(Boolean))
  : [];

const BRAIN_DIR_LABELS = {};
BRAIN_DIRS.forEach(d => {
  // Create user-friendly labels based on path
  const basename = path.basename(d);
  if (d.includes('testing')) BRAIN_DIR_LABELS[d] = 'testing';
  else if (basename) BRAIN_DIR_LABELS[d] = basename;
  else BRAIN_DIR_LABELS[d] = 'brains';
});

// Config endpoint for frontend (exposes safe config values)
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    features: {
      brains: {
        enabled: BRAINS_ENABLED,
        hasDirectories: BRAIN_DIRS.length > 0
      },
      ui_refresh_v1: process.env.UI_REFRESH_V1 !== 'false'
    },
    openclaw: {
      enabled: serverConfig?.openclaw?.enabled || false,
      tab_name: serverConfig?.openclaw?.tab_name || 'OpenClaw'
    }
  });
});

app.get('/api/brains/list', async (req, res) => {
  // Return empty list if brains feature is disabled
  if (!BRAINS_ENABLED || BRAIN_DIRS.length === 0) {
    return res.json({ success: true, brains: [], disabled: true });
  }
  
  try {
    const brains = [];
    for (const dir of BRAIN_DIRS) {
      try {
        await fs.access(dir);
      } catch {
        continue; // skip unmounted/missing dirs
      }
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const brainPath = path.join(dir, entry.name);
        const statePath = path.join(brainPath, 'state.json.gz');
        try {
          await fs.access(statePath);
          // Quick check: read state to get node count
          let nodeCount = null;
          try {
            const compressed = await fs.readFile(statePath);
            const decompressed = await gunzip(compressed);
            const state = JSON.parse(decompressed.toString());
            nodeCount = state.memory?.nodes?.length || 0;
          } catch { /* skip count on error */ }
          brains.push({
            name: entry.name,
            path: brainPath,
            nodes: nodeCount,
            location: BRAIN_DIR_LABELS[dir] || 'unknown'
          });
        } catch {
          continue; // no state.json.gz = not a valid brain
        }
      }
    }
    // Sort by name descending (newest timestamps first typically)
    brains.sort((a, b) => b.name.localeCompare(a.name));
    res.json({ success: true, brains });
  } catch (error) {
    console.error('[BRAIN-PICKER] Error listing brains:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/brain/load', async (req, res) => {
  try {
    const { path: brainPath } = req.body;
    if (!brainPath) {
      return res.status(400).json({ success: false, error: 'Path required' });
    }
    // Race condition guard
    if (brainLoadingInProgress) {
      return res.status(409).json({ success: false, error: 'Brain load already in progress' });
    }
    // Path validation: must be within one of the configured BRAIN_DIRS
    const resolvedPath = path.resolve(brainPath);
    const isAllowed = BRAIN_DIRS.some(dir => resolvedPath.startsWith(path.resolve(dir)));
    if (!isAllowed) {
      return res.status(403).json({ success: false, error: 'Path not within allowed brain directories' });
    }
    // Verify it's a valid brain
    const statePath = path.join(resolvedPath, 'state.json.gz');
    if (!fsSync.existsSync(statePath)) {
      return res.status(400).json({ success: false, error: 'No state.json.gz found at path' });
    }
    brainLoadingInProgress = true;
    console.log(`[BRAIN-PICKER] Loading brain: ${resolvedPath}`);
    unloadBrain(); // Clean up previous brain state
    await loadBrain(resolvedPath);
    brainLoadingInProgress = false;
    const loader = getBrainLoader();
    res.json({
      success: true,
      brain: {
        name: path.basename(resolvedPath),
        path: resolvedPath,
        nodes: loader?.nodes?.length || 0,
        edges: loader?.edges?.length || 0
      }
    });
  } catch (error) {
    brainLoadingInProgress = false;
    console.error('[BRAIN-PICKER] Error loading brain:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// CLI: Load brain before starting server
const args = process.argv.slice(2);
if (args.length > 0 && args[0] !== '--help' && fsSync.existsSync(args[0])) {
  loadBrain(path.resolve(args[0])).then(() => {
    console.log('✅ Brain Studio ready with brain loaded\n');
  }).catch(err => {
    console.error('❌ Failed to load brain:', err.message);
  });
}
