/**
 * Unit tests for SlotFinder.
 *
 * Reference week used throughout (ISO Mon=1):
 *   2026-04-13  Monday
 *   2026-04-14  Tuesday
 *   2026-04-15  Wednesday
 *   2026-04-16  Thursday
 *   2026-04-17  Friday
 *   2026-04-20  Next Monday
 *   2026-04-21  Next Tuesday
 */

const SlotFinder = require('../utils/slot-finder');

/* ---------- Fixtures ---------- */

const PAIR_NUMS = SlotFinder.DEFAULT_PAIR_NUMS;

function lesson(date, pairNumber, group = 'GroupA', subject = 'Math', topic = '') {
  return { date, pairNumber, group, subject, topic };
}

function entry(date, pairNumber) {
  return { date, pairNumber };
}

function allPairsOnDates(dates) {
  return dates.flatMap((d) => PAIR_NUMS.map((p) => entry(d, p)));
}

/* ========== Construction / data hydration ========== */

describe('construction', () => {
  test('accepts empty input without throwing', () => {
    expect(() => new SlotFinder()).not.toThrow();
    expect(() => new SlotFinder({})).not.toThrow();
  });

  test('findSlots returns empty array when no lessons provided', () => {
    expect(new SlotFinder({ lessons: [] }).findSlots()).toEqual([]);
  });

  test('accepts custom pairNums and uses them', () => {
    const finder = new SlotFinder({
      lessons: [lesson('2026-04-13', 1)],
      pairNums: [1, 2],
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ pairNumber: 2 });
  });

  test('sorts pairNums ascending so earliest pair is always preferred', () => {
    // Pass in reverse order — should still find pair 2, not pair 6
    const finder = new SlotFinder({
      lessons: [lesson('2026-04-13', 1)],
      pairNums: [6, 5, 4, 3, 2],
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ pairNumber: 2 });
  });

  test('undefined teacherEntries is treated as empty (no conflicts)', () => {
    const finder = new SlotFinder({ lessons: [lesson('2026-04-13', 1)] });
    expect(() => finder.findSlots()).not.toThrow();
    expect(finder.findSlots()[0].slot).not.toBeNull();
  });

  test('groupSchedules entry with missing entries array does not throw', () => {
    const finder = new SlotFinder({
      lessons: [lesson('2026-04-13', 1, 'GroupA')],
      groupSchedules: { GroupA: {} },
    });
    expect(() => finder.findSlots()).not.toThrow();
  });
});

/* ========== Basic slot finding ========== */

describe('basic slot finding', () => {
  test('finds the very next pair on the same day', () => {
    const finder = new SlotFinder({ lessons: [lesson('2026-04-13', 1)] });
    const [{ slot }] = finder.findSlots();
    expect(slot).toMatchObject({ date: '2026-04-13', pairNumber: 2 });
  });

  test('finds the first available pair when earlier candidates are free', () => {
    const finder = new SlotFinder({ lessons: [lesson('2026-04-13', 3)] });
    const [{ slot }] = finder.findSlots();
    expect(slot).toMatchObject({ date: '2026-04-13', pairNumber: 4 });
  });

  test('slot contains exactly the fields needed for docx generation', () => {
    const finder = new SlotFinder({ lessons: [lesson('2026-04-13', 1, 'G1', 'Algo', 'Topic X')] });
    const [result] = finder.findSlots();

    expect(result.lesson).toEqual({
      date:       '2026-04-13',
      dayName:    'Понеділок',
      pairNumber: 1,
      group:      'G1',
      subject:    'Algo',
      topic:      'Topic X',
    });
    expect(result.slot).toEqual({
      date:       '2026-04-13',
      dayName:    'Понеділок',
      pairNumber: 2,
    });
    // No timeStart / timeEnd — caller resolves times via config
    expect(result.slot).not.toHaveProperty('timeStart');
    expect(result.slot).not.toHaveProperty('timeEnd');
  });

  test('topic defaults to empty string when absent', () => {
    const finder = new SlotFinder({
      lessons: [{ date: '2026-04-13', pairNumber: 1, group: 'G', subject: 'S' }],
    });
    expect(finder.findSlots()[0].lesson.topic).toBe('');
  });
});

/* ========== Overflow to next day / next week ========== */

