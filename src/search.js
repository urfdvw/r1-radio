import QRCode from 'qrcode';
import html2canvas from 'html2canvas';

// =============================================================
// Constants
// =============================================================

const API_BASE = 'https://de1.api.radio-browser.info';
const API_HEADERS = { 'User-Agent': 'R1Radio/1.0' };
const QUERY_LIMIT = 200;
const PAGE_SIZE = 20;

// =============================================================
// State
// =============================================================

const state = {
  searchText: '',
  filters: { countries: [], languages: [], tags: [] },
  results: [],
  currentPage: 1,
  preview: { name: '', description: '', url: '' },
  playing: false,
  allCountries: [],
  allLanguages: [],
  allTags: [],
};

// =============================================================
// Audio
// =============================================================

const audio = new Audio();
audio.crossOrigin = 'anonymous';

audio.addEventListener('ended', () => setPlaying(false));
audio.addEventListener('error', () => setPlaying(false));
audio.addEventListener('pause', () => setPlaying(false));
audio.addEventListener('play', () => setPlaying(true));
audio.addEventListener('waiting', () => setLoading(true));
audio.addEventListener('playing', () => setLoading(false));
audio.addEventListener('canplay', () => setLoading(false));

function setPlaying(val) {
  state.playing = val;
  setLoading(false);
  const btn = document.getElementById('playBtn');
  btn.textContent = val ? '■ Stop' : '▶ Play';
  btn.dataset.playing = String(val);
  btn.disabled = false;
}

function setLoading(val) {
  const btn = document.getElementById('playBtn');
  if (!btn) return;
  if (val) {
    btn.textContent = 'Loading…';
    btn.dataset.playing = 'false';
    btn.disabled = true;
  } else {
    btn.disabled = false;
  }
}

function playUrl(url) {
  if (!url) return;
  setLoading(true);
  audio.src = url;
  audio.play().catch(err => {
    console.error('Playback error:', err);
    setPlaying(false);
  });
}

function stopPlayback() {
  audio.pause();
}

// =============================================================
// API
// =============================================================

