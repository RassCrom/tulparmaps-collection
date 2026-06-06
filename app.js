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
  initProjects();
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

  const mapsNavCount = document.getElementById('maps-nav-count');
  if (mapsNavCount) mapsNavCount.textContent = mapsList.length;
}

/* ==========================================================================
   UI RENDERING (GALLERY GRID & THUMBNAILS)
   ========================================================================== */
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
    const card = document.createElement('div');
    card.className = 'map-card';
    card.setAttribute('data-index', startIndex + index);
    card.mapData = map; // Store map data for event delegation
    
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
        <img alt="${safeTitle}" class="card-thumbnail-img" ${startIndex + index < 4 ? 'fetchpriority="high"' : 'loading="lazy"'}>
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
const WEB_PROJECTS = [
  {
    id: 'figura',
    title: 'Figura',
    category: 'Web Map',
    badgeClass: 'badge-webmap',
    year: '2024',
    url: 'https://figura-eight.vercel.app/',
    description: 'An interactive web cartography piece presenting spatial data through a carefully designed visual language. Clean vector rendering meets curated geographic layers.',
    inspiration: 'The challenge of building maps that feel like designed objects — where every visual decision serves both aesthetics and information clarity.',
    idea: 'Explore how a minimal map interface can carry rich spatial meaning without visual clutter, letting the geography speak for itself.',
    stack: ['Mapbox GL JS', 'JavaScript', 'Vercel']
  },
  {
    id: 'astana-buildings',
    title: 'Astana Buildings',
    category: 'Urban Map',
    badgeClass: 'badge-urbanmap',
    year: '2024',
    url: 'https://kbh-nu.vercel.app/',
    description: 'A 3D web map visualizing the building stock of Astana, Kazakhstan — exploring the city\'s rapid urban growth and architectural variety through extruded building footprints.',
    inspiration: 'Astana\'s transformation from a steppe outpost into a bold capital in just three decades, with its eclectic mix of Soviet-era blocks and futuristic showpieces.',
    idea: 'Render Astana\'s built environment in three dimensions to reveal patterns of density, height, and construction era across the city\'s districts.',
    stack: ['Mapbox GL JS', 'Deck.gl', 'GeoJSON', 'Vercel']
  },
  {
    id: 'tabiat-gis',
    title: 'Tabiat Küzeti',
    category: 'Web GIS',
    badgeClass: 'badge-webgis',
    year: '2024',
    url: 'https://tabiatgis.netlify.app/',
    description: 'A web GIS platform for nature observation and environmental monitoring. "Tabiat Küzeti" (Nature Watch) brings spatial ecological data to researchers, conservationists, and the public in an accessible web interface.',
    inspiration: 'The absence of open, interactive environmental mapping tools for Central Asian nature areas — and the need to bridge field ecology with modern geospatial technology.',
    idea: 'Build an open GIS platform that democratizes access to environmental data, empowering local communities and researchers with spatial intelligence about their natural surroundings.',
    stack: ['Leaflet', 'GeoJSON', 'PostGIS', 'Python', 'Netlify']
  },
  {
    id: 'tigranes-great',
    title: 'Tigranes the Great',
    category: 'Storytelling',
    badgeClass: 'badge-story',
    year: '2023',
    url: 'https://tigranes-great.netlify.app/',
    description: 'An immersive scrollytelling map chronicling the rise of the Armenian Empire under Tigranes II — at its peak stretching from the Caspian to the Mediterranean, making it one of antiquity\'s largest empires.',
    inspiration: 'The remarkable scale of Tigranes\'s empire and how little it appears in Western historical narratives, despite being a major power of the 1st century BC.',
    idea: 'Use scroll-driven cartographic storytelling to walk the viewer through the empire\'s territorial expansion, key campaigns, and eventual decline — making ancient geopolitics legible and visceral.',
    stack: ['Mapbox GL JS', 'Scrollama', 'JavaScript', 'Netlify']
  },
  {
    id: 'armenia-energy',
    title: 'Armenia Energy Profile',
    category: 'Data Viz',
    badgeClass: 'badge-dataviz',
    year: '2023',
    url: 'https://rasscrom.github.io/armenia-energy/',
    description: 'A data visualization of Armenia\'s energy sector — mapping electricity generation (7.7 TWh in 2021), infrastructure, and the country\'s transition toward renewables across thermal, hydro, nuclear, and solar sources.',
    inspiration: 'Armenia\'s unique energy mix anchored by the aging Metsamor Nuclear Plant alongside rapidly growing solar capacity — a country at a genuine energy crossroads.',
    idea: 'Present Armenia\'s energy landscape through interactive charts and geographic mapping, making complex energy statistics accessible and helping tell the story of the country\'s renewable transition.',
    stack: ['D3.js', 'Mapbox GL JS', 'JavaScript', 'GitHub Pages']
  },
  {
    id: 'tabiat-report',
    title: 'Tabiat Küzeti — Report',
    category: 'Data Report',
    badgeClass: 'badge-report',
    year: '2024',
    url: 'https://tabiatgis.netlify.app/report',
    description: 'The analytical reporting interface of the Tabiat Küzeti platform — an interactive data report presenting environmental indicators, land cover analysis, and ecological findings derived from spatial field data.',
    inspiration: 'The gap between raw GIS data collected in the field and clear, visual communication of findings to decision-makers and the public.',
    idea: 'Present research findings as an interactive web report that combines scientific data with readable visual storytelling — making ecology accessible beyond the specialist community.',
    stack: ['D3.js', 'Chart.js', 'Leaflet', 'Netlify']
  },
  {
    id: 'historical-vienna',
    title: 'Historical Vienna',
    category: 'Web Map',
    badgeClass: 'badge-webmap',
    year: '2023',
    url: 'https://rasscrom.github.io/historical-vienna/#14/48.2082/16.3638',
    description: 'An interactive web map of historical Vienna, overlaying archival cartography with modern geography to reveal how the imperial city\'s fabric — fortifications, the Ringstrasse, Habsburg districts — relates to the city today.',
    inspiration: 'Vienna\'s 19th-century transformation under Franz Joseph I remains one of urban history\'s most dramatic reshaping events, and old maps tell that story better than any text.',
    idea: 'Build a map viewer that lets users explore Vienna across time, comparing historical surveys with contemporary layers through an immersive, navigable web interface.',
    stack: ['Mapbox GL JS', 'Historical Tiles', 'GeoJSON', 'GitHub Pages']
  },
  {
    id: 'austria-income',
    title: 'Austrian Income by Districts',
    category: 'Data Viz',
    badgeClass: 'badge-dataviz',
    year: '2023',
    url: 'https://rasscrom.github.io/austria-income-pct25/income',
    description: 'A spatial visualization of income distribution across Austrian districts — mapping 2023 median income data disaggregated by gender, exposing regional disparities that aggregate national statistics obscure.',
    inspiration: 'The spatial dimension of economic inequality: that wealth and poverty are as much geographic phenomena as social ones, and that maps reveal patterns tables cannot.',
    idea: 'Map district-level income statistics to expose the west–east divide in Austrian earnings and highlight the persistent gender pay gap across all regions.',
    stack: ['Mapbox GL JS', 'D3.js', 'JavaScript', 'GitHub Pages']
  },
  {
    id: 'notable-kazakhs',
    title: 'Notable Kazakhs',
    category: 'Web Map',
    badgeClass: 'badge-webmap',
    year: '2023',
    url: 'https://rasscrom.github.io/notable-kazakhs/#4/48.39/67.62',
    description: 'An interactive map pinpointing the birthplaces and origins of notable Kazakhs throughout history — poets, scientists, politicians, and cultural figures — scattered across the vast Eurasian steppe.',
    inspiration: 'Kazakhstan\'s cultural heritage is rich with remarkable figures whose stories are spread across a territory as large as Western Europe, yet rarely mapped or collected in one place.',
    idea: 'Create a living geographic atlas of Kazakh national identity: collect biographical data for notable Kazakhs and map it, turning history into a spatial story of who came from where.',
    stack: ['Mapbox GL JS', 'GeoJSON', 'JavaScript', 'GitHub Pages']
  },
  {
    id: 'alash-orda',
    title: 'Alash Orda',
    category: 'Storytelling',
    badgeClass: 'badge-story',
    year: '2023',
    url: 'https://rasscrom.github.io/alash-orda/',
    description: 'A scroll-driven story map about the Alash Orda — the Kazakh nationalist movement and short-lived autonomous government (1917–1920) that arose amid the Russian Revolution and fought to preserve Kazakh statehood before being crushed by the Soviets.',
    inspiration: 'Alash Orda is one of the most significant chapters in modern Kazakh history, yet remains largely unknown. Its leaders were intellectuals who envisioned a modern, democratic Kazakh state — and paid with their lives.',
    idea: 'Use cartographic storytelling to bring this pivotal era to life: showing territorial claims, key events, and the political geography of the movement through animated maps and biographical portraits of its founders.',
    stack: ['Mapbox GL JS', 'Scrollama', 'JavaScript', 'GitHub Pages']
  }
];

