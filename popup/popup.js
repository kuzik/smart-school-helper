/**
 * Smart School Helper — Popup Script
 *
 * Report tab workflow:
 *  1. Select month → fetch all lectures for current user
 *  2. Populate multiselects: unique groups & unique subjects
 *  3. Apply filter → show lesson list with checkboxes
 *  4. For checked lessons → find closest available slots
 *  5. Print result in textarea
 */

document.addEventListener('DOMContentLoaded', init);

/* ========== State ========== */

let fetchedEntries = [];   // all schedule entries for the month
let filteredLessons = [];  // entries visible in the lesson list
let lastResults = [];      // results from findAvailableSlots
let lastTeacherName = '';  // teacher name from fetch

/* ========== Initialization ========== */

async function init() {
  setupTabs();
  prefillMonth();
  bindEvents();
}

/* ========== Tab Switching ========== */

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      contents.forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

/* ========== Pre-fill current month ========== */

function prefillMonth() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const sel = document.getElementById('report-month');
  if (sel) sel.value = mm;
}

/* ========== Event Binding ========== */

function bindEvents() {
  on('btn-fetch-month', 'click', fetchMonthSchedule);
  on('btn-apply-filters', 'click', applyFilters);
  on('btn-check-all', 'click', () => toggleAllLessons(true));
  on('btn-uncheck-all', 'click', () => toggleAllLessons(false));
  on('btn-find-available', 'click', findAvailableSlots);
  on('btn-copy-result', 'click', copyResult);
  on('btn-download-report', 'click', downloadReport);

  // Cascading reset: changing an earlier step hides all later steps
  document.getElementById('report-month')?.addEventListener('change', () => {
    resetFrom('filters');
  });
  document.getElementById('filter-groups')?.addEventListener('change', () => {
    resetFrom('lessons');
  });
  document.getElementById('filter-subjects')?.addEventListener('change', () => {
    resetFrom('lessons');
  });
  document.getElementById('lessons-list')?.addEventListener('change', () => {
    resetFrom('result');
  });
}

/**
 * Hide cards from a given step onward and clear their state.
 * Steps: 'filters' → 'lessons' → 'result'
 */
function resetFrom(step) {
  const steps = ['filters', 'lessons', 'result'];
  const idx = steps.indexOf(step);
  if (idx < 0) return;

  for (let i = idx; i < steps.length; i++) {
    const cardId = steps[i] === 'filters' ? 'filters-card'
      : steps[i] === 'lessons' ? 'lessons-card'
      : 'result-card';
    document.getElementById(cardId)?.classList.add('hidden');
  }

  if (idx <= 0) {
    // Reset filters step
    fetchedEntries = [];
    filteredLessons = [];
  }
  if (idx <= 1) {
    // Reset lessons step
    filteredLessons = [];
    const list = document.getElementById('lessons-list');
    if (list) list.innerHTML = '';
  }
  if (idx <= 2) {
    // Reset result step
    lastResults = [];
    const output = document.getElementById('result-output');
    if (output) output.value = '';
  }
}

/* ========== 1. Fetch month schedule ========== */

async function fetchMonthSchedule() {
  const btn = document.getElementById('btn-fetch-month');
  btn.disabled = true;
  btn.textContent = '⏳ Завантаження…';

  try {
    const month = getVal('report-month');
    const year = new Date().getFullYear();

    const result = await sendMessage('FETCH_MONTH_SCHEDULE', { month, year });

    if (!result || result.error) {
      showStatus(result?.error || 'Не вдалося завантажити розклад.', false);
      return;
    }

    fetchedEntries = result.entries || [];
    lastTeacherName = result.teacherName || '';

    if (fetchedEntries.length === 0) {
      showStatus('Занять за цей місяць не знайдено.', false);
      return;
    }

    // Extract unique groups and subjects
    const groups = uniqueBy(fetchedEntries, 'group');
    const subjects = uniqueBy(fetchedEntries, 'subject');

    populateMultiSelect('filter-groups', groups);
    populateMultiSelect('filter-subjects', subjects);

    document.getElementById('filters-card').classList.remove('hidden');
    document.getElementById('lessons-card').classList.add('hidden');
    document.getElementById('result-card').classList.add('hidden');

    showStatus(`Завантажено ${fetchedEntries.length} занять. Оберіть фільтри.`, true);
  } catch (err) {
    showStatus(`Помилка: ${err.message}`, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Завантажити розклад';
  }
}

/* ========== 2. Populate multiselect ========== */

function populateMultiSelect(id, items) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '';
  items.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.selected = true; // select all by default
    sel.appendChild(opt);
  });
}

/* ========== 3. Apply filters → show lessons ========== */

