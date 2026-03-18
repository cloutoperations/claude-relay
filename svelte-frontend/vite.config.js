import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Read PIN hash from daemon.json to build dev auth cookie
function getDevAuthCookie() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude-relay', 'daemon.json'), 'utf8'));
    if (cfg.pinHash) return 'relay_auth=' + cfg.pinHash;
  } catch (e) {}
  return '';
}

const devCookie = getDevAuthCookie();

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all /p/ routes (including WebSocket) to relay dev server
      '/p/': {
        target: process.env.RELAY_URL || 'https://localhost:2633',
        ws: true,
        secure: false,
        headers: devCookie ? { Cookie: devCookie } : {},
      },
      '/auth': {
        target: process.env.RELAY_URL || 'https://localhost:2633',
        secure: false,
      },
      '/api/': {
        target: process.env.RELAY_URL || 'https://localhost:2633',
        secure: false,
        headers: devCookie ? { Cookie: devCookie } : {},
      },
    },
  },
  base: './',
  build: {
    outDir: 'dist',
  },
})
