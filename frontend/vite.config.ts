import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import prerender from '@prerenderer/rollup-plugin'

// Split heavy npm dependencies into their own chunks so:
//   1) the main entry bundle stays small (faster first paint),
//   2) individual chunks can be cached across deploys when only app code changes,
//   3) viz-only libs (recharts, chart.js, react-grid-layout, etc.) load on
//      demand alongside the route/tab that needs them.
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  // MDXEditor + its lexical/codemirror runtime are only reachable via the
  // dynamic import in MarkdownArtifactView. Returning undefined lets Rollup
  // emit them in the async chunk for that route instead of eagerly bundling
  // them into `vendor`. Safe because nothing eager imports these packages.
  if (
    id.includes('@mdxeditor') ||
    id.includes('@lexical') ||
    id.includes('/lexical/') ||
    id.includes('@codemirror') ||
    id.includes('@uiw/react-codemirror') ||
    id.includes('@lezer')
  )
    return undefined
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
  // Keep the entire unified/remark/rehype pipeline in a single chunk. Splitting
  // any of these out causes cross-chunk circular imports — e.g. `mdast-util-to-hast`
  // calls `convert` from `unist-util-is` at module top-level, so if they land in
  // different chunks the importing chunk hits `Cannot access 'Bn' before
  // initialization` on first paint.
  if (
    id.includes('react-markdown') ||
    id.includes('remark-') ||
    id.includes('rehype-') ||
    id.includes('micromark') ||
    id.includes('mdast') ||
    id.includes('hast') ||
    id.includes('/unified/') ||
    id.includes('/unist-util-') ||
    id.includes('/vfile') ||
    id.includes('/zwitch/') ||
    id.includes('/bail/') ||
    id.includes('/trough/') ||
    id.includes('/is-plain-obj/') ||
    id.includes('/parse5') ||
    id.includes('/property-information/') ||
    id.includes('/space-separated-tokens/') ||
    id.includes('/comma-separated-tokens/') ||
    id.includes('/decode-named-character-reference/') ||
    id.includes('/character-entities') ||
    id.includes('/stringify-entities/') ||
    id.includes('/web-namespaces/') ||
    id.includes('/html-void-elements/') ||
    id.includes('/markdown-table/') ||
    id.includes('/longest-streak/') ||
    id.includes('/ccount/') ||
    id.includes('/mdurl/')
  )
    return 'vendor-markdown'
  if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) return 'vendor-forms'
  if (id.includes('date-fns')) return 'vendor-date-fns'
  return 'vendor'
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Build-time prerender for the public landing route so Google and
    // AI crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) that don't
    // run JavaScript still see the full hero content.
    //
    // Prerender drives a headless Chromium via puppeteer. Set
    // DISABLE_PRERENDER=true to skip it entirely — used by the CI smoke-test
    // build, which only needs a working SPA and shouldn't pay the
    // (slow, flaky) Chromium download. Only the deploy build needs SEO HTML.
    ...(process.env.DISABLE_PRERENDER === 'true'
      ? []
      : [
          prerender({
            routes: ['/'],
            renderer: '@prerenderer/renderer-puppeteer',
            rendererOptions: {
              // HomeRoute checks window.__PRERENDER_INJECTED to skip the auth
              // loading spinner and render LandingPage directly during snapshot.
              inject: true,
              injectProperty: '__PRERENDER_INJECTED',
              // Capture after a fixed delay — long enough for React to mount,
              // lazy-load the LandingPage chunk, and render the hero.
              renderAfterTime: 8_000,
              maxConcurrentRoutes: 1,
              timeout: 60_000,
              headless: true,
              args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
              consoleHandler: (route: string, msg: { type: () => string; text: () => string }) => {
                // eslint-disable-next-line no-console
                console.log(`[prerender ${route}] ${msg.type()}: ${msg.text()}`);
              },
            },
          }),
        ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    // Match the production firebase.json hosting header so Firebase Auth's
    // popup-based sign-in can interact with the Google OAuth popup. Without
    // this, modern Chrome blocks `popup.closed` polling and `popup.close()`
    // calls when accounts.google.com (which sets COOP `same-origin`) is
    // opened from an opener with no COOP — the popup completes the auth
    // dance but the parent never learns the credential arrived.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    // Flip to 'hidden' once Sentry source-map upload lands (§C.1).
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
})
