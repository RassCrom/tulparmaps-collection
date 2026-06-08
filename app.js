/* ==========================================================================
   APP BOOTSTRAP
   ========================================================================== */
(() => {
const ROOT_ASSETS = new Set(['sw.js', 'logo.png', 'logo-dark.png']);
let catalogAssetBase = './';

function isExternalUrl(path) {
  return /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:');
}

function normalizeAssetPath(path) {
  if (!path) return '';
  if (isExternalUrl(path)) return path;
  return path.replace(/^\/+/, '');
}

function joinAssetUrl(base, path) {
  const cleanPath = normalizeAssetPath(path);
  if (!cleanPath || isExternalUrl(cleanPath)) return cleanPath;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${cleanPath}`;
}

function getCatalogCandidates() {
  const usesSourceEntry = Array.from(document.scripts).some(script => {
    const src = script.getAttribute('src');
    if (!src) return false;
    const pathname = src.split(/[?#]/, 1)[0];
    return pathname.endsWith('app.min.js') || pathname.endsWith('app.js');
  });
  const usesBundledEntry = !usesSourceEntry;
  const isViteDev = Boolean(document.querySelector('script[src^="/@vite/client"]'));
  const sourceStaticCandidates = ['./public/maps.json', './maps.json'];
  const builtCandidates = ['./maps.json', './public/maps.json'];
  return [...new Set(usesBundledEntry || isViteDev ? builtCandidates : sourceStaticCandidates)];
}

function rememberCatalogLocation(catalogUrl) {
  catalogAssetBase = catalogUrl.replace(/maps\.json(?:[?#].*)?$/, '');
}

function getAssetUrl(path) {
  const cleanPath = normalizeAssetPath(path);
  if (!cleanPath || isExternalUrl(cleanPath)) return cleanPath;
  return joinAssetUrl(ROOT_ASSETS.has(cleanPath) ? './' : catalogAssetBase, cleanPath);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ==========================================================================
   STATE MANAGEMENT
   ========================================================================== */
let mapsList = [];
let filteredMaps = [];

const state = {
  searchQuery: '',
  sortBy: 'newest', // 'newest', 'name-asc', 'name-desc', 'size-desc', 'size-asc'
  currentPage: 1,
  itemsPerPage: 10
};

// Format byte size to a human-readable string (computed client-side)
function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size === 0) return '0 Bytes';
  const mb = size / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = size / 1024;
  return `${kb.toFixed(0)} KB`;
}

function getMapTitle(map) {
  return String(map.title || map.filename || 'Untitled map');
}

function getMapFilename(map) {
  return String(map.filename || '');
}

function getMapTimestamp(map) {
  const numericValue = Number(map.dateAdded);
  if (Number.isFinite(numericValue)) return numericValue;

  const parsedDate = Date.parse(map.dateAdded);
  return Number.isFinite(parsedDate) ? parsedDate : 0;
}

// AbortController for bfcache compatibility
let fetchController = null;

function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// Pan & Zoom Engine State
const zoomState = {
  scale: 1.0,
  panX: 0,
  panY: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  activeMap: null
};

// Configurable zoom boundaries
const ZOOM_CONFIG = {
  minScale: 0.1,
  maxScale: 6.0,
  stepFactor: 0.15, // Zoom factor for buttons
  wheelFactor: 0.08  // Zoom speed for scroll wheel
};

/* ==========================================================================
   DOM ELEMENTS
   ========================================================================== */
const DOM = {
  // Navigation & Theme
  themeToggle: document.getElementById('theme-toggle'),
  headerLogo: document.getElementById('header-logo'),
  footerLogo: document.getElementById('footer-logo'),
  
  // Search & Filter
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  sortSelect: document.getElementById('sort-select'),
  resetFiltersBtn: document.getElementById('reset-filters-btn'),
  
  // Gallery Grid
  mapsGrid: document.getElementById('maps-grid'),
  emptyState: document.getElementById('empty-state'),
  catalogStats: document.getElementById('catalog-stats'),
  
  // Zoom Modal
  zoomModal: document.getElementById('zoom-modal'),
  closeZoomBtn: document.getElementById('close-zoom-btn'),
  zoomTitle: document.getElementById('zoom-map-title'),
  zoomBadge: document.getElementById('zoom-map-badge'),
  zoomSize: document.getElementById('zoom-map-size'),
  zoomSpinner: document.getElementById('zoom-spinner'),
  zoomLoadingText: document.getElementById('zoom-loading-text'),
  zoomDownloadBtn: document.getElementById('zoom-download-btn'),
  
  // Viewer Viewport
  viewport: document.getElementById('viewer-viewport'),
  container: document.getElementById('viewer-container'),
  
  // Floating Controls
  zoomInBtn: document.getElementById('zoom-in-btn'),
  zoomOutBtn: document.getElementById('zoom-out-btn'),
  zoomResetBtn: document.getElementById('zoom-reset-btn'),
  zoomFullscreenBtn: document.getElementById('zoom-fullscreen-btn'),
  zoomPercentageText: document.getElementById('zoom-percentage-text')
};

/* ==========================================================================
   APP INITIALIZATION
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  fetchCatalog();
  setupEventListeners();
  registerServiceWorker();
  fetchProjects().then(initProjects);
});

// Register Service Worker for offline caching
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(getAssetUrl('/sw.js'), { updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(err => console.warn('SW registration failed:', err));
  }
}

// Abort in-flight requests on page hide to allow bfcache restoration
window.addEventListener('pagehide', () => {
  if (fetchController) fetchController.abort();
});

// Re-initialize when page is restored from bfcache
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    fetchCatalog();
  }
});

/* --------------------------------------------------------------------------
   Theme & LocalStorage Persistence
   -------------------------------------------------------------------------- */
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeLogos(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeLogos(newTheme);
}

// Swaps the header and footer logo sources depending on theme
function updateThemeLogos(theme) {
  const logoSrc = theme === 'light' ? '/logo-dark.png' : '/logo.png';
  const resolvedSrc = getAssetUrl(logoSrc);
  
  if (DOM.headerLogo) DOM.headerLogo.src = resolvedSrc;
  if (DOM.footerLogo) DOM.footerLogo.src = resolvedSrc;
}

/* --------------------------------------------------------------------------
   Data Catalog Operations
   -------------------------------------------------------------------------- */
async function fetchCatalog() {
  // Abort any previous in-flight request
  if (fetchController) fetchController.abort();
  fetchController = new AbortController();

  try {
    let response = null;
    const attempts = [];
    const pathsToTry = getCatalogCandidates();

    for (const path of pathsToTry) {
      try {
        response = await fetch(path, { signal: fetchController.signal, cache: 'no-cache' });
        if (response.ok) {
          rememberCatalogLocation(path);
          break;
        }
        attempts.push(`${path} (${response.status})`);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        attempts.push(`${path} (${e.message})`);
      }
    }

    if (!response || !response.ok) {
      throw new Error(`Failed to load map catalog. Tried: ${attempts.join(', ')}`);
    }

    mapsList = await response.json();
    
    // Fallback if empty JSON or file load error
    if (!Array.isArray(mapsList)) {
      mapsList = [];
    }
    
    applyFilters();
    
    // Process deep linked hash routes on page load
    handleInitialHashRoute();
  } catch (error) {
    if (error.name === 'AbortError') return; // Intentional abort, do not log
    console.error('Error fetching maps catalog:', error);
    DOM.catalogStats.innerHTML = `<span style="color: var(--badge-pdf-text)">Error loading map catalog. Please make sure maps.json exists.</span>`;
  }
}

/* ==========================================================================
   FILTERING, SEARCH & SORTING
   ========================================================================== */
function applyFilters() {
  // Search Query filter
  const query = state.searchQuery.toLowerCase().trim();
  filteredMaps = mapsList.filter(map => {
    return getMapTitle(map).toLowerCase().includes(query) ||
      getMapFilename(map).toLowerCase().includes(query);
  });

  // Sorting
  sortFilteredMaps();
  
  // Reset pagination
  state.currentPage = 1;
  DOM.mapsGrid.innerHTML = ''; // clear grid before rendering first page
  
  // Render
  renderGallery();
  updateStats();
}

function sortFilteredMaps() {
  switch (state.sortBy) {
    case 'newest':
      filteredMaps.sort((a, b) => getMapTimestamp(b) - getMapTimestamp(a));
      break;
    case 'name-asc':
      filteredMaps.sort((a, b) => getMapTitle(a).localeCompare(getMapTitle(b)));
      break;
    case 'name-desc':
      filteredMaps.sort((a, b) => getMapTitle(b).localeCompare(getMapTitle(a)));
      break;
    case 'size-desc':
      filteredMaps.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
      break;
    case 'size-asc':
      filteredMaps.sort((a, b) => (Number(a.size) || 0) - (Number(b.size) || 0));
      break;
  }
}

function updateStats() {
  if (mapsList.length === 0) {
    DOM.catalogStats.textContent = 'No maps in showcase. Move files to /public/maps and run build-maps.';
    return;
  }

  if (filteredMaps.length === mapsList.length) {
    DOM.catalogStats.textContent = `Showing all ${mapsList.length} maps`;
  } else {
    DOM.catalogStats.textContent = `Showing ${filteredMaps.length} of ${mapsList.length} matching maps`;
  }

  updateSectionNavCounts();
  applyAllWorksSearch();
}

/* ==========================================================================
   UI RENDERING (GALLERY GRID & THUMBNAILS)
   ========================================================================== */
function createMapCard(map, options = {}) {
  const card = document.createElement('div');
  card.className = 'map-card';
  card.mapData = map;

  const title = getMapTitle(map);
  const filename = getMapFilename(map);
  const resolvedThumbUrl = getAssetUrl(map.thumbnailUrl);
  const resolvedHighResUrl = getAssetUrl(map.url);
  const sizeFormatted = formatSize(map.size);
  const safeTitle = escapeHtml(title);
  const safeFilename = escapeHtml(filename);
  const safeHighResUrl = escapeHtml(resolvedHighResUrl);

  card.innerHTML = `
    <div class="card-thumbnail-wrapper loading">
      <img alt="${safeTitle}" class="card-thumbnail-img" ${options.priority ? 'fetchpriority="high"' : 'loading="lazy"'}>
    </div>
    <div class="card-body">
      <h2 class="card-title">${safeTitle}</h2>
      <div class="card-meta">
        <div class="card-size-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          <span>${sizeFormatted}</span>
        </div>
        <button class="card-download-btn" data-url="${safeHighResUrl}" data-filename="${safeFilename}" title="Download Original File">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
      </div>
    </div>
  `;

  const wrapper = card.querySelector('.card-thumbnail-wrapper');
  const img = card.querySelector('.card-thumbnail-img');
  img.onload = () => {
    img.classList.add('loaded');
    wrapper.classList.remove('loading');
  };
  img.src = resolvedThumbUrl;

  return card;
}

function renderGallery() {
  if (filteredMaps.length === 0) {
    DOM.mapsGrid.style.display = 'none';
    DOM.emptyState.style.display = 'flex';
    return;
  }
  
  DOM.mapsGrid.style.display = 'grid';
  DOM.emptyState.style.display = 'none';
  
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = startIndex + state.itemsPerPage;
  const pageMaps = filteredMaps.slice(startIndex, endIndex);
  
  const fragment = document.createDocumentFragment();
  
  pageMaps.forEach((map, index) => {
    const card = createMapCard(map, { priority: startIndex + index < 4 });
    card.setAttribute('data-index', startIndex + index);
    fragment.appendChild(card);
  });
  
  DOM.mapsGrid.appendChild(fragment);
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ==========================================================================
   HIGH-RESOLUTION PAN-ZOOM ENGINES (THE HERO COMPONENT)
   ========================================================================== */
function openViewer(map) {
  zoomState.activeMap = map;
  
  const resolvedUrl = getAssetUrl(map.url);
  const filename = getMapFilename(map);
  const type = String(map.type || 'png');
  
  DOM.zoomTitle.textContent = getMapTitle(map);
  DOM.zoomBadge.textContent = type.toUpperCase();
  DOM.zoomBadge.className = 'badge badge-png';
  DOM.zoomSize.textContent = formatSize(map.size);
  DOM.zoomDownloadBtn.href = resolvedUrl;
  DOM.zoomDownloadBtn.setAttribute('download', filename);
  
  DOM.zoomSpinner.style.display = 'flex';
  DOM.zoomLoadingText.textContent = 'Preparing viewport...';
  DOM.container.innerHTML = '';
  
  DOM.zoomModal.style.display = 'flex';
  document.body.style.overflow = 'hidden'; // Lock background scrolling
  DOM.container.style.willChange = 'transform'; // GPU promote only when viewer is active
  
  // Set initial transforms
  zoomState.scale = 1.0;
  zoomState.panX = 0;
  zoomState.panY = 0;
  updateTransform();

  // Set the URL hash to support unique deep-linked map subpages!
  window.location.hash = `map=${encodeURIComponent(filename)}`;

  loadHighResImage(resolvedUrl);
}

// Load PNG/WebP High Res Image into viewer
function loadHighResImage(url) {
  const img = new Image();
  DOM.zoomLoadingText.textContent = 'Loading high-resolution map...';
  
  img.onload = () => {
    DOM.container.appendChild(img);
    DOM.zoomSpinner.style.display = 'none';
    fitToViewport();
  };
  
  img.onerror = () => {
    DOM.zoomSpinner.style.display = 'none';
    alert('Failed to load high-resolution image file.');
  };
  
  img.src = url;
}

function closeViewer() {
  DOM.zoomModal.style.display = 'none';
  document.body.style.overflow = ''; // Unlock scrolling
  DOM.container.style.willChange = ''; // Release GPU layer
  DOM.container.innerHTML = '';
  
  // Close fullscreen if active
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(err => {});
  }
  
  // Clear the hash route silently so we are back to main gallery view
  if (window.location.hash && window.location.hash.startsWith('#map=')) {
    history.replaceState("", document.title, window.location.pathname + window.location.search);
  }
  
  zoomState.activeMap = null;
}

/* --------------------------------------------------------------------------
   Deep Linking Hash Router helpers
   -------------------------------------------------------------------------- */
function handleInitialHashRoute() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#map=')) {
    const filename = decodeURIComponent(hash.substring(5));
    const map = mapsList.find(m => getMapFilename(m) === filename);
    if (map) {
      // Delay slightly to allow catalog layout calculations
      setTimeout(() => {
        openViewer(map);
      }, 100);
    }
  }
}

/* --------------------------------------------------------------------------
   Mathematical CSS Translation calculations
   -------------------------------------------------------------------------- */
function updateTransform() {
  DOM.container.style.transform = `translate3d(${zoomState.panX}px, ${zoomState.panY}px, 0) scale(${zoomState.scale})`;
  
  // Update floating indicator percentage
  const percentage = Math.round(zoomState.scale * 100);
  DOM.zoomPercentageText.textContent = `${percentage}%`;
}

// Center map inside viewer matching target coordinates
function fitToViewport() {
  const viewportWidth = DOM.viewport.clientWidth;
  const viewportHeight = DOM.viewport.clientHeight;
  const containerWidth = DOM.container.clientWidth;
  const containerHeight = DOM.container.clientHeight;
  
  if (containerWidth === 0 || containerHeight === 0) return;
  
  // Calculate fitting scale with a padding margin (40px)
  const pad = 40;
  const scaleX = (viewportWidth - pad) / containerWidth;
  const scaleY = (viewportHeight - pad) / containerHeight;
  
  let fitScale = Math.min(scaleX, scaleY);
  // Cap initial scale to maximum of 1.0 (actual size) to prevent small maps from bloating
  fitScale = Math.min(fitScale, 1.0);
  
  zoomState.scale = fitScale;
  
  // Center exactly in the middle of screen coordinates
  zoomState.panX = (viewportWidth - containerWidth * zoomState.scale) / 2;
  zoomState.panY = (viewportHeight - containerHeight * zoomState.scale) / 2;
  
  updateTransform();
}

// Zoom with buttons or scroll wheel centered on specific screen anchor
function zoomTo(nextScale, centerX, centerY) {
  // Clamp scale
  nextScale = Math.min(Math.max(nextScale, ZOOM_CONFIG.minScale), ZOOM_CONFIG.maxScale);
  
  if (nextScale === zoomState.scale) return;
  
  // 1. Calculate relative offsets in container space BEFORE zoom
  const containerX = (centerX - zoomState.panX) / zoomState.scale;
  const containerY = (centerY - zoomState.panY) / zoomState.scale;
  
  // 2. Adjust pan offsets AFTER zoom to keep focus centered on exactly the same pixel
  zoomState.panX = centerX - containerX * nextScale;
  zoomState.panY = centerY - containerY * nextScale;
  zoomState.scale = nextScale;
  
  updateTransform();
}

// Mouse dragging triggers
function startPanDrag(clientX, clientY) {
  zoomState.isDragging = true;
  zoomState.startX = clientX - zoomState.panX;
  zoomState.startY = clientY - zoomState.panY;
}

function continuePanDrag(clientX, clientY) {
  if (!zoomState.isDragging) return;
  zoomState.panX = clientX - zoomState.startX;
  zoomState.panY = clientY - zoomState.startY;
  updateTransform();
}

function stopPanDrag() {
  zoomState.isDragging = false;
}

/* ==========================================================================
   EVENT LISTENERS & BINDINGS
   ========================================================================== */
function setupEventListeners() {
  
  // --- Theme Toggle ---
  DOM.themeToggle.addEventListener('click', toggleTheme);
  
  // --- URL Hash Route Navigation Change ---
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#map=')) {
      const filename = decodeURIComponent(hash.substring(5));
      const map = mapsList.find(m => getMapFilename(m) === filename);
      if (map && (!zoomState.activeMap || getMapFilename(zoomState.activeMap) !== filename)) {
        openViewer(map);
      }
    } else {
      if (zoomState.activeMap) {
        closeViewer();
      }
    }
  });

  // --- Filtering & Searching Inputs ---
  const handleSearchInput = debounce((e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery) {
      DOM.clearSearch.style.display = 'block';
    } else {
      DOM.clearSearch.style.display = 'none';
    }
    applyFilters();
  }, 300);

  DOM.searchInput.addEventListener('input', handleSearchInput);
  
  DOM.clearSearch.addEventListener('click', () => {
    DOM.searchInput.value = '';
    state.searchQuery = '';
    DOM.clearSearch.style.display = 'none';
    applyFilters();
  });
  
  DOM.sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    applyFilters();
  });
  
  DOM.resetFiltersBtn.addEventListener('click', () => {
    DOM.searchInput.value = '';
    state.searchQuery = '';
    DOM.clearSearch.style.display = 'none';
    DOM.sortSelect.value = 'newest';
    state.sortBy = 'newest';
    applyFilters();
  });

  // --- Event Delegation for Maps Grid ---
  DOM.mapsGrid.addEventListener('click', (e) => {
    const downloadBtn = e.target.closest('.card-download-btn');
    if (downloadBtn) {
      triggerDownload(downloadBtn.dataset.url, downloadBtn.dataset.filename);
      return;
    }
    
    const card = e.target.closest('.map-card');
    if (card && card.mapData) {
      openViewer(card.mapData);
    }
  });

  // --- Intersection Observer for Infinite Scroll ---
  const scrollSentinel = document.getElementById('scroll-sentinel');
  if (scrollSentinel) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (state.currentPage * state.itemsPerPage < filteredMaps.length) {
          state.currentPage++;
          renderGallery();
        }
      }
    }, { rootMargin: '200px' });
    observer.observe(scrollSentinel);
  }
  
  // --- Zoom Modal Control Handles ---
  DOM.closeZoomBtn.addEventListener('click', closeViewer);
  
  DOM.zoomInBtn.addEventListener('click', () => {
    const nextScale = zoomState.scale * (1 + ZOOM_CONFIG.stepFactor);
    zoomTo(nextScale, DOM.viewport.clientWidth / 2, DOM.viewport.clientHeight / 2);
  });
  
  DOM.zoomOutBtn.addEventListener('click', () => {
    const nextScale = zoomState.scale * (1 - ZOOM_CONFIG.stepFactor);
    zoomTo(nextScale, DOM.viewport.clientWidth / 2, DOM.viewport.clientHeight / 2);
  });
  
  DOM.zoomResetBtn.addEventListener('click', fitToViewport);
  
  DOM.zoomFullscreenBtn.addEventListener('click', toggleFullscreen);

  // Keyboard Shortcuts (Esc close, +/- zoom)
  window.addEventListener('keydown', (e) => {
    if (DOM.zoomModal.style.display === 'flex') {
      if (e.key === 'Escape') {
        closeViewer();
      } else if (e.key === '=' || e.key === '+') {
        DOM.zoomInBtn.click();
      } else if (e.key === '-') {
        DOM.zoomOutBtn.click();
      } else if (e.key === '0') {
        DOM.zoomResetBtn.click();
      }
    }
  });

  // --- Pan & Zoom Mouse Event Bindings ---
  DOM.viewport.addEventListener('mousedown', (e) => {
    // Left click only
    if (e.button !== 0) return;
    e.preventDefault();
    startPanDrag(e.clientX, e.clientY);
  });
  
  window.addEventListener('mousemove', (e) => {
    if (!zoomState.isDragging) return;
    continuePanDrag(e.clientX, e.clientY);
  });
  
  window.addEventListener('mouseup', stopPanDrag);
  
  // Mouse Scroll Wheel Zoom (Fitted to Cursor Focus)
  let wheelRafId = null;
  DOM.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    if (wheelRafId) {
      cancelAnimationFrame(wheelRafId);
    }
    
    wheelRafId = requestAnimationFrame(() => {
      const rect = DOM.viewport.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      
      // Scroll velocity delta
      const delta = -e.deltaY;
      let nextScale;
      
      if (delta > 0) {
        nextScale = zoomState.scale * (1 + ZOOM_CONFIG.wheelFactor);
      } else {
        nextScale = zoomState.scale * (1 - ZOOM_CONFIG.wheelFactor);
      }
      
      zoomTo(nextScale, cursorX, cursorY);
    });
  }, { passive: false });
  
  // Double click resets to fit or zooms in
  DOM.viewport.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const rect = DOM.viewport.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    
    if (zoomState.scale > 1.0) {
      fitToViewport();
    } else {
      zoomTo(2.0, cursorX, cursorY);
    }
  });

  // --- Touch Gestures Mobile Bindings ---
  let touchStartDistance = 0;
  let touchStartScale = 1.0;
  
  DOM.viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      startPanDrag(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      // Setup pinch to zoom
      zoomState.isDragging = false;
      touchStartDistance = getTouchDistance(e.touches);
      touchStartScale = zoomState.scale;
    }
  });
  
  DOM.viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && zoomState.isDragging) {
      continuePanDrag(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      e.preventDefault();
      // Calculate dual touch pinch zoom
      const distance = getTouchDistance(e.touches);
      const factor = distance / touchStartDistance;
      const nextScale = touchStartScale * factor;
      
      // Calculate midpoint coordinates
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = DOM.viewport.getBoundingClientRect();
      
      zoomTo(nextScale, midX - rect.left, midY - rect.top);
    }
  }, { passive: false });
  
  DOM.viewport.addEventListener('touchend', (e) => {
    stopPanDrag();
    if (e.touches.length > 0) {
      // Re-trigger panning if one finger remains active
      startPanDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
  });

  // Handle browser viewport window resizing
  window.addEventListener('resize', () => {
    if (DOM.zoomModal.style.display === 'flex') {
      fitToViewport();
    }
  });
}

// Helpers for multi-touch finger tracking
function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Toggle native full screen interface
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    DOM.zoomModal.requestFullscreen()
      .then(() => {
        DOM.zoomFullscreenBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="fs-close"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>`;
      })
      .catch(err => {
        console.error(`Error activating fullscreen mode: ${err.message}`);
      });
  } else {
    document.exitFullscreen()
      .then(() => {
        DOM.zoomFullscreenBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fs-open"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
      });
  }
}