let filteredWebProjects = [...WEB_PROJECTS];
let projectSearchQuery = '';

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

  return `
    <div class="project-preview-placeholder ${badgeClass}${sizeClass}" aria-label="${safeTitle} preview placeholder" role="img">
      <div class="project-preview-grid" aria-hidden="true"></div>
      <div class="project-preview-mark">${safeInitials}</div>
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
}

function renderProjects(projects = filteredWebProjects) {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();

  projects.forEach(project => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.id = project.id;

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
          <span class="project-card-category-label">${safeCategory}</span>
          <span class="project-card-arrow">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="13 6 19 12 13 18"></polyline></svg>
          </span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openProjectModal(project));
    fragment.appendChild(card);
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

function openProjectModal(project) {
  const modal = document.getElementById('project-modal');
  if (!modal) return;

  const preview = document.getElementById('project-modal-preview-placeholder');
  const liveBadge = document.getElementById('project-modal-live-badge');
  const liveLink = document.getElementById('project-modal-link');
  if (!preview || !liveBadge || !liveLink) return;

  preview.innerHTML = getProjectPreviewMarkup(project, { large: true });
  liveBadge.href = project.url;
  document.getElementById('project-modal-title').textContent = project.title;
  document.getElementById('project-modal-desc').textContent = project.description;
  document.getElementById('project-modal-inspiration').textContent = project.inspiration;
  document.getElementById('project-modal-idea').textContent = project.idea;
  document.getElementById('project-modal-year').textContent = project.year;
  liveLink.href = project.url;

  const metaBadge = document.getElementById('project-modal-meta-badge');
  metaBadge.textContent = project.category;
  metaBadge.className = `project-category-badge ${getCategoryBadgeClass(project.badgeClass)}`;

  const stackContainer = document.getElementById('project-modal-stack');
  stackContainer.innerHTML = project.stack
    .map(tech => `<span class="stack-tag">${escapeHtml(tech)}</span>`)
    .join('');

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeProjectModal() {
  const modal = document.getElementById('project-modal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

function initProjects() {
  applyProjectSearch();

  const projectsNavCount = document.getElementById('projects-nav-count');
  if (projectsNavCount) projectsNavCount.textContent = WEB_PROJECTS.length;

  const projectSearchInput = document.getElementById('project-search-input');
  const clearProjectSearchButton = document.getElementById('clear-project-search');
  const resetProjectSearchButton = document.getElementById('reset-project-search-btn');

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

  const closeProjectBtn = document.getElementById('project-modal-close');
  if (closeProjectBtn) closeProjectBtn.addEventListener('click', closeProjectModal);

  const projectModal = document.getElementById('project-modal');
  if (projectModal) {
    projectModal.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeProjectModal();
    });
  }

  document.querySelectorAll('.section-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.section-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const section = btn.dataset.section;
      const mapsGallery = document.querySelector('.gallery-container');
      const projectsSection = document.getElementById('projects-section');
      const controlsSection = document.querySelector('.controls-section');
      const infoBanner = document.getElementById('maps-info-banner');
      const projectsControlsSection = document.getElementById('projects-controls-section');
      const projectsInfoBanner = document.getElementById('projects-info-banner');

      if (section === 'maps') {
        mapsGallery.style.display = '';
        projectsSection.style.display = 'none';
        if (controlsSection) controlsSection.style.display = '';
        if (infoBanner) infoBanner.style.display = '';
        if (projectsControlsSection) projectsControlsSection.style.display = 'none';
        if (projectsInfoBanner) projectsInfoBanner.style.display = 'none';
      } else {
        mapsGallery.style.display = 'none';
        projectsSection.style.display = '';
        if (controlsSection) controlsSection.style.display = 'none';
        if (infoBanner) infoBanner.style.display = 'none';
        if (projectsControlsSection) projectsControlsSection.style.display = '';
        if (projectsInfoBanner) projectsInfoBanner.style.display = '';
      }
    });
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('project-modal');
      if (modal && modal.style.display === 'flex') closeProjectModal();
    }
  });
}
})();
