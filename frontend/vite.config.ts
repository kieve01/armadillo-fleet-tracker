import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // En desarrollo, proxea /api y /ws al backend de producción
  // Así no se necesita backend local ni cambiar variables entre máquinas
  server: {
    proxy: {
      '/api': {
        target:      'https://api.tracker.etarmadillo.com',
        changeOrigin: true,
        secure:       true,
      },
      '/ws': {
        target:  'wss://api.tracker.etarmadillo.com',
        ws:       true,
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
