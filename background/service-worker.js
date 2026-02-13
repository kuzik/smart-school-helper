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
        defaultKabinetId: '',   // KABINET_ID
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
      // Forward to active tab's content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) {
          sendResponse({ error: 'Немає активної вкладки Smart School' });
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action, payload }, (response) => {
          sendResponse(response);
        });
      });
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

/* ---------- Context Menu (optional, future) ---------- */

// chrome.contextMenus.create({ ... });
