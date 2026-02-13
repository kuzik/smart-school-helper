/**
 * Smart School Helper — Popup Script
 *
 * Controls the popup UI: tab switching, config loading/saving,
 * triggering schedule parsing and report generation via background messages.
 */

document.addEventListener('DOMContentLoaded', init);

/* ========== Initialization ========== */

async function init() {
  setupTabs();
  await loadConfig();
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

/* ========== Config ========== */

async function loadConfig() {
  const config = await sendMessage('GET_CONFIG');
  if (!config) return;

  setVal('teacher-name', config.teacherName);
  setVal('default-teacher-id', config.defaultTeacherId);
  setVal('default-predmet-id', config.defaultPredmetId);
  setVal('default-kabinet-id', config.defaultKabinetId);
  setVal('subgroup-label', config.subgroupLabel);
  setVal('semester-start', config.semesterStart);
  setVal('semester-end', config.semesterEnd);

  // Pre-fill date range from semester if available
  if (config.semesterStart) setVal('date-from', config.semesterStart);
  if (config.semesterEnd) setVal('date-to', config.semesterEnd);

  // Pre-fill IDs from defaults
  if (config.defaultTeacherId) setVal('teacher-id', config.defaultTeacherId);
  if (config.defaultPredmetId) setVal('predmet-id', config.defaultPredmetId);
  if (config.defaultKabinetId) setVal('kabinet-id', config.defaultKabinetId);
}

async function saveConfig() {
  const config = {
    teacherName: getVal('teacher-name'),
    defaultTeacherId: getVal('default-teacher-id'),
    defaultPredmetId: getVal('default-predmet-id'),
    defaultKabinetId: getVal('default-kabinet-id'),
    subgroupLabel: getVal('subgroup-label'),
    semesterStart: getVal('semester-start'),
    semesterEnd: getVal('semester-end'),
  };
  const result = await sendMessage('SAVE_CONFIG', config);
  showStatus(result?.success ? 'Налаштування збережено!' : 'Помилка збереження', result?.success);
}

/* ========== Event Binding ========== */

function bindEvents() {
  // Settings
  on('btn-save-config', 'click', saveConfig);
  on('btn-clear-cache', 'click', clearCache);

  // Schedule
  on('btn-load-filters', 'click', loadFiltersFromPage);
  on('btn-parse', 'click', parseSchedule);
  on('btn-find-slots', 'click', findFreeSlots);

  // Report
  on('btn-generate', 'click', generateReport);
}

/* ========== Schedule Actions ========== */

/**
 * Load filter options (groups, teachers, subjects, rooms) from the active page.
 */
async function loadFiltersFromPage() {
  const btn = document.getElementById('btn-load-filters');
  btn.disabled = true;
  btn.textContent = '⏳ Завантаження...';

  try {
    const result = await sendMessage('LOAD_FILTERS');

    if (result?.error) {
      showStatus(result.error, false);
      return;
    }

    // Populate dropdowns
    populateSelect('my-group', result.groups || [], getVal('my-group'));
    populateSelect('target-group', result.groups || [], getVal('target-group'));
    populateSelect('teacher-id', result.teachers || [], getVal('teacher-id'));
    populateSelect('predmet-id', result.subjects || [], getVal('predmet-id'));
    populateSelect('kabinet-id', result.rooms || [], getVal('kabinet-id'));

    showStatus(`Завантажено: ${(result.groups||[]).length} груп, ${(result.teachers||[]).length} викладачів`, true);
  } catch (err) {
    showStatus(`Помилка: ${err.message}`, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Завантажити фільтри зі сторінки';
  }
}

/**
 * Populate a <select> with options.
 */
function populateSelect(selectId, items, currentValue) {
  const select = document.getElementById(selectId);
  if (!select) return;

  // Preserve the first "empty" option
  const firstOption = select.querySelector('option');
  select.innerHTML = '';
  if (firstOption) select.appendChild(firstOption);

  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = `${item.name} (${item.id})`;
    if (item.id === currentValue) opt.selected = true;
    select.appendChild(opt);
  });
}

