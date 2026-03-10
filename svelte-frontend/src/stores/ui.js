// UI state store
import { writable } from 'svelte/store';

export const sidebarOpen = writable(true);
export const workspaceEnabled = writable(false);
export const currentView = writable('home'); // 'home' | 'board' | 'session' | 'connect'
