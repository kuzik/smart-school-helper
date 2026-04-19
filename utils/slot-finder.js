/**
 * SlotFinder — pure business logic for scheduling subgroup practical lessons.
 *
 * Zero dependencies on DOM, fetch, or chrome.* APIs.
 * Hydrate via constructor with plain data; call findSlots() for docx-ready results.
 *
 * Slot results carry only { date, dayName, pairNumber }.
 * Time lookup (start/end) is the caller's responsibility via the config layer.
 */
class SlotFinder {
  /**
   * @param {object} params
   * @param {Array}  params.lessons          — [{date, pairNumber, group, subject, topic?}]
   * @param {Array}  [params.teacherEntries] — [{date, pairNumber, ...}] full teacher schedule
   * @param {object} [params.groupSchedules] — { groupName: { entries: [{date, pairNumber}] } }
   * @param {Array}  [params.pairNums]       — pair numbers in any order, e.g. [1,2,3,4,5,6]
   *                                           injectable for testing
   */
  constructor({ lessons = [], teacherEntries = [], groupSchedules = {}, pairNums } = {}) {
    this._lessons = lessons;
    // Sort ascending so we always pick the earliest available pair
    this._pairNums = [...(pairNums || SlotFinder.DEFAULT_PAIR_NUMS)].sort((a, b) => a - b);

    this._teacherOccupied = SlotFinder._buildOccupiedMap(teacherEntries);

    this._groupOccupied = {};
    for (const [name, schedule] of Object.entries(groupSchedules)) {
      this._groupOccupied[name] = SlotFinder._buildOccupiedMap(schedule.entries || []);
    }
  }

  /**
   * Find the next available slot for each lesson.
   *
   * Searches the lesson's own week first, then the following week.
   * Callers should ensure fetched schedule data covers at least lesson-week + 1.
   *
   * A virtual schedule tracks slots reserved during this run so the same
   * teacher / group combination is never double-booked across iterations.
   *
   * @returns {Array<{lesson: object, slot: {date, dayName, pairNumber}|null}>}
   */
  findSlots() {
    const virtualTeacher = {};   // { 'YYYY-MM-DD': Set<pairNumber> }
    const virtualGroup   = {};   // { groupName: { 'YYYY-MM-DD': Set<pairNumber> } }
    const results        = [];

    for (const lesson of this._lessons) {
      if (!virtualGroup[lesson.group]) virtualGroup[lesson.group] = {};

      const searchDates = [
        ...SlotFinder._weekDates(lesson.date),
        ...SlotFinder._nextWeekDates(lesson.date),
      ];

      const groupOccupied = this._groupOccupied[lesson.group] || {};

      let found = null;
      outer:
      for (const d of searchDates) {
        if (d < lesson.date) continue;

        const teacherBusy  = this._teacherOccupied[d]       || new Set();
        const groupDayBusy = groupOccupied[d]                || new Set();
        const vTeacherBusy = virtualTeacher[d]               || new Set();
        const vGroupBusy   = virtualGroup[lesson.group][d]   || new Set();

        for (const pairNum of this._pairNums) {
          if (d === lesson.date && pairNum <= lesson.pairNumber) continue;

          if (
            !teacherBusy.has(pairNum)  &&
            !groupDayBusy.has(pairNum) &&
            !vTeacherBusy.has(pairNum) &&
            !vGroupBusy.has(pairNum)
          ) {
            found = { date: d, dayName: SlotFinder._dayName(d), pairNumber: pairNum };
            break outer;
          }
        }
      }

      if (found) {
        if (!virtualTeacher[found.date]) virtualTeacher[found.date] = new Set();
        virtualTeacher[found.date].add(found.pairNumber);

        if (!virtualGroup[lesson.group][found.date]) {
          virtualGroup[lesson.group][found.date] = new Set();
        }
        virtualGroup[lesson.group][found.date].add(found.pairNumber);
      }

      results.push({
        lesson: {
          date:       lesson.date,
          dayName:    lesson.date ? SlotFinder._dayName(lesson.date) : '',
          pairNumber: lesson.pairNumber,
          group:      lesson.group,
          subject:    lesson.subject,
          topic:      lesson.topic || '',
        },
        slot: found,
      });
    }

    return results;
  }

  /* ---------- Static helpers (pure, no side-effects) ---------- */

  static _buildOccupiedMap(entries) {
    const map = {};
    for (const entry of entries) {
      if (!entry.date) continue;
      if (!map[entry.date]) map[entry.date] = new Set();
      map[entry.date].add(entry.pairNumber);
    }
    return map;
  }

  // Parse YYYY-MM-DD as local midnight to avoid UTC-shift on getDay()
  static _parseDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  static _formatDate(d) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }

  static _dayName(dateStr) {
    return SlotFinder.DAY_NAMES[SlotFinder._parseDate(dateStr).getDay()] || '';
  }

  // Mon–Fri starting from an already-computed monday Date
  static _datesFromMonday(monday) {
    return Array.from({ length: 5 }, (_, i) => {
      const c = new Date(monday);
      c.setDate(monday.getDate() + i);
      return SlotFinder._formatDate(c);
    });
  }

  static _weekDates(dateStr) {
    const d = SlotFinder._parseDate(dateStr);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return SlotFinder._datesFromMonday(d);
  }

  static _nextWeekDates(dateStr) {
    const d = SlotFinder._parseDate(dateStr);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7);
    return SlotFinder._datesFromMonday(d);
  }
}

SlotFinder.DAY_NAMES = Object.freeze({
  1: 'Понеділок',
  2: 'Вівторок',
  3: 'Середа',
  4: 'Четвер',
  5: 'Пʼятниця',
});

SlotFinder.DEFAULT_PAIR_NUMS = Object.freeze([1, 2, 3, 4, 5, 6]);

// Universal export: works as a browser content-script global AND as a Node.js module
if (typeof module !== 'undefined') module.exports = SlotFinder;
