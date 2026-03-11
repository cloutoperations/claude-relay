// UI state store
import { writable } from 'svelte/store';

export const sidebarOpen = writable(true);
export const workspaceEnabled = writable(false);
export const currentView = writable('home'); // 'home' | 'board' | 'session' | 'connect'

// Shared search query — set by Sidebar, consumed by SearchTimeline in chat area
export const chatSearchQuery = writable('');

// File panel visibility toggle (independent of whether files are open)
export const filePanelVisible = writable(true);
