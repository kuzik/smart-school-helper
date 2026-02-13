/**
 * Smart School Helper — Schedule Comparator
 *
 * Compares two parsed schedules (teacher's group vs. target group)
 * to find free time slots available for both.
 */

const ScheduleComparator = (() => {

  /**
   * Find free slots where BOTH groups have no lessons scheduled.
   *
   * @param {object} mySchedule     — parsed schedule (from ScheduleParser)
   * @param {object} targetSchedule — parsed schedule of the target group
   * @param {string} dateFrom       — start date (YYYY-MM-DD)
   * @param {string} dateTo         — end date (YYYY-MM-DD)
   * @returns {Array<object>} array of free slot objects
   */
  function findFreeSlots(mySchedule, targetSchedule, dateFrom, dateTo) {
    SmartSchoolConfig.log('Comparing schedules…');

    // Build occupied maps: { 'YYYY-MM-DD': Set<pairNumber> }
    const myOccupied = buildOccupiedMap(mySchedule.entries);
    const targetOccupied = buildOccupiedMap(targetSchedule.entries);

    // Generate all weekday dates in the range
    const allDates = SmartSchoolConfig.dateRange(dateFrom, dateTo, true);

    const freeSlots = [];

    for (const date of allDates) {
      const myBusy = myOccupied[date] || new Set();
      const targetBusy = targetOccupied[date] || new Set();

      for (const pair of SmartSchoolConfig.PAIR_TIMES) {
        // Both groups must be free for this pair
        if (!myBusy.has(pair.number) && !targetBusy.has(pair.number)) {
          freeSlots.push({
            date,
            dateUA: SmartSchoolConfig.formatDateUA(date),
            dayName: SmartSchoolConfig.getDayName(date),
            pairNumber: pair.number,
            timeStart: pair.start,
            timeEnd: pair.end,
          });
        }
      }
    }

    SmartSchoolConfig.log(`Found ${freeSlots.length} free slots.`);
    return freeSlots;
  }

  /**
   * From the list of all free slots, pick the FIRST available slot
   * for each week (or each specified interval).
   *
   * @param {Array} freeSlots — from findFreeSlots()
   * @param {string} strategy — 'first-per-week' | 'first-per-month' | 'all'
   * @returns {Array<object>} suggested slots
   */
  function suggestSlots(freeSlots, strategy = 'first-per-week') {
    if (strategy === 'all') return freeSlots;

    const grouped = {};

    for (const slot of freeSlots) {
      let key;
      if (strategy === 'first-per-week') {
        key = getISOWeek(slot.date);
      } else if (strategy === 'first-per-month') {
        key = slot.date.substring(0, 7); // YYYY-MM
      }

      if (!grouped[key]) {
        grouped[key] = slot;
      }
    }

    return Object.values(grouped);
  }

  /**
   * Get a human-readable comparison summary.
   */
  function getSummary(mySchedule, targetSchedule, freeSlots) {
    return {
      myGroup: mySchedule.groupName || mySchedule.groupId,
      targetGroup: targetSchedule.groupName || targetSchedule.groupId,
      myTotalLessons: mySchedule.entries.length,
      targetTotalLessons: targetSchedule.entries.length,
      totalFreeSlots: freeSlots.length,
    };
  }

  /* ---------- Internal Helpers ---------- */

  /**
   * Build a map: date -> Set of occupied pair numbers.
   */
  function buildOccupiedMap(entries) {
    const map = {};
    for (const entry of entries) {
      if (!map[entry.date]) {
        map[entry.date] = new Set();
      }
      map[entry.date].add(entry.pairNumber);
    }
    return map;
  }

  /**
   * Get ISO week string for grouping: "YYYY-Www"
   */
  function getISOWeek(dateStr) {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    // Thursday of current week determines the year
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNo = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  /* ---------- Public API ---------- */

  return {
    findFreeSlots,
    suggestSlots,
    getSummary,
  };
})();
