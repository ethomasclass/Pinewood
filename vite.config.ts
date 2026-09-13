import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative so the built bundle can be served from any path, including alongside
  // a published artifact page where root-relative URLs are not served.
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
})