/* ==========================================================================
   WEB PROJECTS
   ========================================================================== */
let WEB_PROJECTS = [];

let filteredWebProjects = [...WEB_PROJECTS];
let projectSearchQuery = '';
let filteredAllWorks = [];
let allWorksSearchQuery = '';

function getCategoryBadgeClass(badgeClass) {
  return badgeClass || 'badge-webmap';
}

function normalizeProjectSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getProjectSearchText(project) {
  return normalizeProjectSearchText([
    project.id,
    project.title,
    project.category,
    project.year,
    project.description,
    project.inspiration,
    project.idea,
    ...(project.stack || [])
  ].join(' '));
}

function getProjectInitials(title) {
  return String(title || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
    .join('') || 'WP';
}

function getProjectPreviewMarkup(project, options = {}) {
  const safeTitle = escapeHtml(project.title);
  const safeCategory = escapeHtml(project.category);
  const safeInitials = escapeHtml(getProjectInitials(project.title));
  const badgeClass = getCategoryBadgeClass(project.badgeClass);
  const sizeClass = options.large ? ' project-preview-placeholder-large' : '';

  const createSlide = (index) => `
    <div class="carousel-slide project-preview-placeholder ${badgeClass}${sizeClass}" aria-label="${safeTitle} preview placeholder ${index}" role="img">
      <div class="project-preview-grid" aria-hidden="true"></div>
      <div class="project-preview-mark">${safeInitials} ${index}</div>
      <div class="project-preview-lines" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div class="project-preview-footer">
        <span>${safeCategory}</span>
      </div>
    </div>
  `;

  return `
    <div class="project-carousel" style="display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; width: 100%; height: 100%; pointer-events: none;">
      ${createSlide(1)}
      ${createSlide(2)}
      ${createSlide(3)}
    </div>
  `;
}

function createProjectCard(project) {
  const card = document.createElement('a');
  card.href = `./project/${encodeURIComponent(project.id)}/index.html`;
  card.className = 'project-card';
  card.dataset.id = project.id;
  card.style.textDecoration = 'none';

  const safeTitle = escapeHtml(project.title);
  const safeDesc = escapeHtml(project.description);
  const safeCategory = escapeHtml(project.category);
  const badgeClass = getCategoryBadgeClass(project.badgeClass);

  card.innerHTML = `
    <div class="project-thumbnail-wrapper">
      ${getProjectPreviewMarkup(project)}
      <span class="project-category-badge ${badgeClass}">${safeCategory}</span>
    </div>
    <div class="project-card-body">
      <h2 class="project-card-title">${safeTitle}</h2>
      <p class="project-card-desc">${safeDesc}</p>
      <div class="project-card-footer">
        <span class="project-card-category-label">${project.startDate ? escapeHtml(project.startDate) + ' to ' + escapeHtml(project.endDate) : escapeHtml(project.year)}</span>
        <span class="project-card-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="13 6 19 12 13 18"></polyline></svg>
        </span>
      </div>
    </div>
  `;

  return card;
}

function navigateToProjectCard(event) {
  const card = event.target.closest('.project-card');
  if (!card || event.defaultPrevented) return false;

  // Keep native link behavior for new-tab/window gestures.
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return true;
  }

  event.preventDefault();
  window.location.assign(card.href);
  return true;
}

