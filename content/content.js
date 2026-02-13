/**
 * Smart School Helper — Content Script
 *
 * Runs on https://admin-saceit.smart-school.com.ua/*
 * Orchestrates schedule parsing, comparison, and report generation
 * in the context of the actual page.
 */

(() => {
  'use strict';

  /* ========== State ========== */

  const state = {
    mySchedule: null,
    targetSchedule: null,
    freeSlots: [],
    selectedSlots: [],
    config: {},
  };

  /* ========== Initialization ========== */

  SmartSchoolConfig.log('Content script loaded on', window.location.href);

  // Load config from storage
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (config) => {
    state.config = config || {};
    SmartSchoolConfig.log('Config loaded:', state.config);
    injectHelperUI();
  });

  /* ========== Message Listener (from popup / background) ========== */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    switch (action) {
      case 'PARSE_SCHEDULE':
        handleParseSchedule(payload).then(sendResponse);
        return true;

      case 'FIND_FREE_SLOTS':
        handleFindFreeSlots(payload).then(sendResponse);
        return true;

      case 'GENERATE_REPORT':
        handleGenerateReport(payload).then(sendResponse);
        return true;

      case 'GET_GROUPS':
        sendResponse({ groups: ScheduleParser.parseGroupList() });
        return true;

      case 'LOAD_FILTERS': {
        // First try live DOM, if on the lesson/index page
        const liveGroups = ScheduleParser.parseGroupList();
        if (liveGroups.length > 0) {
          sendResponse({
            groups: liveGroups,
            teachers: ScheduleParser.parseTeacherList(),
            subjects: ScheduleParser.parseSubjectList(),
            rooms: ScheduleParser.parseRoomList(),
            lessonNums: ScheduleParser.parseLessonNumList(),
          });
        } else {
          // Not on the right page — fetch it
          fetchFiltersFromLessonPage().then(sendResponse);
        }
        return true;
      }

      default:
        return false;
    }
  });

  /* ========== Handlers ========== */

  /**
   * Parse schedules for both groups.
   */
  async function handleParseSchedule(payload) {
    try {
      const { myGroupId, targetGroupId, teacherId, predmetId, kabinetId, dateFrom, dateTo } = payload;

      if (!myGroupId || !targetGroupId) {
        return { error: 'Оберіть обидві групи' };
      }

      showOverlayStatus('Зчитування розкладу моєї групи…');
      state.mySchedule = await fetchAndParseSchedule({
        klassId: myGroupId, teacherId, predmetId, kabinetId, dateFrom, dateTo,
      });

      showOverlayStatus('Зчитування розкладу другої групи…');
      state.targetSchedule = await fetchAndParseSchedule({
        klassId: targetGroupId, teacherId, predmetId, kabinetId, dateFrom, dateTo,
      });

      hideOverlayStatus();

      // Cache the schedules
      chrome.runtime.sendMessage({
        action: 'CACHE_SCHEDULE',
        payload: { groupId: myGroupId, schedule: state.mySchedule },
      });
      chrome.runtime.sendMessage({
        action: 'CACHE_SCHEDULE',
        payload: { groupId: targetGroupId, schedule: state.targetSchedule },
      });

      return {
        success: true,
        myEntries: state.mySchedule.entries.length,
        targetEntries: state.targetSchedule.entries.length,
      };
    } catch (err) {
      SmartSchoolConfig.error('Parse error:', err);
      hideOverlayStatus();
      return { error: err.message };
    }
  }

  /**
   * Find free slots from parsed schedules.
   */
  async function handleFindFreeSlots(payload) {
    try {
      if (!state.mySchedule || !state.targetSchedule) {
        return { error: 'Спочатку зчитайте розклади обох груп' };
      }

      const { dateFrom, dateTo } = payload;
      const allFree = ScheduleComparator.findFreeSlots(
        state.mySchedule,
        state.targetSchedule,
        dateFrom,
        dateTo
      );

      // Suggest optimal slots (first per week)
      state.freeSlots = allFree;
      state.selectedSlots = ScheduleComparator.suggestSlots(allFree, 'first-per-week');

      return {
        success: true,
        slots: state.selectedSlots,
        totalFree: allFree.length,
        summary: ScheduleComparator.getSummary(
          state.mySchedule,
          state.targetSchedule,
          allFree
        ),
      };
    } catch (err) {
      SmartSchoolConfig.error('Comparison error:', err);
      return { error: err.message };
    }
  }

  /**
   * Generate and download/copy the report.
   */
  async function handleGenerateReport(payload) {
    try {
      const { selectedIndexes, discipline, format } = payload;

      const slots = selectedIndexes.map((i) => state.selectedSlots[i]).filter(Boolean);
      if (slots.length === 0) {
        return { error: 'Оберіть хоча б одну пару' };
      }

      const result = ReportGenerator.generate({
        slots,
        discipline,
        teacherName: state.config.teacherName || '',
        groupName: state.targetSchedule?.groupName || '',
        subgroupLabel: state.config.subgroupLabel || '2 підгрупа',
        format,
      });

      // Handle output based on format
      if (format === 'clipboard') {
        await ReportGenerator.copyToClipboard(result.preview);
      } else if (result.blob && result.filename) {
        ReportGenerator.downloadBlob(result.blob, result.filename);
      }

      return {
        success: true,
        preview: result.preview,
      };
    } catch (err) {
      SmartSchoolConfig.error('Report error:', err);
      return { error: err.message };
    }
  }

  /* ========== Schedule Fetching ========== */

  /**
   * Fetch the lesson/index page to extract filter options (groups, teachers, etc.)
   * even when we're not currently on that page.
   */
  async function fetchFiltersFromLessonPage() {
    try {
      const url = SmartSchoolConfig.buildLessonSearchURL({});
      SmartSchoolConfig.log('Fetching lesson page for filters:', url);

      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Accept': 'text/html' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      return {
        groups: ScheduleParser.parseGroupList(doc),
        teachers: ScheduleParser.parseTeacherList(doc),
        subjects: ScheduleParser.parseSubjectList(doc),
        rooms: ScheduleParser.parseRoomList(doc),
        lessonNums: ScheduleParser.parseLessonNumList(doc),
      };
    } catch (err) {
      SmartSchoolConfig.error('Failed to fetch filters:', err);
      return { error: err.message };
    }
  }

  /**
   * Fetch and parse a group schedule using the LessonSearch endpoint.
   *
   * @param {object} params
   * @param {string} params.klassId   — KLASS_ID (group)
   * @param {string} [params.teacherId]  — TEACHER_ID
   * @param {string} [params.predmetId]  — PREDMET_ID
   * @param {string} [params.kabinetId]  — KABINET_ID
   * @param {string} params.dateFrom
   * @param {string} params.dateTo
   */
  async function fetchAndParseSchedule(params) {
    const { klassId, teacherId, predmetId, kabinetId, dateFrom, dateTo } = params;

    // Build URL using the real LessonSearch parameters
    const url = SmartSchoolConfig.buildLessonSearchURL({
      klassId,
      teacherId,
      predmetId,
      kabinetId,
      startDate: dateFrom,
      endDate: dateTo,
    });

    SmartSchoolConfig.log('Fetching schedule from:', url);

    try {
      const response = await fetch(url, {
        credentials: 'same-origin', // send session cookies
        headers: {
          'Accept': 'text/html',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      return ScheduleParser.parseFromHTML(html, klassId);
    } catch (err) {
      SmartSchoolConfig.warn('Fetch failed, falling back to DOM parsing:', err.message);
      // Fallback: parse current visible page
      return ScheduleParser.parseVisibleSchedule(klassId);
    }
  }

  /* ========== Overlay UI ========== */

  /**
   * Inject a minimal floating helper UI on the page.
   */
  function injectHelperUI() {
    // Don't double-inject
    if (document.getElementById('ssh-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ssh-overlay';
    overlay.innerHTML = `
      <div id="ssh-status" class="ssh-status hidden"></div>
      <button id="ssh-fab" class="ssh-fab" title="Smart School Helper">📚</button>
    `;
    document.body.appendChild(overlay);

    // FAB click toggles a quick-action panel (future enhancement)
    document.getElementById('ssh-fab').addEventListener('click', () => {
      SmartSchoolConfig.log('FAB clicked — open popup for controls');
    });
  }

  function showOverlayStatus(text) {
    const el = document.getElementById('ssh-status');
    if (el) {
      el.textContent = text;
      el.classList.remove('hidden');
    }
  }

  function hideOverlayStatus() {
    const el = document.getElementById('ssh-status');
    if (el) {
      el.classList.add('hidden');
    }
  }

})();
