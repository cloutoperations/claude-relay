// Agents store — Svelte 5 runes
// Manages Ralph loops, cron jobs, and one-shot agents.
// State hydrated from server via agent_list, updated via agent_status events.

import { send } from './ws.svelte.js';

export const agents = $state({});
export const agentOrder = $state([]);

// Derived helpers
export function getAgentList() {
  return agentOrder.map(id => agents[id]).filter(Boolean);
}

export function getRunningCount() {
  return agentOrder.filter(id => agents[id]?.status === 'running').length;
}

// --- Hydrate from server ---

export function handleAgentList(list) {
  // Full replace from server
  const newOrder = [];
  for (const agent of list) {
    agents[agent.id] = agent;
    newOrder.push(agent.id);
  }
  agentOrder.length = 0;
  agentOrder.push(...newOrder);
}

export function handleAgentStatus(msg) {
  const id = msg.agentId || msg.id;
  if (!id) return;
  if (agents[id]) {
    Object.assign(agents[id], msg.data || msg);
  } else {
    // New agent we didn't know about
    agents[id] = msg.data || msg;
    if (!agentOrder.includes(id)) agentOrder.push(id);
  }
}

export function handleAgentCreated(agent) {
  agents[agent.id] = agent;
  if (!agentOrder.includes(agent.id)) agentOrder.push(agent.id);
}

export function handleAgentDeleted(msg) {
  const id = msg.agentId || msg.id;
  delete agents[id];
  const idx = agentOrder.indexOf(id);
  if (idx !== -1) agentOrder.splice(idx, 1);
}

// --- Actions (send to server) ---

export function createAgent(type, config) {
  send({ type: 'agent_create', agentType: type, config });
}

export function startAgent(id) {
  send({ type: 'agent_start', agentId: id });
}

export function stopAgent(id) {
  send({ type: 'agent_stop', agentId: id });
}

export function deleteAgent(id) {
  send({ type: 'agent_delete', agentId: id });
}

export function triggerAgent(id) {
  send({ type: 'agent_trigger', agentId: id });
}

export function updateAgent(id, config) {
  send({ type: 'agent_update', agentId: id, config });
}