async function applyFilters() {
  const selGroups = getSelectedValues('filter-groups');
  const selSubjects = getSelectedValues('filter-subjects');

  filteredLessons = fetchedEntries.filter((e) =>
    selGroups.includes(e.group) && selSubjects.includes(e.subject)
  );

  if (filteredLessons.length === 0) {
    showStatus('Нічого не підходить під обрані фільтри.', false);
    document.getElementById('lessons-card').classList.add('hidden');
    return;
  }

  // Show lessons immediately (without topics yet)
  renderLessons(filteredLessons);
  document.getElementById('lessons-card').classList.remove('hidden');
  document.getElementById('result-card').classList.add('hidden');

  // Fetch details (topics) only for the filtered entries
  const needDetails = filteredLessons.filter((l) => l.lessonId && !l.topic);
  if (needDetails.length > 0) {
    showStatus(`Завантаження тем (${needDetails.length})…`, true);
    const btn = document.getElementById('btn-apply-filters');
    btn.disabled = true;

    const result = await sendMessage('FETCH_LESSON_DETAILS', { entries: needDetails });
    btn.disabled = false;

    if (result?.success && result.entries) {
      // Merge topics back into fetchedEntries (by lessonId)
      const topicMap = new Map(result.entries.map((e) => [e.lessonId, e.topic]));
      for (const entry of fetchedEntries) {
        if (topicMap.has(entry.lessonId)) {
          entry.topic = topicMap.get(entry.lessonId);
        }
      }
      // Re-render with topics
      renderLessons(filteredLessons);
    }
  }

  showStatus(`Показано ${filteredLessons.length} занять.`, true);
}

function renderLessons(lessons) {
  const list = document.getElementById('lessons-list');
  list.innerHTML = lessons.map((l, i) => {
    const topicLine = l.topic
      ? `<span class="lesson-topic">${escapeHtml(l.topic)}</span>` : '';
    return `
    <label class="lesson-item${topicLine ? ' has-topic' : ''}">
      <input type="checkbox" data-index="${i}" checked />
      <span class="lesson-date">${l.date}</span>
      <span class="lesson-pair">${l.pairNumber} пара</span>
      <span class="lesson-group">${l.group}</span>
      <span class="lesson-subject">${l.subject}</span>
      ${topicLine}
    </label>`;
  }).join('');
}

function toggleAllLessons(checked) {
  document.querySelectorAll('#lessons-list input[type="checkbox"]')
    .forEach((cb) => { cb.checked = checked; });
}

/* ========== 4. Find available slots ========== */

async function findAvailableSlots() {
  const btn = document.getElementById('btn-find-available');
  btn.disabled = true;
  btn.textContent = '⏳ Пошук…';

  try {
    const checkboxes = document.querySelectorAll('#lessons-list input[type="checkbox"]:checked');
    const selectedLessons = Array.from(checkboxes).map((cb) => {
      const idx = parseInt(cb.dataset.index, 10);
      return filteredLessons[idx];
    }).filter(Boolean);

    if (selectedLessons.length === 0) {
      showStatus('Оберіть хоча б одне заняття.', false);
      return;
    }

    const result = await sendMessage('FIND_SLOTS_FOR_LESSONS', {
      lessons: selectedLessons,
    });

    if (!result || result.error) {
      showStatus(result?.error || 'Помилка пошуку вільних пар.', false);
      return;
    }

    // Store results for report generation
    lastResults = result.results || [];

    // Show result textarea
    const output = document.getElementById('result-output');
    output.value = result.text || '';
    document.getElementById('result-card').classList.remove('hidden');
    showStatus(`Знайдено ${result.slotCount || 0} вільних пар.`, true);
  } catch (err) {
    showStatus(`Помилка: ${err.message}`, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '🗓️ Знайти вільні пари';
  }
}

/* ========== 5. Copy result ========== */

async function copyResult() {
  const text = document.getElementById('result-output')?.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showStatus('Скопійовано!', true);
  } catch {
    // Fallback
    document.getElementById('result-output').select();
    document.execCommand('copy');
    showStatus('Скопійовано!', true);
  }
}

/* ========== 6. Download report (.doc) ========== */

const UA_MONTHS_GEN = {
  '01': 'січень', '02': 'лютий', '03': 'березень',
  '04': 'квітень', '05': 'травень', '06': 'червень',
  '07': 'липень', '08': 'серпень', '09': 'вересень',
  '10': 'жовтень', '11': 'листопад', '12': 'грудень',
};

