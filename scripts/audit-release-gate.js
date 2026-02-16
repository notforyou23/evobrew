#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ALLOWED_HIGH_PACKAGES = new Set(['xlsx']);
const EXCEPTION_DOC_PATH = path.join(process.cwd(), 'docs/security/release-risk-exceptions.md');
const SERVER_FILE = path.join(process.cwd(), 'server/server.js');
const TOOLS_FILE = path.join(process.cwd(), 'server/tools.js');

function fail(message) {
  console.error(`[security:audit] ${message}`);
  process.exit(1);
}

function loadAuditReport() {
  let raw = '';
  try {
    raw = execSync('npm audit --omit=dev --json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    raw = String(error.stdout || error.stderr || '');
  }

  if (!raw.trim()) {
    fail('No JSON output received from npm audit.');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Failed to parse npm audit JSON: ${error.message}`);
  }
}

function getHighAndCriticalFindings(report) {
  const vulnerabilities = report && report.vulnerabilities ? report.vulnerabilities : {};
  return Object.entries(vulnerabilities)
    .map(([name, details]) => ({
      name,
      severity: String(details?.severity || '').toLowerCase(),
      fixAvailable: details?.fixAvailable
    }))
    .filter((entry) => entry.severity === 'high' || entry.severity === 'critical');
}

function assertXlsxExceptionDocumentation() {
  if (!fs.existsSync(EXCEPTION_DOC_PATH)) {
    fail(`Missing required exception doc: ${EXCEPTION_DOC_PATH}`);
  }

  const content = fs.readFileSync(EXCEPTION_DOC_PATH, 'utf8');
  const hasXlsxEntry = /xlsx/i.test(content);
  const hasInternetMitigationNote = /internet profile/i.test(content) && /disabled/i.test(content);

  if (!hasXlsxEntry || !hasInternetMitigationNote) {
    fail(`Exception doc must describe xlsx and internet-profile disablement: ${EXCEPTION_DOC_PATH}`);
  }
}

function assertXlsxMitigationsInCode() {
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const toolsSource = fs.readFileSync(TOOLS_FILE, 'utf8');

  const requiredServerMarkers = [
    'Spreadsheet parsing is disabled in internet profile',
    'Spreadsheet preview is disabled in internet profile'
  ];

  for (const marker of requiredServerMarkers) {
    if (!serverSource.includes(marker)) {
      fail(`Missing xlsx mitigation marker in server/server.js: "${marker}"`);
    }
  }

  if (!toolsSource.includes('Spreadsheet parsing is disabled in this deployment profile.')) {
    fail('Missing tool-level spreadsheet parsing guard in server/tools.js');
  }
}

function run() {
  const report = loadAuditReport();
  const highFindings = getHighAndCriticalFindings(report);

  if (highFindings.length === 0) {
    console.log('[security:audit] OK (no high/critical production vulnerabilities)');
    return;
  }

  const unapproved = highFindings.filter((finding) => !ALLOWED_HIGH_PACKAGES.has(finding.name));
  if (unapproved.length > 0) {
    const summary = unapproved.map((f) => `${f.name}:${f.severity}`).join(', ');
    fail(`Blocking vulnerabilities found: ${summary}`);
  }

  const xlsxFinding = highFindings.find((finding) => finding.name === 'xlsx');
  if (xlsxFinding) {
    assertXlsxExceptionDocumentation();
    assertXlsxMitigationsInCode();
    console.log('[security:audit] Allowed temporary exception: xlsx (internet profile mitigated/disabled)');
  }
}

try {
  run();
} catch (error) {
  fail(error.message);
}
