import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE_URL || 'http://localhost:3000'
  const wsBase = env.VITE_WS_URL || 'ws://localhost:3000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
          secure: apiBase.startsWith('https'),
        },
        '/ws': {
          target: wsBase,
          ws: true,
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
  }
})