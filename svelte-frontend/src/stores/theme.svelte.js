// Theme store — Svelte 5 runes version.
// Color utilities, palettes, and CSS variable computation.

// ---------------------------------------------------------------------------
//  Color utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function darken(hex, amount) { const c = hexToRgb(hex); const f = 1 - amount; return rgbToHex(c.r * f, c.g * f, c.b * f); }
function lighten(hex, amount) { const c = hexToRgb(hex); return rgbToHex(c.r + (255 - c.r) * amount, c.g + (255 - c.g) * amount, c.b + (255 - c.b) * amount); }

function mixColors(hex1, hex2, weight) {
  const c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
  return rgbToHex(c1.r * weight + c2.r * (1 - weight), c1.g * weight + c2.g * (1 - weight), c1.b * weight + c2.b * (1 - weight));
}

function hexToRgba(hex, alpha) { const c = hexToRgb(hex); return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`; }
function toRgbStr(hex) { const c = hexToRgb(hex); return `${c.r}, ${c.g}, ${c.b}`; }
function luminance(hex) { const c = hexToRgb(hex); return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255; }

// ---------------------------------------------------------------------------
//  Claude default palettes
// ---------------------------------------------------------------------------

const claudeFallback = {
  name: 'Claude Dark', variant: 'dark',
  base00: '2F2E2B', base01: '35332F', base02: '3E3C37', base03: '807A70',
  base04: 'A09A90', base05: 'C2BDB3', base06: 'E8E5DE', base07: 'FFFFFF',
  base08: 'E5534B', base09: 'DA7756', base0A: 'E5A84B', base0B: '57AB5A',
  base0C: '4EC9B0', base0D: '569CD6', base0E: 'C586C0', base0F: 'D7BA7D',
};

const claudeLightFallback = {
  name: 'Claude Light', variant: 'light',
  base00: 'F7F5F0', base01: 'EDEAE3', base02: 'D8D4CB', base03: '9E998F',
  base04: '78736A', base05: '504C46', base06: '35332F', base07: '1A1918',
  base08: 'D63D35', base09: 'C4613A', base0A: 'B88B20', base0B: '3D8B40',
  base0C: '2E9E8E', base0D: '3A7ABF', base0E: 'A560A5', base0F: 'A8893A',
};

// Pre-computed CSS vars for instant first paint
const claudeExactVars = computeVarsFromExact({
  bg: '#2F2E2B', bgAlt: '#35332F', text: '#E8E5DE', textSecondary: '#C2BDB3',
  textMuted: '#A09A90', textDimmer: '#807A70', accent: '#DA7756', accentHover: '#E5886A',
  codeBg: '#282623', border: '#3E3C37', borderSubtle: '#36342F', inputBg: '#3D3B37',
  userBubble: '#46423A', error: '#E5534B', success: '#57AB5A', warning: '#E5A84B',
  sidebarBg: '#282623', sidebarHover: '#33312D', sidebarActive: '#3C3A36',
  bgDeeper: '#282623', bgRaised: '#3A3835',
}, 'dark');

function computeVarsFromExact(c, variant) {
  const isLight = variant === 'light';
  const overlayRgb = isLight ? '0, 0, 0' : '255, 255, 255';
  return {
    '--bg': c.bg, '--bg-alt': c.bgAlt, '--bg-deeper': c.bgDeeper, '--bg-raised': c.bgRaised,
    '--text': c.text, '--text-secondary': c.textSecondary, '--text-muted': c.textMuted, '--text-dimmer': c.textDimmer,
    '--accent': c.accent, '--accent-hover': c.accentHover, '--accent-bg': hexToRgba(c.accent, 0.12),
    '--accent-rgb': toRgbStr(c.accent), '--error-rgb': toRgbStr(c.error), '--success-rgb': toRgbStr(c.success), '--warning-rgb': toRgbStr(c.warning),
    '--code-bg': c.codeBg, '--border': c.border, '--border-subtle': c.borderSubtle,
    '--input-bg': c.inputBg, '--user-bubble': c.userBubble,
    '--error': c.error, '--success': c.success, '--warning': c.warning,
    '--sidebar-bg': c.sidebarBg, '--sidebar-hover': c.sidebarHover, '--sidebar-active': c.sidebarActive,
    '--accent-8': hexToRgba(c.accent, 0.08), '--accent-12': hexToRgba(c.accent, 0.12),
    '--accent-15': hexToRgba(c.accent, 0.15), '--accent-20': hexToRgba(c.accent, 0.20),
    '--accent-25': hexToRgba(c.accent, 0.25), '--accent-30': hexToRgba(c.accent, 0.30),
    '--accent-40': hexToRgba(c.accent, 0.40), '--accent-50': hexToRgba(c.accent, 0.50),
    '--error-8': hexToRgba(c.error, 0.08), '--error-12': hexToRgba(c.error, 0.12),
    '--error-15': hexToRgba(c.error, 0.15), '--error-25': hexToRgba(c.error, 0.25),
    '--success-8': hexToRgba(c.success, 0.08), '--success-12': hexToRgba(c.success, 0.12),
    '--success-15': hexToRgba(c.success, 0.15), '--success-25': hexToRgba(c.success, 0.25),
    '--success-40': hexToRgba(c.success, 0.40),
    '--warning-bg': hexToRgba(c.warning, 0.12),
    '--overlay-rgb': overlayRgb, '--shadow-rgb': '0, 0, 0',
    '--hl-comment': '#6D6860', '--hl-keyword': '#C586C0', '--hl-string': '#57AB5A',
    '--hl-number': '#DA7756', '--hl-function': '#569CD6', '--hl-variable': '#E5534B',
    '--hl-type': '#E5A84B', '--hl-constant': '#DA7756', '--hl-tag': '#E5534B',
    '--hl-attr': '#569CD6', '--hl-regexp': '#4EC9B0', '--hl-meta': '#D7BA7D',
    '--hl-builtin': '#DA7756', '--hl-symbol': '#D7BA7D',
    '--hl-addition': '#57AB5A', '--hl-deletion': '#E5534B',
  };
}

// ---------------------------------------------------------------------------
//  Compute CSS variables from any base16 palette
// ---------------------------------------------------------------------------

function computeVars(theme) {
  const b = {};
  const keys = ['base00','base01','base02','base03','base04','base05','base06','base07','base08','base09','base0A','base0B','base0C','base0D','base0E','base0F'];
  for (const k of keys) b[k] = '#' + theme[k];
  const isLight = theme.variant === 'light';
  return {
    '--bg': b.base00, '--bg-alt': b.base01,
    '--bg-deeper': isLight ? lighten(b.base00, 0.03) : darken(b.base00, 0.06),
    '--bg-raised': isLight ? lighten(b.base00, 0.015) : lighten(b.base01, 0.04),
    '--text': b.base06, '--text-secondary': b.base05, '--text-muted': b.base04, '--text-dimmer': b.base03,
    '--accent': b.base09, '--accent-hover': isLight ? darken(b.base09, 0.12) : lighten(b.base09, 0.12),
    '--accent-bg': hexToRgba(b.base09, 0.12), '--accent-rgb': toRgbStr(b.base09),
    '--error-rgb': toRgbStr(b.base08), '--success-rgb': toRgbStr(b.base0B), '--warning-rgb': toRgbStr(b.base0A),
    '--code-bg': isLight ? darken(b.base00, 0.03) : darken(b.base00, 0.15),
    '--border': b.base02, '--border-subtle': mixColors(b.base00, b.base02, 0.6),
    '--input-bg': mixColors(b.base01, b.base02, 0.5),
    '--user-bubble': isLight ? darken(b.base01, 0.03) : mixColors(b.base01, b.base02, 0.3),
    '--error': b.base08, '--success': b.base0B, '--warning': b.base0A,
    '--sidebar-bg': isLight ? darken(b.base00, 0.02) : darken(b.base00, 0.10),
    '--sidebar-hover': mixColors(b.base00, b.base01, 0.5), '--sidebar-active': mixColors(b.base01, b.base02, 0.5),
    '--accent-8': hexToRgba(b.base09, 0.08), '--accent-12': hexToRgba(b.base09, 0.12),
    '--accent-15': hexToRgba(b.base09, 0.15), '--accent-20': hexToRgba(b.base09, 0.20),
    '--accent-25': hexToRgba(b.base09, 0.25), '--accent-30': hexToRgba(b.base09, 0.30),
    '--accent-40': hexToRgba(b.base09, 0.40), '--accent-50': hexToRgba(b.base09, 0.50),
    '--error-8': hexToRgba(b.base08, 0.08), '--error-12': hexToRgba(b.base08, 0.12),
    '--error-15': hexToRgba(b.base08, 0.15), '--error-25': hexToRgba(b.base08, 0.25),
    '--success-8': hexToRgba(b.base0B, 0.08), '--success-12': hexToRgba(b.base0B, 0.12),
    '--success-15': hexToRgba(b.base0B, 0.15), '--success-25': hexToRgba(b.base0B, 0.25),
    '--success-40': hexToRgba(b.base0B, 0.40),
    '--warning-bg': hexToRgba(b.base0A, 0.12),
    '--overlay-rgb': isLight ? '0, 0, 0' : '255, 255, 255', '--shadow-rgb': '0, 0, 0',
    '--hl-comment': b.base03, '--hl-keyword': b.base0E, '--hl-string': b.base0B,
    '--hl-number': b.base09, '--hl-function': b.base0D, '--hl-variable': b.base08,
    '--hl-type': b.base0A, '--hl-constant': b.base09, '--hl-tag': b.base08,
    '--hl-attr': b.base0D, '--hl-regexp': b.base0C, '--hl-meta': b.base0F,
    '--hl-builtin': b.base09, '--hl-symbol': b.base0F,
    '--hl-addition': b.base0B, '--hl-deletion': b.base08,
  };
}

export function computeTerminalTheme(theme) {
  const b = {};
  const keys = ['base00','base01','base02','base03','base04','base05','base06','base07','base08','base09','base0A','base0B','base0C','base0D','base0E','base0F'];
  for (const k of keys) b[k] = '#' + theme[k];
  const isLight = theme.variant === 'light';
  return {
    background: isLight ? darken(b.base00, 0.03) : darken(b.base00, 0.15),
    foreground: b.base05, cursor: b.base06, selectionBackground: hexToRgba(b.base02, 0.5),
    black: isLight ? b.base07 : b.base00, red: b.base08, green: b.base0B,
    yellow: b.base0A, blue: b.base0D, magenta: b.base0E, cyan: b.base0C,
    white: isLight ? b.base00 : b.base05, brightBlack: b.base03,
    brightRed: isLight ? darken(b.base08, 0.1) : lighten(b.base08, 0.1),
    brightGreen: isLight ? darken(b.base0B, 0.1) : lighten(b.base0B, 0.1),
    brightYellow: isLight ? darken(b.base0A, 0.1) : lighten(b.base0A, 0.1),
    brightBlue: isLight ? darken(b.base0D, 0.1) : lighten(b.base0D, 0.1),
    brightMagenta: isLight ? darken(b.base0E, 0.1) : lighten(b.base0E, 0.1),
    brightCyan: isLight ? darken(b.base0C, 0.1) : lighten(b.base0C, 0.1),
    brightWhite: b.base07,
  };
}

function validateTheme(t) {
  if (!t || typeof t !== 'object' || !t.name || typeof t.name !== 'string') return false;
  const keys = ['base00','base01','base02','base03','base04','base05','base06','base07','base08','base09','base0A','base0B','base0C','base0D','base0E','base0F'];
  for (const k of keys) { if (!t[k] || !/^[0-9a-fA-F]{6}$/.test(t[k])) return false; }
  if (t.variant && t.variant !== 'dark' && t.variant !== 'light') return false;
  if (!t.variant) t.variant = luminance('#' + t.base00) > 0.5 ? 'light' : 'dark';
  return true;
}

// ---------------------------------------------------------------------------
//  State (runes)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'claude-relay-theme';
const MODE_KEY = 'claude-relay-theme-mode';

// Internal state — plain variables, not exported, no .value needed
let themes = $state({ claude: claudeFallback, 'claude-light': claudeLightFallback });
let customSet = $state({});
let themesLoaded = false;

// Exported state — .value wrappers for cross-module mutation
export const currentTheme = $state({ value: 'claude' });
export const themeMode = $state({ value: 'auto' });

// Derived variant — exported as getter
function _getCurrentVariant() {
  const t = themes[currentTheme.value] || claudeFallback;
  return t.variant || 'dark';
}
export function getCurrentVariant() { return _getCurrentVariant(); }

// ---------------------------------------------------------------------------
//  OS preference detection
// ---------------------------------------------------------------------------

let prefersColorSchemeQuery = null;

function getOsPreference() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveAutoTheme() {
  return getOsPreference() === 'light' ? 'claude-light' : 'claude';
}

// ---------------------------------------------------------------------------
//  Apply CSS variables to document root
// ---------------------------------------------------------------------------

function applyVarsToRoot(vars, variant) {
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) root.style.setProperty(prop, value);
  const isLight = variant === 'light';
  root.classList.toggle('light-theme', isLight);
  root.classList.toggle('dark-theme', !isLight);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--bg']);
}

// ---------------------------------------------------------------------------
//  setTheme / setThemeMode
// ---------------------------------------------------------------------------

export function setTheme(themeId) {
  let theme = themes[themeId];
  if (!theme) { themeId = 'claude'; theme = themes.claude || claudeFallback; }
  currentTheme.value = themeId;
  const vars = (themeId === 'claude' && !themesLoaded) ? claudeExactVars : computeVars(theme);
  applyVarsToRoot(vars, theme.variant || 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, themeId);
    localStorage.setItem(STORAGE_KEY + '-vars', JSON.stringify(vars));
    localStorage.setItem(STORAGE_KEY + '-variant', theme.variant || 'dark');
  } catch (_) {}
}

export function setThemeMode(mode) {
  themeMode.value = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
  if (mode === 'auto') { setTheme(resolveAutoTheme()); } else { setTheme(mode); }
}

// ---------------------------------------------------------------------------
//  Getters
// ---------------------------------------------------------------------------

export function getThemes() { return { ...themes }; }
export function getThemePalette(id) { return themes[id] || (id === 'claude' ? claudeFallback : null); }
export function isCustomTheme(id) { return !!customSet[id]; }

export function getCurrentVars() {
  const id = currentTheme.value;
  if (id === 'claude' && !themesLoaded) return { ...claudeExactVars };
  return computeVars(themes[id] || claudeFallback);
}

export function getTerminalTheme() {
  return computeTerminalTheme(themes[currentTheme.value] || claudeFallback);
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

    const newThemes = {};
    const newCustom = {};
    for (const [id, t] of Object.entries(data.bundled || {})) { if (validateTheme(t)) newThemes[id] = t; }
    for (const [id, t] of Object.entries(data.custom || {})) { if (validateTheme(t)) { newThemes[id] = t; newCustom[id] = true; } }
    if (!newThemes.claude) newThemes.claude = claudeFallback;
    if (!newThemes['claude-light']) newThemes['claude-light'] = claudeLightFallback;

    themes = newThemes;
    customSet = newCustom;
    themesLoaded = true;

    if (themeMode.value === 'auto') { setTheme(resolveAutoTheme()); } else { setTheme(currentTheme.value); }
  } catch (_) {
    themes = { claude: claudeFallback, 'claude-light': claudeLightFallback };
    themesLoaded = true;
  }
}

// ---------------------------------------------------------------------------
//  initTheme — call once on app startup
// ---------------------------------------------------------------------------

export function initTheme() {
  try { localStorage.removeItem(STORAGE_KEY + '-vars'); } catch (_) {}

  let savedMode = 'auto';
  try { savedMode = localStorage.getItem(MODE_KEY) || 'auto'; } catch (_) {}
  themeMode.value = savedMode;

  let initialThemeId;
  if (savedMode === 'auto') {
    initialThemeId = resolveAutoTheme();
  } else {
    try { initialThemeId = localStorage.getItem(STORAGE_KEY) || savedMode; } catch (_) { initialThemeId = savedMode; }
  }

  currentTheme.value = initialThemeId;

  if (initialThemeId === 'claude') { applyVarsToRoot(claudeExactVars, 'dark'); }
  else if (initialThemeId === 'claude-light') { applyVarsToRoot(computeVars(claudeLightFallback), 'light'); }

  loadThemes();

  if (typeof window !== 'undefined') {
    // Remove previous listeners if initTheme called again (HMR)
    if (_themeCleanup) _themeCleanup();

    prefersColorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');
    const onSchemeChange = () => {
      if (themeMode.value === 'auto') setTheme(resolveAutoTheme());
    };
    const onStorage = (e) => {
      if (e.key === MODE_KEY && e.newValue) {
        themeMode.value = e.newValue;
        if (e.newValue === 'auto') setTheme(resolveAutoTheme());
      }
      if (e.key === STORAGE_KEY && e.newValue && e.newValue !== currentTheme.value) {
        if (themeMode.value !== 'auto') setTheme(e.newValue);
      }
    };
    prefersColorSchemeQuery.addEventListener('change', onSchemeChange);
    window.addEventListener('storage', onStorage);
    _themeCleanup = () => {
      prefersColorSchemeQuery.removeEventListener('change', onSchemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }
}
let _themeCleanup = null;