async function parseSchedule() {
  const btn = document.getElementById('btn-parse');
  btn.disabled = true;
  btn.textContent = '⏳ Зчитування...';

  try {
    const payload = {
      myGroupId: getVal('my-group'),
      targetGroupId: getVal('target-group'),
      teacherId: getVal('teacher-id'),
      predmetId: getVal('predmet-id'),
      kabinetId: getVal('kabinet-id'),
      dateFrom: getVal('date-from'),
      dateTo: getVal('date-to'),
    };

    const result = await sendMessage('PARSE_SCHEDULE', payload);

    if (result?.error) {
      showStatus(result.error, false);
    } else {
      document.getElementById('btn-find-slots').disabled = false;
      showStatus('Розклад зчитано!', true);
    }
  } catch (err) {
    showStatus(`Помилка: ${err.message}`, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Зчитати розклад';
  }
}

async function findFreeSlots() {
  const btn = document.getElementById('btn-find-slots');
  btn.disabled = true;
  btn.textContent = '⏳ Пошук...';

  try {
    const result = await sendMessage('FIND_FREE_SLOTS', {
      myGroupId: getVal('my-group'),
      targetGroupId: getVal('target-group'),
      dateFrom: getVal('date-from'),
      dateTo: getVal('date-to'),
    });

    if (result?.error) {
      showStatus(result.error, false);
      return;
    }

    renderSlots(result?.slots || []);
  } catch (err) {
    showStatus(`Помилка: ${err.message}`, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '🗓️ Знайти вільні пари';
  }
}

function renderSlots(slots) {
  const container = document.getElementById('slots-list');
  const wrapper = document.getElementById('slots-result');

  if (slots.length === 0) {
    container.innerHTML = '<p class="hint">Вільних пар не знайдено.</p>';
    wrapper.classList.remove('hidden');
    return;
  }

  container.innerHTML = slots.map((slot, i) => `
    <div class="slot-item">
      <input type="checkbox" id="slot-${i}" data-index="${i}" checked />
      <span class="slot-date">${slot.date}</span>
      <span class="slot-pair">${slot.pairNumber} пара (${slot.timeStart}–${slot.timeEnd})</span>
    </div>
  `).join('');

  wrapper.classList.remove('hidden');
  document.getElementById('btn-generate').disabled = false;
}

/* ========== Report ========== */

async function generateReport() {
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.textContent = '⏳ Генерація...';

  try {
    // Gather selected slots
    const checkboxes = document.querySelectorAll('#slots-list input[type="checkbox"]:checked');
    const selectedIndexes = Array.from(checkboxes).map((cb) => parseInt(cb.dataset.index, 10));

    const result = await sendMessage('GENERATE_REPORT', {
      selectedIndexes,
      discipline: getVal('discipline'),
      format: getVal('report-format'),
    });

    if (result?.error) {
      showStatus(result.error, false);
      return;
    }

    // Show preview
    if (result?.preview) {
      const preview = document.getElementById('report-preview');
      preview.textContent = result.preview;
      preview.classList.remove('hidden');
    }

    showStatus('Звіт згенеровано!', true);
  } catch (err) {
    showStatus(`Помилка: ${err.message}`, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 Згенерувати звіт';
  }
}

/* ========== Cache ========== */

async function clearCache() {
  const result = await sendMessage('CLEAR_CACHE');
  showStatus(result?.success ? 'Кеш очищено!' : 'Помилка', result?.success);
}

/* ========== Helpers ========== */

function sendMessage(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, payload }, (response) => {
      resolve(response);
    });
  });
}

function showStatus(text, success = true) {
  const el = document.getElementById('status-msg');
  el.textContent = text;
  el.className = `status ${success ? 'success' : 'error'}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function getVal(id) { return document.getElementById(id)?.value ?? ''; }
function setVal(id, val) { const el = document.getElementById(id); if (el && val) el.value = val; }
function on(id, event, handler) { document.getElementById(id)?.addEventListener(event, handler); }
