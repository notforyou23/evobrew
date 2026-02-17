/**
 * Brain Loader Module
 * Loads .brain package before server starts
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

const { BrainQueryEngine } = require('../lib/brain-query-engine');

let brainLoader = null;
let brainQueryEngine = null;

function unloadBrain() {
  if (brainQueryEngine) {
    if (typeof brainQueryEngine.dispose === 'function') brainQueryEngine.dispose();
    if (typeof brainQueryEngine.close === 'function') brainQueryEngine.close();
  }
  brainQueryEngine = null;
  brainLoader = null;
}

async function loadBrain(brainPath) {
  console.log(`\n🧠 Loading brain: ${brainPath}`);
  
  const statePath = path.join(brainPath, 'state.json.gz');
  if (!fsSync.existsSync(statePath)) {
    throw new Error('No state.json.gz found in brain');
  }

  const compressed = await fs.readFile(statePath);
  const decompressed = await gunzip(compressed);
  const state = JSON.parse(decompressed.toString());

  brainLoader = {
    brainPath: path.resolve(brainPath),
    state,
    nodes: state.memory?.nodes || [],
    edges: state.memory?.edges || []
  };

  // QueryEngine requires OpenAI for embeddings - make it optional
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    brainQueryEngine = new BrainQueryEngine(brainPath, openaiKey);
    console.log(`✅ Brain loaded: ${brainLoader.nodes.length} nodes, ${brainLoader.edges.length} edges`);
    console.log(`✅ Query engine initialized with OpenAI embeddings\n`);
  } else {
    brainQueryEngine = null;
    console.log(`✅ Brain loaded: ${brainLoader.nodes.length} nodes, ${brainLoader.edges.length} edges`);
    console.warn(`⚠️  Query engine disabled (no OPENAI_API_KEY). Brain browsing works, but queries won't.\n`);
  }
  
  return { brainLoader, brainQueryEngine };
}

function getBrainLoader() {
  return brainLoader;
}

function getQueryEngine() {
  return brainQueryEngine;
}

module.exports = { loadBrain, unloadBrain, getBrainLoader, getQueryEngine };
