import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Split heavy npm dependencies into their own chunks so:
//   1) the main entry bundle stays small (faster first paint),
//   2) individual chunks can be cached across deploys when only app code changes,
//   3) viz-only libs (recharts, chart.js, react-grid-layout, etc.) load on
//      demand alongside the route/tab that needs them.
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  if (id.includes('recharts')) return 'vendor-recharts'
  if (id.includes('chart.js') || id.includes('react-chartjs-2') || id.includes('chartjs-adapter-date-fns'))
    return 'vendor-chartjs'
  if (id.includes('d3-cloud') || id.includes('react-wordcloud')) return 'vendor-wordcloud'
  if (id.includes('react-grid-layout')) return 'vendor-grid-layout'
  if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf'
  if (id.includes('firebase')) return 'vendor-firebase'
  if (id.includes('motion')) return 'vendor-motion'
  if (id.includes('lucide-react')) return 'vendor-icons'
  if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('mdast') || id.includes('hast'))
    return 'vendor-markdown'
  if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) return 'vendor-forms'
  if (id.includes('date-fns')) return 'vendor-date-fns'
  if (id.includes('@tanstack/react-query')) return 'vendor-react-query'
  if (id.includes('react-router')) return 'vendor-router'
  if (id.includes('radix-ui') || id.includes('@radix-ui')) return 'vendor-radix'
  if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler'))
    return 'vendor-react'
  return 'vendor'
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
})