function renderProjects(projects = filteredWebProjects) {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();

  projects.forEach(project => {
    fragment.appendChild(createProjectCard(project));
  });

  grid.appendChild(fragment);

  const emptyState = document.getElementById('projects-empty-state');
  grid.style.display = projects.length ? 'grid' : 'none';
  if (emptyState) emptyState.style.display = projects.length ? 'none' : 'flex';
}

function applyProjectSearch() {
  const query = normalizeProjectSearchText(projectSearchQuery.trim());
  const queryTerms = query.split(/\s+/).filter(Boolean);
  filteredWebProjects = queryTerms.length
    ? WEB_PROJECTS.filter(project => {
        const searchText = getProjectSearchText(project);
        return queryTerms.every(term => searchText.includes(term));
      })
    : [...WEB_PROJECTS];

  renderProjects();

  const stats = document.getElementById('projects-catalog-stats');
  if (stats) {
    stats.textContent = filteredWebProjects.length === WEB_PROJECTS.length
      ? `Showing all ${WEB_PROJECTS.length} web projects`
      : `Showing ${filteredWebProjects.length} of ${WEB_PROJECTS.length} matching web projects`;
  }
}

function clearProjectSearch() {
  const input = document.getElementById('project-search-input');
  const clearButton = document.getElementById('clear-project-search');
  if (input) input.value = '';
  if (clearButton) clearButton.style.display = 'none';
  projectSearchQuery = '';
  applyProjectSearch();
}

