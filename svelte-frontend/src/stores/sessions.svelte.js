// Session list store — manages the list of all sessions from the server.
// No message handling — session-router updates us directly.

import { send } from './ws.svelte.js';
import { openTab } from './tabs.svelte.js';

// Clean up stale localStorage
try { localStorage.removeItem('claude-relay-active-session'); } catch {}

// --- State ---

export let sessionList = $state([]); // full session list from server
export const activeSessionId = $state({ value: null }); // legacy — used by board components
export let homeVisible = $state(true);
export let boardVisible = $state(false);

// Pending new-session request IDs
export let pendingNewSessionRequests = $state(new Set());

// Session search
export const sessionSearchQuery = $state({ value: '' });
export const sessionSearchResults = $state({ value: null }); // null = no search
export const searchSeq = $state({ value: 0 });
let searchDebounce = null;

// --- Derived ---

let _activeSession = $derived(
  sessionList.find(s => s.id === activeSessionId.value) || null
);

export function getActiveSession() { return _activeSession; }

// --- Public API ---

export function switchSession(sessionId) {
  openTab(sessionId, 'Session');
}

export function createSession(accountId, openFullscreen = true, projectPath = null) {
  const requestId = crypto.randomUUID();
  if (openFullscreen) pendingNewSessionRequests.add(requestId);
  const msg = { type: 'new_session', accountId: accountId || undefined, _requestId: requestId };
  if (projectPath) msg.projectPath = projectPath;
  send(msg);
}

export function deleteSession(sessionId) {
  send({ type: 'delete_session', id: sessionId });
}

export function renameSession(sessionId, title) {
  send({ type: 'rename_session', id: sessionId, title });
}

export function leaveSession() {
  send({ type: 'leave_session' });
  activeSessionId.value = null;
}

export function archiveSession(sessionId) {
  send({ type: 'archive_session', sessionId });
}

export function unarchiveSession(sessionId) {
  send({ type: 'unarchive_session', sessionId });
}

export function setSessionStatus(sessionId, status) {
  send({ type: 'set_session_status', sessionId, status });
}

// Session review agent — evaluates all open sessions against GTD context
export const pendingSessionReview = $state({ active: false, prompt: null });

export function startSessionReview(boardData) {
  if (!boardData) return;
  const openSessions = sessionList.filter(s => !s.archived && (s.status || 'open') !== 'done');
  if (openSessions.length === 0) return;

  const lines = openSessions.slice(0, 50).map(s => {
    const area = s.projectPath ? s.projectPath.split('/')[0] : 'untagged';
    const age = s.lastActivity ? Math.round((Date.now() - s.lastActivity) / 86400000) + 'd ago' : 'unknown';
    return `- "${s.title || 'Untitled'}" [${area}] (${age}, ${s.status || 'open'}) id:${s.id}`;
  });

  const areaContext = (boardData.areas || []).map(a =>
    `${a.name}: ${a.presentState ? 'Present: ' + a.presentState.substring(0, 100) : '(no TOTE)'}`
  ).join('\n');

  const prompt = `Review these ${openSessions.length} open sessions and suggest which ones should be marked as done or waiting.

## Open Sessions
${lines.join('\n')}

## Area Context
${areaContext}

## Instructions
For each session, evaluate:
1. Is the goal likely achieved based on the title? → suggest "done"
2. Is it stale (no activity in 7+ days) with no clear next step? → suggest "done"
3. Is it blocked on something external? → suggest "waiting" with reason
4. Is it still actively relevant? → keep as "open"

Then use these commands to update statuses:
\`\`\`
curl -X POST http://localhost:2633/p/clout-operations/api/set-session-status -H 'Content-Type: application/json' -d '{"sessionId":"<ID>","status":"done"}'
\`\`\`

Process all sessions now. Be decisive — mark things done aggressively. Open sessions should only be ones you'd actively work on this week.`;

  pendingSessionReview.active = true;
  pendingSessionReview.prompt = prompt;
  createSession(undefined, true, 'strategy');
}

export function bulkArchive(olderThanMs) {
  send({ type: 'bulk_archive', olderThan: olderThanMs });
}

// Pending auto-tagger: when active, next new session auto-sends tagging prompt
export const pendingAutoTag = $state({ active: false, customPrompt: null });

export function buildAutoTagPrompt() {
  const untagged = sessionList.filter(s => !s.archived && !s.projectPath);
  if (untagged.length === 0) return 'All sessions are already tagged.';
  const lines = untagged.slice(0, 30).map(s =>
    `- "${s.title || 'Untitled'}" (id: ${s.id})`
  );
  return `I have ${untagged.length} untagged sessions that need to be tagged to the right area/project.\n\nHere are the untagged sessions:\n${lines.join('\n')}\n\nFirst, fetch the board structure to see all areas and projects:\n\`\`\`\ncurl -s http://localhost:2633/p/clout-operations/api/board | head -200\n\`\`\`\n\nThen tag each session using:\n\`\`\`\ncurl -X POST http://localhost:2633/p/clout-operations/api/board/tag-session -H 'Content-Type: application/json' -d '{"sessionId":"<ID>","projectPath":"<area/project>"}'\n\`\`\`\n\nBased on each session title, match it to the most relevant area or project path. Tag all ${Math.min(untagged.length, 30)} sessions now.`;
}

