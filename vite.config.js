import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        detail: resolve(__dirname, 'detail.html'),
      },
    },
  },
  server: {
    port: 5175,
    proxy: {
      '/api/align': {
        target: 'https://align.kohnai.ai',
        changeOrigin: true,
        secure: true,
      },
      '/api/audio': {
        target: 'https://align.kohnai.ai',
        changeOrigin: true,
        secure: true,
      },
      '/api/transcript': {
        target: 'https://align.kohnai.ai',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
