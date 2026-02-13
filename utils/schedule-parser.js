/**
 * Smart School Helper — Schedule Parser
 *
 * Extracts schedule data from the Smart School admin lesson/index page.
 * The site uses Yii2 + Kartik GridView (krajee/yii2-grid).
 *
 * Actual DOM structure (from view-source):
 *   Table: <table class="kv-grid-table table table-hover table-bordered table-striped ...">
 *   Headers: <thead><tr class="kartik-sheet-style">
 *     <th data-col-seq="0"> <a data-sort="LESSON_DATE">Дата заняття</a>
 *     <th data-col-seq="1"> <a data-sort="LESSON_NUM">Номер заняття</a>
 *     <th data-col-seq="2"> <a data-sort="KLASS_ID">Група</a>
 *     <th data-col-seq="3"> <a data-sort="PREDMET_ID">Предмет</a>
 *     <th data-col-seq="4"> <a data-sort="TEACHER_ID">Вчитель</a>
 *     <th data-col-seq="5"> <a data-sort="KABINET_ID">Кабінет</a>
 *     <th data-col-seq="actionc">Дії          (skip)
 *     <th data-col-seq="6">  Expand icon   (skip)
 *
 *   Body rows: <tbody><tr data-key="48423">
 *     <td data-col-seq="0"> "понеділок 09 лютого 2026"
 *     <td data-col-seq="1"> <strong>1й урок</strong><br><sub>09.02.2026</sub>...
 *     <td data-col-seq="2"> "16кб (2025)"
 *     <td data-col-seq="3"> "Інформатика"
 *     <td data-col-seq="4"> "Кузьо Андрій Тарасович"
 *     <td data-col-seq="5"> "106. Лабораторія ..." or "Кабінет не заданий"
 *
 *   Filter selects (inside <thead> filter row):
 *     #lessonsearch-klass_id     name="LessonSearch[KLASS_ID][]"  (multi-select)
 *     #lessonsearch-predmet_id   name="LessonSearch[PREDMET_ID]"
 *     #lessonsearch-teacher_id   name="LessonSearch[TEACHER_ID]"
 *     #lessonsearch-kabinet_id   name="LessonSearch[KABINET_ID]"
 *     #lessonsearch-lesson_num   name="LessonSearch[LESSON_NUM]"
 *
 * Output normalized schedule:
 * {
 *   groupId: string,
 *   groupName: string,
 *   entries: [
 *     { date, dayName, pairNumber, timeStart, timeEnd, subject,
 *       teacher, room, group, lessonId }
 *   ]
 * }
 */