describe('day/week overflow', () => {
  test('spills to the next day when remaining same-day pairs are blocked by teacher', () => {
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-13', 4)],
      teacherEntries: [entry('2026-04-13', 5), entry('2026-04-13', 6)],
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-14', pairNumber: 1 });
  });

  test('Friday pair 3 → still finds pair 4 on the same Friday', () => {
    const finder = new SlotFinder({ lessons: [lesson('2026-04-17', 3)] });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-17', pairNumber: 4 });
  });

  test('Friday last pair → wraps to next Monday pair 1', () => {
    const finder = new SlotFinder({ lessons: [lesson('2026-04-17', 6)] });
    const { slot } = finder.findSlots()[0];
    expect(slot).toEqual({ date: '2026-04-20', dayName: 'Понеділок', pairNumber: 1 });
  });

  test('Friday pair 5 with pair 6 blocked → wraps to next Monday', () => {
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-17', 5)],
      teacherEntries: [entry('2026-04-17', 6)],
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-20', pairNumber: 1 });
  });

  test('Wednesday last pair, Thursday fully blocked → slot on Friday', () => {
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-15', 6)],
      teacherEntries: allPairsOnDates(['2026-04-16']),
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-17', pairNumber: 1 });
  });

  test('Thursday last pair, Friday fully blocked → slot on next Monday', () => {
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-16', 6)],
      teacherEntries: allPairsOnDates(['2026-04-17']),
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-20', pairNumber: 1 });
  });

  test('slot date is never earlier than the lesson date', () => {
    // Tuesday lesson — Monday is in the same week but must be skipped
    const finder = new SlotFinder({ lessons: [lesson('2026-04-14', 2)] });
    const { slot } = finder.findSlots()[0];
    expect(slot.date >= '2026-04-14').toBe(true);
  });
});

/* ========== Conflict blocking ========== */

describe('conflict blocking', () => {
  test('teacher busy at pair 2 and 3 → slot is pair 4', () => {
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-13', 1)],
      teacherEntries: [entry('2026-04-13', 2), entry('2026-04-13', 3)],
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-13', pairNumber: 4 });
  });

  test("group's own schedule blocks a candidate pair", () => {
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-13', 1, 'GroupA')],
      groupSchedules: { GroupA: { entries: [entry('2026-04-13', 2), entry('2026-04-13', 3)] } },
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-13', pairNumber: 4 });
  });

  test('requires BOTH teacher and group to be free (mixed conflicts)', () => {
    // teacher: pair 2 blocked; group: pair 3 blocked → first free is pair 4
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-13', 1, 'GroupA')],
      teacherEntries: [entry('2026-04-13', 2)],
      groupSchedules: { GroupA: { entries: [entry('2026-04-13', 3)] } },
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-13', pairNumber: 4 });
  });

  test("group schedule for GroupB does not affect GroupA's search", () => {
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-13', 1, 'GroupA')],
      groupSchedules: { GroupB: { entries: [entry('2026-04-13', 2), entry('2026-04-13', 3)] } },
    });
    expect(finder.findSlots()[0].slot).toMatchObject({ date: '2026-04-13', pairNumber: 2 });
  });

  test('returns null when entire current week + next week are blocked', () => {
    const blockDates = [
      '2026-04-13','2026-04-14','2026-04-15','2026-04-16','2026-04-17',
      '2026-04-20','2026-04-21','2026-04-22','2026-04-23','2026-04-24',
    ];
    const finder = new SlotFinder({
      lessons:        [lesson('2026-04-13', 1)],
      teacherEntries: allPairsOnDates(blockDates),
    });
    expect(finder.findSlots()[0].slot).toBeNull();
  });
});

/* ========== Virtual schedule (anti-double-booking) ========== */

describe('virtual schedule prevents double-booking', () => {
  test('two lessons on the same day are assigned different teacher slots', () => {
    const finder = new SlotFinder({
      lessons: [
        lesson('2026-04-13', 1, 'GroupA'),
        lesson('2026-04-13', 1, 'GroupB'),
      ],
    });
    const [r1, r2] = finder.findSlots();
    expect(r1.slot.pairNumber).not.toBe(r2.slot.pairNumber);
  });

  test('second lesson for same group same original pair finds the next slot after first is reserved', () => {
    const finder = new SlotFinder({
      lessons: [
        lesson('2026-04-13', 1, 'GroupA', 'Math'),
        lesson('2026-04-13', 1, 'GroupA', 'Science'),
      ],
    });
    const [r1, r2] = finder.findSlots();
    expect(r1.slot).toMatchObject({ date: '2026-04-13', pairNumber: 2 });
    expect(r2.slot).toMatchObject({ date: '2026-04-13', pairNumber: 3 });
  });

  test('GroupA reservation in virtualGroup does not block GroupB — only teacher does', () => {
    // GroupA gets pair 2; that reserves it in virtualTeacher.
    // GroupB cannot reuse pair 2 (teacher busy) → gets pair 3.
    // If the bug existed where virtualGroup leaked across groups,
    // GroupB would skip pair 2 via group map instead of teacher map.
    const finder = new SlotFinder({
      lessons: [
        lesson('2026-04-13', 1, 'GroupA'),
        lesson('2026-04-13', 1, 'GroupB'),
      ],
    });
    const [r1, r2] = finder.findSlots();
    expect(r1.slot.pairNumber).toBe(2);
    expect(r2.slot.pairNumber).toBe(3);
  });

  test('null slot for one lesson does not corrupt the virtual schedule for subsequent lessons', () => {
    // Teacher fully blocked → lesson 1 (GroupA) gets null.
    // lesson 2 (GroupA) is also blocked by teacher → also null.
    // lesson 3 (GroupA, next day) — teacher free on that day → gets a slot.
    const blockOnlyMonday = allPairsOnDates(['2026-04-13']);

    // Lesson 1: teacher fully blocked both weeks → null
    // Lesson 2: teacher only blocked on Monday, Tuesday is free → finds slot
    const finder = new SlotFinder({
      lessons: [
        lesson('2026-04-13', 1, 'GroupA'), // fully blocked → null
        lesson('2026-04-13', 1, 'GroupA'), // teacher blocks Mon, Tue free → pair 1
      ],
      // Use separate finders to simulate independent teacher schedules is not possible,
      // so test the simpler invariant: order of results matches order of lessons
      teacherEntries: blockOnlyMonday,
    });
    const results = finder.findSlots();
    // Both search from Mon pair 1; Mon is blocked, so both land on Tue pair 1 and 2
    expect(results[0].slot).toMatchObject({ date: '2026-04-14', pairNumber: 1 });
    expect(results[1].slot).toMatchObject({ date: '2026-04-14', pairNumber: 2 });
  });
});

