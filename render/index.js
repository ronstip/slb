/**
 * Headless widget render service.
 *
 * POST /render  → loads a chrome-less embed URL in headless Chromium, waits for
 * the page's readiness signal, and returns a PNG screenshot of one element.
 * It is channel-agnostic: the alert worker uses it for email today; the same
 * PNG works for Slack/Teams/WhatsApp later.
 *
 * Auth: a shared bearer in `x-render-token` (RENDER_SERVICE_TOKEN). The render
 * URL itself carries a separate, scoped token the API verifies — this service
 * never sees app data, only drives a browser.
 */
import express from 'express';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const RENDER_SERVICE_TOKEN = process.env.RENDER_SERVICE_TOKEN || '';
const NAV_TIMEOUT_MS = Number(process.env.RENDER_NAV_TIMEOUT_MS || 30000);
const READY_TIMEOUT_MS = Number(process.env.RENDER_READY_TIMEOUT_MS || 20000);

// One browser process for the life of the service; a fresh context per request
// keeps renders isolated and lets us set deviceScaleFactor per call.
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
    });
  }
  return browserPromise;
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/render', async (req, res) => {
  if (RENDER_SERVICE_TOKEN && req.get('x-render-token') !== RENDER_SERVICE_TOKEN) {
    return res.status(401).json({ error: 'bad render token' });
  }

  const {
    url,
    selector = '#alert-widget-capture',
    width = 1000,
    height = 420,
    deviceScaleFactor = 2,
    readySelector = 'body[data-alert-render-ready="1"]',
  } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: { width: Math.round(Number(width) + 80), height: Math.round(Number(height) + 80) },
      deviceScaleFactor: Number(deviceScaleFactor) || 2,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });

    // Surface an explicit render error from the embed page rather than timing out.
    const renderError = await page.evaluate(() => window.__alertRenderError || null);
    if (renderError) {
      await context.close();
      return res.status(502).json({ error: `embed render error: ${renderError}` });
    }

    // Prefer the data-attribute readiness flag; fall back to the window flag.
    await page
      .waitForSelector(readySelector, { timeout: READY_TIMEOUT_MS })
      .catch(async () => {
        await page.waitForFunction(() => window.__alertRenderReady === true, null, {
          timeout: 2000,
        });
      });

    const el = await page.$(selector);
    if (!el) {
      await context.close();
      return res.status(502).json({ error: `selector not found: ${selector}` });
    }

    const png = await el.screenshot({ type: 'png' });
    await context.close();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    return res.send(png);
  } catch (err) {
    if (context) await context.close().catch(() => {});
    console.error('render failed:', err);
    return res.status(504).json({ error: `render failed: ${err.message || String(err)}` });
  }
});

app.listen(PORT, () => {
  console.log(`scolto-render listening on :${PORT} (token ${RENDER_SERVICE_TOKEN ? 'required' : 'OPEN - dev only'})`);
});
