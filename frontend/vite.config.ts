import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target:       'https://api.tracker.etarmadillo.com',
        changeOrigin: true,
        secure:       true,
      },
      '/ws': {
        target:       'wss://api.tracker.etarmadillo.com',
        ws:           true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash]-v2.js',
        chunkFileNames: 'assets/[name]-[hash]-v2.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
