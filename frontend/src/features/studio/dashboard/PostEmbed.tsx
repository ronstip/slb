import { useEffect, useRef, useState } from 'react';
import { ExternalLink, AlertCircle } from 'lucide-react';

// ── Script loader ───────────────────────────────────────────────────────────
// Singleton: one <script> per src across the whole document. Subsequent calls
// resolve once the existing script's load event has fired (or immediately if
// already complete).

const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const existing = scriptPromises.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const existingTag = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existingTag) {
      if (existingTag.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existingTag.addEventListener('load', () => resolve());
      existingTag.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.addEventListener('load', () => {
      tag.dataset.loaded = 'true';
      resolve();
    });
    tag.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.body.appendChild(tag);
  });
  scriptPromises.set(src, promise);
  return promise;
}

// ── Platform detection ──────────────────────────────────────────────────────

type Platform = 'twitter' | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'linkedin' | 'unknown';

interface ParsedUrl {
  platform: Platform;
  url: string;
  /** Platform-specific id (tweet id, youtube video id, etc.). Undefined if not parseable. */
  id?: string;
}

function parseUrl(raw: string): ParsedUrl {
  const url = raw.trim();
  let host = '';
  let pathname = '';
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, '');
    pathname = u.pathname;
  } catch {
    return { platform: 'unknown', url };
  }

  if (host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') {
    const m = pathname.match(/\/status\/(\d+)/);
    return { platform: 'twitter', url, id: m?.[1] };
  }
  if (host === 'instagram.com') {
    const m = pathname.match(/\/(p|reel|tv)\/([^/]+)/);
    return { platform: 'instagram', url, id: m?.[2] };
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const m = pathname.match(/\/video\/(\d+)/);
    return { platform: 'tiktok', url, id: m?.[1] };
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const u = new URL(url);
    const v = u.searchParams.get('v') ?? undefined;
    const shorts = pathname.match(/\/shorts\/([^/]+)/);
    return { platform: 'youtube', url, id: v ?? shorts?.[1] };
  }
  if (host === 'youtu.be') {
    return { platform: 'youtube', url, id: pathname.slice(1) || undefined };
  }
  if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com')) {
    return { platform: 'facebook', url };
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    return { platform: 'linkedin', url };
  }
  return { platform: 'unknown', url };
}

// ── Window typings for embed SDKs ───────────────────────────────────────────

declare global {
  interface Window {
    twttr?: {
      widgets?: { load: (el?: HTMLElement) => void };
    };
    instgrm?: {
      Embeds?: { process: () => void };
    };
  }
}

// ── Main component ──────────────────────────────────────────────────────────

interface PostEmbedProps {
  url: string;
  /** Optional theme hint forwarded to platform-aware embeds (X, Instagram). */
  theme?: 'light' | 'dark';
}

export function PostEmbed({ url, theme = 'light' }: PostEmbedProps) {
  const parsed = parseUrl(url);
  if (!parsed.url) return null;
  switch (parsed.platform) {
    case 'twitter':   return <TwitterEmbed parsed={parsed} theme={theme} />;
    case 'instagram': return <InstagramEmbed parsed={parsed} />;
    case 'tiktok':    return <TikTokEmbed parsed={parsed} />;
    case 'youtube':   return <YouTubeEmbed parsed={parsed} />;
    case 'facebook':  return <FacebookEmbed parsed={parsed} />;
    case 'linkedin':  return <LinkedInEmbed parsed={parsed} />;
    default:          return <LinkCard parsed={parsed} />;
  }
}

// ── Twitter / X ─────────────────────────────────────────────────────────────

function TwitterEmbed({ parsed, theme }: { parsed: ParsedUrl; theme: 'light' | 'dark' }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadScript('https://platform.twitter.com/widgets.js')
      .then(() => {
        if (cancelled) return;
        const widgets = window.twttr?.widgets;
        if (widgets && ref.current) widgets.load(ref.current);
      })
      .catch(() => !cancelled && setErrored(true));
    return () => { cancelled = true; };
  }, [parsed.url]);

  if (errored) return <LinkCard parsed={parsed} />;

  return (
    <div ref={ref} className="w-full">
      <blockquote className="twitter-tweet" data-theme={theme} data-dnt="true">
        <a href={parsed.url}>{parsed.url}</a>
      </blockquote>
    </div>
  );
}