function downloadReport() {
  if (!lastResults || lastResults.length === 0) {
    showStatus('Немає даних для звіту.', false);
    return;
  }

  const month = getVal('report-month');
  const year = new Date().getFullYear();
  const monthName = UA_MONTHS_GEN[month] || month;

  // Group results by subject → group
  const bySubject = {};
  for (const r of lastResults) {
    const subj = r.lesson.subject || 'Невідомо';
    const grp = r.lesson.group || 'Невідомо';
    if (!bySubject[subj]) bySubject[subj] = {};
    if (!bySubject[subj][grp]) bySubject[subj][grp] = [];
    bySubject[subj][grp].push(r);
  }

  // Shorten teacher name: "Кузьо Андрій Тарасович" → "Кузьо А.Т."
  const teacherShort = shortenName(lastTeacherName);

  // Build HTML pages — one per subject+group combination
  let pages = '';
  let isFirst = true;
  for (const [subject, groups] of Object.entries(bySubject)) {
    for (const [groupName, results] of Object.entries(groups)) {
      pages += buildGroupPage(subject, groupName, results, monthName, year, teacherShort, isFirst);
      isFirst = false;
    }
  }

  const html = buildDocHtml(pages);

  // Download as .doc
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `графік_практичних_${monthName}-${year}.doc`;
  a.click();
  URL.revokeObjectURL(url);

  showStatus('Звіт завантажено!', true);
}

function shortenName(full) {
  if (!full) return '';
  const parts = full.trim().split(/\s+/);
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
  }
  if (parts.length === 2) {
    return `${parts[0]} ${parts[1][0]}.`;
  }
  return full;
}

function formatDateUA(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

function buildGroupPage(subject, groupName, results, monthName, year, teacher, isFirst) {
  let rows = '';
  results.forEach((r, idx) => {
    const topicLabel = r.lesson.topic || `ПР ${idx + 1}`;
    const origDate = formatDateUA(r.lesson.date);
    const origPair = r.lesson.pairNumber;
    const slotDate = r.slot ? formatDateUA(r.slot.date) : '—';
    const slotPair = r.slot ? r.slot.pairNumber : '—';

    // Subgroup I → found slot, Subgroup II → original lesson
    rows += `
      <tr>
        <td rowspan="2" style="text-align:center; vertical-align:middle;">${escapeHtml(topicLabel)}</td>
        <td rowspan="2" style="text-align:center; vertical-align:middle;">${escapeHtml(groupName)}</td>
        <td style="text-align:center;">І</td>
        <td style="text-align:center;">${slotDate}</td>
        <td style="text-align:center;">${slotPair} пара</td>
      </tr>
      <tr>
        <td style="text-align:center;">ІІ</td>
        <td style="text-align:center;">${origDate}</td>
        <td style="text-align:center;">${origPair} пара</td>
      </tr>`;
  });

  const pageBreak = isFirst ? '' : '<div style="page-break-before:always;"></div>';

  return `
    ${pageBreak}
    <p style="text-align:right; margin-bottom:0;">«Затверджую»</p>
    <p style="text-align:right; margin-bottom:0;">Заступник директора</p>
    <p style="text-align:right; margin-bottom:24pt;">з навчальної роботи<br/>_______Сарахман М.І</p>

    <p style="text-align:center; font-size:14pt; font-weight:bold; margin-bottom:0;">Графік</p>
    <p style="text-align:center; font-size:12pt; margin-bottom:0;">проведення практичних робіт</p>
    <p style="text-align:center; font-size:12pt; margin-bottom:0;">з освітньої компоненти «${escapeHtml(subject)}»</p>
    <p style="text-align:center; font-size:12pt; margin-bottom:24pt;">за ${escapeHtml(monthName)} ${year} р.</p>

    <table border="1" cellpadding="4" cellspacing="0"
           style="border-collapse:collapse; width:100%; font-size:12pt;">
      <thead>
        <tr style="font-weight:bold;">
          <th style="width:25%;">№ Практичної роботи</th>
          <th style="width:15%;">Група</th>
          <th style="width:15%;">підгрупа</th>
          <th style="width:22%;">дата</th>
          <th style="width:23%;">пара</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <p style="margin-top:24pt;">Викладач: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${escapeHtml(teacher)}</p>
  `;
}

function buildDocHtml(bodyContent) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4 portrait; margin: 2cm 1.5cm 2cm 2cm; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #000; padding: 4pt 6pt; }
  p { margin: 2pt 0; }
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

/* ========== Helpers ========== */

function uniqueBy(arr, key) {
  const seen = new Set();
  return arr.reduce((acc, item) => {
    const val = item[key];
    if (val && !seen.has(val)) {
      seen.add(val);
      acc.push(val);
    }
    return acc;
  }, []);
}

function getSelectedValues(id) {
  const sel = document.getElementById(id);
  if (!sel) return [];
  return Array.from(sel.selectedOptions).map((o) => o.value);
}

function sendMessage(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Smart School Helper] sendMessage error:', chrome.runtime.lastError.message);
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

function showStatus(text, success = true) {
  const el = document.getElementById('status-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `status ${success ? 'success' : 'error'}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function getVal(id) { return document.getElementById(id)?.value ?? ''; }
function setVal(id, val) { const el = document.getElementById(id); if (el && val) el.value = val; }
function on(id, event, handler) { document.getElementById(id)?.addEventListener(event, handler); }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
