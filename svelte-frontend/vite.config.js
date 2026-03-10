import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all /p/ routes (including WebSocket) to relay dev server
      '/p/': {
        target: 'https://localhost:2700',
        ws: true,
        secure: false, // accept self-signed certs
      },
      // Proxy API calls
      '/api': {
        target: 'https://localhost:2700',
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
