import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'

// Get git commit count for version number
const getGitCommitCount = () => {
  try {
    return execSync('git rev-list --count HEAD').toString().trim()
  } catch {
    return '0'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(`1.${getGitCommitCount()}`),
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
})
