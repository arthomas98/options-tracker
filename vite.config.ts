import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import packageJson from './package.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  // Environment variables prefixed with VITE_ are exposed to client
  // Set VITE_GOOGLE_CLIENT_ID in .env.local for development
  // For production, set in GitHub Actions or hosting environment
  envPrefix: 'VITE_',
  resolve: {
    alias: {
      // Force single React instance for all dependencies
      react: path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'chart.js', 'react-chartjs-2'],
  },
  // Multi-page app: landing page at /, React app at /app
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'app.html'),
      },
    },
  },
})
