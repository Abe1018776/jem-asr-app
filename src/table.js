import { getState, getFilteredRows, getFilterCounts, getStatus } from './state.js';
import { truncateWords, formatConfidence, debounce } from './utils.js';

// ── Internal state ──────────────────────────────────────────────────
let currentFilter = 'all';
let currentSort = { column: null, dir: 'asc' };
let currentPage = 1;
let searchTerm = '';
let filterYear = '';
let filterMonth = '';
let filterType = '';
let selectedIds = new Set();
const PAGE_SIZE = 50;

let _container = null;
let _onRowExpand = null;
let _onRowSelect = null;

// ── Column definitions ─────────────────────────────────────────────
const COLUMNS = [
  { key: 'checkbox',    label: '',               sortable: false, showWhen: () => true },
  { key: 'rowNum',      label: '#',              sortable: false, showWhen: () => true },
  { key: 'name',        label: 'Audio Name',     sortable: true,  showWhen: () => true },
  { key: 'year',        label: 'Year',           sortable: true,  showWhen: () => true },
  { key: 'type',        label: 'Type',           sortable: true,  showWhen: () => true },
  { key: 'estMinutes',  label: 'Est Duration',   sortable: true,  showWhen: () => true },
  { key: 'firstLine',   label: 'First 15 Words', sortable: false, showWhen: (f) => f !== 'unmapped' },
  { key: 'transcript',  label: 'Transcript Name',sortable: true,  showWhen: (f) => f !== 'unmapped' },
  { key: 'matchConf',   label: 'Match Confidence (%)', sortable: true, showWhen: (f) => !['unmapped'].includes(f) },
  { key: 'cleanRate',   label: 'Clean Rate (%)', sortable: true,  showWhen: (f) => !['unmapped', 'mapped'].includes(f) },
  { key: 'avgConf',     label: 'Avg Confidence (%)', sortable: true, showWhen: (f) => !['unmapped', 'mapped', 'fifty'].includes(f) && f !== 'cleaned' },
  { key: 'lowConfWords',label: 'Low Confidence Words', sortable: true, showWhen: (f) => !['unmapped', 'mapped', 'fifty'].includes(f) && f !== 'cleaned' },
  { key: 'status',      label: 'Status',         sortable: true,  showWhen: () => true },
  { key: 'actions',     label: 'Actions',        sortable: false, showWhen: () => true },
];

// ── Filter key mapping (HTML data-filter → state.js key) ────────────
const FILTER_MAP = {
  all: 'all',
  unmapped: 'unmapped',
  mapped: 'mapped',
  cleaned: 'cleaned',
  fifty: '50hr',
  benchmark: 'benchmark',
  review: 'needsReview',
  approved: 'approved',
};

function stateFilterKey(htmlFilter) {
  return FILTER_MAP[htmlFilter] || htmlFilter;
}

// ── Helpers ─────────────────────────────────────────────────────────

function getVisibleColumns() {
  return COLUMNS.filter(c => c.showWhen(currentFilter));
}

function getTranscriptForAudio(audioId) {
  const state = getState();
  const mapping = state.mappings && state.mappings[audioId];
  if (!mapping) return null;
  const transcripts = state.transcripts || [];
  return transcripts.find(t => t.id === mapping.transcriptId) || null;
}

function getRowData(audio) {
  const state = getState();
  const id = audio.id;
  const status = getStatus(id);
  const mapping = state.mappings && state.mappings[id];
  const cleaning = state.cleaning && state.cleaning[id];
  const alignment = state.alignments && state.alignments[id];
  const transcript = getTranscriptForAudio(id);

  return {
    id,
    name: audio.name || '',
    year: audio.year || '',
    month: audio.month || '',
    type: audio.type || '',
    estMinutes: audio.estMinutes != null ? audio.estMinutes + ' min' : '',
    firstLine: transcript ? truncateWords(transcript.firstLine || '', 15) : '',
    transcript: transcript ? transcript.name : '',
    matchConf: mapping ? formatConfidence(mapping.confidence) : '',
    cleanRate: cleaning ? cleaning.cleanRate + '%' : '',
    avgConf: alignment ? formatConfidence(alignment.avgConfidence) : '',
    lowConfWords: alignment ? alignment.lowConfidenceCount : '',
    status,
    isBenchmark: !!audio.isBenchmark,
  };
}

function matchesSearch(row) {
  if (filterYear && row.year !== filterYear) return false;
  if (filterMonth && row.month !== filterMonth) return false;
  if (filterType && row.type !== filterType) return false;
  if (!searchTerm) return true;
  const term = searchTerm.toLowerCase();
  return (
    row.name.toLowerCase().includes(term) ||
    row.transcript.toLowerCase().includes(term) ||
    row.firstLine.toLowerCase().includes(term)
  );
}

