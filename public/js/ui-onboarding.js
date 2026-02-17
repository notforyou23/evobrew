(function () {
  let initialized = false;
  let emptyStateEl = null;

  function hasSelectedFolder() {
    const sidebarPath = document.getElementById('sidebar-path');
    return Boolean(sidebarPath && sidebarPath.textContent.trim());
  }

  function ensureEmptyState() {
    if (emptyStateEl) return emptyStateEl;

    const host = document.querySelector('.editor-wrapper');
    if (!host) return null;

    emptyStateEl = document.createElement('div');
    emptyStateEl.className = 'onboarding-empty-state';
    emptyStateEl.id = 'onboarding-empty-state';
    emptyStateEl.innerHTML = `
      <div class="onboarding-card" role="region" aria-label="Workspace setup">
        <h2>Start Your Workspace</h2>
        <p>Choose a folder to work in and optionally connect a brain. This stays non-blocking so you can keep navigating while setting context.</p>
        <div class="onboarding-actions">
          <button class="onboarding-action primary" data-action="showFolderBrowser()">Choose Folder</button>
          <button class="onboarding-action" data-action="toggleBrainPicker()">Load Brain</button>
          <button class="onboarding-action" data-action="showRecentFiles()">Open Recent</button>
        </div>
      </div>
    `;
    host.appendChild(emptyStateEl);
    return emptyStateEl;
  }

  function updateVisibility() {
    const el = ensureEmptyState();
    if (!el) return;

    if (!hasSelectedFolder()) {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  function wrap(fnName) {
    const original = window[fnName];
    if (typeof original !== 'function' || original.__onboardingWrapped) return;

    const wrapped = async function (...args) {
      const result = await original.apply(this, args);
      updateVisibility();
      return result;
    };

    wrapped.__onboardingWrapped = true;
    window[fnName] = wrapped;
  }

  function init() {
    if (initialized) return;
    initialized = true;

    ensureEmptyState();
    ['selectAndLoadFolder', 'loadFileTree', 'closeFolderBrowser', 'showFolderBrowser'].forEach(wrap);

    setTimeout(updateVisibility, 0);
    setTimeout(updateVisibility, 500);

    window.UIRefreshOnboarding = {
      updateVisibility
    };
  }

  window.UIRefreshOnboarding = {
    init,
    updateVisibility
  };
})();
