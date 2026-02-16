(function () {
  let baseInitialized = false;
  let initialized = false;
  let headerMetricsObserver = null;

  function parseArgs(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return [];
    try {
      return Function(`"use strict"; return [${trimmed}];`)();
    } catch (error) {
      console.warn('[UI Refresh] Failed to parse action args:', raw, error);
      return [];
    }
  }

  function runActionExpression(expr) {
    const trimmed = (expr || '').trim();
    const match = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\((.*)\)$/);
    if (!match) return;

    const fnName = match[1];
    const fn = window[fnName];
    if (typeof fn !== 'function') {
      console.warn('[UI Refresh] Missing action function:', fnName);
      return;
    }

    const args = parseArgs(match[2]);
    return fn(...args);
  }

  function installDelegatedActions() {
    if (document.body.dataset.uiActionDelegation === 'ready') return;
    document.body.dataset.uiActionDelegation = 'ready';

    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      if (target.disabled) return;

      const expr = target.getAttribute('data-action');
      if (!expr) return;

      event.preventDefault();
      runActionExpression(expr);
    });
  }

  function convertInlineActions() {
    const scope = [
      '.ide-header',
      '#sidebar',
      '#tablet-panel-bar',
      '.status-bar',
      '#search-panel',
      '#settings-panel',
      '#keyboard-help',
      '#folder-browser',
      '#brainPickerModal',
      '.header-overflow-menu',
      '#readme-tab-panel',
      '#query-tab-panel',
      '#explore-tab-panel',
      '#openclaw-tab-panel'
    ];

    const selector = scope
      .map((region) => `${region}[onclick], ${region} [onclick]`)
      .join(', ');
    document.querySelectorAll(selector).forEach((el) => {
      const onclick = el.getAttribute('onclick');
      if (!onclick) return;
      if (onclick.includes('if(') || onclick.includes(';')) return;
      el.setAttribute('data-action', onclick.trim());
      el.removeAttribute('onclick');
    });
  }

  function initOverflowMenu() {
    const toggle = document.getElementById('header-overflow-btn');
    const menu = document.getElementById('header-overflow-menu');
    if (!toggle || !menu) return;

    const closeMenu = () => {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', (event) => {
      if (menu.contains(event.target) || toggle.contains(event.target)) return;
      closeMenu();
    });

    window.closeHeaderOverflow = closeMenu;
    window.toggleHeaderOverflow = () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
  }

  function normalizeA11y() {
    document.querySelectorAll('.btn-icon').forEach((btn) => {
      const hasLabel = btn.getAttribute('aria-label');
      if (!hasLabel) {
        const title = btn.getAttribute('title') || btn.getAttribute('data-tooltip') || 'Action';
        btn.setAttribute('aria-label', title);
      }
    });

    const sidePath = document.getElementById('sidebar-path');
    if (sidePath) {
      sidePath.setAttribute('role', 'button');
      sidePath.setAttribute('tabindex', '0');
      sidePath.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          runActionExpression(sidePath.getAttribute('data-action') || 'showFolderBrowser()');
        }
      });
    }
  }

  function syncHeaderMetrics() {
    const header = document.querySelector('.ide-header');
    if (!header) return;
    const height = Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--ui-shell-header-height', `${height}px`);
  }

  function bindHeaderMetrics() {
    syncHeaderMetrics();
    window.addEventListener('resize', syncHeaderMetrics);

    const header = document.querySelector('.ide-header');
    if (!header || typeof ResizeObserver !== 'function') return;

    if (headerMetricsObserver) {
      headerMetricsObserver.disconnect();
    }

    headerMetricsObserver = new ResizeObserver(() => syncHeaderMetrics());
    headerMetricsObserver.observe(header);
  }

  function initShell() {
    if (initialized) return;
    initialized = true;

    document.body.classList.add('ui-refresh-enabled');
    const overflow = document.querySelector('.header-overflow');
    if (overflow) overflow.style.display = '';
    convertInlineActions();
    installDelegatedActions();
    initOverflowMenu();
    normalizeA11y();
    bindHeaderMetrics();

    if (window.UIRefreshPanels?.init) window.UIRefreshPanels.init();
    if (window.UIRefreshOnboarding?.init) window.UIRefreshOnboarding.init();
    if (window.UIRefreshShortcuts?.init) window.UIRefreshShortcuts.init();
  }

  function maybeInitFromFlag(enabled) {
    if (!baseInitialized) {
      baseInitialized = true;
      installDelegatedActions();
      normalizeA11y();
    }

    if (enabled === false) {
      const overflow = document.querySelector('.header-overflow');
      if (overflow) overflow.style.display = 'none';
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initShell, { once: true });
    } else {
      initShell();
    }
  }

  window.initUIRefresh = maybeInitFromFlag;

  window.addEventListener('evobrew:ui-refresh-toggle', (event) => {
    maybeInitFromFlag(event?.detail?.enabled !== false);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      maybeInitFromFlag(window.uiRefreshEnabled === true);
    }, { once: true });
  } else {
    maybeInitFromFlag(window.uiRefreshEnabled === true);
  }
})();