function populateDropdownFilters() {
  const state = getState();
  if (!state || !state.audio) return;

  const years = new Set();
  const months = new Set();
  const types = new Set();

  state.audio.forEach(a => {
    if (a.year) years.add(a.year);
    if (a.month) months.add(a.month);
    if (a.type) types.add(a.type);
  });

  const yearSelect = document.getElementById('filter-year');
  const monthSelect = document.getElementById('filter-month');
  const typeSelect = document.getElementById('filter-type');

  if (yearSelect && yearSelect.options.length <= 1) {
    [...years].sort().forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    });
  }

  if (monthSelect && monthSelect.options.length <= 1) {
    [...months].sort().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      monthSelect.appendChild(opt);
    });
  }

  if (typeSelect && typeSelect.options.length <= 1) {
    [...types].sort().forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      typeSelect.appendChild(opt);
    });
  }
}

function sortRows(rows) {
  if (!currentSort.column) return rows;
  const key = currentSort.column;
  const dir = currentSort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    // Parse numeric-looking values
    if (typeof va === 'string') {
      const na = parseFloat(va);
      const nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
    }
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

function getStatusClass(status) {
  const map = {
    unmapped: 'status-unmapped',
    mapped: 'status-mapped',
    cleaned: 'status-cleaned',
    aligned: 'status-aligned',
    reviewed: 'status-reviewed',
    approved: 'status-approved',
    rejected: 'status-rejected',
  };
  return map[status] || 'status-unmapped';
}

// ── Build table DOM ─────────────────────────────────────────────────

function buildTable(rows) {
  const cols = getVisibleColumns();
  const table = document.createElement('table');
  table.className = 'data-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  cols.forEach(col => {
    const th = document.createElement('th');
    if (col.key === 'checkbox') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'select-all-cb';
      cb.checked = rows.length > 0 && rows.every(r => selectedIds.has(r.id));
      cb.addEventListener('change', () => {
        if (cb.checked) {
          rows.forEach(r => selectedIds.add(r.id));
        } else {
          rows.forEach(r => selectedIds.delete(r.id));
        }
        updateTable();
        _fireRowSelect();
      });
      th.appendChild(cb);
    } else {
      th.textContent = col.label;
      if (col.sortable) {
        th.classList.add('sortable');
        if (currentSort.column === col.key) {
          th.classList.add(currentSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
        th.addEventListener('click', () => {
          if (currentSort.column === col.key) {
            currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            currentSort.column = col.key;
            currentSort.dir = 'asc';
          }
          currentPage = 1;
          updateTable();
        });
      }
    }
    if (col.key === 'firstLine') th.classList.add('rtl-cell');
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + PAGE_SIZE);

  pageRows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.className = 'table-row';
    tr.setAttribute('data-audio-id', row.id);
    if (row.isBenchmark) tr.classList.add('benchmark-row');
    if (selectedIds.has(row.id)) tr.classList.add('selected');

    cols.forEach(col => {
      const td = document.createElement('td');

      switch (col.key) {
        case 'checkbox': {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'row-checkbox';
          cb.checked = selectedIds.has(row.id);
          cb.addEventListener('change', (e) => {
            e.stopPropagation();
            if (cb.checked) {
              selectedIds.add(row.id);
            } else {
              selectedIds.delete(row.id);
            }
            updateTable();
            _fireRowSelect();
          });
          td.appendChild(cb);
          break;
        }
        case 'rowNum':
          td.textContent = startIdx + i + 1;
          break;
        case 'firstLine':
          td.textContent = row.firstLine;
          td.classList.add('cell-hebrew');
          break;
        case 'status': {
          const badge = document.createElement('span');
          badge.className = `status-badge ${getStatusClass(row.status)}`;
          badge.textContent = row.status;
          td.appendChild(badge);
          break;
        }
        case 'actions': {
          const btn = document.createElement('button');
          btn.className = 'action-btn action-btn-primary';
          btn.textContent = 'Open';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(`/detail.html?id=${encodeURIComponent(row.id)}`, '_blank');
          });
          td.appendChild(btn);
          break;
        }
        default:
          td.textContent = row[col.key] != null ? row[col.key] : '';
      }
      tr.appendChild(td);
    });

    tr.addEventListener('click', () => {
      window.open(`/detail.html?id=${encodeURIComponent(row.id)}`, '_blank');
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function buildCardView(rows) {
  const container = document.createElement('div');
  container.className = 'card-view';

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + PAGE_SIZE);

  pageRows.forEach(row => {
    const card = document.createElement('div');
    card.className = 'card-item';
    if (selectedIds.has(row.id)) card.classList.add('selected');

    const header = document.createElement('div');
    header.className = 'card-item-header';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'row-checkbox';
    cb.checked = selectedIds.has(row.id);
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedIds.add(row.id);
      else selectedIds.delete(row.id);
      updateTable();
      _fireRowSelect();
    });

    const name = document.createElement('span');
    name.className = 'card-item-name';
    name.textContent = row.name;

    header.appendChild(cb);
    header.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'card-item-meta';
    if (row.year) {
      const yearSpan = document.createElement('span');
      yearSpan.textContent = row.year;
      meta.appendChild(yearSpan);
    }
    if (row.type) {
      const typeSpan = document.createElement('span');
      typeSpan.textContent = row.type;
      meta.appendChild(typeSpan);
    }
    const badge = document.createElement('span');
    badge.className = `status-badge ${getStatusClass(row.status)}`;
    badge.textContent = row.status;
    meta.appendChild(badge);

    card.appendChild(header);
    card.appendChild(meta);

    if (row.firstLine) {
      const preview = document.createElement('div');
      preview.className = 'card-item-preview';
      preview.dir = 'rtl';
      preview.textContent = row.firstLine;
      card.appendChild(preview);
    }

    const actions = document.createElement('div');
    actions.className = 'card-item-actions';
    const viewBtn = document.createElement('button');
    viewBtn.className = 'action-btn';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_onRowExpand) _onRowExpand(row.id);
    });
    actions.appendChild(viewBtn);
    card.appendChild(actions);

    card.addEventListener('click', () => {
      if (_onRowExpand) _onRowExpand(row.id);
    });

    container.appendChild(card);
  });

  return container;
}

