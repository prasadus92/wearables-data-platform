import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Avoids CORS in dev; production builds set VITE_API_URL instead.
      '/v1': 'http://localhost:8000',
    },
  },
})
