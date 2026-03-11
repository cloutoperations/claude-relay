// Board store — GTD areas, projects, sessions, drill-down navigation
import { writable, derived, get } from 'svelte/store';
import { getBasePath } from './ws.js';

export const boardData = writable(null); // { areas: [], looseSessions: [] }
export const boardLoading = writable(false);
export const boardError = writable(null);
export const expandedAreas = writable(new Set());
export const expandedProjects = writable(new Set());

// Drill-down navigation: null | { type: 'area', name } | { type: 'project', path, areaName }
export const drilldownView = writable(null);

// Cached file content for project docs
export const fileCache = writable({});

// Total session count across all areas
export const totalBoardSessions = derived(boardData, ($data) => {
  if (!$data) return 0;
  let count = 0;
  for (const area of $data.areas) {
    for (const project of area.projects) {
      count += project.sessions.length;
      for (const sub of project.subProjects) count += sub.sessions.length;
    }
  }
  return count + ($data.looseSessions?.length || 0);
});

export async function fetchBoard() {
  boardLoading.set(true);
  boardError.set(null);
  try {
    const res = await fetch(getBasePath() + 'api/board');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    boardData.set(data);
  } catch (e) {
    boardError.set(e.message);
  } finally {
    boardLoading.set(false);
  }
}

export async function fetchBoardFile(filePath) {
  const cache = get(fileCache);
  if (cache[filePath]) return cache[filePath];
  try {
    const res = await fetch(getBasePath() + 'api/board/file?path=' + encodeURIComponent(filePath));
    if (!res.ok) return null;
    const content = await res.text();
    fileCache.update(c => ({ ...c, [filePath]: content }));
    return content;
  } catch (e) {
    return null;
  }
}

export function toggleArea(areaName) {
  expandedAreas.update(set => {
    const next = new Set(set);
    if (next.has(areaName)) next.delete(areaName);
    else next.add(areaName);
    return next;
  });
}

export function toggleProject(projectPath) {
  expandedProjects.update(set => {
    const next = new Set(set);
    if (next.has(projectPath)) next.delete(projectPath);
    else next.add(projectPath);
    return next;
  });
}

export function navigateToArea(areaName) {
  drilldownView.set({ type: 'area', name: areaName });
}

export function navigateToProject(projectPath, areaName) {
  drilldownView.set({ type: 'project', path: projectPath, areaName });
}

export function navigateHome() {
  drilldownView.set(null);
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

// Helper: get area by name
export function getArea(name) {
  const data = get(boardData);
  if (!data) return null;
  return data.areas.find(a => a.name === name) || null;
}

// Helper: get project or sub-project by path
export function getProject(path) {
  const data = get(boardData);
  if (!data) return null;
  for (const area of data.areas) {
    const proj = area.projects.find(p => p.path === path);
    if (proj) return proj;
    // Check sub-projects
    for (const p of area.projects) {
      const sub = p.subProjects.find(s => s.path === path);
      if (sub) return { ...sub, isDir: true, subProjects: [], parentProject: p.name };
    }
  }
  return null;
}

// Helper: get area name for a project path
export function getAreaForProject(projectPath) {
  const data = get(boardData);
  if (!data) return null;
  for (const area of data.areas) {
    if (area.projects.some(p => p.path === projectPath)) return area.name;
    for (const p of area.projects) {
      if (p.subProjects.some(s => s.path === projectPath)) return area.name;
    }
  }
  return null;
}
