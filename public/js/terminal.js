(function () {
  const STORAGE = {
    clientId: 'evobrew.terminal.client_id.v1',
    dockOpen: 'evobrew.terminal.open.v1',
    dockHeight: 'evobrew.terminal.height.v1',
    activeSession: 'evobrew.terminal.active_session.v1'
  };

  const DEFAULT_DOCK_HEIGHT = 280;
  const MIN_DOCK_HEIGHT = 140;
  const MAX_DOCK_HEIGHT_RATIO = 0.7;

  const state = {
    initialized: false,
    clientId: '',
    ws: null,
    wsConnected: false,
    wsConnectAttempted: false,
    wsReconnectTimer: null,
    sessions: new Map(),
    activeSessionId: null,
    shuttingDown: false,
    terminalApiUnavailable: false
  };

  const els = {
    dock: null,
    body: null,
    tabs: null,
    empty: null,
    resizeHandle: null,
    newBtn: null,
    killBtn: null,
    toggleBtn: null
  };

  function readStorage(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function randomId() {
    const arr = new Uint8Array(12);
    window.crypto.getRandomValues(arr);
    return Array.from(arr).map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  function getClientId() {
    if (state.clientId) return state.clientId;
    let id = readStorage(STORAGE.clientId, '');
    if (!id || !/^[A-Za-z0-9:_-]{1,128}$/.test(id)) {
      id = `client_${randomId()}`;
      writeStorage(STORAGE.clientId, id);
    }
    state.clientId = id;
    return state.clientId;
  }

  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else {
      console.log(`[terminal:${type}]`, message);
    }
  }

  function notifyUnavailable() {
    showToast('Terminal is not available. Verify terminal assets and restart Evobrew.', 'error');
  }

  function setDockHeight(px) {
    if (!els.dock) return;
    const parentRect = els.dock.parentElement.getBoundingClientRect();
    const maxHeight = Math.floor(parentRect.height * MAX_DOCK_HEIGHT_RATIO);
    const height = Math.max(MIN_DOCK_HEIGHT, Math.min(maxHeight, Math.floor(px)));
    els.dock.style.height = `${height}px`;
    writeStorage(STORAGE.dockHeight, String(height));
    fitActiveTerminal();
  }

  function getSavedDockHeight() {
    const raw = readStorage(STORAGE.dockHeight, String(DEFAULT_DOCK_HEIGHT));
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return DEFAULT_DOCK_HEIGHT;
    return parsed;
  }

  function isDockOpen() {
    return !els.dock.classList.contains('hidden');
  }

  function openDock({ focus = false } = {}) {
    if (!els.dock) return;
    els.dock.classList.remove('hidden');
    writeStorage(STORAGE.dockOpen, 'true');
    fitActiveTerminal();
    if (focus) focusActiveTerminal();
  }

  function closeDock() {
    if (!els.dock) return;
    els.dock.classList.add('hidden');
    writeStorage(STORAGE.dockOpen, 'false');
  }

  function toggleDock({ focus = false } = {}) {
    if (isDockOpen()) {
      closeDock();
    } else {
      openDock({ focus });
    }
  }

  function ensureXtermAvailable() {
    const TerminalCtor = getTerminalCtor();
    const getCtor = getAddonCtor;
    const hasFit = Boolean(getCtor(window.FitAddon, 'FitAddon'));
    if (!TerminalCtor || !hasFit) {
      return false;
    }

    // Web links and search are optional enhancements; missing one should not block terminal bootstrap.
    return true;
  }

  function getAddonCtor(namespace, className) {
    if (!namespace) return null;
    if (typeof namespace === 'function') return namespace;
    if (typeof namespace[className] === 'function') return namespace[className];
    return null;
  }

  function getTerminalCtor() {
    return getAddonCtor(window.Terminal, 'Terminal') || getAddonCtor(window.XTerm, 'Terminal');
  }

  async function fetchJson(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Evobrew-Terminal-Client-Id': getClientId(),
      ...(options.headers || {})
    };

    const res = await fetch(url, {
      ...options,
      headers
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // ignore parse errors
    }

    if (!res.ok) {
      const msg = data?.error || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    return data;
  }

  function getCurrentCwd() {
    if (typeof folderPath !== 'undefined' && folderPath) return folderPath;
    if (typeof currentBrowsePath !== 'undefined' && currentBrowsePath) return currentBrowsePath;
    return '.';
  }

  function sessionLabel(session) {
    if (session.name && String(session.name).trim()) return session.name;
    const cwd = session.cwd || '';
    const leaf = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '';
    return leaf || session.session_id.slice(0, 8);
  }

  function ensureSessionRecord(raw) {
    if (!raw || !raw.session_id) return null;
    const existing = state.sessions.get(raw.session_id);
    if (existing) {
      Object.assign(existing, raw);
      return existing;
    }

    const view = document.createElement('div');
    view.className = 'terminal-view';
    view.dataset.sessionId = raw.session_id;
    els.body.appendChild(view);

    const TerminalCtor = getTerminalCtor();
    if (!TerminalCtor) {
      return null;
    }

    const terminal = new TerminalCtor({
      convertEol: false,
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: '#0b0f17',
        foreground: '#dbe7ff',
        cursor: '#5eead4',
        selectionBackground: 'rgba(94, 234, 212, 0.28)'
      }
    });

    const fitAddon = new (getAddonCtor(window.FitAddon, 'FitAddon'))();
    const webLinksCtor = getAddonCtor(window.WebLinksAddon, 'WebLinksAddon');
    const searchCtor = getAddonCtor(window.SearchAddon, 'SearchAddon');

    terminal.loadAddon(fitAddon);
    if (webLinksCtor) {
      try {
        const webLinksAddon = new webLinksCtor();
        terminal.loadAddon(webLinksAddon);
      } catch (error) {
        console.warn('[terminal] Failed to load WebLinksAddon:', error);
      }
    }
    if (searchCtor) {
      try {
        const searchAddon = new searchCtor();
        terminal.loadAddon(searchAddon);
      } catch (error) {
        console.warn('[terminal] Failed to load SearchAddon:', error);
      }
    }

    terminal.open(view);

    terminal.onData((data) => {
      sendWs({
        type: 'input',
        session_id: raw.session_id,
        data
      });
    });

    terminal.onResize(({ cols, rows }) => {
      sendWs({
        type: 'resize',
        session_id: raw.session_id,
        cols,
        rows
      });
    });

    const record = {
      ...raw,
      terminal,
      fitAddon,
      searchAddon,
      view,
      disconnected: false,
      receivedReplay: false
    };

    state.sessions.set(raw.session_id, record);
    return record;
  }

  function removeSessionRecord(sessionId) {
    const record = state.sessions.get(sessionId);
    if (!record) return;

    try {
      record.terminal?.dispose();
    } catch (_) {
      // ignore
    }
    try {
      record.view?.remove();
    } catch (_) {
      // ignore
    }

    state.sessions.delete(sessionId);

    if (state.activeSessionId === sessionId) {
      const next = state.sessions.keys().next().value || null;
      state.activeSessionId = next;
      writeStorage(STORAGE.activeSession, next || '');
      if (next) {
        activateSession(next, { focus: false, attach: true });
      }
    }

    renderTabs();
    refreshEmptyState();
  }

  function fitActiveTerminal() {
    if (!isDockOpen()) return;
    const sid = state.activeSessionId;
    if (!sid) return;
    const record = state.sessions.get(sid);
    if (!record) return;

    try {
      record.fitAddon.fit();
      sendWs({
        type: 'resize',
        session_id: sid,
        cols: record.terminal.cols,
        rows: record.terminal.rows
      });
    } catch (_) {
      // ignore fit errors during layout churn
    }
  }

  function focusActiveTerminal() {
    const sid = state.activeSessionId;
    if (!sid) return;
    const record = state.sessions.get(sid);
    if (!record) return;
    try {
      record.terminal.focus();
    } catch (_) {
      // ignore
    }
  }

  function refreshEmptyState() {
    if (!els.empty) return;
    els.empty.style.display = state.sessions.size === 0 ? 'flex' : 'none';
  }

  function renderTabs() {
    if (!els.tabs) return;

    els.tabs.innerHTML = '';
    for (const record of state.sessions.values()) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'terminal-tab';
      if (record.session_id === state.activeSessionId) tab.classList.add('active');
      if (record.state === 'exited' || record.state === 'closed') tab.classList.add('exited');
      if (record.disconnected) tab.classList.add('disconnected');
      tab.title = `${record.cwd || ''}`;

      const dot = document.createElement('span');
      dot.className = 'state-dot';
      tab.appendChild(dot);

      const label = document.createElement('span');
      label.textContent = sessionLabel(record);
      tab.appendChild(label);

      tab.addEventListener('click', () => {
        activateSession(record.session_id, { focus: true, attach: true });
      });

      els.tabs.appendChild(tab);
    }
  }

  function activateSession(sessionId, options = {}) {
    const record = state.sessions.get(sessionId);
    if (!record) return;

    state.activeSessionId = sessionId;
    writeStorage(STORAGE.activeSession, sessionId);

    for (const [id, item] of state.sessions.entries()) {
      item.view.classList.toggle('active', id === sessionId);
    }

    renderTabs();
    refreshEmptyState();

    if (options.attach !== false) {
      attachWsSession(sessionId);
    }

    setTimeout(() => {
      fitActiveTerminal();
      if (options.focus) focusActiveTerminal();
    }, 0);
  }

  function activeSessionRecord() {
    if (!state.activeSessionId) return null;
    return state.sessions.get(state.activeSessionId) || null;
  }

  async function listSessions() {
    const data = await fetchJson(`/api/terminal/sessions?clientId=${encodeURIComponent(getClientId())}`, {
      method: 'GET'
    });

    return Array.isArray(data.sessions) ? data.sessions : [];
  }

  async function createSession() {
    try {
      if (state.terminalApiUnavailable) return;

      const data = await fetchJson('/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({
          clientId: getClientId(),
          cwd: getCurrentCwd(),
          cols: 120,
          rows: 34,
          persistent: true
        })
      });

      const record = ensureSessionRecord(data.session);
      openDock({ focus: false });
      activateSession(record.session_id, { focus: true, attach: true });
      return record;
    } catch (error) {
      if (error.status === 403) {
        state.terminalApiUnavailable = true;
      }
      showToast(`Failed to create terminal: ${error.message}`, 'error');
      return null;
    }
  }

  async function killActiveSession() {
    const record = activeSessionRecord();
    if (!record) return;

    try {
      await fetchJson(`/api/terminal/sessions/${encodeURIComponent(record.session_id)}?clientId=${encodeURIComponent(getClientId())}`, {
        method: 'DELETE'
      });
      removeSessionRecord(record.session_id);
    } catch (error) {
      showToast(`Failed to close terminal: ${error.message}`, 'error');
    }
  }

  function getWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/terminal/ws?clientId=${encodeURIComponent(getClientId())}`;
  }

  function clearReconnectTimer() {
    if (!state.wsReconnectTimer) return;
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
  }

  function scheduleReconnect() {
    if (state.shuttingDown) return;
    if (state.wsReconnectTimer) return;

    state.wsReconnectTimer = setTimeout(() => {
      state.wsReconnectTimer = null;
      connectWs();
    }, 1200);
  }

  function sendWs(payload) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    try {
      state.ws.send(JSON.stringify(payload));
    } catch (_) {
      // ignore send failures
    }
  }

  function attachWsSession(sessionId) {
    if (!sessionId) return;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    sendWs({
      type: 'attach',
      session_id: sessionId
    });
  }

  function handleWsMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (msg.type === 'ready') {
      if (msg.session && msg.session.session_id) {
        const record = ensureSessionRecord(msg.session);
        record.disconnected = false;
        if (typeof msg.replay === 'string' && msg.replay && !record.receivedReplay) {
          record.terminal.write(msg.replay);
          record.receivedReplay = true;
        }
        if (!state.activeSessionId) {
          activateSession(record.session_id, { focus: false, attach: false });
        }
      }
      return;
    }

    if (msg.type === 'state' && msg.session?.session_id) {
      const record = ensureSessionRecord(msg.session);
      Object.assign(record, msg.session);
      record.disconnected = false;
      renderTabs();
      return;
    }

    if (msg.type === 'output' && msg.session_id) {
      const record = state.sessions.get(msg.session_id);
      if (record) {
        record.terminal.write(msg.data || '');
        record.disconnected = false;
      }
      return;
    }

    if (msg.type === 'exit' && msg.session_id) {
      const record = state.sessions.get(msg.session_id);
      if (record) {
        record.state = 'exited';
        record.exit_code = msg.exit_code;
        record.signal = msg.signal;
        record.disconnected = false;
        renderTabs();
      }
      return;
    }

    if (msg.type === 'error') {
      showToast(`Terminal error: ${msg.error || 'Unknown error'}`, 'error');
    }
  }

  function connectWs() {
    if (state.terminalApiUnavailable) return;
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    state.wsConnectAttempted = true;
    let ws;
    try {
      ws = new WebSocket(getWsUrl());
    } catch (error) {
      scheduleReconnect();
      return;
    }

    state.ws = ws;

    ws.addEventListener('open', () => {
      state.wsConnected = true;
      clearReconnectTimer();

      for (const record of state.sessions.values()) {
        record.disconnected = false;
      }

      if (state.activeSessionId) {
        attachWsSession(state.activeSessionId);
      }
      renderTabs();
    });

    ws.addEventListener('message', handleWsMessage);

    ws.addEventListener('close', () => {
      state.wsConnected = false;
      for (const record of state.sessions.values()) {
        record.disconnected = true;
      }
      renderTabs();
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      state.wsConnected = false;
    });
  }

  async function restoreSessions() {
    try {
      const sessions = await listSessions();
      sessions.forEach((session) => ensureSessionRecord(session));

      const savedActive = readStorage(STORAGE.activeSession, '');
      const target = state.sessions.has(savedActive)
        ? savedActive
        : (state.sessions.keys().next().value || null);

      if (target) {
        activateSession(target, { focus: false, attach: false });
      }

      refreshEmptyState();
      renderTabs();
    } catch (error) {
      if (error.status === 403 || error.status === 404) {
        state.terminalApiUnavailable = true;
      }
    }
  }

  function bindResizeHandle() {
    if (!els.resizeHandle || !els.dock) return;

    let dragging = false;

    const onMove = (event) => {
      if (!dragging) return;
      const parentRect = els.dock.parentElement.getBoundingClientRect();
      const newHeight = parentRect.bottom - event.clientY;
      setDockHeight(newHeight);
      event.preventDefault();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    els.resizeHandle.addEventListener('mousedown', (event) => {
      if (!isDockOpen()) return;
      dragging = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      event.preventDefault();
    });
  }

  function bindControls() {
    els.newBtn?.addEventListener('click', () => {
      createSession();
    });

    els.killBtn?.addEventListener('click', () => {
      killActiveSession();
    });

    els.toggleBtn?.addEventListener('click', () => {
      toggleDock({ focus: false });
    });

    window.addEventListener('resize', () => {
      fitActiveTerminal();
    });
  }

  function restoreDockState() {
    setDockHeight(getSavedDockHeight());

    const shouldOpen = readStorage(STORAGE.dockOpen, 'false') === 'true';
    if (shouldOpen) {
      openDock({ focus: false });
    } else {
      closeDock();
    }
  }

  function exposeApi(enabled = false) {
    const unavailable = () => {
      notifyUnavailable();
      return null;
    };

    if (!enabled) {
      window.toggleTerminalDock = function () {
        unavailable();
      };

      window.newTerminalSession = function () {
        return unavailable();
      };

      window.focusTerminal = function () {
        return unavailable();
      };

      window.killActiveTerminal = function () {
        return unavailable();
      };
    } else {
      window.toggleTerminalDock = function () {
        toggleDock({ focus: false });
      };

      window.newTerminalSession = function () {
        openDock({ focus: false });
        return createSession();
      };

      window.focusTerminal = function () {
        openDock({ focus: true });
        if (!state.activeSessionId && state.sessions.size === 0) {
          createSession();
        } else {
          focusActiveTerminal();
        }
      };

      window.killActiveTerminal = function () {
        return killActiveSession();
      };
    }

    window.getTerminalClientId = function () {
      return getClientId();
    };

    window.evobrewTerminal = {
      getClientId,
      toggleDock,
      createSession: enabled ? createSession : unavailable,
      focusTerminal: window.focusTerminal,
      killActiveSession: enabled ? killActiveSession : unavailable,
      listSessions: () => Array.from(state.sessions.values()).map((s) => ({
        session_id: s.session_id,
        state: s.state,
        cwd: s.cwd,
        name: s.name
      }))
    };
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    exposeApi(false);

    if (!ensureXtermAvailable()) {
      console.warn('[terminal] xterm assets not available; terminal disabled');
      return;
    }

    els.dock = document.getElementById('terminal-dock');
    els.body = document.getElementById('terminal-body');
    els.tabs = document.getElementById('terminal-tabs');
    els.empty = document.getElementById('terminal-empty');
    els.resizeHandle = document.getElementById('terminal-resize-handle');
    els.newBtn = document.getElementById('terminal-new-btn');
    els.killBtn = document.getElementById('terminal-kill-btn');
    els.toggleBtn = document.getElementById('terminal-toggle-btn');

    if (!els.dock || !els.body || !els.tabs) {
      console.warn('[terminal] terminal DOM not found; skipping init');
      return;
    }

    exposeApi(true);
    bindControls();
    bindResizeHandle();
    restoreDockState();
    await restoreSessions();
    connectWs();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
  });

  window.addEventListener('beforeunload', () => {
    state.shuttingDown = true;
    clearReconnectTimer();
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      try {
        state.ws.close();
      } catch (_) {
        // ignore
      }
    }
  });
})();