async function apiFetch(url) {
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Build an array of URLs to fetch in parallel based on current state.
// Multiple countries/languages → parallel requests, merged by stationuuid.
// Multiple tags → comma-separated (API AND logic).
function buildQueryUrls() {
  const { searchText, filters } = state;
  const hasText = searchText.trim().length > 0;
  const hasFilters =
    filters.countries.length > 0 ||
    filters.languages.length > 0 ||
    filters.tags.length > 0;

  if (!hasText && !hasFilters) return [];

  const baseParams = new URLSearchParams();
  if (hasText) baseParams.set('name', searchText.trim());
  if (filters.tags.length > 0) baseParams.set('tagList', filters.tags.join(','));
  baseParams.set('limit', String(QUERY_LIMIT));
  baseParams.set('hidebroken', 'true');
  baseParams.set('order', 'votes');
  baseParams.set('reverse', 'true');

  // Build country × language combinations (capped at 3 each to limit requests)
  const countryList = filters.countries.slice(0, 3);
  const languageList = filters.languages.slice(0, 3);

  const countryValues = countryList.length > 0 ? countryList : [null];
  const languageValues = languageList.length > 0 ? languageList : [null];

  const urls = [];
  for (const country of countryValues) {
    for (const language of languageValues) {
      const params = new URLSearchParams(baseParams);
      if (country) params.set('country', country);
      if (language) params.set('language', language);
      urls.push(`${API_BASE}/json/stations/search?${params}`);
    }
  }

  return urls;
}

function dedupeByUuid(stations) {
  const seen = new Set();
  return stations.filter(s => {
    if (seen.has(s.stationuuid)) return false;
    seen.add(s.stationuuid);
    return true;
  });
}

// =============================================================
// Query runner (debounced)
// =============================================================

let queryTimer = null;

function scheduleQuery() {
  state.currentPage = 1;
  clearTimeout(queryTimer);
  queryTimer = setTimeout(runQuery, 300);
}

async function runQuery() {
  const urls = buildQueryUrls();

  if (urls.length === 0) {
    showEmptyState('Add a filter or search above to find stations.');
    return;
  }

  showEmptyState('Loading…');
  document.getElementById('resultsList').innerHTML = '';

  try {
    const responses = await Promise.all(urls.map(apiFetch));
    const merged = dedupeByUuid(responses.flat());
    state.results = merged;
    renderPagedResults();
  } catch (err) {
    console.error('Query error:', err);
    showEmptyState('Could not reach Radio Browser API. Check your connection.');
    renderPagination();
  }
}

// =============================================================
// Render
// =============================================================

// Stored by stationuuid for O(1) lookup on click
const stationMap = new Map();

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showEmptyState(msg) {
  const el = document.getElementById('emptyState');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideEmptyState() {
  document.getElementById('emptyState').style.display = 'none';
}

function renderPagedResults() {
  const { results, currentPage } = state;
  const list = document.getElementById('resultsList');
  stationMap.clear();

  if (results.length === 0) {
    list.innerHTML = '';
    showEmptyState('No stations found. Try different filters.');
    renderPagination();
    return;
  }

  hideEmptyState();

  const start = (currentPage - 1) * PAGE_SIZE;
  const page = results.slice(start, start + PAGE_SIZE);

  const fragment = document.createDocumentFragment();
  for (const s of page) {
    stationMap.set(s.stationuuid, s);
    const metaParts = [s.country, s.language, s.codec, s.bitrate ? `${s.bitrate}k` : '']
      .filter(Boolean);

    const row = document.createElement('div');
    row.className = 'result-row';
    row.dataset.uuid = s.stationuuid;
    row.innerHTML = `
      <div class="result-name">${esc(s.name)}</div>
      <div class="result-meta">${esc(metaParts.join(' · '))}</div>
    `;
    fragment.appendChild(row);
  }

  list.innerHTML = '';
  list.appendChild(fragment);
  list.scrollTop = 0;
  renderPagination();
}

function renderPagination() {
  const bar = document.getElementById('pagination');
  const { results, currentPage } = state;
  const totalPages = Math.ceil(results.length / PAGE_SIZE);

  if (totalPages <= 1) {
    bar.innerHTML = '';
    return;
  }

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  bar.innerHTML = `
    <button class="page-btn" id="prevBtn" ${hasPrev ? '' : 'disabled'}>← Prev</button>
    <span class="page-info">Page ${currentPage}</span>
    <button class="page-btn" id="nextBtn" ${hasNext ? '' : 'disabled'}>Next →</button>
  `;

  if (hasPrev) {
    bar.querySelector('#prevBtn').addEventListener('click', () => goToPage(currentPage - 1));
  }
  if (hasNext) {
    bar.querySelector('#nextBtn').addEventListener('click', () => goToPage(currentPage + 1));
  }
}

function goToPage(page) {
  state.currentPage = page;
  renderPagedResults();
}

// =============================================================
// Station selection
// =============================================================

function buildDescription(station) {
  const parts = [];
  if (station.tags) parts.push(station.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 4).join(', '));
  if (station.country) parts.push(station.country);
  if (station.language) parts.push(station.language);
  return parts.filter(Boolean).join(' · ');
}

function selectStation(station) {
  // Highlight selected row
  document.querySelectorAll('.result-row').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector(`.result-row[data-uuid="${station.stationuuid}"]`);
  if (row) row.classList.add('selected');

  const url = station.url_resolved || station.url || '';
  const description = buildDescription(station);

  state.preview = { name: station.name || '', description, url };

  document.getElementById('previewName').value = station.name || '';
  document.getElementById('previewDescription').value = description;
  document.getElementById('previewUrl').value = url;

  updateCard();

  if (url) playUrl(url);
}

// =============================================================
// Card
// =============================================================

async function updateCard() {
  const { name, description, url } = state.preview;
  const hasContent = Boolean(name || url);

  const placeholder = document.getElementById('cardPlaceholder');
  const qrImg = document.getElementById('qrImg');
  const cardName = document.getElementById('cardName');
  const cardDesc = document.getElementById('cardDescription');

  if (hasContent) {
    placeholder.classList.add('hidden');
    cardName.textContent = name || '';
    cardDesc.textContent = description || '';

    const qrData = JSON.stringify({ name: name || '', url: url || '' });
    try {
      const dataUrl = await QRCode.toDataURL(qrData, {
        width: 240,
        margin: 1,
        color: { dark: '#1a1a1a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
      qrImg.src = dataUrl;
      qrImg.classList.add('visible');
    } catch (err) {
      console.error('QR generation error:', err);
    }
  } else {
    placeholder.classList.remove('hidden');
    qrImg.classList.remove('visible');
    qrImg.src = '';
    cardName.textContent = '';
    cardDesc.textContent = '';
  }
}

// =============================================================
// Save card as image (300 dpi, 2×3.5 inches → 600×1050px)
// =============================================================

async function saveCard() {
  const card = document.getElementById('card');
  const saveBtn = document.getElementById('saveBtn');

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    // scale so the exported canvas width = 600px (2 in × 300 dpi)
    const scale = 600 / card.offsetWidth;

    const canvas = await html2canvas(card, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    canvas.toBlob(blob => {
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      const safeName = (state.preview.name || 'station')
        .replace(/[^a-z0-9\s-]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase() || 'station';
      a.download = `${safeName}-card.png`;
      a.click();
      URL.revokeObjectURL(objUrl);
    }, 'image/png');
  } catch (err) {
    console.error('Save error:', err);
    alert('Could not save card. Please try again.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save as Image';
  }
}

// =============================================================
// Autocomplete
// =============================================================

function createAutocomplete(inputEl, dropdownEl, getOptions, onSelect) {
  let activeIndex = -1;
  let currentOptions = [];

  function showDropdown(options) {
    currentOptions = options;
    activeIndex = -1;

    dropdownEl.innerHTML = options
      .map((opt, i) =>
        `<div class="ac-item" data-index="${i}">
          <span>${esc(opt.name)}</span>
          <span class="ac-count">${opt.count ? opt.count.toLocaleString() : ''}</span>
        </div>`
      )
      .join('');

    dropdownEl.style.display = options.length ? 'block' : 'none';
  }

  function hideDropdown() {
    dropdownEl.style.display = 'none';
    currentOptions = [];
    activeIndex = -1;
  }

  function setActive(index) {
    activeIndex = index;
    Array.from(dropdownEl.children).forEach((el, i) =>
      el.classList.toggle('active', i === activeIndex)
    );
    if (activeIndex >= 0) {
      dropdownEl.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }

  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim().toLowerCase();
    if (!q) { hideDropdown(); return; }
    const matches = getOptions()
      .filter(o => o.name.toLowerCase().includes(q))
      .slice(0, 8);
    showDropdown(matches);
  });

  inputEl.addEventListener('keydown', e => {
    if (dropdownEl.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, currentOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && currentOptions[activeIndex]) {
        onSelect(currentOptions[activeIndex]);
        inputEl.value = '';
        hideDropdown();
      }
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  dropdownEl.addEventListener('mousedown', e => {
    const item = e.target.closest('.ac-item');
    if (!item) return;
    e.preventDefault();
    const idx = parseInt(item.dataset.index, 10);
    if (currentOptions[idx]) {
      onSelect(currentOptions[idx]);
      inputEl.value = '';
      hideDropdown();
    }
  });

  document.addEventListener('click', e => {
    if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
      hideDropdown();
    }
  });
}

// =============================================================
// Chips
// =============================================================

function addChip(chipsContainerId, filterKey, value) {
  if (state.filters[filterKey].includes(value)) return;
  state.filters[filterKey].push(value);

  const container = document.getElementById(chipsContainerId);
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = value;
  chip.addEventListener('click', () => {
    state.filters[filterKey] = state.filters[filterKey].filter(v => v !== value);
    chip.remove();
    scheduleQuery();
  });
  container.appendChild(chip);

  scheduleQuery();
}

// =============================================================
// Initialisation
// =============================================================

async function init() {
  // Pre-load autocomplete data in parallel
  try {
    const [countries, languages, tags] = await Promise.all([
      apiFetch(`${API_BASE}/json/countries?order=stationcount&reverse=true&limit=100`),
      apiFetch(`${API_BASE}/json/languages?order=stationcount&reverse=true&limit=80`),
      apiFetch(`${API_BASE}/json/tags?order=stationcount&reverse=true&limit=100`),
    ]);
    state.allCountries = countries.map(c => ({ name: c.name, count: c.stationcount }));
    state.allLanguages = languages.map(l => ({ name: l.name, count: l.stationcount }));
    state.allTags = tags.map(t => ({ name: t.name, count: t.stationcount }));
  } catch (err) {
    console.error('Failed to preload autocomplete data:', err);
  }

  // Search input
  document.getElementById('searchInput').addEventListener('input', e => {
    state.searchText = e.target.value;
    scheduleQuery();
  });

  // Autocomplete for each filter dimension
  createAutocomplete(
    document.getElementById('countryInput'),
    document.getElementById('countryDropdown'),
    () => state.allCountries,
    opt => addChip('countryChips', 'countries', opt.name)
  );

  createAutocomplete(
    document.getElementById('languageInput'),
    document.getElementById('languageDropdown'),
    () => state.allLanguages,
    opt => addChip('languageChips', 'languages', opt.name)
  );

  createAutocomplete(
    document.getElementById('tagInput'),
    document.getElementById('tagDropdown'),
    () => state.allTags,
    opt => addChip('tagChips', 'tags', opt.name)
  );

  // Results list: delegated click
  document.getElementById('resultsList').addEventListener('click', e => {
    const row = e.target.closest('.result-row');
    if (!row) return;
    const station = stationMap.get(row.dataset.uuid);
    if (station) selectStation(station);
  });

  // Preview fields → update card in real time
  const syncPreview = () => {
    state.preview.name = document.getElementById('previewName').value;
    state.preview.description = document.getElementById('previewDescription').value;
    state.preview.url = document.getElementById('previewUrl').value;
    updateCard();
  };
  document.getElementById('previewName').addEventListener('input', syncPreview);
  document.getElementById('previewDescription').addEventListener('input', syncPreview);
  document.getElementById('previewUrl').addEventListener('input', syncPreview);

  // Play / Stop button
  document.getElementById('playBtn').addEventListener('click', () => {
    if (state.playing) {
      stopPlayback();
    } else {
      const url = document.getElementById('previewUrl').value.trim();
      if (url) playUrl(url);
    }
  });

  // Save card
  document.getElementById('saveBtn').addEventListener('click', saveCard);
}

document.addEventListener('DOMContentLoaded', init);
