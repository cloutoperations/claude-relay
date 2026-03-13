// Board store — GTD areas, projects, sessions, drill-down navigation.
// Svelte 5 runes version.

import { getBasePath } from './ws.svelte.js';

// --- State ---

export const boardData = $state({ value: null }); // { areas: [], looseSessions: [] }
export const boardLoading = $state({ value: false });
export const boardError = $state({ value: null });
export const expandedAreas = $state({ value: new Set() });
export const expandedProjects = $state({ value: new Set() });
export const drilldownView = $state({ value: null }); // null | { type: 'area', name } | { type: 'project', path, areaName }
export let fileCache = $state({});

// Persisted focused area
let _savedFocus = null;
try { _savedFocus = localStorage.getItem('focusedArea') || null; } catch {}
export const focusedArea = $state({ value: _savedFocus });
$effect.root(() => {
  $effect(() => {
    try { if (focusedArea.value) localStorage.setItem('focusedArea', focusedArea.value); else localStorage.removeItem('focusedArea'); } catch {}
  });
});

// --- Derived ---

let _totalBoardSessions = $derived.by(() => {
  if (!boardData.value) return 0;
  let count = 0;
  for (const area of boardData.value.areas) {
    for (const project of area.projects) {
      count += project.sessions.length;
      for (const sub of project.subProjects) { if (sub.sessions) count += sub.sessions.length; }
    }
  }
  return count + (boardData.value.looseSessions?.length || 0);
});

export function getTotalBoardSessions() { return _totalBoardSessions; }

// --- API ---

export async function fetchBoard() {
  boardLoading.value = true;
  boardError.value = null;
  try {
    const res = await fetch(getBasePath() + 'api/board');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    boardData.value = await res.json();
  } catch (e) {
    boardError.value = e.message;
  } finally {
    boardLoading.value = false;
  }
}

export async function fetchBoardFile(filePath) {
  if (fileCache[filePath]) return fileCache[filePath];
  try {
    const res = await fetch(getBasePath() + 'api/board/file?path=' + encodeURIComponent(filePath));
    if (!res.ok) return null;
    const content = await res.text();
    fileCache[filePath] = content;
    return content;
  } catch (e) {
    return null;
  }
}

export function toggleArea(areaName) {
  if (expandedAreas.value.has(areaName)) expandedAreas.value.delete(areaName);
  else expandedAreas.value.add(areaName);
  expandedAreas.value = new Set(expandedAreas.value);
}

export function toggleProject(projectPath) {
  if (expandedProjects.value.has(projectPath)) expandedProjects.value.delete(projectPath);
  else expandedProjects.value.add(projectPath);
  expandedProjects.value = new Set(expandedProjects.value);
}

export function navigateToArea(areaName) {
  drilldownView.value = { type: 'area', name: areaName };
}

export function navigateToProject(projectPath, areaName) {
  drilldownView.value = { type: 'project', path: projectPath, areaName };
}

export function navigateHome() {
  drilldownView.value = null;
}

export async function tagSession(sessionId, projectPath) {
  try {
    await fetch(getBasePath() + 'api/board/tag-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, projectPath }),
    });
    await fetchBoard();
  } catch (e) {
    console.error('Failed to tag session:', e);
  }
}

export function getArea(name) {
  if (!boardData.value) return null;
  return boardData.value.areas.find(a => a.name === name) || null;
}

export function getProject(path) {
  if (!boardData.value) return null;
  for (const area of boardData.value.areas) {
    const proj = area.projects.find(p => p.path === path);
    if (proj) return proj;
    for (const p of area.projects) {
      const sub = p.subProjects.find(s => s.path === path);
      if (sub) return { ...sub, isDir: true, subProjects: [], parentProject: p.name };
    }
  }
  return null;
}

export function getAreaForProject(projectPath) {
  if (!boardData.value) return null;
  for (const area of boardData.value.areas) {
    if (area.projects.some(p => p.path === projectPath)) return area.name;
    for (const p of area.projects) {
      if (p.subProjects.some(s => s.path === projectPath)) return area.name;
    }
  }
  return null;
}