export function startAutoTag() {
  pendingAutoTag.active = true;
  createSession(undefined, true, 'strategy');
}

// Area analysis agent
export const pendingAreaAnalysis = $state({ active: false, areaName: null, prompt: null });

export function startAreaAnalysis(areaName, boardData) {
  if (!areaName || !boardData) return;

  const area = boardData.areas?.find(a => a.name === areaName);
  if (!area) return;

  // Build rich context prompt
  const projects = area.projects.map(p => {
    const sessions = p.sessions?.length || 0;
    const subs = p.subProjects?.length || 0;
    return `  - ${p.name} (${sessions} sessions${subs ? ', ' + subs + ' subprojects' : ''})`;
  }).join('\n');

  const operations = (area.operations || []).map(o => {
    return `  - ${o.name}${o.description ? ': ' + o.description.substring(0, 80) : ''}`;
  }).join('\n');

  const recentSessions = [...(area.areaSessions || [])].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).slice(0, 10);
  const sessionLines = recentSessions.map(s => `  - "${s.title || 'Untitled'}" (${s.turnCount || '?'} turns, $${(s.totalCost || 0).toFixed(2)})`).join('\n');

  let prompt = `Analyse the "${areaName}" area. Read the TOTE doc and give me a strategic review.

## Area: ${areaName}

**Present State:**
${area.presentState || '(not documented)'}

**Desired State:**
${area.desiredState || '(not documented)'}

**Projects (${area.projects.length}):**
${projects || '  (none)'}

**Operations (${(area.operations || []).length}):**
${operations || '  (none)'}

**Recent Sessions (${recentSessions.length}):**
${sessionLines || '  (none)'}

## Instructions

1. Read the area TOTE doc: \`gtd/${areaName}/${areaName}.md\`
2. Scan the key project TOTEs (read the main .md in each project dir under \`gtd/${areaName}/01-projects/\`)
3. Check which operations are active vs stale
4. Analyse:
   - **Gap analysis**: What's the delta between Present and Desired state?
   - **What's on track**: Projects/operations making progress
   - **What needs attention**: Stale, blocked, or missing pieces
   - **Suggested next actions**: Top 3-5 concrete things to do next
5. Be specific — reference actual files, sessions, and data you find`;

  // Strategy area gets a special cross-area review prompt
  if (areaName === 'strategy') {
    const allAreas = boardData.areas || [];
    const crossAreaSummary = allAreas.map(a => {
      const projCount = a.projects?.length || 0;
      const opCount = (a.operations || []).length;
      const sessionCount = (a.areaSessions?.length || 0) + a.projects.reduce((n, p) => n + (p.sessions?.length || 0), 0);
      return `### ${a.name}
Present: ${a.presentState || '(none)'}
Desired: ${a.desiredState || '(none)'}
Projects: ${projCount} | Operations: ${opCount} | Sessions: ${sessionCount}`;
    }).join('\n\n');

    prompt = `Run a full strategic review across all areas.

## Goals (from gtd/strategy/goals.md)
Read \`gtd/strategy/goals.md\` for the current goals and focus.

## Cross-Area Summary

${crossAreaSummary}

## Instructions

1. Read \`gtd/strategy/strategy.md\` and \`gtd/strategy/goals.md\`
2. For each area, read its TOTE doc (\`gtd/{area}/{area}.md\`)
3. Answer the strategy TOTE test questions:
   - What is the highest-leverage move right now? (one sentence)
   - Are current operations closing the gap between present and desired?
   - Am I violating my principles? (simplicity first, don't build until you understand)
   - Is the spec-to-ship ratio healthy?
   - Does strategy align with goals, vision, purpose?
4. Produce:
   - **Cross-area alignment**: Which areas are on track, which are drifting?
   - **Resource allocation**: Where is time/energy going vs where it should go?
   - **Highest leverage move**: The single most impactful thing to do next
   - **Risks & patterns**: Over-building, avoidance, misalignment
   - **Recommended next actions**: Top 5, prioritized`;
  }

  pendingAreaAnalysis.active = true;
  pendingAreaAnalysis.areaName = areaName;
  pendingAreaAnalysis.prompt = prompt;

  createSession(undefined, true, areaName);
}

export function searchSessions(query) {
  sessionSearchQuery.value = query;
  if (searchDebounce) clearTimeout(searchDebounce);
  if (!query.trim()) {
    sessionSearchResults.value = null;
    return;
  }
  sessionSearchResults.value = null;
  searchDebounce = setTimeout(() => {
    searchSeq.value++;
    send({ type: 'search_sessions', query: query.trim(), _searchSeq: searchSeq.value });
  }, 200);
}