function getAllWorks() {
  return [
    ...mapsList.map(map => ({
      kind: 'map',
      item: map,
      searchText: normalizeProjectSearchText([
        'map',
        getMapTitle(map),
        getMapFilename(map),
        map.type
      ].join(' '))
    })),
    ...WEB_PROJECTS.map(project => ({
      kind: 'project',
      item: project,
      searchText: `project ${getProjectSearchText(project)}`
    }))
  ];
}

function renderAllWorks() {
  const grid = document.getElementById('all-works-grid');
  const emptyState = document.getElementById('all-works-empty-state');
  if (!grid) return;

  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();

  filteredAllWorks.forEach((work, index) => {
    fragment.appendChild(
      work.kind === 'map'
        ? createMapCard(work.item, { priority: index < 4 })
        : createProjectCard(work.item)
    );
  });

  grid.appendChild(fragment);
  grid.style.display = filteredAllWorks.length ? 'grid' : 'none';
  if (emptyState) emptyState.style.display = filteredAllWorks.length ? 'none' : 'flex';
}

function applyAllWorksSearch() {
  const allWorks = getAllWorks();
  const query = normalizeProjectSearchText(allWorksSearchQuery.trim());
  const queryTerms = query.split(/\s+/).filter(Boolean);
  filteredAllWorks = queryTerms.length
    ? allWorks.filter(work => queryTerms.every(term => work.searchText.includes(term)))
    : allWorks;

  renderAllWorks();

  const total = allWorks.length;
  const stats = document.getElementById('all-works-catalog-stats');
  if (stats) {
    stats.textContent = filteredAllWorks.length === total
      ? `Showing all ${total} works`
      : `Showing ${filteredAllWorks.length} of ${total} matching works`;
  }

  updateSectionNavCounts();
}