// ── Instagram ───────────────────────────────────────────────────────────────

function InstagramEmbed({ parsed }: { parsed: ParsedUrl }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadScript('https://www.instagram.com/embed.js')
      .then(() => {
        if (cancelled) return;
        window.instgrm?.Embeds?.process();
      })
      .catch(() => !cancelled && setErrored(true));
    return () => { cancelled = true; };
  }, [parsed.url]);

  if (errored) return <LinkCard parsed={parsed} />;

  return (
    <div ref={ref} className="w-full flex justify-center">
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={parsed.url}
        data-instgrm-version="14"
        style={{ background: '#FFF', border: 0, margin: 0, maxWidth: 540, width: '100%' }}
      >
        <a href={parsed.url}>{parsed.url}</a>
      </blockquote>
    </div>
  );
}

// ── TikTok ──────────────────────────────────────────────────────────────────

function TikTokEmbed({ parsed }: { parsed: ParsedUrl }) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadScript('https://www.tiktok.com/embed.js').catch(() => !cancelled && setErrored(true));
    return () => { cancelled = true; };
  }, [parsed.url]);

  if (errored) return <LinkCard parsed={parsed} />;

  return (
    <blockquote
      className="tiktok-embed"
      cite={parsed.url}
      data-video-id={parsed.id}
      style={{ maxWidth: 605, minWidth: 280, margin: '0 auto' }}
    >
      <section>
        <a href={parsed.url}>{parsed.url}</a>
      </section>
    </blockquote>
  );
}

// ── YouTube ─────────────────────────────────────────────────────────────────

function YouTubeEmbed({ parsed }: { parsed: ParsedUrl }) {
  if (!parsed.id) return <LinkCard parsed={parsed} />;
  return (
    <div className="w-full aspect-video">
      <iframe
        src={`https://www.youtube.com/embed/${parsed.id}`}
        title="YouTube video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full rounded-md border border-border"
      />
    </div>
  );
}

// ── Facebook ────────────────────────────────────────────────────────────────

function FacebookEmbed({ parsed }: { parsed: ParsedUrl }) {
  const src = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(parsed.url)}&show_text=true&width=500`;
  return (
    <div className="w-full flex justify-center">
      <iframe
        src={src}
        title="Facebook post"
        width={500}
        height={600}
        style={{ border: 'none', overflow: 'hidden', maxWidth: '100%' }}
        scrolling="no"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
      />
    </div>
  );
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

function LinkedInEmbed({ parsed }: { parsed: ParsedUrl }) {
  // LinkedIn requires a share URN to embed via /embed/feed/update/. We try to
  // extract one from common URL shapes; otherwise fall back to a link card.
  const match = parsed.url.match(/(urn:li:[a-zA-Z]+:\d+)/) ?? parsed.url.match(/-([0-9]{16,})-/);
  const urn = match ? (match[1] ?? `urn:li:share:${match[1]}`) : null;
  if (!urn) return <LinkCard parsed={parsed} />;
  return (
    <div className="w-full">
      <iframe
        src={`https://www.linkedin.com/embed/feed/update/${urn}`}
        title="LinkedIn post"
        width={504}
        height={600}
        style={{ border: 'none', maxWidth: '100%' }}
        allowFullScreen
      />
    </div>
  );
}

// ── Link card fallback ──────────────────────────────────────────────────────

function LinkCard({ parsed }: { parsed: ParsedUrl }) {
  let host = '';
  try { host = new URL(parsed.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  return (
    <a
      href={parsed.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-md border border-border bg-card p-3 text-sm hover:border-primary/40 transition-colors"
    >
      <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{host || 'External link'}</div>
        <div className="truncate text-foreground">{parsed.url}</div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
    </a>
  );
}
