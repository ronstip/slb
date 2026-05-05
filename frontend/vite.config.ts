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
  // Only chunk leaf libraries that don't share React internals. Splitting
  // anything inside the React ecosystem (react, radix, router, react-query,
  // motion, …) creates cross-chunk circular imports that crash the app on
  // first paint — `Cannot read properties of undefined (reading 'forwardRef')`
  // because the shared React module hasn't finished initializing when a peer
  // chunk's top-level forwardRef call runs. Keep them together in `vendor`.
  if (id.includes('recharts')) return 'vendor-recharts'
  if (id.includes('chart.js') || id.includes('react-chartjs-2') || id.includes('chartjs-adapter-date-fns'))
    return 'vendor-chartjs'
  if (id.includes('d3-cloud') || id.includes('react-wordcloud')) return 'vendor-wordcloud'
  if (id.includes('react-grid-layout')) return 'vendor-grid-layout'
  if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf'
  if (id.includes('firebase')) return 'vendor-firebase'
  if (id.includes('lucide-react')) return 'vendor-icons'
  if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('mdast') || id.includes('hast'))
    return 'vendor-markdown'
  if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) return 'vendor-forms'
  if (id.includes('date-fns')) return 'vendor-date-fns'
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