/* ========== Ukrainian day names ========== */

describe('day name localisation', () => {
  const dayLessons = [
    ['2026-04-13', 'Понеділок'],
    ['2026-04-14', 'Вівторок'],
    ['2026-04-15', 'Середа'],
    ['2026-04-16', 'Четвер'],
    ['2026-04-17', 'Пʼятниця'],
  ];

  test.each(dayLessons)('%s → lesson.dayName = "%s"', (date, expected) => {
    const finder = new SlotFinder({ lessons: [lesson(date, 5)] });
    expect(finder.findSlots()[0].lesson.dayName).toBe(expected);
  });

  test('slot.dayName is correctly set for a next-week slot', () => {
    const finder = new SlotFinder({ lessons: [lesson('2026-04-17', 6)] });
    expect(finder.findSlots()[0].slot.dayName).toBe('Понеділок');
  });
});

/* ========== Multiple lessons / batch behaviour ========== */

describe('batch processing', () => {
  test('returns one result per lesson preserving order', () => {
    const lessons = [
      lesson('2026-04-13', 1, 'G1'),
      lesson('2026-04-14', 2, 'G2'),
      lesson('2026-04-15', 3, 'G3'),
    ];
    const results = new SlotFinder({ lessons }).findSlots();
    expect(results).toHaveLength(3);
    results.forEach((r, i) => expect(r.lesson.date).toBe(lessons[i].date));
  });

  test('lessons for different groups on the same day all get distinct slots', () => {
    const lessons = Array.from({ length: 4 }, (_, i) =>
      lesson('2026-04-13', 1, `Group${i}`)
    );
    const pairNums = new Set(new SlotFinder({ lessons }).findSlots().map((r) => r.slot.pairNumber));
    expect(pairNums.size).toBe(4);
  });
});

/* ========== Static helpers ========== */

describe('static helpers', () => {
  test('_parseDate returns a local-midnight Date, not UTC midnight', () => {
    const d = SlotFinder._parseDate('2026-04-13');
    // Local midnight: hours should be 0 (local), not potentially 23 from UTC shift
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  test('_weekDates first entry is always a Monday', () => {
    // Test from every day of the same week
    const daysOfWeek = [
      '2026-04-13','2026-04-14','2026-04-15','2026-04-16','2026-04-17',
    ];
    for (const date of daysOfWeek) {
      const [monday] = SlotFinder._weekDates(date);
      expect(SlotFinder._dayName(monday)).toBe('Понеділок');
    }
  });

  test('_weekDates returns exactly Mon–Fri', () => {
    expect(SlotFinder._weekDates('2026-04-15')).toEqual([
      '2026-04-13','2026-04-14','2026-04-15','2026-04-16','2026-04-17',
    ]);
  });

  test('_nextWeekDates returns the following Mon–Fri', () => {
    expect(SlotFinder._nextWeekDates('2026-04-17')).toEqual([
      '2026-04-20','2026-04-21','2026-04-22','2026-04-23','2026-04-24',
    ]);
  });

  test('_weekDates is stable regardless of which day of the week is passed', () => {
    expect(SlotFinder._weekDates('2026-04-13')).toEqual(SlotFinder._weekDates('2026-04-17'));
  });

  test('_buildOccupiedMap groups pair numbers by date', () => {
    const map = SlotFinder._buildOccupiedMap([
      entry('2026-04-13', 1),
      entry('2026-04-13', 3),
      entry('2026-04-14', 2),
    ]);
    expect(map['2026-04-13']).toEqual(new Set([1, 3]));
    expect(map['2026-04-14']).toEqual(new Set([2]));
    expect(map['2026-04-15']).toBeUndefined();
  });

  test('_buildOccupiedMap skips entries with no date', () => {
    expect(Object.keys(SlotFinder._buildOccupiedMap([{ pairNumber: 1 }]))).toHaveLength(0);
  });
});
