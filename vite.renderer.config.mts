import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true }
})
