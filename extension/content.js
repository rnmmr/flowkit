/**
 * Content script — bridge between background.js and injected.js
 * Injects injected.js into MAIN world to access window.grecaptcha
 */
(function () {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type !== 'GET_CAPTCHA') return;

  const { requestId, pageAction } = msg;

  const handler = (e) => {
    if (e.detail?.requestId === requestId) {
      window.removeEventListener('CAPTCHA_RESULT', handler);
      clearTimeout(timer);
      reply({ token: e.detail.token, error: e.detail.error });
    }
  };

  const timer = setTimeout(() => {
    window.removeEventListener('CAPTCHA_RESULT', handler);
    reply({ error: 'CONTENT_TIMEOUT' });
  }, 25000);

  window.addEventListener('CAPTCHA_RESULT', handler);

  window.dispatchEvent(new CustomEvent('GET_CAPTCHA', {
    detail: { requestId, pageAction },
  }));

  return true; // keep channel open for async reply
});

// ─── TRPC Media URL Monitor ─────────────────────────────────
// Forward intercepted TRPC responses with media URLs to background.js
window.addEventListener('TRPC_MEDIA_URLS', (e) => {
  const { url, body } = e.detail || {};
  if (!body) return;
  chrome.runtime.sendMessage({
    type: 'TRPC_MEDIA_URLS',
    trpcUrl: url,
    body,
  }).catch(() => {});
});

// ─── Copy media_id from context menu ────────────────────────
(async () => {
  const m = location.pathname.match(/\/project\/([a-f0-9-]+)/);
  if (!m) return;
  const projectId = m[1];

  // Fetch workflowId → primaryMediaId mapping
  const wfToMedia = {};
  try {
    const input = encodeURIComponent(JSON.stringify({ json: { projectId } }));
    const resp = await fetch(`/fx/api/trpc/flow.projectInitialData?input=${input}`);
    const data = await resp.json();
    for (const wf of data?.result?.data?.json?.projectContents?.workflows || []) {
      wfToMedia[wf.name] = wf.metadata?.primaryMediaId;
    }
    console.log(`[FlowKit] Loaded ${Object.keys(wfToMedia).length} workflow→media mappings`);
  } catch (e) {
    console.warn('[FlowKit] Failed to load projectInitialData:', e);
  }

  // Track which workflow or collection was right-clicked
  let lastWorkflowId = null;
  let lastCollectionId = null;
  document.addEventListener('contextmenu', (e) => {
    const wfLink = e.target.closest?.('a[href*="/edit/"]');
    if (wfLink) {
      const hrefMatch = wfLink.href.match(/\/edit\/([a-f0-9-]+)/);
      if (hrefMatch) lastWorkflowId = hrefMatch[1];
      lastCollectionId = null;
      return;
    }
    const colLink = e.target.closest?.('a[href*="/collection/"]');
    if (colLink) {
      const hrefMatch = colLink.href.match(/\/collection\/([a-f0-9-]+)/);
      if (hrefMatch) lastCollectionId = hrefMatch[1];
      lastWorkflowId = null;
      return;
    }
    lastWorkflowId = null;
    lastCollectionId = null;
  }, true);

  // Watch for context menu, inject copy buttons
  let injecting = false;
  const observer = new MutationObserver(() => {
    if (injecting) return;
    const menu = document.querySelector('[data-context-menu-content]');
    if (!menu) return;
    if (menu.querySelector('.fk-copy-media-id') || menu.querySelector('.fk-copy-collection-id')) return;

    injecting = true;
    const items = menu.querySelectorAll('[role="menuitem"]');
    let downloadItem = null;
    for (const item of items) {
      if (item.textContent.includes('下载')) { downloadItem = item; break; }
    }
    if (!downloadItem) { injecting = false; return; }

    if (lastWorkflowId && wfToMedia[lastWorkflowId]) {
      // Inject copy media_id button
      const sep = document.createElement('div');
      sep.setAttribute('role', 'separator');
      sep.setAttribute('aria-orientation', 'horizontal');
      sep.className = 'sc-3f5a9d11-4 bbaXTT';

      const btn = document.createElement('button');
      btn.className = 'sc-16c4830a-1 iBbNYo sc-e7a64add-0 sc-e7a64add-1 fPutAP jmLZrS sc-d5e0baee-7 ccqZFg sc-f57eb923-1 gyMhuu fk-copy-media-id';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('tabindex', '-1');
      btn.setAttribute('data-orientation', 'vertical');
      btn.setAttribute('data-radix-collection-item', '');
      btn.innerHTML = `<i class="sc-a39c2a59-0 gOHwjv google-symbols undefined" font-size="1.25rem" color="currentColor">content_copy</i>复制 media_id<div data-type="button-overlay" class="sc-16c4830a-0 cZvLor"></div>`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard.writeText(wfToMedia[lastWorkflowId]).then(() => {
          const icon = btn.querySelector('i');
          icon.textContent = 'check';
          icon.nextSibling.textContent = '已复制!';
          setTimeout(() => { icon.textContent = 'content_copy'; icon.nextSibling.textContent = '复制 media_id'; }, 1500);
        });
        menu.setAttribute('data-state', 'closed');
        menu.style.display = 'none';
      });

      downloadItem.parentElement.insertBefore(sep, downloadItem.nextSibling);
      downloadItem.parentElement.insertBefore(btn, sep.nextSibling);
    } else if (lastCollectionId) {
      // Inject copy collection_id button
      const sep = document.createElement('div');
      sep.setAttribute('role', 'separator');
      sep.setAttribute('aria-orientation', 'horizontal');
      sep.className = 'sc-3f5a9d11-4 bbaXTT';

      const btn = document.createElement('button');
      btn.className = 'sc-16c4830a-1 iBbNYo sc-e7a64add-0 sc-e7a64add-1 fPutAP jmLZrS sc-d5e0baee-7 ccqZFg sc-f57eb923-1 gyMhuu fk-copy-collection-id';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('tabindex', '-1');
      btn.setAttribute('data-orientation', 'vertical');
      btn.setAttribute('data-radix-collection-item', '');
      btn.innerHTML = `<i class="sc-a39c2a59-0 gOHwjv google-symbols undefined" font-size="1.25rem" color="currentColor">content_copy</i>复制 collection_id<div data-type="button-overlay" class="sc-16c4830a-0 cZvLor"></div>`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard.writeText(lastCollectionId).then(() => {
          const icon = btn.querySelector('i');
          icon.textContent = 'check';
          icon.nextSibling.textContent = '已复制!';
          setTimeout(() => { icon.textContent = 'content_copy'; icon.nextSibling.textContent = '复制 collection_id'; }, 1500);
        });
        menu.setAttribute('data-state', 'closed');
        menu.style.display = 'none';
      });

      downloadItem.parentElement.insertBefore(sep, downloadItem.nextSibling);
      downloadItem.parentElement.insertBefore(btn, sep.nextSibling);
    }

    injecting = false;
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
