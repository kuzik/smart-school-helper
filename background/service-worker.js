/**
 * Smart School Helper — Background Service Worker
 *
 * Handles:
 * - Message routing between popup ↔ content scripts
 * - Badge / notification updates
 * - Persistent storage coordination
 */

/* ---------- Installation & Startup ---------- */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default config on first install
    chrome.storage.local.set({
      config: {
        teacherName: '',
        defaultTeacherId: '',   // TEACHER_ID
        defaultPredmetId: '',   // PREDMET_ID
        subgroupLabel: '2 підгрупа',
        semesterStart: '',
        semesterEnd: '',
      },
      cachedSchedules: {},
    });
    console.log('[Smart School Helper] Installed — default config saved.');
  }
});

/* ---------- Message Router ---------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  switch (action) {
    /* --- Config --- */
    case 'GET_CONFIG':
      chrome.storage.local.get('config', (data) => sendResponse(data.config || {}));
      return true; // keep channel open for async response

    case 'SAVE_CONFIG':
      chrome.storage.local.set({ config: payload }, () => {
        sendResponse({ success: true });
      });
      return true;

    /* --- Schedule caching --- */
    case 'CACHE_SCHEDULE':
      chrome.storage.local.get('cachedSchedules', (data) => {
        const schedules = data.cachedSchedules || {};
        schedules[payload.groupId] = {
          data: payload.schedule,
          fetchedAt: Date.now(),
        };
        chrome.storage.local.set({ cachedSchedules: schedules }, () => {
          sendResponse({ success: true });
        });
      });
      return true;

    case 'GET_CACHED_SCHEDULES':
      chrome.storage.local.get('cachedSchedules', (data) => {
        sendResponse(data.cachedSchedules || {});
      });
      return true;

    case 'CLEAR_CACHE':
      chrome.storage.local.set({ cachedSchedules: {} }, () => {
        sendResponse({ success: true });
      });
      return true;

    /* --- Trigger content script actions from popup --- */
    case 'PARSE_SCHEDULE':
    case 'GENERATE_REPORT':
    case 'FIND_FREE_SLOTS':
    case 'LOAD_FILTERS':
    case 'FETCH_MONTH_SCHEDULE':
    case 'GET_CURRENT_USER':
    case 'FIND_SLOTS_FOR_LESSONS':
    case 'FETCH_LESSON_DETAILS':
      // Forward to active tab's content script (with auto-injection fallback)
      forwardToContentScript(action, payload, sendResponse);
      return true;

    /* --- Badge update --- */
    case 'SET_BADGE':
      chrome.action.setBadgeText({ text: payload.text || '' });
      chrome.action.setBadgeBackgroundColor({ color: payload.color || '#4CAF50' });
      sendResponse({ success: true });
      return true;

    default:
      console.warn('[Smart School Helper] Unknown action:', action);
      sendResponse({ error: `Unknown action: ${action}` });
      return true;
  }
});

/* ---------- Content Script Injection Helper ---------- */

/**
 * Forward a message to the content script on the active tab.
 * If the content script is not injected, inject it first, then retry.
 */
function forwardToContentScript(action, payload, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      sendResponse({ error: 'Немає активної вкладки' });
      return;
    }

    // Check if the tab is on the Smart School site
    if (!tab.url || !tab.url.includes('admin-saceit.smart-school.com.ua')) {
      sendResponse({ error: 'Відкрийте сайт Smart School (admin-saceit.smart-school.com.ua)' });
      return;
    }

    // Try sending the message
    try {
      const response = await sendMessageToTab(tab.id, action, payload);
      sendResponse(response);
    } catch (err) {
      console.log('[Smart School Helper] Content script not found, injecting…');
      // Inject content scripts programmatically
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            'utils/config.js',
            'utils/schedule-parser.js',
            'utils/schedule-comparator.js',
            'utils/report-generator.js',
            'content/content.js',
          ],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['styles/overlay.css'],
        });
        // Wait a tick for the scripts to initialize
        await new Promise((r) => setTimeout(r, 100));
        // Retry the message
        const response = await sendMessageToTab(tab.id, action, payload);
        sendResponse(response);
      } catch (injErr) {
        console.error('[Smart School Helper] Injection failed:', injErr);
        sendResponse({ error: `Не вдалось завантажити скрипт: ${injErr.message}` });
      }
    }
  });
}

/**
 * Send a message to a tab and return a Promise.
 * Rejects if chrome.runtime.lastError is set (no receiving end).
 */
function sendMessageToTab(tabId, action, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
