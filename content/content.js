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
    if (chrome.runtime.lastError) {
      SmartSchoolConfig.warn('GET_CONFIG failed:', chrome.runtime.lastError.message);
    }
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
          SmartSchoolConfig.log('LOAD_FILTERS: found', liveGroups.length, 'groups in live DOM');
          sendResponse({
            groups: liveGroups,
            teachers: ScheduleParser.parseTeacherList(),
            subjects: ScheduleParser.parseSubjectList(),
            lessonNums: ScheduleParser.parseLessonNumList(),
          });
        } else {
          SmartSchoolConfig.log('LOAD_FILTERS: no groups in live DOM, fetching lesson page…');
          // Not on the right page — fetch it
          fetchFiltersFromLessonPage()
            .then((data) => {
              SmartSchoolConfig.log('LOAD_FILTERS fetch result:', data);
              sendResponse(data);
            })
            .catch((err) => {
              SmartSchoolConfig.error('LOAD_FILTERS fetch failed:', err);
              sendResponse({ error: err.message });
            });
        }
        return true;
      }

      case 'GET_CURRENT_USER': {
        const user = extractCurrentUser();
        sendResponse(user);
        return true;
      }

      case 'FETCH_MONTH_SCHEDULE': {
        handleFetchMonthSchedule(payload)
          .then(sendResponse)
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }

      case 'FIND_SLOTS_FOR_LESSONS': {
        handleFindSlotsForLessons(payload)
          .then(sendResponse)
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }

      case 'FETCH_LESSON_DETAILS': {
        handleFetchLessonDetails(payload)
          .then(sendResponse)
          .catch((err) => sendResponse({ error: err.message }));
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
      const { myGroupId, targetGroupId, teacherId, predmetId, dateFrom, dateTo } = payload;

      if (!myGroupId || !targetGroupId) {
        return { error: 'Оберіть обидві групи' };
      }

      showOverlayStatus('Зчитування розкладу моєї групи…');
      state.mySchedule = await fetchAndParseSchedule({
        klassId: myGroupId, teacherId, predmetId, dateFrom, dateTo,
      });

      showOverlayStatus('Зчитування розкладу другої групи…');
      state.targetSchedule = await fetchAndParseSchedule({
        klassId: targetGroupId, teacherId, predmetId, dateFrom, dateTo,
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
   * @param {string} params.dateFrom
   * @param {string} params.dateTo
   */
  async function fetchAndParseSchedule(params) {
    const { klassId, teacherId, predmetId, dateFrom, dateTo } = params;

    // Build URL using the real LessonSearch parameters
    const url = SmartSchoolConfig.buildLessonSearchURL({
      klassId,
      teacherId,
      predmetId,
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

  /* ========== Lesson Detail (Topic) Fetching ========== */

  /**
   * Fetch the lesson-detail for each entry to extract the topic.
   * Uses the Kartik ExpandRow detail URL: POST /index.php?r=lesson/lesson-detail
   * with expandRowKey=LESSON_ID.
   *
   * Processes in batches to avoid overloading the server.
   *
   * @param {Array} entries — schedule entries with lessonId
   * @param {function} onProgress — callback(done, total)
   */
  async function fetchLessonDetails(entries, onProgress) {
    const BATCH_SIZE = 5;
    const DELAY_MS = 100;
    const detailUrl = `${SmartSchoolConfig.SITE_ORIGIN}/index.php?r=lesson%2Flesson-detail`;

    // Yii2 requires CSRF token on POST requests
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    if (!csrfToken) {
      SmartSchoolConfig.warn('CSRF token not found — detail requests may fail.');
    }

    let done = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (entry) => {
        if (!entry.lessonId) return;
        try {
          const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          };
          if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
          }
          const resp = await fetch(detailUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: `expandRowKey=${encodeURIComponent(entry.lessonId)}`,
          });
          if (!resp.ok) return;
          const html = await resp.text();
          entry.topic = parseLessonTopic(html);
        } catch (err) {
          SmartSchoolConfig.warn(`Detail fetch failed for lesson ${entry.lessonId}:`, err.message);
        }
      });
      await Promise.all(promises);
      done += batch.length;
      if (onProgress) onProgress(done, entries.length);
      if (i + BATCH_SIZE < entries.length) {
        await SmartSchoolConfig.sleep(DELAY_MS);
      }
    }
  }

  /**
   * Parse the topic (тема) from the lesson-detail HTML fragment.
   * The detail is typically a table or div with lesson info.
   * We look for a row/field labeled "Тема" or extract the first
   * meaningful text content.
   */
  function parseLessonTopic(html) {
    if (!html || html.length < 10) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Primary: exact selector from the Kartik detail-view widget
    const topicEl = doc.querySelector(
      '#w1 > tbody > tr:nth-child(7) > td > table > tbody > tr > td > div.kv-attribute'
    );
    if (topicEl) {
      const val = topicEl.textContent.trim();
      if (val && val !== '(не задано)') return val;
    }

    // Fallback: any .kv-attribute whose preceding .kv-label contains "Тема"
    const labels = doc.querySelectorAll('.kv-label');
    for (const label of labels) {
      if (/тема/i.test(label.textContent)) {
        const attr = label.closest('td')?.querySelector('.kv-attribute')
          || label.parentElement?.querySelector('.kv-attribute');
        if (attr) {
          const val = attr.textContent.trim();
          if (val && val !== '(не задано)') return val;
        }
      }
    }

    return '';
  }

  /* ========== Current User Extraction ========== */

  /**
   * Extract current user info from the page header.
   * Selector: .user-footer .pull-left a → href contains teacher ID.
   * Also: .user-menu .hidden-xs → teacher name.
   */
  function extractCurrentUser() {
    const nameEl = document.querySelector('.user-menu .hidden-xs');
    const profileLink = document.querySelector('.user-footer .pull-left a');

    const name = nameEl?.textContent?.trim() || '';
    let teacherId = '';
    if (profileLink) {
      // href like "/index.php?r=teacher%2Fview&id=65"
      const match = profileLink.href.match(/[?&]id=(\d+)/);
      if (match) teacherId = match[1];
    }

    SmartSchoolConfig.log('Current user:', name, 'teacherId:', teacherId);
    return { name, teacherId };
  }

  /* ========== Fetch Month Schedule ========== */

  /**
   * Fetch all lessons for the current user in a given month.
   * Uses the teacher ID extracted from the page header.
   */
  async function handleFetchMonthSchedule(payload) {
    const { month, year } = payload;

    // Get current user's teacher ID from the page
    const user = extractCurrentUser();
    if (!user.teacherId) {
      return { error: 'Не вдалося визначити ID викладача. Переконайтесь, що ви залогінені.' };
    }

    // Calculate date range for the month
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(year, parseInt(month, 10), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

    SmartSchoolConfig.log(`Fetching schedule for teacher ${user.teacherId}, ${startDate} → ${endDate}`);

    showOverlayStatus(`Завантаження розкладу за ${month}.${year}…`);

    try {
      const url = SmartSchoolConfig.buildLessonSearchURL({
        teacherId: user.teacherId,
        startDate,
        endDate,
      });

      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Accept': 'text/html' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const schedule = ScheduleParser.parseFromHTML(html, '');

      // Check if there's pagination — fetch remaining pages
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const allEntries = [...schedule.entries];
      const totalRecords = ScheduleParser.parseTotalRecords(doc);

      if (totalRecords && totalRecords > allEntries.length) {
        SmartSchoolConfig.log(`Page 1: ${allEntries.length}/${totalRecords} records, fetching more…`);
        let page = 2;
        while (allEntries.length < totalRecords) {
          const pageUrl = url + `&page=${page}`;
          showOverlayStatus(`Завантаження сторінки ${page}…`);
          const pageResp = await fetch(pageUrl, {
            credentials: 'same-origin',
            headers: { 'Accept': 'text/html' },
          });
          if (!pageResp.ok) break;
          const pageHtml = await pageResp.text();
          const pageSchedule = ScheduleParser.parseFromHTML(pageHtml, '');
          if (pageSchedule.entries.length === 0) break;
          allEntries.push(...pageSchedule.entries);
          page++;
          // Safety limit
          if (page > 20) break;
        }
      }

      hideOverlayStatus();

      SmartSchoolConfig.log(`Total entries fetched: ${allEntries.length}`);
      return {
        success: true,
        entries: allEntries,
        teacherName: user.name,
        teacherId: user.teacherId,
      };
    } catch (err) {
      hideOverlayStatus();
      SmartSchoolConfig.error('Fetch month schedule failed:', err);
      return { error: err.message };
    }
  }

  /* ========== Fetch Lesson Details (topics) for filtered entries ========== */

  /**
   * Receives a list of filtered entries, fetches their lesson details (topic),
   * and returns the entries with topics populated.
   */
  async function handleFetchLessonDetails(payload) {
    const { entries } = payload;
    if (!entries || entries.length === 0) {
      return { entries: [], error: 'Немає занять для завантаження деталей.' };
    }

    showOverlayStatus(`Завантаження тем занять (0/${entries.length})…`);
    await fetchLessonDetails(entries, (done, total) => {
      showOverlayStatus(`Завантаження тем занять (${done}/${total})…`);
    });
    hideOverlayStatus();

    SmartSchoolConfig.log(`Fetched details for ${entries.length} entries.`);
    return { success: true, entries };
  }

  /* ========== Find Slots for Specific Lessons ========== */

  /**
   * For each checked lesson, find the closest available (free) slot
   * for that group on the same week.
   *
   * Strategy: for each lesson entry, look at the same week's dates
   * and find a pair slot where neither the teacher nor that group
   * has anything scheduled.
   */
  async function handleFindSlotsForLessons(payload) {
    const { lessons, allTeacherEntries } = payload;
    if (!lessons || lessons.length === 0) {
      return { error: 'Немає обраних занять.' };
    }

    showOverlayStatus('Пошук вільних пар…');

    try {
      // Get current user
      const user = extractCurrentUser();
      if (!user.teacherId) {
        hideOverlayStatus();
        return { error: 'Не вдалося визначити ID викладача.' };
      }

      // Collect unique groups from the selected lessons
      const uniqueGroups = [...new Set(lessons.map((l) => l.group))];

      // Determine full date range from the lessons
      const dates = lessons.map((l) => l.date).filter(Boolean).sort();
      if (dates.length === 0) {
        hideOverlayStatus();
        return { error: 'Немає дат в обраних заняттях.' };
      }

      const minDate = dates[0];
      // Extend by 7 days so fetched data covers the next-week fallback window
      const maxDateExtended = (() => {
        const d = new Date(dates[dates.length - 1]);
        d.setDate(d.getDate() + 7);
        return SmartSchoolConfig.formatDate(d);
      })();

      // Fetch group list once — used to resolve group name → ID for all groups
      const filters = await fetchFiltersFromLessonPage();

      const groupSchedules = {};
      for (const groupName of uniqueGroups) {
        showOverlayStatus(`Завантаження розкладу групи "${groupName}"…`);
        const groupOption = (filters.groups || []).find((g) => g.name === groupName);
        if (groupOption) {
          groupSchedules[groupName] = await fetchAndParseSchedule({
            klassId: groupOption.id,
            dateFrom: minDate,
            dateTo: maxDateExtended,
          });
        }
      }

      const results = new SlotFinder({
        lessons,
        teacherEntries: allTeacherEntries || [],
        groupSchedules,
      }).findSlots();

      hideOverlayStatus();

      // Format output text
      const lines = results.map((r) => {
        const l = r.lesson;
        const s = r.slot;
        const topicStr = l.topic ? ` | ${l.topic}` : '';
        const lessonStr = `${l.date} ${l.pairNumber} пара | ${l.group} | ${l.subject}${topicStr}`;
        const slotStr = s
          ? `→ ${s.date} (${s.dayName}) ${s.pairNumber} пара`
          : '→ вільних пар не знайдено';
        return `${lessonStr}\n  ${slotStr}`;
      });

      return {
        success: true,
        text: lines.join('\n\n'),
        slotCount: results.filter((r) => r.slot).length,
        results,
      };
    } catch (err) {
      hideOverlayStatus();
      SmartSchoolConfig.error('Find slots error:', err);
      return { error: err.message };
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