function buildPagination(totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const nav = document.createElement('div');
  nav.className = 'pagination';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'pagination-btn';
  prevBtn.textContent = 'Prev';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; updateTable(); }
  });

  const pageInfo = document.createElement('span');
  pageInfo.className = 'pagination-info';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'pagination-btn';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; updateTable(); }
  });

  nav.appendChild(prevBtn);
  nav.appendChild(pageInfo);
  nav.appendChild(nextBtn);
  return nav;
}

function updateFilterCounts() {
  const counts = getFilterCounts();
  // Map: HTML element id → state.js count key
  const map = {
    'count-all': 'all',
    'count-unmapped': 'unmapped',
    'count-mapped': 'mapped',
    'count-cleaned': 'cleaned',
    'count-fifty': '50hr',
    'count-benchmark': 'benchmark',
    'count-review': 'needsReview',
    'count-approved': 'approved',
  };
  for (const [elId, stateKey] of Object.entries(map)) {
    const el = document.getElementById(elId);
    if (el) el.textContent = counts[stateKey] != null ? counts[stateKey] : 0;
  }
}

function updateFilterPills() {
  const pills = document.querySelectorAll('.filter-pill');
  pills.forEach(pill => {
    const filter = pill.getAttribute('data-filter');
    pill.classList.toggle('active', filter === currentFilter);
  });
}

function updateBulkCount() {
  const el = document.getElementById('bulk-selection-count');
  if (el) el.textContent = `${selectedIds.size} selected`;
}

function _fireRowSelect() {
  updateBulkCount();
  if (_onRowSelect) _onRowSelect([...selectedIds]);
}

// ── Public API ──────────────────────────────────────────────────────

function renderTable(container, options = {}) {
  _container = container;
  _onRowExpand = options.onRowExpand || null;
  _onRowSelect = options.onRowSelect || null;

  if (options.filter) currentFilter = options.filter;

  // Wire filter pills
  const pills = document.querySelectorAll('.filter-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      currentFilter = pill.getAttribute('data-filter');
      currentPage = 1;
      selectedIds.clear();
      updateTable();
      _fireRowSelect();
    });
  });

  // Wire dropdown filters
  const yearSelect = document.getElementById('filter-year');
  const monthSelect = document.getElementById('filter-month');
  const typeSelect = document.getElementById('filter-type');

  if (yearSelect) {
    yearSelect.addEventListener('change', () => {
      filterYear = yearSelect.value;
      currentPage = 1;
      updateTable();
    });
  }
  if (monthSelect) {
    monthSelect.addEventListener('change', () => {
      filterMonth = monthSelect.value;
      currentPage = 1;
      updateTable();
    });
  }
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      filterType = typeSelect.value;
      currentPage = 1;
      updateTable();
    });
  }

  // Wire search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    const debouncedSearch = debounce((val) => {
      searchTerm = val;
      currentPage = 1;
      updateTable();
    }, 250);
    searchInput.addEventListener('input', (e) => {
      debouncedSearch(e.target.value);
    });
  }

  // Populate dropdown filters from data
  populateDropdownFilters();

  updateTable();
}

function updateTable() {
  if (!_container) return;

  // Get filtered rows from state (map HTML filter key to state key)
  const filteredAudio = getFilteredRows(stateFilterKey(currentFilter));

  // Build row data
  let rows = filteredAudio.map(getRowData);

  // Apply search
  rows = rows.filter(matchesSearch);

  // Apply sort
  rows = sortRows(rows);

  // Clear container
  _container.innerHTML = '';

  // Update UI
  updateFilterCounts();
  updateFilterPills();
  updateBulkCount();

  // Build and append table
  const table = buildTable(rows);
  _container.appendChild(table);

  // Build and append card view (visible on mobile ≤480px via CSS)
  const cardView = buildCardView(rows);
  _container.appendChild(cardView);

  // Build and append pagination
  const pagination = buildPagination(rows.length);
  _container.appendChild(pagination);
}

function getSelectedRows() {
  return [...selectedIds];
}

export { renderTable, updateTable, getSelectedRows };
