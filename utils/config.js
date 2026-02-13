/**
 * Smart School Helper — Config Utility
 *
 * Shared constants, pair (lesson) time slots, and helper functions
 * used across content scripts and utilities.
 */

const SmartSchoolConfig = (() => {
  /* ---------- Constants ---------- */

  const SITE_ORIGIN = 'https://admin-saceit.smart-school.com.ua';

  /**
   * Smart School lesson/index endpoint.
   * Uses Yii2-style GET parameters: LessonSearch[FIELD]
   */
  const LESSON_INDEX_PATH = '/index.php';
  const ROUTE = 'lesson/index';

  /**
   * LessonSearch GET parameter keys (as used by the site).
   */
  const SEARCH_PARAMS = {
    ROUTE:       'r',
    LESSON_DATE: 'LessonSearch[LESSON_DATE]',
    LESSON_NUM:  'LessonSearch[LESSON_NUM]',
    KLASS_ID:    'LessonSearch[KLASS_ID][]',   // array — group/class
    PREDMET_ID:  'LessonSearch[PREDMET_ID]',    // subject/discipline
    TEACHER_ID:  'LessonSearch[TEACHER_ID]',    // teacher
    KABINET_ID:  'LessonSearch[KABINET_ID]',    // room
    DATE_RANGE:  'LessonSearch[date_range]',
    START_DATE:  'LessonSearch[start_date]',
    END_DATE:    'LessonSearch[end_date]',
  };

  /**
   * Standard pair (lesson) time slots.
   * Adjust these to match the actual schedule on the site.
   */
  const PAIR_TIMES = [
    { number: 1, start: '08:00', end: '09:20' },
    { number: 2, start: '09:30', end: '10:50' },
    { number: 3, start: '11:10', end: '12:30' },
    { number: 4, start: '12:40', end: '14:00' },
    { number: 5, start: '14:10', end: '15:30' },
    { number: 6, start: '15:40', end: '17:00' },
    { number: 7, start: '17:10', end: '18:30' },
    { number: 8, start: '18:40', end: '20:00' },
  ];

  /**
   * Day name mapping (Ukrainian).
   */
  const DAY_NAMES = {
    0: 'Неділя',
    1: 'Понеділок',
    2: 'Вівторок',
    3: 'Середа',
    4: 'Четвер',
    5: 'Пʼятниця',
    6: 'Субота',
  };

  /* ---------- Helpers ---------- */

  /**
   * Format a Date as YYYY-MM-DD.
   */
  function formatDate(date) {
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Format a Date as DD.MM.YYYY (Ukrainian standard).
   */
  function formatDateUA(date) {
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  /**
   * Get the day name in Ukrainian for a given date.
   */
  function getDayName(date) {
    return DAY_NAMES[new Date(date).getDay()];
  }

  /**
   * Generate an array of dates (YYYY-MM-DD) between start and end (inclusive).
   * Optionally filter by weekdays only (skip Saturday/Sunday).
   */
  function dateRange(startDate, endDate, weekdaysOnly = true) {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const day = current.getDay();
      if (!weekdaysOnly || (day !== 0 && day !== 6)) {
        dates.push(formatDate(current));
      }
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  /**
   * Get pair info by number.
   */
  function getPairByNumber(num) {
    return PAIR_TIMES.find((p) => p.number === num) || null;
  }

  /**
   * Sleep utility for throttling requests.
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Log with extension prefix.
   */
  function log(...args) {
    console.log('[Smart School Helper]', ...args);
  }

  function warn(...args) {
    console.warn('[Smart School Helper]', ...args);
  }

  function error(...args) {
    console.error('[Smart School Helper]', ...args);
  }

  /**
   * Build a LessonSearch URL for the Smart School site.
   *
   * @param {object} params — filter options
   * @param {string} [params.klassId]    — group/class ID
   * @param {string} [params.teacherId]  — teacher ID
   * @param {string} [params.predmetId]  — subject/discipline ID
   * @param {string} [params.kabinetId]  — room/cabinet ID
   * @param {number} [params.lessonNum]  — pair number (1–8)
   * @param {string} [params.startDate]  — YYYY-MM-DD
   * @param {string} [params.endDate]    — YYYY-MM-DD
   * @returns {string} fully qualified URL
   */
  function buildLessonSearchURL(params = {}) {
    const url = new URL(LESSON_INDEX_PATH, SITE_ORIGIN);
    url.searchParams.set(SEARCH_PARAMS.ROUTE, ROUTE);

    // order_lesson=1 is required by the site to sort chronologically
    url.searchParams.set('order_lesson', '1');

    if (params.klassId) {
      url.searchParams.append(SEARCH_PARAMS.KLASS_ID, params.klassId);
    }
    if (params.teacherId) {
      url.searchParams.set(SEARCH_PARAMS.TEACHER_ID, params.teacherId);
    }
    if (params.predmetId) {
      url.searchParams.set(SEARCH_PARAMS.PREDMET_ID, params.predmetId);
    }
    if (params.kabinetId) {
      url.searchParams.set(SEARCH_PARAMS.KABINET_ID, params.kabinetId);
    }
    if (params.lessonNum) {
      url.searchParams.set(SEARCH_PARAMS.LESSON_NUM, params.lessonNum);
    }
    if (params.startDate && params.endDate) {
      url.searchParams.set(SEARCH_PARAMS.DATE_RANGE,
        `${params.startDate} - ${params.endDate}`);
      url.searchParams.set(SEARCH_PARAMS.START_DATE, params.startDate);
      url.searchParams.set(SEARCH_PARAMS.END_DATE, params.endDate);
    }

    return url.toString();
  }

  /* ---------- Public API ---------- */

  return {
    SITE_ORIGIN,
    LESSON_INDEX_PATH,
    ROUTE,
    SEARCH_PARAMS,
    PAIR_TIMES,
    DAY_NAMES,
    buildLessonSearchURL,
    formatDate,
    formatDateUA,
    getDayName,
    dateRange,
    getPairByNumber,
    sleep,
    log,
    warn,
    error,
  };
})();
