/* ==========================================================================
   DYNAMIC ENVIRONMENT PATH RESOLVER
   ========================================================================== */
// VS Code Live Server defaults to port 5500, or pathname may contain '/public/'
const isLiveServer = window.location.port === '5500' || window.location.pathname.includes('/public/');
const BASE_PATH = isLiveServer ? '/public' : '';

function getAssetUrl(path) {
  if (!path) return '';
  
  // Handle paths that already start with public
  if (path.startsWith('/public') || path.startsWith('public')) {
    // Under Vite or Public Host (where public/ folder mounts at root), strip the prefix
    if (!isLiveServer) {
      return path.replace(/^\/?public/, '');
    }
    return path.startsWith('/') ? path : '/' + path;
  }
  
  // Format leading slash and prepend base path for Live Server compatibility
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return BASE_PATH + cleanPath;
}

/* ==========================================================================
   STATE MANAGEMENT
   ========================================================================== */
let mapsList = [];
let filteredMaps = [];

const state = {
  searchQuery: '',
  sortBy: 'newest' // 'newest', 'name-asc', 'name-desc', 'size-desc', 'size-asc'
};

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
  try {
    const response = await fetch(getAssetUrl('/maps.json'));
    if (!response.ok) throw new Error('Failed to load map catalog');
    mapsList = await response.json();
    
    // Fallback if empty JSON or file load error
    if (!Array.isArray(mapsList)) {
      mapsList = [];
    }
    
    applyFilters();
    
    // Process deep linked hash routes on page load
    handleInitialHashRoute();
  } catch (error) {
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
    return map.title.toLowerCase().includes(query) || map.filename.toLowerCase().includes(query);
  });

  // Sorting
  sortFilteredMaps();
  
  // Render
  renderGallery();
  updateStats();
}

function sortFilteredMaps() {
  switch (state.sortBy) {
    case 'newest':
      filteredMaps.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
      break;
    case 'name-asc':
      filteredMaps.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'name-desc':
      filteredMaps.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case 'size-desc':
      filteredMaps.sort((a, b) => b.size - a.size);
      break;
    case 'size-asc':
      filteredMaps.sort((a, b) => a.size - b.size);
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
}

/* ==========================================================================
   UI RENDERING (GALLERY GRID & THUMBNAILS)
   ========================================================================== */
function renderGallery() {
  DOM.mapsGrid.innerHTML = '';
  
  if (filteredMaps.length === 0) {
    DOM.mapsGrid.style.display = 'none';
    DOM.emptyState.style.display = 'flex';
    return;
  }
  
  DOM.mapsGrid.style.display = 'grid';
  DOM.emptyState.style.display = 'none';
  
  filteredMaps.forEach((map, index) => {
    const card = document.createElement('div');
    card.className = 'map-card';
    card.setAttribute('data-index', index);
    
    // Format badge (PNG, JPG, etc.)
    const badgeText = map.type.toUpperCase();
    const resolvedThumbUrl = getAssetUrl(map.thumbnailUrl);
    const resolvedHighResUrl = getAssetUrl(map.url);
    
    card.innerHTML = `
      <div class="card-thumbnail-wrapper">
        <span class="card-badge badge-png">${badgeText}</span>
        <img src="${resolvedThumbUrl}" alt="${map.title}" class="card-thumbnail-img" loading="lazy">
      </div>
      <div class="card-body">
        <h3 class="card-title">${map.title}</h3>
        <div class="card-meta">
          <div class="card-size-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            <span>${map.sizeFormatted}</span>
          </div>
          <button class="card-download-btn" data-url="${resolvedHighResUrl}" data-filename="${map.filename}" title="Download Original File">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>
      </div>
    `;
    
    // Zoom Viewer triggers on clicking card (except download button)
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-download-btn')) {
        const downloadBtn = e.target.closest('.card-download-btn');
        triggerDownload(downloadBtn.dataset.url, downloadBtn.dataset.filename);
        return;
      }
      openViewer(map);
    });
    
    DOM.mapsGrid.appendChild(card);
  });
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
  
  DOM.zoomTitle.textContent = map.title;
  DOM.zoomBadge.textContent = map.type.toUpperCase();
  DOM.zoomBadge.className = 'badge badge-png';
  DOM.zoomSize.textContent = map.sizeFormatted;
  DOM.zoomDownloadBtn.href = resolvedUrl;
  DOM.zoomDownloadBtn.setAttribute('download', map.filename);
  
  DOM.zoomSpinner.style.display = 'flex';
  DOM.zoomLoadingText.textContent = 'Preparing viewport...';
  DOM.container.innerHTML = '';
  
  DOM.zoomModal.style.display = 'flex';
  document.body.style.overflow = 'hidden'; // Lock background scrolling
  
  // Set initial transforms
  zoomState.scale = 1.0;
  zoomState.panX = 0;
  zoomState.panY = 0;
  updateTransform();

  // Set the URL hash to support unique deep-linked map subpages!
  window.location.hash = `map=${encodeURIComponent(map.filename)}`;

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
    const map = mapsList.find(m => m.filename === filename);
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
      const map = mapsList.find(m => m.filename === filename);
      if (map && (!zoomState.activeMap || zoomState.activeMap.filename !== filename)) {
        openViewer(map);
      }
    } else {
      if (zoomState.activeMap) {
        closeViewer();
      }
    }
  });

  // --- Filtering & Searching Inputs ---
  DOM.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery) {
      DOM.clearSearch.style.display = 'block';
    } else {
      DOM.clearSearch.style.display = 'none';
    }
    applyFilters();
  });
  
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
  DOM.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    
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
