// Board store — GTD areas, projects, sessions
import { writable, derived, get } from 'svelte/store';

export const boardData = writable(null); // { areas: [], looseSessions: [] }
export const boardLoading = writable(false);
export const boardError = writable(null);
export const expandedAreas = writable(new Set());
export const expandedProjects = writable(new Set());

// Total session count across all areas
export const totalBoardSessions = derived(boardData, ($data) => {
  if (!$data) return 0;
  let count = 0;
  for (const area of $data.areas) {
    for (const project of area.projects) {
      count += project.sessions.length;
    }
  }
  return count + ($data.looseSessions?.length || 0);
});

export async function fetchBoard() {
  boardLoading.set(true);
  boardError.set(null);
  try {
    const res = await fetch('./api/board');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    boardData.set(data);
  } catch (e) {
    boardError.set(e.message);
  } finally {
    boardLoading.set(false);
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

export async function tagSession(sessionId, projectPath) {
  try {
    await fetch('./api/board/tag-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, projectPath }),
    });
    // Refresh board data
    await fetchBoard();
  } catch (e) {
    console.error('Failed to tag session:', e);
  }
}