function updateSectionNavCounts() {
  const counts = {
    'maps-nav-count': mapsList.length,
    'projects-nav-count': WEB_PROJECTS.length,
    'all-works-nav-count': mapsList.length + WEB_PROJECTS.length
  };

  Object.entries(counts).forEach(([id, count]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = count;
  });
}

function clearAllWorksSearch() {
  const input = document.getElementById('all-works-search-input');
  const clearButton = document.getElementById('clear-all-works-search');
  if (input) input.value = '';
  if (clearButton) clearButton.style.display = 'none';
  allWorksSearchQuery = '';
  applyAllWorksSearch();
}





async function fetchProjects() {
  try {
    const res = await fetch('./projects.json');
    WEB_PROJECTS = await res.json();
    filteredWebProjects = [...WEB_PROJECTS];
  } catch (e) {
    console.error('Failed to load projects.json', e);
  }
}

function initProjects() {
  applyProjectSearch();
  applyAllWorksSearch();
  updateSectionNavCounts();

  const projectSearchInput = document.getElementById('project-search-input');
  const clearProjectSearchButton = document.getElementById('clear-project-search');
  const resetProjectSearchButton = document.getElementById('reset-project-search-btn');
  const allWorksSearchInput = document.getElementById('all-works-search-input');
  const clearAllWorksSearchButton = document.getElementById('clear-all-works-search');
  const resetAllWorksSearchButton = document.getElementById('reset-all-works-search-btn');

  if (projectSearchInput) {
    projectSearchInput.addEventListener('input', debounce(event => {
      projectSearchQuery = event.target.value;
      if (clearProjectSearchButton) {
        clearProjectSearchButton.style.display = projectSearchQuery ? 'block' : 'none';
      }
      applyProjectSearch();
    }, 300));
  }
  if (clearProjectSearchButton) clearProjectSearchButton.addEventListener('click', clearProjectSearch);
  if (resetProjectSearchButton) resetProjectSearchButton.addEventListener('click', clearProjectSearch);

  const projectsGrid = document.getElementById('projects-grid');
  if (projectsGrid) {
    projectsGrid.addEventListener('click', navigateToProjectCard);
  }

  if (allWorksSearchInput) {
    allWorksSearchInput.addEventListener('input', debounce(event => {
      allWorksSearchQuery = event.target.value;
      if (clearAllWorksSearchButton) {
        clearAllWorksSearchButton.style.display = allWorksSearchQuery ? 'block' : 'none';
      }
      applyAllWorksSearch();
    }, 300));
  }
  if (clearAllWorksSearchButton) clearAllWorksSearchButton.addEventListener('click', clearAllWorksSearch);
  if (resetAllWorksSearchButton) resetAllWorksSearchButton.addEventListener('click', clearAllWorksSearch);

  const allWorksGrid = document.getElementById('all-works-grid');
  if (allWorksGrid) {
    allWorksGrid.addEventListener('click', event => {
      if (navigateToProjectCard(event)) return;

      const downloadButton = event.target.closest('.card-download-btn');
      if (downloadButton) {
        triggerDownload(downloadButton.dataset.url, downloadButton.dataset.filename);
        return;
      }

      const mapCard = event.target.closest('.map-card');
      if (mapCard?.mapData) openViewer(mapCard.mapData);
    });
  }

  // project-modal removed; cards now navigate directly via <a> href

  document.querySelectorAll('.section-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.section-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const section = btn.dataset.section;
      const mapsGallery = document.querySelector('.gallery-container');
      const projectsSection = document.getElementById('projects-section');
      const allWorksSection = document.getElementById('all-works-section');
      const controlsSection = document.getElementById('maps-controls-section');
      const infoBanner = document.getElementById('maps-info-banner');
      const projectsControlsSection = document.getElementById('projects-controls-section');
      const projectsInfoBanner = document.getElementById('projects-info-banner');
      const allWorksControlsSection = document.getElementById('all-works-controls-section');
      const allWorksInfoBanner = document.getElementById('all-works-info-banner');

      if (section === 'maps') {
        mapsGallery.style.display = '';
        projectsSection.style.display = 'none';
        allWorksSection.style.display = 'none';
        if (controlsSection) controlsSection.style.display = '';
        if (infoBanner) infoBanner.style.display = '';
        if (projectsControlsSection) projectsControlsSection.style.display = 'none';
        if (projectsInfoBanner) projectsInfoBanner.style.display = 'none';
        if (allWorksControlsSection) allWorksControlsSection.style.display = 'none';
        if (allWorksInfoBanner) allWorksInfoBanner.style.display = 'none';
      } else if (section === 'projects') {
        mapsGallery.style.display = 'none';
        projectsSection.style.display = '';
        allWorksSection.style.display = 'none';
        if (controlsSection) controlsSection.style.display = 'none';
        if (infoBanner) infoBanner.style.display = 'none';
        if (projectsControlsSection) projectsControlsSection.style.display = '';
        if (projectsInfoBanner) projectsInfoBanner.style.display = '';
        if (allWorksControlsSection) allWorksControlsSection.style.display = 'none';
        if (allWorksInfoBanner) allWorksInfoBanner.style.display = 'none';
      } else {
        mapsGallery.style.display = 'none';
        projectsSection.style.display = 'none';
        allWorksSection.style.display = '';
        if (controlsSection) controlsSection.style.display = 'none';
        if (infoBanner) infoBanner.style.display = 'none';
        if (projectsControlsSection) projectsControlsSection.style.display = 'none';
        if (projectsInfoBanner) projectsInfoBanner.style.display = 'none';
        if (allWorksControlsSection) allWorksControlsSection.style.display = '';
        if (allWorksInfoBanner) allWorksInfoBanner.style.display = '';
      }
    });
  });

  window.addEventListener('keydown', e => {
    // Esc key reserved for zoom modal (handled in setupEventListeners)
  });
}
})();
