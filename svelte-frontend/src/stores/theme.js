import { writable, derived, get } from 'svelte/store';

// ---------------------------------------------------------------------------
//  Color utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

function darken(hex, amount) {
  const c = hexToRgb(hex);
  const f = 1 - amount;
  return rgbToHex(c.r * f, c.g * f, c.b * f);
}

function lighten(hex, amount) {
  const c = hexToRgb(hex);
  return rgbToHex(c.r + (255 - c.r) * amount, c.g + (255 - c.g) * amount, c.b + (255 - c.b) * amount);
}

function mixColors(hex1, hex2, weight) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  return rgbToHex(
    c1.r * weight + c2.r * (1 - weight),
    c1.g * weight + c2.g * (1 - weight),
    c1.b * weight + c2.b * (1 - weight),
  );
}

function hexToRgba(hex, alpha) {
  const c = hexToRgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function luminance(hex) {
  const c = hexToRgb(hex);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

// ---------------------------------------------------------------------------
//  Claude default palette (used before API themes load)
// ---------------------------------------------------------------------------

const claudeFallback = {
  name: 'Claude Dark',
  variant: 'dark',
  base00: '2F2E2B', base01: '35332F', base02: '3E3C37', base03: '6D6860',
  base04: '908B81', base05: 'B5B0A6', base06: 'E8E5DE', base07: 'FFFFFF',
  base08: 'E5534B', base09: 'DA7756', base0A: 'E5A84B', base0B: '57AB5A',
  base0C: '4EC9B0', base0D: '569CD6', base0E: 'C586C0', base0F: 'D7BA7D',
};

// Pre-computed CSS vars for Claude Dark so the first paint is instant
const claudeExactVars = {
  '--bg': '#2F2E2B',
  '--bg-alt': '#35332F',
  '--text': '#E8E5DE',
  '--text-secondary': '#B5B0A6',
  '--text-muted': '#908B81',
  '--text-dimmer': '#6D6860',
  '--accent': '#DA7756',
  '--accent-hover': '#E5886A',
  '--accent-bg': 'rgba(218, 119, 86, 0.12)',
  '--code-bg': '#1E1D1A',
  '--border': '#3E3C37',
  '--border-subtle': '#36342F',
  '--input-bg': '#393733',
  '--user-bubble': '#46423A',
  '--error': '#E5534B',
  '--success': '#57AB5A',
  '--warning': '#E5A84B',
  '--sidebar-bg': '#262522',
  '--sidebar-hover': '#302E2A',
  '--sidebar-active': '#3A3834',
  '--accent-8': 'rgba(218, 119, 86, 0.08)',
  '--accent-12': 'rgba(218, 119, 86, 0.12)',
  '--accent-15': 'rgba(218, 119, 86, 0.15)',
  '--accent-20': 'rgba(218, 119, 86, 0.20)',
  '--accent-25': 'rgba(218, 119, 86, 0.25)',
  '--accent-30': 'rgba(218, 119, 86, 0.30)',
  '--error-8': 'rgba(229, 83, 75, 0.08)',
  '--error-12': 'rgba(229, 83, 75, 0.12)',
  '--error-15': 'rgba(229, 83, 75, 0.15)',
  '--error-25': 'rgba(229, 83, 75, 0.25)',
  '--success-8': 'rgba(87, 171, 90, 0.08)',
  '--success-12': 'rgba(87, 171, 90, 0.12)',
  '--success-15': 'rgba(87, 171, 90, 0.15)',
  '--success-25': 'rgba(87, 171, 90, 0.25)',
  '--warning-bg': 'rgba(229, 168, 75, 0.12)',
  '--overlay-rgb': '255,255,255',
  '--shadow-rgb': '0,0,0',
  '--hl-comment': '#6D6860',
  '--hl-keyword': '#C586C0',
  '--hl-string': '#57AB5A',
  '--hl-number': '#DA7756',
  '--hl-function': '#569CD6',
  '--hl-variable': '#E5534B',
  '--hl-type': '#E5A84B',
  '--hl-constant': '#DA7756',
  '--hl-tag': '#E5534B',
  '--hl-attr': '#569CD6',
  '--hl-regexp': '#4EC9B0',
  '--hl-meta': '#D7BA7D',
  '--hl-builtin': '#DA7756',
  '--hl-symbol': '#D7BA7D',
  '--hl-addition': '#57AB5A',
  '--hl-deletion': '#E5534B',
};

// ---------------------------------------------------------------------------
//  Compute CSS variables from any base16 palette
// ---------------------------------------------------------------------------

function computeVars(theme) {
  const b = {};
  const keys = [
    'base00','base01','base02','base03','base04','base05','base06','base07',
    'base08','base09','base0A','base0B','base0C','base0D','base0E','base0F',
  ];
  for (const k of keys) b[k] = '#' + theme[k];

  const isLight = theme.variant === 'light';

  return {
    '--bg':             b.base00,
    '--bg-alt':         b.base01,
    '--text':           b.base06,
    '--text-secondary': b.base05,
    '--text-muted':     b.base04,
    '--text-dimmer':    b.base03,
    '--accent':         b.base09,
    '--accent-hover':   isLight ? darken(b.base09, 0.12) : lighten(b.base09, 0.12),
    '--accent-bg':      hexToRgba(b.base09, 0.12),
    '--code-bg':        isLight ? darken(b.base00, 0.03) : darken(b.base00, 0.15),
    '--border':         b.base02,
    '--border-subtle':  mixColors(b.base00, b.base02, 0.6),
    '--input-bg':       mixColors(b.base01, b.base02, 0.5),
    '--user-bubble':    isLight ? darken(b.base01, 0.03) : mixColors(b.base01, b.base02, 0.3),
    '--error':          b.base08,
    '--success':        b.base0B,
    '--warning':        b.base0A,
    '--sidebar-bg':     isLight ? darken(b.base00, 0.02) : darken(b.base00, 0.10),
    '--sidebar-hover':  mixColors(b.base00, b.base01, 0.5),
    '--sidebar-active': mixColors(b.base01, b.base02, 0.5),
    '--accent-8':       hexToRgba(b.base09, 0.08),
    '--accent-12':      hexToRgba(b.base09, 0.12),
    '--accent-15':      hexToRgba(b.base09, 0.15),
    '--accent-20':      hexToRgba(b.base09, 0.20),
    '--accent-25':      hexToRgba(b.base09, 0.25),
    '--accent-30':      hexToRgba(b.base09, 0.30),
    '--error-8':        hexToRgba(b.base08, 0.08),
    '--error-12':       hexToRgba(b.base08, 0.12),
    '--error-15':       hexToRgba(b.base08, 0.15),
    '--error-25':       hexToRgba(b.base08, 0.25),
    '--success-8':      hexToRgba(b.base0B, 0.08),
    '--success-12':     hexToRgba(b.base0B, 0.12),
    '--success-15':     hexToRgba(b.base0B, 0.15),
    '--success-25':     hexToRgba(b.base0B, 0.25),
    '--warning-bg':     hexToRgba(b.base0A, 0.12),
    '--overlay-rgb':    isLight ? '0,0,0' : '255,255,255',
    '--shadow-rgb':     '0,0,0',
    '--hl-comment':     b.base03,
    '--hl-keyword':     b.base0E,
    '--hl-string':      b.base0B,
    '--hl-number':      b.base09,
    '--hl-function':    b.base0D,
    '--hl-variable':    b.base08,
    '--hl-type':        b.base0A,
    '--hl-constant':    b.base09,
    '--hl-tag':         b.base08,
    '--hl-attr':        b.base0D,
    '--hl-regexp':      b.base0C,
    '--hl-meta':        b.base0F,
    '--hl-builtin':     b.base09,
    '--hl-symbol':      b.base0F,
    '--hl-addition':    b.base0B,
    '--hl-deletion':    b.base08,
  };
}

// Compute xterm.js / terminal color map
export function computeTerminalTheme(theme) {
  const b = {};
  const keys = [
    'base00','base01','base02','base03','base04','base05','base06','base07',
    'base08','base09','base0A','base0B','base0C','base0D','base0E','base0F',
  ];
  for (const k of keys) b[k] = '#' + theme[k];
  const isLight = theme.variant === 'light';

  return {
    background:          isLight ? darken(b.base00, 0.03) : darken(b.base00, 0.15),
    foreground:          b.base05,
    cursor:              b.base06,
    selectionBackground: hexToRgba(b.base02, 0.5),
    black:               isLight ? b.base07 : b.base00,
    red:                 b.base08,
    green:               b.base0B,
    yellow:              b.base0A,
    blue:                b.base0D,
    magenta:             b.base0E,
    cyan:                b.base0C,
    white:               isLight ? b.base00 : b.base05,
    brightBlack:         b.base03,
    brightRed:           isLight ? darken(b.base08, 0.1) : lighten(b.base08, 0.1),
    brightGreen:         isLight ? darken(b.base0B, 0.1) : lighten(b.base0B, 0.1),
    brightYellow:        isLight ? darken(b.base0A, 0.1) : lighten(b.base0A, 0.1),
    brightBlue:          isLight ? darken(b.base0D, 0.1) : lighten(b.base0D, 0.1),
    brightMagenta:       isLight ? darken(b.base0E, 0.1) : lighten(b.base0E, 0.1),
    brightCyan:          isLight ? darken(b.base0C, 0.1) : lighten(b.base0C, 0.1),
    brightWhite:         b.base07,
  };
}

// ---------------------------------------------------------------------------
//  Theme validation
// ---------------------------------------------------------------------------

function validateTheme(t) {
  if (!t || typeof t !== 'object' || !t.name || typeof t.name !== 'string') return false;
  const keys = [
    'base00','base01','base02','base03','base04','base05','base06','base07',
    'base08','base09','base0A','base0B','base0C','base0D','base0E','base0F',
  ];
  for (const k of keys) {
    if (!t[k] || !/^[0-9a-fA-F]{6}$/.test(t[k])) return false;
  }
  if (t.variant && t.variant !== 'dark' && t.variant !== 'light') return false;
  if (!t.variant) {
    t.variant = luminance('#' + t.base00) > 0.5 ? 'light' : 'dark';
  }
  return true;
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'claude-relay-theme';

// ---------------------------------------------------------------------------
//  Stores
// ---------------------------------------------------------------------------

// All loaded themes keyed by id
const themes = writable({ claude: claudeFallback });

// Which ids came from custom user themes
const customSet = writable({});

// Whether the API theme load has completed
const themesLoaded = writable(false);

// The currently active theme id
export const currentTheme = writable('claude');

// Derived: the current theme's variant ('dark' | 'light')
export const currentVariant = derived(
  [currentTheme, themes],
  ([$id, $themes]) => {
    const t = $themes[$id] || claudeFallback;
    return t.variant || 'dark';
  },
);

// ---------------------------------------------------------------------------
//  Apply CSS variables to document root
// ---------------------------------------------------------------------------

function applyVarsToRoot(vars, variant) {
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }
  const isLight = variant === 'light';
  root.classList.toggle('light-theme', isLight);
  root.classList.toggle('dark-theme', !isLight);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--bg']);
}

// ---------------------------------------------------------------------------
//  setTheme  --  switch to a theme by id
// ---------------------------------------------------------------------------

export function setTheme(themeId) {
  const $themes = get(themes);
  const $loaded = get(themesLoaded);

  let theme = $themes[themeId];
  if (!theme) {
    themeId = 'claude';
    theme = $themes.claude || claudeFallback;
  }

  currentTheme.set(themeId);

  const vars = (themeId === 'claude' && !$loaded) ? claudeExactVars : computeVars(theme);
  applyVarsToRoot(vars, theme.variant || 'dark');

  try {
    localStorage.setItem(STORAGE_KEY, themeId);
    localStorage.setItem(STORAGE_KEY + '-vars', JSON.stringify(vars));
    localStorage.setItem(STORAGE_KEY + '-variant', theme.variant || 'dark');
  } catch (_) { /* storage full or blocked */ }
}

// ---------------------------------------------------------------------------
//  getThemes  --  return all loaded themes (snapshot)
// ---------------------------------------------------------------------------

export function getThemes() {
  return { ...get(themes) };
}

// ---------------------------------------------------------------------------
//  getThemePalette  --  get the raw base16 palette for a theme id
// ---------------------------------------------------------------------------

export function getThemePalette(id) {
  const $themes = get(themes);
  return $themes[id] || (id === 'claude' ? claudeFallback : null);
}

// ---------------------------------------------------------------------------
//  isCustomTheme  --  whether a theme id was loaded from user custom dir
// ---------------------------------------------------------------------------

export function isCustomTheme(id) {
  return !!get(customSet)[id];
}

// ---------------------------------------------------------------------------
//  getCurrentVars  --  get computed CSS var map for current theme
// ---------------------------------------------------------------------------

export function getCurrentVars() {
  const id = get(currentTheme);
  const $loaded = get(themesLoaded);
  if (id === 'claude' && !$loaded) return { ...claudeExactVars };
  const $themes = get(themes);
  return computeVars($themes[id] || claudeFallback);
}

// ---------------------------------------------------------------------------
//  getTerminalTheme  --  xterm.js color config for current theme
// ---------------------------------------------------------------------------

export function getTerminalTheme() {
  const id = get(currentTheme);
  const $themes = get(themes);
  return computeTerminalTheme($themes[id] || claudeFallback);
}

// ---------------------------------------------------------------------------
//  Load themes from API
// ---------------------------------------------------------------------------

async function loadThemes() {
  try {
    const res = await fetch('/api/themes');
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    if (!data) return;

    const bundled = data.bundled || {};
    const custom = data.custom || {};
    const newThemes = {};
    const newCustom = {};

    for (const [id, t] of Object.entries(bundled)) {
      if (validateTheme(t)) newThemes[id] = t;
    }
    for (const [id, t] of Object.entries(custom)) {
      if (validateTheme(t)) {
        newThemes[id] = t;
        newCustom[id] = true;
      }
    }

    // Ensure claude always present
    if (!newThemes.claude) newThemes.claude = claudeFallback;

    themes.set(newThemes);
    customSet.set(newCustom);
    themesLoaded.set(true);

    // Re-apply current theme now that real palettes are loaded
    setTheme(get(currentTheme));
  } catch (_) {
    // API unavailable -- keep claude fallback
    themes.set({ claude: claudeFallback });
    themesLoaded.set(true);
  }
}

// ---------------------------------------------------------------------------
//  initTheme  --  call once on app startup
// ---------------------------------------------------------------------------

export function initTheme() {
  // Restore saved theme id
  let saved = 'claude';
  try { saved = localStorage.getItem(STORAGE_KEY) || 'claude'; } catch (_) {}
  currentTheme.set(saved);

  // Apply Claude defaults immediately (instant first paint)
  if (saved === 'claude') {
    applyVarsToRoot(claudeExactVars, 'dark');
  }

  // Fetch full theme list from server, then re-apply
  loadThemes();

  // Sync across browser tabs
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue && e.newValue !== get(currentTheme)) {
        setTheme(e.newValue);
      }
    });
  }
}
