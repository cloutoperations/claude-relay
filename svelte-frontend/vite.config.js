import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all /p/ routes (including WebSocket) to relay dev server
      '/p/': {
        target: process.env.RELAY_URL || 'http://localhost:2633',
        ws: true,
        secure: false, // accept self-signed certs
      },
    },
  },
  base: './',
  build: {
    outDir: 'dist',
  },
})