const ScheduleParser = (() => {

  /**
   * Ukrainian month names for parsing "понеділок 09 лютого 2026".
   */
  const UA_MONTHS = {
    'січня': '01', 'лютого': '02', 'березня': '03', 'квітня': '04',
    'травня': '05', 'червня': '06', 'липня': '07', 'серпня': '08',
    'вересня': '09', 'жовтня': '10', 'листопада': '11', 'грудня': '12',
  };

  /* ========== Main API ========== */

  /**
   * Parse the lesson table currently visible on the page.
   */
  function parseVisibleSchedule(groupId) {
    SmartSchoolConfig.log('Parsing visible schedule for group:', groupId);
    return parseScheduleFromRoot(document, groupId);
  }

  /**
   * Parse from fetched HTML string.
   */
  function parseFromHTML(html, groupId) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return parseScheduleFromRoot(doc, groupId);
  }

  /* ========== Core Parser ========== */

  /**
   * Parse from any document root (live DOM or DOMParser result).
   */
  function parseScheduleFromRoot(root, groupId) {
    const schedule = { groupId, groupName: '', entries: [] };

    // Find the Kartik kv-grid-table
    const table = root.querySelector('table.kv-grid-table');
    if (!table) {
      SmartSchoolConfig.warn('kv-grid-table not found, trying fallback selectors...');
      const fallback = root.querySelector(
        'table.table-striped, table.table-bordered, table'
      );
      if (!fallback) {
        SmartSchoolConfig.warn('No table found in DOM at all.');
        return schedule;
      }
      return parseGenericTable(fallback, groupId);
    }

    // Parse <tbody> rows — each <tr> has data-key="LESSON_ID"
    const tbody = table.querySelector('tbody');
    if (!tbody) {
      SmartSchoolConfig.warn('No <tbody> found.');
      return schedule;
    }

    const rows = tbody.querySelectorAll('tr[data-key]');
    SmartSchoolConfig.log(`Found ${rows.length} data rows.`);

    rows.forEach((row) => {
      const lessonId = row.getAttribute('data-key') || '';

      // Use data-col-seq attributes to reliably find the right cell
      const cellDate     = row.querySelector('td[data-col-seq="0"]');
      const cellLessonNum = row.querySelector('td[data-col-seq="1"]');
      const cellGroup    = row.querySelector('td[data-col-seq="2"]');
      const cellSubject  = row.querySelector('td[data-col-seq="3"]');
      const cellTeacher  = row.querySelector('td[data-col-seq="4"]');
      const cellRoom     = row.querySelector('td[data-col-seq="5"]');

      // --- Parse date ---
      // Cell text: "понеділок 09 лютого 2026"
      const dateText = cellDate?.textContent?.trim() || '';
      const dateISO = parseDateFromText(dateText);

      // --- Parse lesson number ---
      // Cell contains: <strong>1й урок</strong><br><sub>09.02.2026</sub>...
      const lessonNumText = cellLessonNum?.textContent?.trim() || '';
      const pairNumber = parseLessonNumber(lessonNumText);

      // Also extract date from the <sub> inside lesson num cell as backup
      const subEl = cellLessonNum?.querySelector('sub');
      const subDateText = subEl?.textContent?.trim() || '';
      const backupDate = parseDateFromText(subDateText);
      const finalDate = dateISO || backupDate || '';

      const pairInfo = SmartSchoolConfig.getPairByNumber(pairNumber);

      const groupText = cellGroup?.textContent?.trim() || '';
      const subjectText = cellSubject?.textContent?.trim() || '';
      const teacherText = cellTeacher?.textContent?.trim() || '';
      const roomText = cellRoom?.textContent?.trim() || '';

      schedule.entries.push({
        date: finalDate,
        dayName: finalDate ? SmartSchoolConfig.getDayName(finalDate) : '',
        pairNumber,
        timeStart: pairInfo?.start || '',
        timeEnd: pairInfo?.end || '',
        subject: subjectText,
        teacher: teacherText,
        room: roomText,
        group: groupText,
        type: '',  // not a separate column in this view
        lessonId,
      });
    });

    // Set group name from the first matching entry
    if (groupId) {
      const matchingEntry = schedule.entries.find((e) => e.group);
      if (matchingEntry) schedule.groupName = matchingEntry.group;
    }

    // Also parse pagination summary for total count
    const summary = root.querySelector('.summary');
    if (summary) {
      SmartSchoolConfig.log('Grid summary:', summary.textContent.trim());
    }

    SmartSchoolConfig.log(`Parsed ${schedule.entries.length} entries for group ${groupId}.`);
    return schedule;
  }

  /**
   * Fallback: generic table parser for non-Kartik tables.
   */
  function parseGenericTable(table, groupId) {
    const schedule = { groupId, groupName: '', entries: [] };
    const rows = table.querySelectorAll('tbody tr, tr');

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return;

      const dateISO = parseDateFromText(cells[0]?.textContent?.trim() || '');
      const pairNumber = parseLessonNumber(cells[1]?.textContent?.trim() || '');
      const pairInfo = SmartSchoolConfig.getPairByNumber(pairNumber);

      schedule.entries.push({
        date: dateISO || '',
        dayName: dateISO ? SmartSchoolConfig.getDayName(dateISO) : '',
        pairNumber,
        timeStart: pairInfo?.start || '',
        timeEnd: pairInfo?.end || '',
        group: cells[2]?.textContent?.trim() || '',
        subject: cells[3]?.textContent?.trim() || '',
        teacher: cells[4]?.textContent?.trim() || '',
        room: cells[5]?.textContent?.trim() || '',
        type: '',
        lessonId: row.getAttribute('data-key') || '',
      });
    });

    return schedule;
  }

  /* ========== Date Parsing ========== */

  /**
   * Parse various Ukrainian date formats:
   *   "понеділок 09 лютого 2026"  → "2026-02-09"
   *   "09.02.2026"                → "2026-02-09"
   *   "2026-02-09"                → "2026-02-09"
   */
  function parseDateFromText(text) {
    if (!text) return null;

    // 1) ISO: YYYY-MM-DD
    const matchISO = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (matchISO) return matchISO[0];

    // 2) DD.MM.YYYY
    const matchDMY = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (matchDMY) {
      return `${matchDMY[3]}-${matchDMY[2]}-${matchDMY[1]}`;
    }

    // 3) Ukrainian natural: "понеділок 09 лютого 2026" or "09 лютого 2026"
    const matchUA = text.match(/(\d{1,2})\s+([\u0400-\u04FF]+)\s+(\d{4})/);
    if (matchUA) {
      const day = matchUA[1].padStart(2, '0');
      const monthName = matchUA[2].toLowerCase();
      const year = matchUA[3];
      const month = UA_MONTHS[monthName];
      if (month) return `${year}-${month}-${day}`;
    }

    return null;
  }

  /**
   * Extract lesson/pair number from text like:
   *   "1й урок\n09.02.2026\n\nІнформатика\n16кб (2025)\nКількість годин: 2"
   *   → 1
   */
  function parseLessonNumber(text) {
    // Match "Xй урок" or just a leading number
    const match = text.match(/(\d+)\s*й?\s*урок/i);
    if (match) return parseInt(match[1], 10);

    // Fallback: first number in the text
    const numMatch = text.match(/^(\d+)/);
    if (numMatch) return parseInt(numMatch[1], 10);

    return 0;
  }

  /* ========== Filter Extraction ========== */

  /**
   * Extract groups from #lessonsearch-klass_id select.
   * Returns [{ id, name }]
   */
  function parseGroupList(root) {
    return parseSelectById(root || document, 'lessonsearch-klass_id');
  }

  /**
   * Extract teachers from #lessonsearch-teacher_id select.
   */
  function parseTeacherList(root) {
    return parseSelectById(root || document, 'lessonsearch-teacher_id');
  }

  /**
   * Extract subjects from #lessonsearch-predmet_id select.
   */
  function parseSubjectList(root) {
    return parseSelectById(root || document, 'lessonsearch-predmet_id');
  }

  /**
   * Extract lesson numbers from #lessonsearch-lesson_num select.
   */
  function parseLessonNumList(root) {
    return parseSelectById(root || document, 'lessonsearch-lesson_num');
  }

  /**
   * Extract <option> values from a <select> by its ID.
   * Handles the real IDs: #lessonsearch-klass_id, #lessonsearch-teacher_id, etc.
   */
  function parseSelectById(root, selectId) {
    const items = [];
    const select = root.querySelector(`#${selectId}`);

    if (!select) {
      // Fallback: try name-based matching
      const nameKey = selectId.replace('lessonsearch-', '').toUpperCase();
      const selects = root.querySelectorAll(
        `select[name*="${nameKey}"]`
      );
      selects.forEach((sel) => extractOptions(sel, items));
    } else {
      extractOptions(select, items);
    }

    // Deduplicate
    const seen = new Set();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  /**
   * Extract options from a <select>, skipping placeholder options.
   */
  function extractOptions(select, items) {
    select.querySelectorAll('option').forEach((opt) => {
      // Skip empty/placeholder options
      if (!opt.value || opt.value === '') return;
      items.push({ id: opt.value, name: opt.textContent.trim() });
    });
  }

  /**
   * Parse the pagination summary to get total record count.
   * Text: "Показані 1-11 із 11 записів."
   */
  function parseTotalRecords(root) {
    const summary = (root || document).querySelector('.summary');
    if (!summary) return null;
    const match = summary.textContent.match(/із\s+(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /* ========== Public API ========== */

  return {
    parseVisibleSchedule,
    parseFromHTML,
    parseScheduleFromRoot,
    parseGroupList,
    parseTeacherList,
    parseSubjectList,
    parseLessonNumList,
    parseSelectById,
    parseDateFromText,
    parseLessonNumber,
    parseTotalRecords,
  };
})();
