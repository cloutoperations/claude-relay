import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

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
      },
      '/auth': {
        target: process.env.RELAY_URL || 'https://localhost:2633',
        secure: false,
      },
      '/api/': {
        target: process.env.RELAY_URL || 'https://localhost:2633',
        secure: false,
      },
    },
  },
  base: './',
  build: {
    outDir: 'dist',
  },
})
