import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useHead } from '@unhead/react';
import { useAuth } from './useAuth.ts';
import { captureGoogleEmail } from './firebase.ts';
import { apiPost } from '../api/client.ts';
import { ScoltoMark } from '../components/Logo.tsx';
import { SiteFooter } from '../landing/SiteFooter.tsx';
import { trackEvent } from '../lib/analytics.ts';

const FAQ_ITEMS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'What is Scolto?',
    a: "An AI agent for your brand, native to social. You ask it anything about your category; it listens, watches the video, reads the comments, and ships the brief, the dashboard, the deck or the digest your team already reads.",
  },
  {
    q: 'Who is Scolto for?',
    a: "Brand and insights leads at consumer companies. Agencies and competitive-intel teams use it too - anyone who walks into a room and has to explain what just happened in their category.",
  },
  {
    q: 'How does Scolto work?',
    a: "Brief it like a teammate: question, context, deliverable. It plans the research, pulls signals from the public web, watches the video frame-by-frame, weighs the comment thread, and writes back the read-out.",
  },
  {
    q: 'Where does the data come from?',
    a: "Public social, comments, video, reviews, forums and press - across TikTok, Instagram, YouTube, X, Reddit, Facebook and the open web. Licensed providers where required. No private DMs, ever.",
  },
  {
    q: 'How is hallucination handled?',
    a: "Every claim cites the post, clip or comment it came from - timecoded for video. If Scolto can't source it, it flags the gap instead of guessing. The receipts sit next to the read-out.",
  },
  {
    q: 'What does it cost?',
    a: "Usage-based - you pay for the work, not a seat. Plans run from $149/mo (Solo) to Studio for agencies, plus Scale for brand teams. Credits meter the reading; run out and you roll onto pay-as-you-go at the same rate. Full breakdown under Pricing above.",
  },
  {
    q: "How is this different from a social-listening dashboard?",
    a: "Dashboards count mentions and ask you to interpret them. Scolto ships the interpretation - what happened, why it matters, what to do - with the dashboard as a side artifact when you want one.",
  },
  {
    q: 'What about privacy?',
    a: "Only public conversation. Your briefs, outputs and workspace stay yours - we don't train on them or share them. Single sign-on with Google or Microsoft.",
  },
];

// ── Brand tokens ──────────────────────────────────────────────────────────────
const LP_BRAND = {
  orange:     '#D97757',
  orangeDeep: '#C25E3F',
  orangeSoft: '#F2D5C4',
  ink:        '#0F1F4D',
  slate:      '#29261B',
  slate2:     '#3A352A',
  cream:      '#F6F4EF',
  cream2:     '#EFEBE2',
  paper:      '#FBFAF6',
  rule:       '#E5E0D4',
  ruleDark:   '#3A352A',
  muted:      '#6E665A',
  mutedDark:  '#A29A8B',
  green:      '#2F8E6C',
  blue:       '#3A6FB6',
  purple:     '#7B5BD9',
  amber:      '#B6843A',
  pink:       '#E4405F',
} as const;

const PEOPLE = {
  creator1:  '/landing/people/creator1.jpg',
  creator3:  '/landing/people/creator3.jpg',
  creator4:  '/landing/people/creator4.jpg',
  creator5:  '/landing/people/creator5.jpg',
  creator6:  '/landing/people/creator6.jpg',
  creator8:  '/landing/people/creator8.jpg',
  vlog1:     '/landing/people/vlog1.jpg',
  sportPair: '/landing/people/sportPair.jpg',
  athlete:   '/landing/people/athlete.jpg',
  runner:    '/landing/people/runner.jpg',
  sneakers:  '/landing/people/sneakers.jpg',
};

const OSCARS = {
  jordan:   '/landing/oscars/jordan.jpg',
  pta:      '/landing/oscars/pta.jpg',
  dolby:    '/landing/oscars/dolby.jpg',
  dicaprio: '/landing/oscars/dicaprio.jpg',
};

// ── Shared primitives ─────────────────────────────────────────────────────────

const LP_Mono = ({
  children,
  color,
  size = 10.5,
  style = {},
}: {
  children: ReactNode;
  color?: string;
  size?: number;
  style?: CSSProperties;
}) => (
  <span
    style={{
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: size,
      color: color || LP_BRAND.muted,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      ...style,
    }}
  >
    {children}
  </span>
);

// Thin landing-page wrapper around the shared brand mark. The shared
// component uses `currentColor` for the brackets, so all we add here is the
// onDark color toggle.
const LP_ScoltoMark = ({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) => (
  <span
    style={{
      display: 'inline-flex',
      color: onDark ? LP_BRAND.cream : '#0F1F4D',
      flexShrink: 0,
    }}
  >
    <ScoltoMark size={size} />
  </span>
);

const LP_ScoltoLogo = ({
  markSize = 44,
  fontSize = 34,
  gap,
  onDark = false,
  showMark = true,
}: {
  markSize?: number;
  fontSize?: number;
  /** Optional override; defaults to markSize × 0.375 (the brand standalone ratio). */
  gap?: number;
  onDark?: boolean;
  showMark?: boolean;
}) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: gap ?? markSize * 0.375, lineHeight: 1 }}>
    {showMark && <LP_ScoltoMark size={markSize} onDark={onDark} />}
    <span
      style={{
        fontFamily: "'Fraunces', serif",
        fontStyle: 'italic',
        fontWeight: 400,
        fontSize,
        letterSpacing: '-0.026em',
        lineHeight: 1,
        color: onDark ? LP_BRAND.cream : '#0F1F4D',
        display: 'inline-flex',
        alignItems: 'baseline',
      }}
    >
      Scolto
    </span>
  </span>
);

type BotFig = { body: ReactNode; shade: ReactNode; antenna: ReactNode; eye: ReactNode };

const LP_AgentBot = ({
  hue = LP_BRAND.orange,
  variant = 1,
  size = 56,
}: {
  hue?: string;
  variant?: number;
  size?: number;
}) => {
  const v = ((variant % 4) + 4) % 4;
  const ink = '#0F1F4D';
  const dark = `color-mix(in oklab, ${hue} 80%, #0F1F4D)`;
  const figures: BotFig[] = [
    {
      body: <path d="M14 24 Q14 12 24 12 Q34 12 34 24 V44 Q34 50 28 50 H20 Q14 50 14 44 Z" fill={hue} />,
      shade: <path d="M14 24 Q14 12 24 12 Q24 12 24 12 V50 H20 Q14 50 14 44 Z" fill={dark} opacity="0.35" />,
      antenna: (
        <>
          <path d="M24 4 V12" stroke={ink} strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="24" cy="3.8" r="2.4" fill={hue} />
        </>
      ),
      eye: (
        <>
          <rect x="17" y="22" width="14" height="9" rx="2" fill={ink} />
          <path d="M20 26.5h8" stroke={hue} strokeWidth="1.8" strokeLinecap="round" />
        </>
      ),
    },
    {
      body: <path d="M10 28 Q10 14 24 14 Q38 14 38 28 V46 Q38 50 34 50 H14 Q10 50 10 46 Z" fill={hue} />,
      shade: <path d="M10 28 Q10 14 24 14 V50 H14 Q10 50 10 46 Z" fill={dark} opacity="0.32" />,
      antenna: (
        <>
          <path d="M18 8 V14" stroke={ink} strokeWidth="1" strokeLinecap="round" />
          <path d="M30 8 V14" stroke={ink} strokeWidth="1" strokeLinecap="round" />
          <circle cx="18" cy="7" r="1.8" fill={hue} />
          <circle cx="30" cy="7" r="1.8" fill={hue} />
        </>
      ),
      eye: (
        <>
          <rect x="14" y="24" width="20" height="8" rx="2" fill={ink} />
          <circle cx="20" cy="28" r="1.4" fill={hue} />
          <circle cx="28" cy="28" r="1.4" fill={hue} />
        </>
      ),
    },
    {
      body: (
        <>
          <path d="M6 22 Q6 8 24 8 Q42 8 42 22 Q42 26 38 26 H10 Q6 26 6 22 Z" fill={hue} />
          <rect x="16" y="26" width="16" height="22" rx="4" fill={hue} />
        </>
      ),
      shade: <path d="M6 22 Q6 8 24 8 V26 H10 Q6 26 6 22 Z" fill={dark} opacity="0.32" />,
      antenna: <path d="M24 2 V8" stroke={ink} strokeWidth="1.2" strokeLinecap="round" />,
      eye: (
        <>
          <rect x="13" y="14" width="22" height="7" rx="1.6" fill={ink} />
          <path d="M16 17.5h6M26 17.5h6" stroke={hue} strokeWidth="1.6" strokeLinecap="round" />
        </>
      ),
    },
    {
      body: <path d="M12 22 Q12 12 24 12 Q36 12 36 22 V48 H12 Z" fill={hue} />,
      shade: <path d="M12 22 Q12 12 24 12 V48 H12 Z" fill={dark} opacity="0.32" />,
      antenna: (
        <>
          <path d="M24 6 V12" stroke={ink} strokeWidth="1" strokeLinecap="round" />
          <path d="M21 5 H27" stroke={hue} strokeWidth="2.6" strokeLinecap="round" />
        </>
      ),
      eye: (
        <>
          <rect x="15" y="22" width="18" height="10" rx="2.5" fill={ink} />
          <circle cx="24" cy="27" r="2.2" fill={hue} />
        </>
      ),
    },
  ];
  const f = figures[v];
  return (
    <svg
      viewBox="0 0 48 56"
      width={(size * 48) / 56}
      height={size}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 4px 8px rgba(40,30,20,0.18))' }}
    >
      <ellipse cx="24" cy="51.5" rx="14" ry="1.8" fill="#000" opacity="0.16" />
      {f.body}
      {f.shade}
      {f.antenna}
      {f.eye}
      <path d="M30 14 Q34 16 35 22" stroke="#FFF" strokeOpacity="0.35" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
};

// ── Platform badges ──
// Brand glyphs lifted from the Scolto Design System marketing kit
// (ui_kits/marketing/shared.jsx). Real-brand 24x24 SVGs, rounded squares
// at 22% radius, with the production PLATFORM_COLORS palette.
type PlatformId =
  | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'reddit' | 'web'
  | 'slack' | 'whatsapp' | 'gmail' | 'notion';

const PLATFORMS: { id: PlatformId; label: string; color: string; glyph: ReactNode }[] = [
  { id: 'instagram', label: 'Instagram',
    color: 'radial-gradient(circle at 72% 108%, #FEDA77 0%, #F58529 40%, #DD2A7B 72%, #8134AF 94%, #515BD4 112%)',
    glyph: (<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" fill="#FFF" />) },
  { id: 'tiktok', label: 'TikTok', color: '#57534E',
    glyph: (<path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.3 0 .59.05.86.12V9.01a6.32 6.32 0 00-.86-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.98a8.21 8.21 0 004.77 1.52V7.05a4.83 4.83 0 01-1-.36z" fill="#FFF" />) },
  { id: 'youtube', label: 'YouTube', color: '#E03030',
    glyph: (<path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFF" />) },
  { id: 'facebook', label: 'Facebook', color: '#1877F2',
    glyph: (<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#FFF" />) },
  { id: 'x', label: 'X (Twitter)', color: '#0F0F0F',
    glyph: (<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="#FFF" />) },
  { id: 'reddit', label: 'Reddit', color: '#E05A00',
    glyph: (<path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z" fill="#FFF" />) },
  { id: 'web', label: 'Web', color: '#4285F4',
    glyph: (<><circle cx="12" cy="12" r="10" fill="none" stroke="#FFF" strokeWidth="2"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="#FFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>) },
  { id: 'slack', label: 'Slack', color: '#FFFFFF',
    glyph: (<><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/><path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/><path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/><path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/></>) },
  { id: 'whatsapp', label: 'WhatsApp', color: '#25D366',
    glyph: (<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="#FFF"/>) },
  { id: 'gmail', label: 'Email', color: '#EA4335',
    glyph: (<><path d="M5 8l7 5 7-5v8.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8z" fill="#FFF"/><path d="M5 8l7 5 7-5" stroke="#EA4335" strokeWidth="1.2" fill="none"/></>) },
  { id: 'notion', label: 'Notion', color: '#0F0F0F',
    glyph: (<><rect x="6" y="5" width="12" height="14" rx="1.5" fill="#FFF"/><path d="M9 8v8M9 8l6 8M15 8v8" stroke="#0F0F0F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></>) },
];

const LP_PlatformBadge = ({ id, size = 32 }: { id: PlatformId; size?: number }) => {
  const p = PLATFORMS.find(x => x.id === id) || PLATFORMS[0];
  return (
    <span
      title={p.label}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        background: p.color,
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        color: '#FFFFFF',
        boxShadow: '0 1px 2px rgba(15,12,8,0.18)',
        outline: '1px solid rgba(0,0,0,0.05)',
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} aria-label={p.label} style={{ display: 'block' }}>
        {p.glyph}
      </svg>
    </span>
  );
};

// ── Hero ──────────────────────────────────────────────────────────────────────

const ROTATING_DELIVERABLES = [
  'Writes the brief.',
  'Builds the dashboard.',
  'Spots the competitors.',
  'Ships the slide deck.',
  'Delivers the deep-dive.',
  'Pings the team.',
];

// Typewriter rotator: types a word, holds it, deletes back to empty, advances.
// Renders as plain inline text (no absolute positioning + no `overflow: hidden`)
// so the baseline matches surrounding inline text on every line wrap - that's
// what previously raised the rotator above "Reads the comments." on mobile.
const TYPE_MS = 65;
const DELETE_MS = 35;
const HOLD_MS = 2000;

const RotatingWord = ({
  words,
  color,
}: {
  words: string[];
  color: string;
}) => {
  const [wordIdx, setWordIdx] = useState(0);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'typing' | 'holding' | 'deleting'>('typing');

  useEffect(() => {
    const current = words[wordIdx] ?? '';
    let id: number;
    if (phase === 'typing') {
      if (text.length < current.length) {
        id = window.setTimeout(() => setText(current.slice(0, text.length + 1)), TYPE_MS);
      } else {
        id = window.setTimeout(() => setPhase('holding'), 0);
      }
    } else if (phase === 'holding') {
      id = window.setTimeout(() => setPhase('deleting'), HOLD_MS);
    } else {
      if (text.length > 0) {
        id = window.setTimeout(() => setText(text.slice(0, -1)), DELETE_MS);
      } else {
        id = window.setTimeout(() => {
          setWordIdx((idx) => (idx + 1) % words.length);
          setPhase('typing');
        }, 0);
      }
    }
    return () => clearTimeout(id);
  }, [text, phase, wordIdx, words]);

  return (
    <span style={{ color, fontWeight: 500 }}>
      {text}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: '0.08em',
          height: '0.95em',
          marginLeft: '0.05em',
          background: color,
          verticalAlign: '-0.12em',
          animation: 'lp-caret-blink 1s steps(1) infinite',
        }}
      />
    </span>
  );
};

const LP_Sparkline = ({
  values,
  color = LP_BRAND.orangeDeep,
  width = 120,
  height = 28,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) => {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 2) + 1;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = d + ` L ${width - 1} ${height - 1} L 1 ${height - 1} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" style={{ display: 'block' }}>
      <path d={area} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
};

const LP_FeedThumb = ({
  photo,
  platform,
  handle,
  caption,
  meta,
}: {
  photo: string;
  platform: PlatformId;
  handle: string;
  caption: string;
  meta: string;
}) => (
  <div
    style={{
      background: '#FFFFFF',
      border: `1px solid ${LP_BRAND.rule}`,
      borderRadius: 10,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    <div style={{ position: 'relative', aspectRatio: '4 / 5', overflow: 'hidden', background: '#000' }}>
      <img src={photo} alt="" referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 35%)' }} />
      <div style={{ position: 'absolute', top: 6, left: 6 }}>
        <LP_PlatformBadge id={platform} size={18} />
      </div>
      <div
        style={{
          position: 'absolute', top: 6, right: 6,
          padding: '1px 6px', borderRadius: 99, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
          fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 8, fontWeight: 600, color: '#FFF', letterSpacing: 0.3,
        }}
      >
        {meta}
      </div>
    </div>
    <div style={{ padding: '7px 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10.5, fontWeight: 600, color: LP_BRAND.ink, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{handle}</div>
      <div style={{
        fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: LP_BRAND.muted, lineHeight: 1.3,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      } as CSSProperties}>{caption}</div>
    </div>
  </div>
);

const LP_DailyRead = () => {
  const trend = [0.6, 0.8, 1.1, 1.4, 1.9, 11.8, 9.8];
  const sentimentBars = [
    { label: 'positive', pct: 64, color: '#3DA37D' },
    { label: 'neutral',  pct: 28, color: LP_BRAND.muted },
    { label: 'negative', pct:  8, color: LP_BRAND.orangeDeep },
  ];
  return (
    <article className="lp-daily-read" style={{
      background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 18,
      boxShadow: '0 40px 80px -40px rgba(40,30,20,0.32), 0 12px 28px -18px rgba(40,30,20,0.12)',
      overflow: 'hidden', width: 520, maxWidth: '100%', display: 'flex', flexDirection: 'column',
    }}>
      <div className="lp-daily-head" style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px',
        background: LP_BRAND.cream, borderBottom: `1px solid ${LP_BRAND.rule}`,
      }}>
        <LP_ScoltoMark size={20} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, minWidth: 0 }}>
          <span style={{ fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 14, color: LP_BRAND.ink }}>Weekly Read</span>
          <LP_Mono size={8.5} style={{ marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>Tue · 17 Mar · 09:14 PT</LP_Mono>
        </div>
        <span style={{ flex: 1 }} />
        <span className="lp-daily-fresh" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 99,
          background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, whiteSpace: 'nowrap',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: 99, background: '#3DA37D',
            boxShadow: '0 0 0 3px rgba(61,163,125,0.18)', animation: 'lp-pulse 1.8s ease-in-out infinite',
          }} />
          <LP_Mono size={9}>fresh · 6m ago</LP_Mono>
        </span>
      </div>

      <div style={{ padding: '18px 20px 6px' }}>
        <LP_Mono size={9.5}>Brief · 98th Academy Awards · ceremony week</LP_Mono>
        <h3 style={{
          margin: '6px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30,
          letterSpacing: -0.8, lineHeight: 1.05, color: LP_BRAND.ink,
        }}>
          The Oscars had a <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>three-film night</span> online.
        </h3>
        <p style={{ margin: '8px 0 0', fontFamily: "'Inter Tight',sans-serif", fontSize: 12.5, lineHeight: 1.5, color: LP_BRAND.muted }}>
          Michael B. Jordan's upset Best Actor win and the In-N-Out after-party are carrying positive sentiment.
          Sinners and One Battle After Another are splitting the prestige conversation. The KPop Demon Hunters
          speech cut-off is the only loud negative thread - and it's still climbing on TikTok.
        </p>
      </div>

      <div className="lp-daily-kpis" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 0, padding: '14px 20px 6px' }}>
        <div style={{ paddingRight: 14, borderRight: `1px solid ${LP_BRAND.rule}`, minWidth: 0 }}>
          <LP_Mono size={9}>mentions · 7d</LP_Mono>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span className="lp-daily-num" style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 400, color: LP_BRAND.ink, letterSpacing: -0.6 }}>27.4M</span>
            <span style={{ fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 10, fontWeight: 600, color: '#3DA37D' }}>+1,872%</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <LP_Sparkline values={trend} width={140} height={26} />
          </div>
        </div>
        <div style={{ padding: '0 14px', borderRight: `1px solid ${LP_BRAND.rule}`, minWidth: 0 }}>
          <LP_Mono size={9}>sentiment</LP_Mono>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span className="lp-daily-num" style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 400, color: LP_BRAND.ink, letterSpacing: -0.6 }}>+0.61</span>
          </div>
          <div style={{ marginTop: 6, display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', border: `1px solid ${LP_BRAND.rule}` }}>
            {sentimentBars.map(b => (
              <span key={b.label} title={`${b.label} ${b.pct}%`} style={{ width: `${b.pct}%`, background: b.color }} />
            ))}
          </div>
        </div>
        <div style={{ paddingLeft: 14, minWidth: 0 }}>
          <LP_Mono size={9}>reach</LP_Mono>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span className="lp-daily-num" style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 400, color: LP_BRAND.ink, letterSpacing: -0.6 }}>1.4B</span>
          </div>
          <div className="lp-daily-reach-badges" style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {(['tiktok','instagram','x','youtube','reddit'] as PlatformId[]).map(p => (
              <LP_PlatformBadge key={p} id={p} size={15} />
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 20px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <LP_Mono size={9.5}>top moments · ceremony night</LP_Mono>
        <span style={{ flex: 1, height: 1, background: LP_BRAND.rule }} />
        <LP_Mono size={9}>34.2k more</LP_Mono>
      </div>

      <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <LP_FeedThumb photo={OSCARS.jordan}   platform="instagram" handle="@eentertainment" caption="Michael B. Jordan: 'Yo momma, what's up?' - Best Actor speech for Sinners" meta="4.1M · 1:24" />
        <LP_FeedThumb photo={OSCARS.pta}      platform="x"         handle="@PopBase"        caption="Paul Thomas Anderson finally wins his first Oscar after 14 nominations" meta="8.4M views" />
        <LP_FeedThumb photo={OSCARS.dolby}    platform="x"         handle="@nextbestpic"    caption="The mess celebs left inside the Dolby Theatre after the ceremony…" meta="7.2M views" />
      </div>

      <div style={{
        margin: '18px 20px 0', padding: '14px 16px', background: LP_BRAND.cream,
        borderRadius: 12, border: `1px solid ${LP_BRAND.rule}`, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <LP_Mono size={9}>pull quote of the night</LP_Mono>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{
            fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 300, fontSize: 32,
            color: LP_BRAND.orangeDeep, lineHeight: 0.7, marginTop: 6,
          }}>"</span>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 300, fontSize: 18,
              lineHeight: 1.3, color: LP_BRAND.ink, letterSpacing: -0.2,
            }}>
              michael b jordan eating at in-n-out with his oscar is the most joyful thing i've seen all year
            </div>
            <LP_Mono size={9} style={{ marginTop: 6, display: 'block' }}>@PopBase · x · 312k likes</LP_Mono>
          </div>
        </div>
      </div>

      <div style={{
        margin: '12px 20px 18px', padding: '12px 14px', background: '#FFFFFF',
        border: `1px solid ${LP_BRAND.orange}66`, borderLeft: `3px solid ${LP_BRAND.orange}`,
        borderRadius: 10, display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6, background: `${LP_BRAND.orange}22`,
          display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1,
        }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke={LP_BRAND.orangeDeep} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12.5, fontWeight: 600, color: LP_BRAND.ink, lineHeight: 1.3 }}>
            #JusticeForYuhan still climbing on TikTok &amp; X
          </div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11.5, color: LP_BRAND.muted, lineHeight: 1.4, marginTop: 3 }}>
            41k posts in 36 hours after KPop Demon Hunters' co-writer Yu Han Lee was played off mid-speech.
            K-pop fan communities are organising; the story has legs through Wednesday's late-shows.
          </div>
        </div>
        <LP_Mono size={9} color={LP_BRAND.orangeDeep}>watch</LP_Mono>
      </div>
    </article>
  );
};

// Top-down beach umbrella - 8 scalloped fabric petals alternating rust / cream,
// with a tiny ink finial. The petal edges bulge outward (not straight radial
// lines) so it reads as canopy fabric, not a cog. Lifted from the design kit.
const LP_BeachUmbrellaWatermark = ({ size = 240 }: { size?: number }) => {
  const panels = 8;
  const step = 360 / panels;
  const R = 44;
  const bulge = 1.18;
  const petals: ReactNode[] = [];
  for (let i = 0; i < panels; i++) {
    const a0 = ((i * step - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * step - 90) * Math.PI) / 180;
    const am = (a0 + a1) / 2;
    const x0 = Math.cos(a0) * R, y0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R, y1 = Math.sin(a1) * R;
    const cx = Math.cos(am) * R * bulge * 1.35;
    const cy = Math.sin(am) * R * bulge * 1.35;
    const fill = i % 2 === 0 ? LP_BRAND.orange : '#F6F1E4';
    petals.push(
      <path key={i}
        d={`M0,0 L${x0.toFixed(2)},${y0.toFixed(2)} Q${cx.toFixed(2)},${cy.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)} Z`}
        fill={fill}
        stroke={LP_BRAND.orangeDeep}
        strokeOpacity="0.32"
        strokeWidth="0.5"
        strokeLinejoin="round" />
    );
  }
  return (
    <div style={{
      position: 'relative', width: size, height: size,
      opacity: 0.22,
      transform: 'translateY(calc(-8px + 1cm)) rotate(-8deg)',
    }} aria-hidden="true">
      <svg viewBox="-60 -60 120 120" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
        <ellipse cx="2" cy="3" rx="52" ry="50" fill={LP_BRAND.orangeDeep} opacity="0.06" />
        {petals}
        <circle cx="0" cy="0" r="7" fill={LP_BRAND.orange} stroke={LP_BRAND.orangeDeep} strokeOpacity="0.45" strokeWidth="0.5" />
        <circle cx="0" cy="0" r="3.5" fill={LP_BRAND.cream} />
        <circle cx="0" cy="0" r="1.6" fill={LP_BRAND.ink} />
      </svg>
    </div>
  );
};

// Credibility strip - single-row "by the numbers" beat. Sits between
// MeetScolto and the Friday preview. Editorial pull-line on the left,
// four Fraunces big stats on the right, divided by warm 1px rules.
const LP_Credibility = () => {
  return (
    <section className="lp-section" style={{ padding: '32px 64px 8px' }}>
      <div className="lp-credibility-row" style={{
        maxWidth: 1180, margin: '0 auto',
        borderTop: `1px solid ${LP_BRAND.rule}`, borderBottom: `1px solid ${LP_BRAND.rule}`,
        padding: '28px 0',
        display: 'grid', gridTemplateColumns: '1.05fr 1.95fr', gap: 56, alignItems: 'center',
      }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange,
              boxShadow: `0 0 0 4px ${LP_BRAND.orange}33`,
              animation: 'lp-pulse 1.8s ease-in-out infinite',
            }} />
            <LP_Mono color={LP_BRAND.orangeDeep}>Built to be trusted</LP_Mono>
          </div>
          <div style={{
            fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 26, lineHeight: 1.2,
            color: LP_BRAND.ink, letterSpacing: -0.4, maxWidth: 340,
          }}>
            Scolto's job is{' '}
            <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>to be right.</span>
            {' '}If it can't source a claim, it doesn't make one.
          </div>
        </div>
        <div className="lp-cred-stat" style={{ display: 'flex', alignItems: 'baseline', gap: 28 }}>
          <div className="lp-cred-num" style={{
            fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 140,
            letterSpacing: -4, lineHeight: 0.9, color: LP_BRAND.ink,
            fontVariantNumeric: 'tabular-nums',
          }}>100%</div>
          <div className="lp-cred-caption" style={{
            fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 300,
            fontSize: 22, lineHeight: 1.3, color: LP_BRAND.ink, maxWidth: 280,
          }}>
            of claims cited to the post, clip or comment they came from.
          </div>
        </div>
      </div>
    </section>
  );
};

// "What Friday looks like" - anchors its own beat below the centered hero.
// The Weekly Read card, rotated -1.2°, with a Live pill rotated -0.6°.
const LP_FridayPreview = () => (
  <section className="lp-section lp-friday-section" style={{ padding: '96px 64px 80px', position: 'relative' }}>
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <LP_Mono size={10.5} color={LP_BRAND.orangeDeep} style={{ marginBottom: 14 }}>What Friday looks like</LP_Mono>
      <h2
        className="lp-section-h2 lp-friday-h2"
        style={{
          margin: '0 0 64px',
          fontFamily: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
          fontWeight: 500, fontSize: 56,
          lineHeight: 1.0, letterSpacing: '-0.04em', color: LP_BRAND.ink, textAlign: 'center',
          fontVariationSettings: "'opsz' 64", maxWidth: 720,
        }}
      >
        Scolto reads the week. <span style={{ color: LP_BRAND.orangeDeep }}>You read the brief.</span>
      </h2>

      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <div
          className="lp-friday-glow"
          style={{
            position: 'absolute', inset: '-40px -120px',
            background: `radial-gradient(60% 80% at 50% 40%, ${LP_BRAND.orange}1f 0%, ${LP_BRAND.orange}08 40%, transparent 75%)`,
            borderRadius: 32, pointerEvents: 'none',
          }}
        />
        <div
          className="lp-friday-card-wrap"
          style={{
            position: 'relative', zIndex: 2,
            transform: 'rotate(-1.2deg)',
            filter: 'drop-shadow(0 30px 60px rgba(40,30,20,0.18))',
          }}
        >
          <LP_DailyRead />
          <div
            className="lp-friday-live-pill"
            style={{
              position: 'absolute', top: -30, left: 38, display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 13px 6px 9px', background: LP_BRAND.ink, color: LP_BRAND.cream, borderRadius: 99,
              boxShadow: '0 14px 28px -16px rgba(40,30,20,0.45)', zIndex: 4, transform: 'rotate(-0.6deg)',
            }}
          >
            <span
              style={{
                width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange,
                boxShadow: `0 0 0 4px ${LP_BRAND.orange}44`,
                animation: 'lp-pulse 1.6s ease-in-out infinite',
              }}
            />
            <LP_Mono size={9.5} color={LP_BRAND.cream}>live · 27.4M mentions / 7d</LP_Mono>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const LP_Hero = ({ openWaitlist }: { openWaitlist: (brief?: string) => void }) => {
  const [brief, setBrief] = useState('');
  const [focused, setFocused] = useState(false);
  const PLACEHOLDER = "Describe to Scolto what you need...";

  return (
    <section className="lp-section lp-hero-section" style={{ padding: '56px 64px 0', position: 'relative', overflow: 'hidden' }}>
      <div className="lp-hero-stack" style={{
        position: 'relative', zIndex: 2,
        maxWidth: 880, margin: '0 auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      }}>
        <div className="lp-hero-badge" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 28,
          padding: '6px 14px 6px 8px', borderRadius: 99, background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`,
        }}>
          <LP_AgentBot hue={LP_BRAND.orange} variant={1} size={24} />
          <LP_Mono size={10} color={LP_BRAND.orangeDeep}>Built for brand &amp; insights teams</LP_Mono>
        </div>

        <h1 className="lp-hero-h1" style={{
          margin: 0,
          fontFamily: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
          fontWeight: 400, fontSize: 88,
          lineHeight: 1.0, letterSpacing: '-0.035em', color: LP_BRAND.ink,
          fontVariationSettings: "'opsz' 88",
        }}>
          The first <span style={{ color: LP_BRAND.orangeDeep, fontWeight: 500 }}>AI&nbsp;agent</span>
          <br />on social.
        </h1>

        <p className="lp-hero-lede" style={{
          margin: '24px 0 0', maxWidth: 640,
          fontFamily: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
          fontWeight: 400, fontSize: 22,
          lineHeight: 1.4, color: LP_BRAND.ink, letterSpacing: '-0.018em',
          fontVariationSettings: "'opsz' 24",
        }}>
          Scolto watches the <span style={{ color: LP_BRAND.orangeDeep, fontWeight: 500 }}>video.</span>{' '}
          Reads the <span style={{ color: LP_BRAND.orangeDeep, fontWeight: 500 }}>comments.</span>
          <br />
          <RotatingWord words={ROTATING_DELIVERABLES} color={LP_BRAND.orangeDeep} />
        </p>

        <div
          className="lp-hero-form-wrap"
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            position: 'relative',
            marginTop: 120,
          }}
        >
          <div
            className="lp-hero-watermark"
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0,
              pointerEvents: 'none', zIndex: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: 'translateY(-151px)',
            }}
          >
            <LP_BeachUmbrellaWatermark size={240} />
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); openWaitlist(brief.trim() || undefined); }}
            className="lp-hero-form"
            style={{ maxWidth: 540, width: '100%', position: 'relative', zIndex: 1 }}
          >
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              background: '#FFFFFF',
              border: `2px solid ${LP_BRAND.orange}`,
              borderRadius: 14, padding: '12px 14px 10px',
              boxShadow: focused
                ? `0 0 0 5px ${LP_BRAND.orange}24, 0 18px 44px -22px rgba(40,30,20,0.22)`
                : `0 0 0 3px ${LP_BRAND.orange}14, 0 18px 44px -22px rgba(40,30,20,0.22)`,
              transition: 'box-shadow 160ms ease',
              textAlign: 'left',
            }}>
              <textarea
                rows={2}
                value={brief}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={PLACEHOLDER}
                style={{
                  border: 'none', outline: 'none', background: 'transparent', resize: 'none',
                  fontFamily: "'Inter Tight',sans-serif", fontSize: 15.5, color: LP_BRAND.ink,
                  lineHeight: 1.45, padding: 0, minHeight: 46,
                }}
              />
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                paddingTop: 8, borderTop: `1px solid ${LP_BRAND.rule}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <LP_Mono size={9}>listens on</LP_Mono>
                  {(['instagram', 'tiktok', 'youtube', 'x', 'reddit', 'facebook'] as PlatformId[]).map(p => (
                    <LP_PlatformBadge key={p} id={p} size={18} />
                  ))}
                </div>
                <button
                  type="submit"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '9px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
                    background: LP_BRAND.ink, color: '#F4EFE3',
                    fontFamily: "'Inter Tight',sans-serif", fontSize: 13, fontWeight: 600,
                    whiteSpace: 'nowrap', boxShadow: '0 6px 16px -8px rgba(40,30,20,0.5)',
                  }}
                >
                  Get early access
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            </div>

          </form>
        </div>

        <div style={{ marginTop: 68, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex' }}>
            {[PEOPLE.creator1, PEOPLE.creator3, PEOPLE.creator4, PEOPLE.creator5].map((src, i) => (
              <img key={i} src={src} alt="" referrerPolicy="no-referrer"
                style={{
                  width: 30, height: 30, borderRadius: '50%', objectFit: 'cover',
                  border: `2px solid ${LP_BRAND.cream}`, marginLeft: i === 0 ? 0 : -8,
                }} />
            ))}
          </div>
          <span style={{
            width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange,
            boxShadow: `0 0 0 4px ${LP_BRAND.orange}33`,
            animation: 'lp-pulse 1.8s ease-in-out infinite',
          }} />
          <LP_Mono size={10.5}>on the desk of brand teams across consumer, entertainment &amp; agencies</LP_Mono>
        </div>
      </div>
    </section>
  );
};

// ── Meet your researcher (v3) ─────────────────────────────────────────────────
// Three cards: 01 watches the FIELD · 02 reads the ROOM · 03 briefs the TEAM.
// Lifted from ui_kits/marketing/MeetResearcherV3.jsx in the design bundle.

const MR3_Tick = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" style={{ flexShrink: 0 }}>
    <path d="M3 8.5l3 3 7-8" fill="none" stroke={LP_BRAND.orangeDeep}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MR3_FmtIcon = ({ id }: { id: 'video' | 'audio' | 'image' | 'text' | 'live' }) => {
  const map = {
    video: 'M5 4l10 6-10 6V4z',
    audio: 'M3 7v6h3l5 4V3l-5 4H3z',
    image: 'M3 4h14v12H3z M3 13l4-4 3 3 4-5 3 4',
    text:  'M4 5h12 M4 9h12 M4 13h7',
    live:  'M10 4a6 6 0 100 12 6 6 0 000-12z M10 8v4 M10 12.5h.01',
  };
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" style={{ flexShrink: 0 }}>
      <path d={map[id]} fill="none" stroke={LP_BRAND.ink} strokeWidth="1.3"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const MR3_FieldDemo = () => {
  const tag = (txt: string) => (
    <span style={{
      fontFamily: "'JetBrains Mono', ui-monospace",
      fontSize: 8.5, color: LP_BRAND.muted, letterSpacing: 0.5,
      padding: '2px 6px', borderRadius: 99,
      background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`,
      whiteSpace: 'nowrap',
    }}>{txt}</span>
  );
  const NOW = 14;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <MR3_Tick />
        <LP_Mono size={9} color={LP_BRAND.ink} style={{ minWidth: 88 }}>every platform</LP_Mono>
        <div style={{ display: 'flex', gap: 5 }}>
          {(['tiktok','instagram','youtube','x','reddit','facebook','web'] as PlatformId[]).map(p => (
            <LP_PlatformBadge key={p} id={p} size={18} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <MR3_Tick />
        <LP_Mono size={9} color={LP_BRAND.ink} style={{ minWidth: 88 }}>every format</LP_Mono>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          {(['video','audio','image','text','live'] as const).map(k => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MR3_FmtIcon id={k} /><LP_Mono size={8.5}>{k}</LP_Mono>
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <MR3_Tick />
        <LP_Mono size={9} color={LP_BRAND.ink} style={{ minWidth: 88, paddingTop: 3 }}>every entity</LP_Mono>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {['logos','products','prices','faces','on-screen text','scenes','hashtags','handles'].map(t => (
            <span key={t}>{tag(t)}</span>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 4, paddingTop: 14, borderTop: `1px dashed ${LP_BRAND.rule}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MR3_Tick />
            <LP_Mono size={9} color={LP_BRAND.ink}>every hour</LP_Mono>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange,
              boxShadow: `0 0 0 4px ${LP_BRAND.orange}33`,
              animation: 'lp-pulse 1.6s ease-in-out infinite',
            }} />
            <LP_Mono size={8.5} color={LP_BRAND.orangeDeep}>now · 2:14pm</LP_Mono>
          </div>
        </div>
        <div style={{ position: 'relative', height: 22, marginBottom: 4 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {Array.from({ length: 24 }).map((_, i) => {
              const isNow = i === NOW;
              return (
                <div key={i} style={{
                  flex: 1,
                  height: isNow ? '100%' : (i % 6 === 0 ? '70%' : '55%'),
                  background: isNow ? LP_BRAND.orange : `${LP_BRAND.orange}66`,
                  borderRadius: 1,
                }} />
              );
            })}
          </div>
          <span style={{
            position: 'absolute',
            left: `${(NOW + 0.5) / 24 * 100}%`, top: -4, transform: 'translateX(-50%)',
            width: 7, height: 7, borderRadius: 99, background: LP_BRAND.orange,
            boxShadow: `0 0 0 3px ${LP_BRAND.orange}33, 0 0 0 6px ${LP_BRAND.orange}11`,
            animation: 'lp-pulse 1.6s ease-in-out infinite',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <LP_Mono size={7.5}>12am</LP_Mono><LP_Mono size={7.5}>6am</LP_Mono>
          <LP_Mono size={7.5}>12pm</LP_Mono><LP_Mono size={7.5}>6pm</LP_Mono><LP_Mono size={7.5}>12am</LP_Mono>
        </div>
        <div style={{
          marginTop: 10,
          fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 300,
          fontSize: 13.5, color: LP_BRAND.muted, lineHeight: 1.3,
        }}>
          3.2k posts/hr · 47 hr of content indexed/week · never off the desk.
        </div>
      </div>
    </div>
  );
};

const MR3_RoomTopicsDemo = () => {
  type Topic = {
    name: string;
    count: number;
    trend: 'up' | 'down' | 'flat';
    heat?: 'hot';
    posts: { img: string; plat: PlatformId; lang: string; cap: string }[];
  };
  const TOPICS: Topic[] = [
    {
      name: 'fit / sizing', count: 47, trend: 'down', heat: 'hot',
      posts: [
        { img: PEOPLE.athlete,  plat: 'tiktok',    lang: 'KO', cap: '발이 작게 나와요' },
        { img: PEOPLE.sneakers, plat: 'instagram', lang: 'ES', cap: 'se sale del talón' },
        { img: PEOPLE.runner,   plat: 'youtube',   lang: 'EN', cap: 'runs half a size small' },
      ],
    },
    {
      name: 'price', count: 12, trend: 'flat',
      posts: [
        { img: PEOPLE.sportPair, plat: 'reddit', lang: 'EN', cap: '$180 for a tempo is steep' },
        { img: PEOPLE.athlete,   plat: 'x',      lang: 'JP', cap: '高すぎる' },
      ],
    },
    {
      name: 'volt colorway', count: 38, trend: 'up',
      posts: [
        { img: PEOPLE.sneakers,  plat: 'tiktok',    lang: 'EN', cap: 'the volt is unreal in person' },
        { img: PEOPLE.sportPair, plat: 'instagram', lang: 'EN', cap: 'lime green era' },
      ],
    },
  ];
  const trendArrow = (t: Topic['trend']) => t === 'up' ? '↗' : t === 'down' ? '↘' : '→';
  const trendColor = (t: Topic['trend']) =>
    t === 'up' ? '#3DA37D' : t === 'down' ? LP_BRAND.orangeDeep : LP_BRAND.muted;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {TOPICS.map((topic, ti) => (
        <div key={ti} style={{
          paddingBottom: ti < TOPICS.length - 1 ? 14 : 0,
          borderBottom: ti < TOPICS.length - 1 ? `1px dashed ${LP_BRAND.rule}` : 'none',
          display: 'flex', flexDirection: 'column', gap: 9,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 7, height: 7, borderRadius: 99,
                background: topic.heat === 'hot' ? LP_BRAND.orange : LP_BRAND.muted,
                ...(topic.heat === 'hot' ? { boxShadow: `0 0 0 3px ${LP_BRAND.orange}22` } : {}),
              }} />
              <span style={{
                fontFamily: "'Fraunces',serif", fontStyle: 'italic',
                fontSize: 17, color: LP_BRAND.ink, letterSpacing: -0.3, lineHeight: 1,
              }}>{topic.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LP_Mono size={8.5}>{topic.count} posts</LP_Mono>
              <span style={{
                fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9, fontWeight: 700,
                color: trendColor(topic.trend), letterSpacing: 0.4,
              }}>{trendArrow(topic.trend)} sent.</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            {topic.posts.map((p, pi) => (
              <div key={pi} style={{
                flex: 1, minWidth: 0,
                background: '#FFFFFF',
                border: `1px solid ${LP_BRAND.rule}`,
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: '0 2px 4px -2px rgba(40,30,20,0.12)',
              }}>
                <div style={{ position: 'relative', height: 56, background: '#000' }}>
                  <img src={p.img} alt="" referrerPolicy="no-referrer"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.5) 100%)' }} />
                  <div style={{ position: 'absolute', top: 4, left: 4 }}><LP_PlatformBadge id={p.plat} size={13} /></div>
                  <div style={{
                    position: 'absolute', top: 4, right: 4,
                    fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 7,
                    color: '#FFF', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
                    padding: '1px 4px', borderRadius: 3, letterSpacing: 0.6, fontWeight: 700,
                  }}>{p.lang}</div>
                </div>
                <div style={{
                  padding: '5px 7px 6px',
                  fontFamily: "'Fraunces',serif", fontSize: 10.5, fontWeight: 400,
                  color: LP_BRAND.ink, lineHeight: 1.2, letterSpacing: -0.1,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  minHeight: 28,
                }}>{p.cap}</div>
              </div>
            ))}
            {topic.posts.length < 3 && Array.from({ length: 3 - topic.posts.length }).map((_, k) => (
              <div key={'sp' + k} style={{ flex: 1, minWidth: 0 }} />
            ))}
          </div>
        </div>
      ))}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 10, marginTop: 2, borderTop: `1px dashed ${LP_BRAND.rule}`,
      }}>
        <LP_Mono size={8.5}>+ 14 more topics this week</LP_Mono>
        <LP_Mono size={8.5} color={LP_BRAND.orangeDeep}>same conversation, every language</LP_Mono>
      </div>
    </div>
  );
};

const MR3_BriefsDemo = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{
      background: '#FFF7F1',
      border: `1px solid ${LP_BRAND.orange}`,
      borderRadius: 8,
      padding: '8px 11px',
      display: 'flex', alignItems: 'center', gap: 9,
    }}>
      <LP_Mono size={8} color={LP_BRAND.orangeDeep} style={{ flexShrink: 0 }}>one finding ↓</LP_Mono>
      <span style={{
        flex: 1,
        fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 400,
        fontSize: 13, color: LP_BRAND.ink, lineHeight: 1.2, letterSpacing: -0.2,
      }}>Fit issue forming on Drift V2 - same pattern as V1.</span>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <div style={{
        background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 8,
        padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <LP_Mono size={8} color={LP_BRAND.muted}># brand-leads</LP_Mono>
          <LP_Mono size={7.5} color={LP_BRAND.orangeDeep}>slack</LP_Mono>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{
            width: 16, height: 16, borderRadius: 4, background: LP_BRAND.orange,
            display: 'grid', placeItems: 'center', flexShrink: 0,
            fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 500,
            fontSize: 11, color: '#FFF',
          }}>S</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, fontWeight: 700, color: LP_BRAND.ink }}>Scolto</span>
              <LP_Mono size={7}>4:22pm</LP_Mono>
            </div>
            <div style={{
              fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: LP_BRAND.ink,
              lineHeight: 1.3, marginTop: 1,
            }}>Heads up - sizing pattern forming. Suggest comms hold.</div>
          </div>
        </div>
      </div>

      <div style={{
        background: '#F2F8F2', border: `1px solid #C9DDC9`, borderRadius: 8,
        padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: 99, background: '#3DA37D' }} />
            <LP_Mono size={8} color={LP_BRAND.muted}>Sarah (CMO)</LP_Mono>
          </span>
          <LP_Mono size={7.5} color="#2C7A4F">whatsapp</LP_Mono>
        </div>
        <div style={{
          alignSelf: 'flex-end',
          background: '#DCF3D8',
          borderRadius: '8px 8px 2px 8px',
          padding: '4px 7px 5px',
          maxWidth: '92%',
          fontFamily: "'Inter Tight',sans-serif", fontSize: 9.5,
          color: LP_BRAND.ink, lineHeight: 1.3,
        }}>
          fyi - sizing pattern, V1 redux. brief Fri 9? <span style={{ color: '#3DA37D', marginLeft: 2 }}>✓✓</span>
        </div>
      </div>

      <div style={{
        background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 8,
        padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <LP_Mono size={8} color={LP_BRAND.muted}>from: scolto</LP_Mono>
          <LP_Mono size={7.5} color={LP_BRAND.orangeDeep}>email</LP_Mono>
        </div>
        <div style={{
          fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 11.5,
          color: LP_BRAND.ink, lineHeight: 1.2, letterSpacing: -0.2,
        }}>Friday Brief - Drift V2 sizing</div>
        <div style={{
          fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: LP_BRAND.muted,
          lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>This week a fit-complaint pattern formed across 47 posts in 4 languages…</div>
      </div>

      <div style={{
        background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 8,
        padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <div style={{
          width: 30, height: 36, background: '#FFFFFF',
          border: `1px solid ${LP_BRAND.rule}`, borderRadius: 3,
          position: 'relative', flexShrink: 0,
          boxShadow: '0 2px 4px -2px rgba(40,30,20,0.18)',
        }}>
          <div style={{ position: 'absolute', top: 4, left: 4, right: 4, height: 2, background: LP_BRAND.orange }} />
          <div style={{ position: 'absolute', top: 9, left: 4, right: 4, height: 1, background: LP_BRAND.rule }} />
          <div style={{ position: 'absolute', top: 12, left: 4, right: 6, height: 1, background: LP_BRAND.rule }} />
          <div style={{ position: 'absolute', top: 15, left: 4, right: 9, height: 1, background: LP_BRAND.rule }} />
          <div style={{ position: 'absolute', top: 19, left: 4, right: 4, height: 1, background: LP_BRAND.rule }} />
          <div style={{ position: 'absolute', top: 22, left: 4, right: 6, height: 1, background: LP_BRAND.rule }} />
          <div style={{ position: 'absolute', top: 25, left: 4, right: 11, height: 1, background: LP_BRAND.rule }} />
          <LP_Mono size={5.5} style={{
            position: 'absolute', bottom: 1, right: 2, color: LP_BRAND.orangeDeep,
          }}>pdf</LP_Mono>
        </div>
        <div style={{ minWidth: 0 }}>
          <LP_Mono size={8} color={LP_BRAND.muted}>2-page memo</LP_Mono>
          <div style={{
            fontFamily: "'Fraunces',serif", fontStyle: 'italic',
            fontSize: 11, color: LP_BRAND.ink, lineHeight: 1.2,
          }}>Drift V2 - Friday Brief</div>
          <LP_Mono size={7.5} color={LP_BRAND.orangeDeep} style={{ display: 'block', marginTop: 2 }}>for CMO · Fri 9am</LP_Mono>
        </div>
      </div>

      <div style={{
        background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 8,
        padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <div style={{
          width: 40, height: 26, background: '#FFFFFF',
          border: `1px solid ${LP_BRAND.rule}`, borderRadius: 3,
          position: 'relative', flexShrink: 0,
          boxShadow: '0 2px 4px -2px rgba(40,30,20,0.18)',
        }}>
          <div style={{
            position: 'absolute', top: 3, left: 3, right: 3, height: 3,
            background: LP_BRAND.orange, borderRadius: 1,
          }} />
          <div style={{ position: 'absolute', top: 9, left: 3, right: 12, height: 1, background: LP_BRAND.rule }} />
          <div style={{ position: 'absolute', top: 12, left: 3, right: 18, height: 1, background: LP_BRAND.rule }} />
          <div style={{
            position: 'absolute', bottom: 3, left: 3, width: 7, height: 8,
            background: `${LP_BRAND.orange}66`, borderRadius: 1,
          }} />
          <div style={{
            position: 'absolute', bottom: 3, left: 13, width: 7, height: 5,
            background: `${LP_BRAND.orange}66`, borderRadius: 1,
          }} />
          <div style={{
            position: 'absolute', bottom: 3, left: 23, width: 7, height: 10,
            background: LP_BRAND.orange, borderRadius: 1,
          }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <LP_Mono size={8} color={LP_BRAND.muted}>12-slide deck</LP_Mono>
          <div style={{
            fontFamily: "'Fraunces',serif", fontStyle: 'italic',
            fontSize: 11, color: LP_BRAND.ink, lineHeight: 1.2,
          }}>Drift V2 - QBR</div>
          <LP_Mono size={7.5} color={LP_BRAND.orangeDeep} style={{ display: 'block', marginTop: 2 }}>for QBR · Mon</LP_Mono>
        </div>
      </div>

      <div style={{
        background: '#FFF7F1', border: `1px solid ${LP_BRAND.orange}`, borderRadius: 8,
        padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4,
        position: 'relative',
      }}>
        <span style={{
          position: 'absolute', top: 7, right: 9,
          width: 5, height: 5, borderRadius: 99, background: LP_BRAND.orange,
          boxShadow: `0 0 0 3px ${LP_BRAND.orange}33`,
          animation: 'lp-pulse 1.6s ease-in-out infinite',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg viewBox="0 0 14 14" width="11" height="11">
            <path d="M7 1.5a3.5 3.5 0 00-3.5 3.5v2.7L2 9.5h10l-1.5-1.8V5A3.5 3.5 0 007 1.5z M5.5 11.5a1.5 1.5 0 003 0"
              fill="none" stroke={LP_BRAND.orangeDeep} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <LP_Mono size={8} color={LP_BRAND.orangeDeep}>push alert</LP_Mono>
        </div>
        <div style={{
          fontFamily: "'Inter Tight',sans-serif", fontSize: 10, fontWeight: 600,
          color: LP_BRAND.ink, lineHeight: 1.25,
        }}>Drift V2 fit pattern crossed threshold.</div>
        <LP_Mono size={7.5} color={LP_BRAND.muted}>to: brand lead · now</LP_Mono>
      </div>
    </div>

    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 10, marginTop: 0, borderTop: `1px dashed ${LP_BRAND.rule}`,
    }}>
      <LP_Mono size={8.5}>same finding · every room</LP_Mono>
      <LP_Mono size={8.5} color={LP_BRAND.orangeDeep}>nothing to copy-paste →</LP_Mono>
    </div>
  </div>
);

const MR3_JobCard = ({
  n, head, hi, body, demo, accent,
}: {
  n: string; head: string; hi: string; body: string; demo: ReactNode; accent?: boolean;
}) => (
  <article style={{
    background: LP_BRAND.paper,
    border: accent ? `1px solid ${LP_BRAND.orange}` : `1px solid ${LP_BRAND.rule}`,
    borderRadius: 16,
    padding: '24px 26px 24px',
    position: 'relative',
    boxShadow: accent
      ? '0 24px 60px -36px rgba(217,119,87,0.45)'
      : '0 18px 40px -32px rgba(40,30,20,0.14)',
    display: 'flex', flexDirection: 'column', gap: 16,
    overflow: 'hidden',
  }}>
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 4,
      background: `repeating-linear-gradient(90deg, ${accent ? LP_BRAND.orange : LP_BRAND.rule} 0 8px, transparent 8px 14px)`,
    }} />
    <div>
      <div style={{
        fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 300,
        fontSize: 48, lineHeight: 0.9,
        color: accent ? LP_BRAND.orange : LP_BRAND.muted,
        marginBottom: 6,
      }}>{n}</div>
      <h3 style={{
        margin: 0, fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 28,
        letterSpacing: -0.6, color: LP_BRAND.ink, lineHeight: 1.05,
      }}>
        {head}{' '}<span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>{hi}</span>
      </h3>
    </div>
    <p style={{
      margin: 0, fontFamily: "'Inter Tight',sans-serif", fontSize: 14,
      color: LP_BRAND.ink, opacity: 0.78, lineHeight: 1.55,
    }}>{body}</p>
    <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: `1px dashed ${LP_BRAND.rule}` }}>
      {demo}
    </div>
  </article>
);

const LP_MeetScolto = () => {
  const ASSIGNMENTS = [
    { hue: LP_BRAND.orange, v: 1, name: 'Drift V2 launch',  meta: 'since Mon · 1.4k posts' },
    { hue: LP_BRAND.blue,   v: 2, name: 'Volt colorway',    meta: 'since 7am · 312 posts' },
    { hue: LP_BRAND.purple, v: 0, name: 'Pricing chatter',  meta: 'rolling · 47/day' },
    { hue: LP_BRAND.green,  v: 3, name: '3P reviewers',     meta: 'live · 11 creators' },
  ];
  return (
    <section id="how-it-works" className="lp-section" style={{
      padding: '96px 64px 84px', background: LP_BRAND.cream2,
      borderTop: `1px solid ${LP_BRAND.rule}`, borderBottom: `1px solid ${LP_BRAND.rule}`,
    }}>
      <div className="lp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'end', marginBottom: 48 }}>
        <div>
          <LP_Mono>Meet your researcher</LP_Mono>
          <h2 className="lp-section-h2" style={{
            margin: '14px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 68,
            letterSpacing: -1.8, lineHeight: 0.98, color: LP_BRAND.ink,
          }}>
            You don't need another dashboard.<br />
            You need a <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>researcher.</span>
          </h2>
          <p style={{
            margin: '22px 0 0', maxWidth: 520,
            fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 20, lineHeight: 1.4,
            color: LP_BRAND.ink, letterSpacing: -0.1,
          }}>
            Doesn't wait to be asked. Reads what's happening, decides what matters, and drops the answer before you ask.
          </p>
        </div>
        <div className="lp-meet-roster" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange,
              boxShadow: `0 0 0 4px ${LP_BRAND.orange}33`,
              animation: 'lp-pulse 1.6s ease-in-out infinite',
            }} />
            <LP_Mono size={9.5} color={LP_BRAND.orangeDeep}>on the desk · this week</LP_Mono>
          </div>
          <div className="lp-meet-cards" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            {ASSIGNMENTS.map((a, i) => (
              <div key={i} className="lp-meet-card" style={{
                padding: '18px 12px 12px', borderRadius: 14, background: '#FFFFFF',
                border: `1px solid ${LP_BRAND.rule}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 132,
                transform: i % 2 ? 'translateY(-6px)' : 'none',
                position: 'relative',
              }}>
                <span style={{
                  position: 'absolute', top: 9, right: 9,
                  width: 6, height: 6, borderRadius: 99, background: '#3DA37D',
                  boxShadow: '0 0 0 3px #3DA37D22',
                  animation: 'lp-pulse 1.6s ease-in-out infinite',
                }} />
                <LP_AgentBot hue={a.hue} variant={a.v} size={56} />
                <div style={{ textAlign: 'center', lineHeight: 1.1 }}>
                  <div style={{
                    fontFamily: "'Fraunces',serif", fontStyle: 'italic',
                    fontSize: 14, color: LP_BRAND.ink,
                  }}>{a.name}</div>
                  <LP_Mono size={8} style={{ display: 'block', marginTop: 3 }}>{a.meta}</LP_Mono>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lp-3col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
        <MR3_JobCard
          n="01" head="Watches the" hi="field."
          body="Every platform, every format, every entity - around the clock. Posts, replies, video frames, audio, on-screen text, logos, prices. Indexed and ready, nothing for you to set up."
          demo={<MR3_FieldDemo />}
        />
        <MR3_JobCard
          n="02" head="Reads the" hi="room."
          body="Groups every mention by what it's actually about - across languages, formats, platforms. The fit complaint in Korean and the heel-slip reel in Spanish go in the same column, not different feeds."
          demo={<MR3_RoomTopicsDemo />}
        />
        <MR3_JobCard
          n="03" head="Briefs the" hi="team."
          body="Same finding, every room. Slack for the brand lead, WhatsApp for the CMO, a 2-page memo for the board, a deck for the QBR, a push when it matters. Picks the channel, picks the form, picks the time."
          demo={<MR3_BriefsDemo />}
          accent
        />
      </div>
    </section>
  );
};


// ── Competitive ───────────────────────────────────────────────────────────────

const BRAND_A = { name: 'Nike',   short: 'N', color: '#111111', accent: '#FFFFFF' };
const BRAND_B = { name: 'Adidas', short: 'A', color: '#FFFFFF', accent: '#111111' };

const GenericMark = ({
  short, color, accent, size = 24,
}: { short: string; color: string; accent: string; size?: number }) => (
  <span style={{
    width: size, height: size, borderRadius: 4, background: color,
    display: 'inline-grid', placeItems: 'center', flexShrink: 0,
    border: color === '#FFFFFF' ? `1px solid ${LP_BRAND.rule}` : 'none',
  }}>
    <span style={{
      fontFamily: "'Inter Tight',sans-serif", fontWeight: 800, fontSize: size * 0.5,
      color: accent, letterSpacing: -0.5,
    }}>{short}</span>
  </span>
);

const DetectionRing = ({
  x, y, size, color, label, conf, delay = 0, side = 'top', className,
}: {
  x: number; y: number; size: number; color: string; label: string;
  conf: number; delay?: number; side?: 'top' | 'bottom'; className?: string;
}) => (
  <div className={className} style={{
    position: 'absolute', left: `${x}%`, top: `${y}%`, width: size, height: size,
    marginLeft: -size / 2, marginTop: -size / 2, pointerEvents: 'none',
  }}>
    <svg viewBox="0 0 100 100" width={size} height={size} style={{
      position: 'absolute', inset: 0, animation: 'lp-ring-in 700ms ease both', animationDelay: `${delay}ms`,
    }}>
      <circle cx="50" cy="50" r="46" fill="none" stroke={color} strokeWidth="2"
        strokeDasharray="289" strokeDashoffset="289"
        style={{
          animation: 'lp-ring-draw 900ms ease forwards', animationDelay: `${delay}ms`,
          filter: `drop-shadow(0 0 4px ${color}88)`,
        }} />
      <path d="M10 32 V10 H32" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round"
        style={{ opacity: 0, animation: 'lp-ring-tick 400ms ease forwards', animationDelay: `${delay + 600}ms` }} />
      <path d="M68 10 H90 V32" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round"
        style={{ opacity: 0, animation: 'lp-ring-tick 400ms ease forwards', animationDelay: `${delay + 600}ms` }} />
      <path d="M90 68 V90 H68" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round"
        style={{ opacity: 0, animation: 'lp-ring-tick 400ms ease forwards', animationDelay: `${delay + 600}ms` }} />
      <path d="M32 90 H10 V68" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round"
        style={{ opacity: 0, animation: 'lp-ring-tick 400ms ease forwards', animationDelay: `${delay + 600}ms` }} />
    </svg>
    <div style={{
      position: 'absolute',
      ...(side === 'top' ? { top: -28 } : { bottom: -28 }),
      left: '50%', transform: 'translateX(-50%)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 7px', borderRadius: 6,
      background: color, color: color === '#FFFFFF' ? LP_BRAND.ink : '#FFF',
      fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
      whiteSpace: 'nowrap', boxShadow: `0 4px 10px -4px ${color}88`,
      opacity: 0, animation: 'lp-ring-tick 400ms ease forwards', animationDelay: `${delay + 700}ms`,
    }}>
      {label} · {conf}%
    </div>
  </div>
);

const LP_Competitive = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(v => v + 1), 5200);
    return () => clearInterval(id);
  }, []);
  const k = `cycle-${tick}`;

  return (
    <section className="lp-section" style={{ padding: '96px 64px 88px' }}>
      <div className="lp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 56, alignItems: 'start' }}>
        <div className="lp-sticky" style={{ position: 'sticky', top: 32 }}>
          <LP_Mono>Competitive analysis</LP_Mono>
          <h2 className="lp-section-h2" style={{
            margin: '14px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 64,
            letterSpacing: -1.6, lineHeight: 0.96, color: LP_BRAND.ink,
          }}>
            It sees every brand<br />
            <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>that walked into the shot.</span>
          </h2>
          <p style={{
            margin: '22px 0 0', maxWidth: 480, fontFamily: "'Inter Tight',sans-serif", fontSize: 15,
            color: LP_BRAND.muted, lineHeight: 1.6,
          }}>
            Scolto's vision agents watch every clip frame-by-frame. They detect competitor logos, products and creators on screen - and tell you how long each one stayed, where it sat, and how visible it was.
          </p>

          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { icon: 'M3 12h4l2-6 4 12 2-6h6', t: 'Frame-level detection', s: 'Logos, products, faces, scenes - at 1 fps or higher.' },
              { icon: 'M12 21s-7-4.35-9.5-9.13C.83 8.5 2.4 5 5.6 5c1.94 0 3.32 1.07 4.4 2.6 1.08-1.53 2.46-2.6 4.4-2.6 3.2 0 4.77 3.5 3.1 6.87C19 16.65 12 21 12 21z', t: 'Share of screen', s: 'Total seconds, % visibility, average size in frame.' },
              { icon: 'M4 4h16v16H4z M9 9h6v6H9z', t: 'Landscape map', s: 'Side-by-side scoreboard across every competitor it finds.' },
            ].map((row, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
                background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 12,
              }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 9, background: `${LP_BRAND.orange}1a`,
                  display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                    stroke={LP_BRAND.orangeDeep} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d={row.icon} />
                  </svg>
                </span>
                <div>
                  <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 18, color: LP_BRAND.ink, letterSpacing: -0.2 }}>{row.t}</div>
                  <div style={{ marginTop: 3, fontFamily: "'Inter Tight',sans-serif", fontSize: 13, color: LP_BRAND.muted, lineHeight: 1.45 }}>{row.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div key={k} style={{
            position: 'relative', borderRadius: 18, overflow: 'hidden',
            border: `1px solid ${LP_BRAND.rule}`, background: '#0F0F0F', aspectRatio: '16 / 10',
            boxShadow: '0 28px 60px -28px rgba(40,30,20,0.4)',
          }}>
            <img src={PEOPLE.athlete} alt="" referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: `linear-gradient(180deg, transparent 0%, ${LP_BRAND.orange}1a 50%, transparent 100%)`,
              animation: 'lp-scan 3.6s linear infinite',
              backgroundSize: '100% 30%', backgroundRepeat: 'no-repeat',
            }} />
            <div style={{
              position: 'absolute', top: 14, left: 14, right: 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 99,
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
              }}>
                <LP_PlatformBadge id="youtube" size={16} />
                <LP_Mono size={9} color="#FFFFFF">@frankthetank · 02:14 / 04:18</LP_Mono>
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99,
                background: LP_BRAND.orange, color: '#FFF',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: '#FFF', animation: 'lp-pulse 1.4s ease-in-out infinite' }} />
                <LP_Mono size={9} color="#FFFFFF">SCOLTO · ANALYZING</LP_Mono>
              </div>
            </div>

            <DetectionRing className="lp-comp-ring lp-comp-ring-a" x={28} y={50} size={130} color={LP_BRAND.orange} label={BRAND_A.name} conf={94} delay={400} side="top" />
            <DetectionRing className="lp-comp-ring lp-comp-ring-b" x={70} y={64} size={86}  color="#FFFFFF"          label={BRAND_B.name} conf={88} delay={1500} side="bottom" />

            <div style={{
              position: 'absolute', bottom: 14, left: 14, right: 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            }}>
              <div style={{ maxWidth: '60%' }}>
                <div style={{
                  color: '#FFF', fontFamily: "'Fraunces',serif", fontSize: 18, fontStyle: 'italic',
                  textShadow: '0 2px 8px rgba(0,0,0,0.7)',
                }}>
                  "Honestly the new {BRAND_A.name} pair beats the {BRAND_B.name} I had last year…"
                </div>
                <LP_Mono size={9} color="rgba(255,255,255,0.7)" style={{ display: 'block', marginTop: 6 }}>
                  transcript · timecode 02:14
                </LP_Mono>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                {['frame 132 / 258', 'fps 30', 'resolution 1080p'].map(s => (
                  <LP_Mono key={s} size={9} color="rgba(255,255,255,0.6)">{s}</LP_Mono>
                ))}
              </div>
            </div>
          </div>

          <div style={{
            marginTop: 18, background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`,
            borderRadius: 14, padding: '20px 22px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <LP_Mono color={LP_BRAND.orangeDeep}>Share of screen · this clip</LP_Mono>
              <LP_Mono size={9}>auto-extracted by Scolto · 04:18 runtime</LP_Mono>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { brand: BRAND_A, secs: '01:47', pct: 71, size: 'large', placement: 'hero' },
                { brand: BRAND_B, secs: '00:38', pct: 22, size: 'medium', placement: 'background' },
              ].map((row, i) => (
                <div key={i} className="lp-comp-share-row" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 140 }}>
                    <GenericMark short={row.brand.short} color={row.brand.color} accent={row.brand.accent} size={28} />
                    <div>
                      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 600, fontSize: 13.5, color: LP_BRAND.ink }}>{row.brand.name}</div>
                      <LP_Mono size={8.5}>{row.secs} on screen</LP_Mono>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 99, background: LP_BRAND.cream2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${row.pct}%`, height: '100%',
                        background: i === 0 ? LP_BRAND.orange : LP_BRAND.slate,
                        animation: 'lp-bar-grow 1200ms cubic-bezier(.2,.7,.2,1) both',
                      }} />
                    </div>
                    <span style={{
                      fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 13, fontWeight: 600,
                      color: LP_BRAND.ink, minWidth: 36, textAlign: 'right',
                    }}>{row.pct}%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 99, background: LP_BRAND.cream2,
                      fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9, color: LP_BRAND.muted, letterSpacing: 0.4,
                    }}>{row.size}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 99, background: LP_BRAND.cream2,
                      fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9, color: LP_BRAND.muted, letterSpacing: 0.4,
                    }}>{row.placement}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 18, paddingTop: 14, borderTop: `1px dashed ${LP_BRAND.rule}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <LP_AgentBot hue={LP_BRAND.orange} variant={1} size={22} />
              <span style={{
                flex: 1, fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 14,
                color: LP_BRAND.ink, lineHeight: 1.4,
              }}>
                "{BRAND_A.name} owned 3.2Ã— more screen than {BRAND_B.name} in this clip, and was placed as hero in 4 of 5 cuts. I rolled this up across 312 clips this week - see <span style={{ color: LP_BRAND.orangeDeep, textDecoration: 'underline' }}>the landscape map</span>."
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// ── Deliverables ──────────────────────────────────────────────────────────────

const LP_DELIVERABLES = [
  { id: 'brief',     label: 'Weekly brief',       sub: 'a 2-page memo',     icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M8 13h8 M8 17h5' },
  { id: 'dashboard', label: 'Executive dashboard', sub: 'live metrics',     icon: 'M4 4h16v6H4z M4 14h7v6H4z M13 14h7v6h-7z' },
  { id: 'slides',    label: 'Slide deck',         sub: 'for the meeting',   icon: 'M4 5h16v11H4z M9 20h6 M12 16v4' },
  { id: 'report',    label: 'Deep-dive report',   sub: 'full PDF analysis', icon: 'M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M15 3v5h5 M9 13h6 M9 17h4' },
  { id: 'digest',    label: 'Scheduled digest',   sub: 'email · Slack · WA', icon: 'M3 7l9 6 9-6 M3 7v10h18V7' },
] as const;

type DeliverableId = (typeof LP_DELIVERABLES)[number]['id'];

const DashboardChart = () => {
  const series = [
    { c: LP_BRAND.orange, d: [12, 14, 18, 22, 28, 34, 30, 38, 45, 52, 48, 62, 71, 68] },
    { c: LP_BRAND.purple, d: [10, 12, 16, 18, 20, 22, 28, 30, 32, 30, 36, 38, 40, 44] },
    { c: LP_BRAND.blue,   d: [8, 10, 12, 16, 18, 20, 22, 24, 28, 30, 28, 30, 32, 34] },
    { c: LP_BRAND.green,  d: [6, 8, 9, 12, 14, 18, 18, 20, 22, 20, 24, 26, 28, 30] },
  ];
  const W = 480, H = 180, max = 80;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {[0.25, 0.5, 0.75].map((t, i) => (
        <line key={i} x1="0" y1={H * t} x2={W} y2={H * t} stroke={LP_BRAND.rule} strokeDasharray="2 4" />
      ))}
      {series.map((s, si) => {
        const pts = s.d.map((v, i) => `${(i / (s.d.length - 1)) * W},${H - (v / max) * H}`).join(' ');
        const area = `0,${H} ${pts} ${W},${H}`;
        return (
          <g key={si}>
            <polyline points={area} fill={s.c} fillOpacity="0.08" />
            <polyline points={pts} fill="none" stroke={s.c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={W} cy={H - (s.d[s.d.length - 1] / max) * H} r="3.5" fill={s.c} />
          </g>
        );
      })}
    </svg>
  );
};

const BriefPreview = () => (
  <div className="lp-brief-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.85fr', gap: 36 }}>
    <div>
      <LP_Mono size={9.5} color={LP_BRAND.muted}>Stanley Cup · week of May 6 · prepared by Scolto</LP_Mono>
      <div style={{
        fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 32, letterSpacing: -0.5,
        marginTop: 10, lineHeight: 1.15, color: LP_BRAND.ink,
      }}>
        The pink colorway is <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>winning</span> - but only on TikTok.
      </div>
      {[
        { k: 'tldr',  v: 'Of 4,820 comments read this week, 71% on TikTok skewed positive on the pink SKU; on Reddit, the same SKU is being read as overpriced. The price-pain is concentrated in one Reddit thread (2,100 upvotes). The cup is not the issue - the price ladder is.' },
        { k: 'watch', v: '@stanleylover (1.4M) is the swing creator - her unboxing is being clipped into duets. If she shifts tone, sentiment will move with her.' },
        { k: 'do',    v: 'Pin the price question on the Stanley site for one week. Reddit will reward the acknowledgement; TikTok will not notice.' },
      ].map(row => (
        <div key={row.k} style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 14, marginTop: 16 }}>
          <LP_Mono size={9}>{row.k}</LP_Mono>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 13.5, color: LP_BRAND.ink, lineHeight: 1.6 }}>{row.v}</div>
        </div>
      ))}
      <div style={{
        marginTop: 24, paddingTop: 14, borderTop: `1px dashed ${LP_BRAND.rule}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <LP_Mono size={9}>cited from 312 clips · 4,820 comments · 6 platforms</LP_Mono>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LP_AgentBot hue={LP_BRAND.orange} variant={1} size={22} />
          <LP_Mono size={9.5} color={LP_BRAND.orangeDeep}>signed, Scolto</LP_Mono>
        </span>
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LP_Mono size={9.5}>receipts</LP_Mono>
      {[
        { p: 'tiktok'    as PlatformId, photo: PEOPLE.vlog1,    handle: '@maya.unboxes',    body: 'the pink one is SCREAMING ðŸ˜­ retail tho???', likes: '+124k' },
        { p: 'reddit'    as PlatformId, photo: PEOPLE.creator3, handle: 'u/coffee_skeptic', body: '$80 for a cup is genuinely insane',         likes: '+2.1k' },
        { p: 'instagram' as PlatformId, photo: PEOPLE.creator6, handle: '@_brookehale',     body: 'haul w/ the new pink - actually worth it',  likes: '+412'  },
        { p: 'youtube'   as PlatformId, photo: PEOPLE.creator8, handle: '@dailygrind',      body: 'we tried every viral water bottle…',        likes: '+88k'  },
      ].map((c, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
          background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 10,
        }}>
          <img src={c.photo} alt="" referrerPolicy="no-referrer"
            style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <LP_PlatformBadge id={c.p} size={12} />
              <LP_Mono size={8.5}>{c.handle}</LP_Mono>
            </div>
            <div style={{
              fontFamily: "'Inter Tight',sans-serif", fontSize: 11.5, color: LP_BRAND.ink, marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{c.body}</div>
          </div>
          <LP_Mono size={9} color={LP_BRAND.orangeDeep}>{c.likes}</LP_Mono>
        </div>
      ))}
    </div>
  </div>
);

const DashboardPreview = () => (
  <div>
    <div className="lp-dash-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, borderBottom: `1px solid ${LP_BRAND.rule}` }}>
      {[
        { k: 'mentions, 7d',   v: '4,820',        d: '+18%',     up: true  as boolean | undefined },
        { k: 'sentiment',      v: '+0.42',        d: '+0.08',    up: true  as boolean | undefined },
        { k: 'share of voice', v: '32%',          d: '−3pp',     up: false as boolean | undefined },
        { k: 'top creator',    v: '@stanleylover',d: '1.4M reach', up: undefined as boolean | undefined },
      ].map((kpi, i) => (
        <div key={i} className="lp-dash-kpi-cell" style={{ padding: '22px 24px', borderRight: i < 3 ? `1px solid ${LP_BRAND.rule}` : 'none', minWidth: 0 }}>
          <LP_Mono size={9}>{kpi.k}</LP_Mono>
          <div className="lp-dash-kpi-val" style={{
            marginTop: 8, fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 30,
            color: LP_BRAND.ink, letterSpacing: -0.5, lineHeight: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{kpi.v}</div>
          <div style={{
            marginTop: 6, fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 10,
            color: kpi.up === undefined ? LP_BRAND.muted : kpi.up ? LP_BRAND.green : LP_BRAND.orangeDeep,
          }}>{kpi.d}</div>
        </div>
      ))}
    </div>
    <div className="lp-dash-charts" style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.85fr', gap: 0 }}>
      <div style={{ padding: '22px 24px', borderRight: `1px solid ${LP_BRAND.rule}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <LP_Mono>Mentions · last 14 days</LP_Mono>
          <LP_Mono size={9}>by platform</LP_Mono>
        </div>
        <DashboardChart />
        <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
          {[
            { c: LP_BRAND.orange, l: 'TikTok' },
            { c: LP_BRAND.purple, l: 'Reddit' },
            { c: LP_BRAND.blue,   l: 'Instagram' },
            { c: LP_BRAND.green,  l: 'YouTube' },
          ].map(li => (
            <div key={li.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: li.c }} />
              <LP_Mono size={9}>{li.l}</LP_Mono>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '22px 24px' }}>
        <LP_Mono style={{ display: 'block', marginBottom: 14 }}>Share of voice · competitors</LP_Mono>
        {[
          { n: 'Stanley',     v: 32, c: LP_BRAND.orange },
          { n: 'Owala',       v: 24, c: LP_BRAND.purple },
          { n: 'Hydro Flask', v: 18, c: LP_BRAND.blue },
          { n: 'YETI',        v: 14, c: LP_BRAND.green },
          { n: 'others',      v: 12, c: LP_BRAND.amber },
        ].map((row, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.ink, fontWeight: 500 }}>{row.n}</span>
              <span style={{ fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 10, color: LP_BRAND.muted }}>{row.v}%</span>
            </div>
            <div style={{ height: 5, borderRadius: 99, background: LP_BRAND.cream2, overflow: 'hidden', marginTop: 4 }}>
              <div style={{ width: `${row.v * 2.6}%`, height: '100%', background: row.c, animation: 'lp-bar-grow 900ms ease both' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const SlidesPreview = () => {
  const slides = [
    { t: 'The pink one is winning.',          sub: 'Stanley · week of May 6',          n: '01' },
    { t: '…but only on TikTok.',              sub: 'Reddit reads it as overpriced',    n: '02' },
    { t: 'The swing creator: @stanleylover.', sub: '1.4M reach, sentiment +24',        n: '03' },
    { t: 'What to do next week.',             sub: 'Pin the price question on-site',   n: '04' },
  ];
  return (
    <div>
      <div className="lp-slide-hero" style={{
        background: LP_BRAND.ink, color: LP_BRAND.cream, borderRadius: 14, padding: '56px 56px 48px',
        position: 'relative', overflow: 'hidden', aspectRatio: '16 / 9',
      }}>
        <LP_Mono size={9.5} color={LP_BRAND.mutedDark}>Stanley · weekly read · May 6</LP_Mono>
        <h3 className="lp-slide-h3" style={{
          margin: '14px 0 12px', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 64,
          letterSpacing: -1.5, lineHeight: 1.0, color: LP_BRAND.cream,
        }}>
          The <span style={{ fontStyle: 'italic', color: LP_BRAND.orange }}>pink</span> one is winning.
        </h3>
        <p className="lp-slide-sub" style={{
          margin: 0, fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 22,
          color: LP_BRAND.cream2, opacity: 0.85, maxWidth: 520, lineHeight: 1.35,
        }}>
          71% positive sentiment on TikTok · concentrated in 18-24 audience · one creator carries the conversation.
        </p>
        <div className="lp-slide-chart" style={{
          position: 'absolute', right: 48, bottom: 48, width: 260, height: 120,
          background: 'rgba(255,255,255,0.06)', border: `1px solid ${LP_BRAND.ruleDark}`,
          borderRadius: 10, padding: '14px 16px',
        }}>
          <LP_Mono size={8.5} color={LP_BRAND.mutedDark}>positive · pink SKU</LP_Mono>
          <svg viewBox="0 0 240 70" width="100%" height="70" style={{ marginTop: 6 }}>
            <polyline points="0,55 30,50 60,48 90,40 120,30 150,22 180,16 210,12 240,8"
              fill="none" stroke={LP_BRAND.orange} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <LP_Mono size={9} color={LP_BRAND.orange}>+71% TikTok · +12% IG</LP_Mono>
        </div>
        <div className="lp-slide-dots" style={{ position: 'absolute', bottom: 18, left: 56, display: 'flex', gap: 4 }}>
          {[0, 1, 2, 3].map(i => (
            <span key={i} style={{
              width: i === 0 ? 32 : 14, height: 3, borderRadius: 99,
              background: i === 0 ? LP_BRAND.orange : LP_BRAND.ruleDark,
            }} />
          ))}
        </div>
      </div>
      <div className="lp-slide-thumbs" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
        {slides.map((s, i) => (
          <div key={i} style={{
            padding: '10px 12px', borderRadius: 9,
            background: i === 0 ? LP_BRAND.ink : LP_BRAND.paper,
            border: i === 0 ? `1px solid ${LP_BRAND.ink}` : `1px solid ${LP_BRAND.rule}`,
            color: i === 0 ? LP_BRAND.cream : LP_BRAND.ink,
            display: 'flex', flexDirection: 'column', gap: 6, minHeight: 74,
          }}>
            <LP_Mono size={8} color={i === 0 ? LP_BRAND.mutedDark : LP_BRAND.muted}>{s.n} / 12</LP_Mono>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 13, lineHeight: 1.2 }}>{s.t}</div>
            <LP_Mono size={8} color={i === 0 ? LP_BRAND.mutedDark : LP_BRAND.muted}>{s.sub}</LP_Mono>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReportPreview = () => (
  <div className="lp-report-grid" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 36 }}>
    <div style={{ background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 12, padding: '24px 26px' }}>
      <LP_Mono size={9.5} color={LP_BRAND.orangeDeep}>Deep-dive · 28 pages</LP_Mono>
      <div style={{
        fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 32, letterSpacing: -0.6,
        marginTop: 10, lineHeight: 1.15, color: LP_BRAND.ink,
      }}>
        The Stanley Cup<br />landscape, Q2 2026.
      </div>
      <LP_Mono size={9} style={{ display: 'block', marginTop: 14 }}>contents</LP_Mono>
      <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[
          'Executive summary',
          'Sentiment landscape · 6 platforms',
          'Competitive share of voice',
          'Creator network analysis',
          'Visual brand detection · 312 clips',
          'Price perception · Reddit deep-read',
          'Recommendations · 30/60/90',
          'Methodology + sources',
        ].map((s, i) => (
          <li key={i} style={{
            display: 'flex', alignItems: 'baseline', gap: 12,
            fontFamily: "'Inter Tight',sans-serif", fontSize: 13, color: LP_BRAND.ink,
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9.5, color: LP_BRAND.muted, width: 22,
            }}>0{i + 1}</span>
            <span style={{ flex: 1 }}>{s}</span>
            <span style={{
              fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9.5, color: LP_BRAND.muted,
            }}>p.{(i + 1) * 3 + 2}</span>
          </li>
        ))}
      </ol>
    </div>
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <LP_Mono color={LP_BRAND.orangeDeep}>Excerpt · §03</LP_Mono>
        <span style={{ flex: 1, height: 1, background: LP_BRAND.rule }} />
        <LP_Mono size={9}>p. 11 / 28</LP_Mono>
      </div>
      <div style={{
        fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 22, letterSpacing: -0.3,
        marginTop: 14, lineHeight: 1.3, color: LP_BRAND.ink,
      }}>
        Stanley's share of TikTok conversation grew <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>3.2Ã— faster</span> than the category - but the gains are concentrated in one SKU, one creator, and one cohort.
      </div>
      <p style={{
        fontFamily: "'Inter Tight',sans-serif", fontSize: 13.5, color: LP_BRAND.ink, opacity: 0.78,
        lineHeight: 1.65, marginTop: 14,
      }}>
        Across the 7-day window, the pink colorway accounted for 71% of positive sentiment volume on TikTok. The remaining 29% split between hauler content and value comparisons. Notably, every viral post (&gt;500K reach) features a creator under 25; the over-35 cohort is conspicuously absent from this surge.
      </p>
      <div style={{
        marginTop: 18, padding: '14px 16px', background: `${LP_BRAND.orange}10`,
        border: `1px solid ${LP_BRAND.orange}55`, borderRadius: 10,
      }}>
        <LP_Mono size={9} color={LP_BRAND.orangeDeep}>Scolto's take</LP_Mono>
        <div style={{
          fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 14, color: LP_BRAND.ink,
          marginTop: 4, lineHeight: 1.45,
        }}>
          "If @stanleylover's tone shifts, expect a 30-40% sentiment swing inside 72 hours. She is the surface."
        </div>
      </div>
    </div>
  </div>
);

const DigestPreview = () => (
  <div className="lp-digest-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
    {/* Email */}
    <div style={{ background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, borderBottom: `1px solid ${LP_BRAND.rule}` }}>
        <span style={{
          width: 28, height: 28, borderRadius: 7, background: '#EA4335', display: 'grid',
          placeItems: 'center', color: '#FFF', fontWeight: 700, fontFamily: "'Inter Tight',sans-serif", fontSize: 14,
        }}>M</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, fontWeight: 600, color: LP_BRAND.ink }}>Email · Monday inbox</div>
          <LP_Mono size={9}>9:02 AM · from Scolto</LP_Mono>
        </div>
      </div>
      <div style={{ marginTop: 10, fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.muted }}>Subject</div>
      <div style={{ fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 15, color: LP_BRAND.ink, marginTop: 2 }}>"Pink is winning, but only on TikTok."</div>
      <div style={{ marginTop: 10, fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.ink, lineHeight: 1.55 }}>
        3 paragraphs · 60-second read. Brief, dashboard and receipts attached. Reply <span style={{ color: LP_BRAND.orangeDeep }}>"dig in"</span> to spin a deep-dive on any line.
      </div>
    </div>
    {/* Slack */}
    <div style={{ background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, borderBottom: `1px solid ${LP_BRAND.rule}` }}>
        <span style={{
          width: 28, height: 28, borderRadius: 7, background: '#4A154B', display: 'grid',
          placeItems: 'center', color: '#FFF', fontWeight: 700, fontFamily: "'Inter Tight',sans-serif", fontSize: 14,
        }}>S</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, fontWeight: 600, color: LP_BRAND.ink }}>Slack · #brand-listening</div>
          <LP_Mono size={9}>posted by Scolto · 9:02 AM</LP_Mono>
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <LP_AgentBot hue={LP_BRAND.orange} variant={1} size={28} />
        <div style={{ flex: 1, fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.ink, lineHeight: 1.5 }}>
          <strong>Scolto</strong> <span style={{ color: LP_BRAND.muted, fontSize: 10 }}>9:02 AM</span><br />
          this week: pink colorway is winning on TikTok (+71% sentiment) but losing on Reddit (price). full brief in ðŸ§µ
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 6, marginLeft: 36 }}>
        <span style={{ padding: '2px 8px', background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 99, fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: LP_BRAND.ink }}>ðŸ‘€ 12</span>
        <span style={{ padding: '2px 8px', background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 99, fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: LP_BRAND.ink }}>ðŸ”¥ 4</span>
        <span style={{ padding: '2px 8px', background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 99, fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: LP_BRAND.ink }}>ðŸ’¬ 8 replies</span>
      </div>
    </div>
    {/* WhatsApp */}
    <div style={{ background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, borderBottom: `1px solid ${LP_BRAND.rule}` }}>
        <span style={{
          width: 28, height: 28, borderRadius: 99, background: '#25D366', display: 'grid',
          placeItems: 'center', color: '#FFF', fontWeight: 700, fontFamily: "'Inter Tight',sans-serif", fontSize: 13,
        }}>W</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, fontWeight: 600, color: LP_BRAND.ink }}>WhatsApp · Scolto</div>
          <LP_Mono size={9}>online · just now</LP_Mono>
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          alignSelf: 'flex-start', maxWidth: '88%', padding: '7px 10px', background: '#FFFFFF',
          border: `1px solid ${LP_BRAND.rule}`, borderRadius: '10px 10px 10px 2px',
          fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.ink, lineHeight: 1.4,
        }}>
          your Monday brief is ready ðŸ“© pink colorway is winning on TikTok, getting roasted on Reddit. want the 60-sec or the full read?
        </div>
        <div style={{
          alignSelf: 'flex-end', maxWidth: '60%', padding: '7px 10px', background: '#D9FDD3',
          borderRadius: '10px 10px 2px 10px',
          fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.ink, lineHeight: 1.4,
        }}>
          60-sec, then dig into Reddit
        </div>
        <div style={{
          alignSelf: 'flex-start', maxWidth: '88%', padding: '7px 10px', background: '#FFFFFF',
          border: `1px solid ${LP_BRAND.rule}`, borderRadius: '10px 10px 10px 2px',
          fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.ink, lineHeight: 1.4,
        }}>
          got it. sending ðŸ‘‡
        </div>
      </div>
    </div>
  </div>
);

const LP_Deliverables = () => {
  const [active, setActive] = useState<DeliverableId>('brief');
  return (
    <section id="sample-brief" className="lp-section" style={{ padding: '96px 64px 80px' }}>
      <div className="lp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'end', marginBottom: 36 }}>
        <div>
          <LP_Mono>What it ships you</LP_Mono>
          <h2 className="lp-section-h2" style={{
            margin: '14px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 64,
            letterSpacing: -1.6, lineHeight: 0.95, color: LP_BRAND.ink,
          }}>
            Same intelligence.<br />
            <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>Every format your team reads in.</span>
          </h2>
        </div>
        <p style={{
          margin: 0, maxWidth: 480, fontFamily: "'Inter Tight',sans-serif", fontSize: 15,
          color: LP_BRAND.muted, lineHeight: 1.6, justifySelf: 'end',
        }}>
          The same intelligence, rendered for every room. Pick your format - the brief for your Monday inbox, the dashboard for the war room, the deck for the Friday meeting, the deep-dive for the board, the digest for Slack or WhatsApp.
        </p>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {LP_DELIVERABLES.map(d => (
          <button
            key={d.id}
            role="tab"
            aria-selected={active === d.id}
            onClick={() => setActive(d.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
              background: active === d.id ? LP_BRAND.ink : '#FFFFFF',
              color: active === d.id ? '#F4EFE3' : LP_BRAND.ink,
              border: active === d.id ? `1px solid ${LP_BRAND.ink}` : `1px solid ${LP_BRAND.rule}`,
              fontFamily: "'Inter Tight',sans-serif", fontSize: 13.5, fontWeight: 600,
              transition: 'all 180ms ease',
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d={d.icon} />
            </svg>
            {d.label}
            <span style={{
              fontFamily: "'JetBrains Mono',ui-monospace", fontSize: 9.5,
              letterSpacing: 0.6, opacity: 0.7, marginLeft: 2,
            }}>{d.sub}</span>
          </button>
        ))}
      </div>

      <div className="lp-deliv-preview" style={{
        background: '#FFFFFF', borderRadius: 20, border: `1px solid ${LP_BRAND.rule}`,
        boxShadow: '0 32px 70px -36px rgba(40,30,20,0.25)', overflow: 'hidden', minHeight: 540,
      }}>
        <div className="lp-deliv-header" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px', borderBottom: `1px solid ${LP_BRAND.rule}`, background: LP_BRAND.paper,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 99, background: '#E8654B' }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, background: '#E5C04A' }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, background: '#6FB860' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LP_AgentBot hue={LP_BRAND.orange} variant={1} size={20} />
            <LP_Mono size={10}>Scolto / {LP_DELIVERABLES.find(d => d.id === active)?.label} · Stanley Cup · week of May 6</LP_Mono>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LP_Mono size={9}>auto-refresh · Mon 9:00</LP_Mono>
          </div>
        </div>
        <div className="lp-deliv-preview-body" style={{ padding: active === 'dashboard' ? 0 : '32px 36px' }}>
          {active === 'brief'     && <BriefPreview />}
          {active === 'dashboard' && <DashboardPreview />}
          {active === 'slides'    && <SlidesPreview />}
          {active === 'report'    && <ReportPreview />}
          {active === 'digest'    && <DigestPreview />}
        </div>
      </div>
    </section>
  );
};

// ── Channels ──────────────────────────────────────────────────────────────────

const WAMsg = ({
  side = 'left', t, typing, children,
}: { side?: 'left' | 'right'; t?: string; typing?: boolean; children?: ReactNode }) => {
  const isMe = side === 'right';
  return (
    <div style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
      <div style={{
        padding: typing ? '10px 14px' : '8px 12px 6px',
        background: isMe ? '#005C4B' : '#FFFFFF',
        color: isMe ? '#FFFFFF' : LP_BRAND.ink,
        borderRadius: isMe ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
        fontFamily: "'Inter Tight',sans-serif", fontSize: 12.5, lineHeight: 1.45,
        boxShadow: '0 1px 0 rgba(0,0,0,0.1)',
        display: typing ? 'inline-flex' : 'block', alignItems: 'center', gap: 4,
      }}>
        {typing ? (
          <>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#9DB5BD', animation: 'lp-typing 1.4s ease-in-out infinite' }} />
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#9DB5BD', animation: 'lp-typing 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
            <span style={{ width: 6, height: 6, borderRadius: 99, background: '#9DB5BD', animation: 'lp-typing 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
          </>
        ) : (
          <>
            <div>{children}</div>
            {t && (
              <div style={{
                textAlign: 'right', fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 8.5,
                color: isMe ? 'rgba(255,255,255,0.65)' : LP_BRAND.muted, marginTop: 2,
              }}>{t} ✓✓</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const LP_Channels = () => (
  <section className="lp-section" style={{ padding: '96px 64px 80px' }}>
    <div className="lp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 56, alignItems: 'start' }}>
      <div>
        <LP_Mono>Where it lives</LP_Mono>
        <h2 className="lp-section-h2" style={{
          margin: '14px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 64,
          letterSpacing: -1.6, lineHeight: 0.95, color: LP_BRAND.ink,
        }}>
          It works <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>in your inbox</span><br />
          and <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>on your phone.</span>
        </h2>
        <p style={{
          margin: '22px 0 0', maxWidth: 460, fontFamily: "'Inter Tight',sans-serif", fontSize: 15,
          color: LP_BRAND.muted, lineHeight: 1.6,
        }}>
          You don't have to log in to a new tool. Scolto shows up where you already are - Slack, WhatsApp, email, or the Scolto app if you want a window into its work. Talk to it the same way you'd brief a teammate.
        </p>

        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {([
            { id: 'slack'    as PlatformId, name: 'Slack',    d: 'Posts in your channel' },
            { id: 'whatsapp' as PlatformId, name: 'WhatsApp', d: 'Texts you on the go' },
            { id: 'gmail'    as PlatformId, name: 'Email',    d: 'Drops the Monday brief' },
            { id: 'notion'   as PlatformId, name: 'Notion',   d: 'Writes into your wiki' },
          ]).map(ch => (
            <div key={ch.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
              background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 11,
            }}>
              <LP_PlatformBadge id={ch.id} size={26} />
              <div>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 600, fontSize: 13, color: LP_BRAND.ink }}>{ch.name}</div>
                <LP_Mono size={9}>{ch.d}</LP_Mono>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{
          background: '#0B141A', borderRadius: 24, padding: '18px 16px 22px',
          boxShadow: '0 32px 60px -32px rgba(40,30,20,0.4)',
          border: `1px solid ${LP_BRAND.rule}`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 8px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ width: 36, height: 36, borderRadius: 99, background: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
              <LP_ScoltoMark size={26} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600, color: '#FFFFFF' }}>Scolto</div>
              <span style={{ fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9.5, color: '#7EAA8B' }}>online · typing…</span>
            </div>
            <div style={{ display: 'flex', gap: 14, color: '#9DB5BD' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l7 7-7 7M22 12H4" /></svg>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
            </div>
          </div>

          <div className="lp-mock-msgs" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 4px 4px', minHeight: 380 }}>
            <div style={{
              alignSelf: 'center', padding: '3px 10px', borderRadius: 99,
              background: 'rgba(255,255,255,0.08)', fontFamily: "'JetBrains Mono', ui-monospace",
              fontSize: 9, color: '#9DB5BD', letterSpacing: 0.6, marginBottom: 6,
            }}>MONDAY · 9:02 AM</div>

            <WAMsg side="left">
              your brief is ready ðŸ“©<br />tldr: the pink colorway is <em>winning</em> on TikTok (+71% sentiment) but losing on Reddit on price.
            </WAMsg>
            <WAMsg side="left" t="9:02 AM">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 8, background: LP_BRAND.cream,
                  display: 'grid', placeItems: 'center', flexShrink: 0, border: `1px solid ${LP_BRAND.rule}`,
                }}><LP_ScoltoMark size={24} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontFamily: "'Inter Tight',sans-serif", fontWeight: 600, fontSize: 12, color: LP_BRAND.ink,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>brief-may06.pdf</div>
                  <span style={{ fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9, color: LP_BRAND.muted }}>2 pages · 480 KB</span>
                </div>
              </div>
              <div style={{ fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 13, color: LP_BRAND.ink }}>"Pink is winning - but only on TikTok."</div>
            </WAMsg>

            <WAMsg side="right" t="9:14 AM">60-sec or full read?</WAMsg>

            <WAMsg side="left" t="9:14 AM">
              60-sec. ðŸ‘‡<br /><br />
              <strong>1.</strong> TikTok loves pink (4.8K mentions, +71% sentiment). <br />
              <strong>2.</strong> Reddit hates the price ($80 thread, 2.1K upvotes). <br />
              <strong>3.</strong> @stanleylover (1.4M) is the swing creator.
            </WAMsg>

            <WAMsg side="right" t="9:15 AM">go deeper on the reddit thread</WAMsg>

            <WAMsg side="left" typing />
          </div>
        </div>

        <div style={{
          position: 'absolute', top: -14, right: 24,
          padding: '6px 12px', borderRadius: 99, background: '#FFFFFF',
          border: `1px solid ${LP_BRAND.rule}`, boxShadow: '0 10px 22px -10px rgba(40,30,20,0.25)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <LP_PlatformBadge id="whatsapp" size={14} />
          <LP_Mono size={9.5} color={LP_BRAND.orangeDeep}>+1 (415) ···· Scolto</LP_Mono>
        </div>
      </div>
    </div>
  </section>
);

// ── Why Scolto ────────────────────────────────────────────────────────────────

const LP_WhyScolto = () => (
  <section className="lp-section" style={{
    padding: '96px 64px 88px', background: LP_BRAND.cream2,
    borderTop: `1px solid ${LP_BRAND.rule}`, borderBottom: `1px solid ${LP_BRAND.rule}`,
  }}>
    <div className="lp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 64, alignItems: 'start' }}>
      <div className="lp-sticky" style={{ position: 'sticky', top: 32 }}>
        <LP_Mono>Why Scolto</LP_Mono>
        <h2 className="lp-section-h2" style={{
          margin: '14px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 72,
          letterSpacing: -1.8, lineHeight: 0.95, color: LP_BRAND.ink,
        }}>
          Most tools give you a search bar.<br />
          <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>Scolto gives you a read.</span>
        </h2>
        <p style={{
          margin: '22px 0 0', maxWidth: 460, fontFamily: "'Inter Tight',sans-serif", fontSize: 15,
          color: LP_BRAND.muted, lineHeight: 1.6,
        }}>
          Brandwatch, Sprinklr, Talkwalker - they all ship the same thing in the end: a dashboard with a search bar, and a deal that asks you to fill it. Scolto ships an agent that fills it for you, and tells you what it found.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { a: 'Hands you a dashboard.',                 b: 'Hands you a brief, a deck, a dashboard, and a digest.' },
          { a: 'Counts mentions and scores sentiment.',  b: 'Reads the post, watches the video, weighs the comment thread.' },
          { a: 'Surfaces a spike. You investigate why.', b: 'Tells you why, and which creator is the swing voter.' },
          { a: 'Locks you into a $30k annual seat.',     b: 'Usage-based. No annual contract.' },
          { a: 'Wants a kickoff call.',                  b: 'Wants a sentence.' },
        ].map((row, i) => (
          <div key={i} className="lp-why-row" style={{
            background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 14,
            overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr',
          }}>
            <div className="lp-why-row-old" style={{ padding: '22px 24px', borderRight: `1px solid ${LP_BRAND.rule}`, background: LP_BRAND.paper }}>
              <LP_Mono size={9}>The old way</LP_Mono>
              <div style={{
                marginTop: 8, fontFamily: "'Inter Tight',sans-serif", fontSize: 15, color: LP_BRAND.muted,
                lineHeight: 1.45, textDecoration: 'line-through', textDecorationColor: `${LP_BRAND.muted}55`,
              }}>{row.a}</div>
            </div>
            <div style={{ padding: '22px 24px' }}>
              <LP_Mono size={9} color={LP_BRAND.orangeDeep}>Scolto</LP_Mono>
              <div style={{
                marginTop: 8, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 400,
                color: LP_BRAND.ink, lineHeight: 1.35, letterSpacing: -0.1,
              }}>{row.b}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

// ── Pricing ───────────────────────────────────────────────────────────────────

const LP_Check = ({ color = LP_BRAND.green }: { color?: string }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

type LP_Feature = { text: string; icons?: PlatformId[] };

type LP_Tier = {
  name: string;
  blurb: string;
  monthly: number | null;
  credits: string;
  seats: string;
  overage: string;
  features: LP_Feature[];
  cta: string;
  featured?: boolean;
};

const LP_TIERS: ReadonlyArray<LP_Tier> = [
  {
    name: 'Solo',
    blurb: 'For snapshots reads - a competitor teardown, a campaign recap, an event debrief.',
    monthly: 149,
    credits: '500 credits / mo',
    seats: '1 seat',
    overage: 'Then pay as you go - same rate, no cliff',
    features: [
      { text: 'Every platform', icons: ['tiktok', 'instagram', 'youtube', 'x', 'reddit', 'facebook', 'web'] },
      { text: 'Get briefs, decks, dashboards, access to data' },
      { text: 'Full multimudallity - Reads video, images, and comments' },
      { text: 'Every claim links back to the posts' },
      { text: 'Share anything you make by link' },
      { text: '30-day history' },
    ],
    cta: 'Get early access',
  },
  {
    name: 'Studio',
    blurb: 'For live moments - follow a campaigns, events, competitors for the period that matter.',
    monthly: 499,
    credits: '2,000 credits / mo',
    seats: '5 seats',
    overage: 'Then pay as you go - same rate, no cliff',
    features: [
      { text: 'Everything in Solo' },
      { text: 'Lower credit rate - more reading per dollar' },
      { text: '5 seats, collaborate in real time' },
      { text: '1-year history' },
    ],
    cta: 'Get early access',
    featured: true,
  },
  {
    name: 'Scale',
    blurb: "For brands & agencies that can't look away - monitoring, crisis, competitors, crowd voice, around the clock.",
    monthly: null,
    credits: 'Custom credit pool',
    seats: 'Unlimited seats',
    overage: 'Custom volume pricing',
    features: [
      { text: 'Everything in Studio' },
      { text: 'Lowest credit rate - custom volume pricing' },
      { text: 'Agent integration to Slack & WhatsApp', icons: ['slack', 'whatsapp'] },
      { text: 'An analyst on hand to support your team' },
      { text: 'Unlimited history' },
    ],
    cta: 'Talk to us',
  },
];

const LP_Pricing = ({ openWaitlist }: { openWaitlist: () => void }) => {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="pricing" className="lp-section" style={{
      padding: '96px 64px 88px', background: LP_BRAND.cream, scrollMarginTop: 80,
      borderTop: `1px solid ${LP_BRAND.rule}`, borderBottom: `1px solid ${LP_BRAND.rule}`,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto' }}>
        <LP_Mono color={LP_BRAND.orangeDeep}>Pricing</LP_Mono>
        <h2 className="lp-section-h2" style={{
          margin: '14px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 64,
          letterSpacing: -1.6, lineHeight: 0.98, color: LP_BRAND.ink,
        }}>
          Pay for the work,<br />
          <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>not a seat.</span>
        </h2>
        <p style={{
          margin: '22px auto 0', maxWidth: 520, fontFamily: "'Inter Tight',sans-serif", fontSize: 15,
          color: LP_BRAND.muted, lineHeight: 1.6,
        }}>
          Every plan ships briefs, decks, dashboards, digests - and the raw data behind them. Credits buy the reading - no kickoff call, no $30k annual seat.
        </p>
      </div>

      {/* Billing toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: 4,
          background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 99,
        }}>
          {([['Monthly', false], ['Annual', true]] as const).map(([label, val]) => (
            <button
              key={label}
              onClick={() => setAnnual(val)}
              style={{
                padding: '8px 18px', borderRadius: 99, border: 'none', cursor: 'pointer',
                background: annual === val ? LP_BRAND.ink : 'transparent',
                color: annual === val ? '#F4EFE3' : LP_BRAND.muted,
                fontFamily: "'Inter Tight',sans-serif", fontSize: 13, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                transition: 'background 140ms ease, color 140ms ease',
              }}
            >
              {label}
              {val && (
                <span style={{
                  fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: 0.6,
                  color: annual ? LP_BRAND.orangeSoft : LP_BRAND.orangeDeep,
                  background: annual ? 'rgba(255,255,255,0.12)' : `${LP_BRAND.orange}1f`,
                  padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase',
                }}>
                  2 mo free
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tier cards */}
      <div className="lp-price-grid" style={{
        marginTop: 44, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18,
        maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto', alignItems: 'stretch',
      }}>
        {LP_TIERS.map((t) => {
          const annualMonthly = t.monthly != null ? Math.round((t.monthly * 10) / 12) : null;
          const shown = annual ? annualMonthly : t.monthly;
          return (
            <div
              key={t.name}
              className="lp-price-card"
              style={{
                position: 'relative', display: 'flex', flexDirection: 'column',
                background: t.featured ? LP_BRAND.ink : '#FFFFFF',
                border: t.featured ? `1px solid ${LP_BRAND.ink}` : `1px solid ${LP_BRAND.rule}`,
                borderRadius: 18, padding: '32px 28px',
                boxShadow: t.featured ? '0 30px 60px -32px rgba(15,31,77,0.5)' : 'none',
              }}
            >
              {t.featured && (
                <div style={{
                  position: 'absolute', top: 18, right: 18,
                  fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: 1.2,
                  textTransform: 'uppercase', color: LP_BRAND.ink, background: LP_BRAND.orange,
                  padding: '4px 9px', borderRadius: 7, fontWeight: 600,
                }}>
                  Most popular
                </div>
              )}

              <LP_Mono color={t.featured ? LP_BRAND.orangeSoft : LP_BRAND.orangeDeep}>{t.name}</LP_Mono>
              <p style={{
                margin: '12px 0 0', minHeight: 72, fontFamily: "'Inter Tight',sans-serif", fontSize: 13.5,
                lineHeight: 1.5, color: t.featured ? '#C9C4D9' : LP_BRAND.muted,
              }}>
                {t.blurb}
              </p>

              {/* Price */}
              <div style={{ marginTop: 20, display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 56 }}>
                {shown != null ? (
                  <>
                    <span style={{
                      fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 52, lineHeight: 1,
                      letterSpacing: -1.5, color: t.featured ? LP_BRAND.cream : LP_BRAND.ink,
                    }}>
                      ${shown}
                    </span>
                    <span style={{
                      fontFamily: "'Inter Tight',sans-serif", fontSize: 13,
                      color: t.featured ? '#A9A3BC' : LP_BRAND.muted,
                    }}>
                      /mo
                    </span>
                  </>
                ) : (
                  <span style={{
                    fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 46, lineHeight: 1,
                    letterSpacing: -1.2, fontStyle: 'italic', color: t.featured ? LP_BRAND.cream : LP_BRAND.ink,
                  }}>
                    Custom
                  </span>
                )}
              </div>
              <div style={{
                marginTop: 6, minHeight: 16, fontFamily: "'Inter Tight',sans-serif", fontSize: 11.5,
                color: t.featured ? '#A9A3BC' : LP_BRAND.mutedDark,
              }}>
                {shown != null && annual ? `billed annually · $${(annualMonthly! * 12).toLocaleString()}/yr` : ' '}
              </div>

              {/* CTA */}
              <button
                onClick={openWaitlist}
                style={{
                  marginTop: 22, padding: '12px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  width: '100%',
                  background: t.featured ? LP_BRAND.orange : LP_BRAND.ink,
                  color: t.featured ? '#FFFFFF' : '#F4EFE3',
                  fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {t.cta}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>

              {/* Reassurance microcopy */}
              {shown != null && (
                <div style={{
                  marginTop: 9, textAlign: 'center', fontFamily: "'Inter Tight',sans-serif", fontSize: 11.5,
                  color: t.featured ? '#A9A3BC' : LP_BRAND.mutedDark,
                }}>
                  Cancel anytime · no contracts
                </div>
              )}

              {/* What's included */}
              <div style={{
                marginTop: 24, paddingTop: 20,
                borderTop: `1px solid ${t.featured ? 'rgba(255,255,255,0.12)' : LP_BRAND.rule}`,
              }}>
                <div style={{
                  fontFamily: "'Inter Tight',sans-serif", fontWeight: 600, fontSize: 14,
                  color: t.featured ? LP_BRAND.cream : LP_BRAND.ink,
                }}>
                  {t.credits}
                </div>
                <div style={{
                  marginTop: 3, fontFamily: "'Inter Tight',sans-serif", fontSize: 12.5,
                  color: t.featured ? '#A9A3BC' : LP_BRAND.muted,
                }}>
                  {t.seats}
                </div>

                <ul style={{ margin: '18px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 11 }}>
                  {t.features.map((f) => (
                    <li key={f.text} style={{ display: 'flex', gap: 9, alignItems: f.icons ? 'center' : 'flex-start' }}>
                      <LP_Check color={t.featured ? LP_BRAND.orange : LP_BRAND.green} />
                      <span style={{
                        fontFamily: "'Inter Tight',sans-serif", fontSize: 13.5, lineHeight: 1.45,
                        color: t.featured ? '#D6D1E2' : LP_BRAND.slate,
                      }}>
                        {f.text}
                      </span>
                      {f.icons && (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                          {f.icons.map(id => <LP_PlatformBadge key={id} id={id} size={17} />)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <div style={{
                  marginTop: 18, fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 0.4,
                  color: t.featured ? '#8E879E' : LP_BRAND.mutedDark,
                }}>
                  {t.overage}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Credit explainer */}
      <div style={{
        marginTop: 28, maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto',
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '16px 22px', background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`,
        borderRadius: 12, textAlign: 'center',
      }}>
        <LP_Mono size={9.5} color={LP_BRAND.orangeDeep}>How credits work</LP_Mono>
        <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 13, color: LP_BRAND.muted, lineHeight: 1.5 }}>
          <strong style={{ color: LP_BRAND.ink, fontWeight: 600 }}>Credits meter the reading</strong> - posts pulled, video watched, comments weighed. Deeper questions read more. Run out before month-end and you roll straight onto pay-as-you-go at the same rate; nothing pauses.
        </span>
      </div>
    </section>
  );
};

// ── Invite / Final CTA ────────────────────────────────────────────────────────

const LP_Invite = ({ openWaitlist }: { openWaitlist: () => void }) => (
  <section className="lp-section" style={{ padding: '112px 64px 96px', position: 'relative', overflow: 'hidden' }}>
    <div className="lp-invite-bg" style={{
      position: 'absolute', left: '50%', top: '-40%', transform: 'translateX(-50%)',
      width: 1200, height: 1200, borderRadius: '50%',
      background: `radial-gradient(circle at 50% 50%, ${LP_BRAND.orange}1f 0%, transparent 60%)`,
      pointerEvents: 'none',
    }} />
    <div style={{ position: 'relative', textAlign: 'center', maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
        <LP_ScoltoMark size={140} />
      </div>
      <LP_Mono color={LP_BRAND.orangeDeep}>Brief your first agent</LP_Mono>
      <h2 className="lp-invite-h2" style={{
        margin: '18px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 104,
        letterSpacing: -3, lineHeight: 0.95, color: LP_BRAND.ink,
      }}>
        Hire <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>Scolto.</span>
      </h2>
      <p style={{
        margin: '22px auto 0', maxWidth: 520,
        fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 20, lineHeight: 1.4,
        color: LP_BRAND.ink, letterSpacing: -0.1,
      }}>
        Type one sentence. Scolto spends the week reading the internet. Friday it writes you back.
      </p>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 32, padding: 8, paddingLeft: 20,
        background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 99,
        boxShadow: '0 24px 50px -28px rgba(40,30,20,0.24)',
      }}>
        <LP_Mono size={11}>ping me the moment a seat opens →</LP_Mono>
        <button
          onClick={openWaitlist}
          style={{
            padding: '12px 22px', borderRadius: 99, border: 'none', cursor: 'pointer',
            background: LP_BRAND.orange, color: '#FFF',
            fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          Get early access
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div style={{ marginTop: 18 }}><LP_Mono size={10}>one click with Google · no spam, ever</LP_Mono></div>
    </div>
  </section>
);

// ── Nav ───────────────────────────────────────────────────────────────────────

const LP_Nav = ({ openAuth, openWaitlist }: { openAuth: () => void; openWaitlist: () => void }) => (
  <header className="lp-nav" style={{
    padding: '22px 64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: `1px solid ${LP_BRAND.rule}`, background: LP_BRAND.cream,
    position: 'sticky', top: 0, zIndex: 50,
  }}>
    <LP_ScoltoLogo markSize={34} fontSize={44} />
    <nav className="lp-nav-links" style={{ display: 'flex', gap: 32, fontFamily: "'Inter Tight',sans-serif", fontSize: 13.5, color: LP_BRAND.ink }}>
      <a
        href="#how-it-works"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
        }}
        style={{ color: LP_BRAND.ink, textDecoration: 'none', cursor: 'pointer' }}
      >
        How it works
      </a>
      <a
        href="#pricing"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
        }}
        style={{ color: LP_BRAND.ink, textDecoration: 'none', cursor: 'pointer' }}
      >
        Pricing
      </a>
      <Link to="/manifesto" style={{ color: LP_BRAND.ink, textDecoration: 'none', cursor: 'pointer' }}>Manifesto</Link>
    </nav>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <button
        onClick={openAuth}
        className="lp-nav-signin"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: "'Inter Tight',sans-serif", fontSize: 13.5, color: LP_BRAND.muted,
        }}
      >
        Sign in
      </button>
      <button
        onClick={openWaitlist}
        className="lp-nav-cta"
        style={{
          padding: '10px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
          background: LP_BRAND.ink, color: '#F4EFE3',
          fontFamily: "'Inter Tight',sans-serif", fontSize: 13, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          whiteSpace: 'nowrap',
        }}
      >
        Get early access
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  </header>
);

// ── Auth provider chooser modal ───────────────────────────────────────────────

function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MicrosoftIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" style={{ flexShrink: 0 }}>
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

function AuthModal({
  open, onClose, loadingProvider, onPickGoogle, onPickMicrosoft,
}: {
  open: boolean;
  onClose: () => void;
  loadingProvider: 'google' | 'microsoft' | null;
  onPickGoogle: () => void;
  onPickMicrosoft: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 14, 12, 0.55)',
        display: 'grid', placeItems: 'center',
        padding: 16, animation: 'lp-fade-in 180ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          background: LP_BRAND.cream, borderRadius: 18,
          border: `1px solid ${LP_BRAND.rule}`, padding: '32px 28px 24px',
          boxShadow: '0 40px 80px -32px rgba(40,30,20,0.5)',
          fontFamily: "'Inter Tight',sans-serif",
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <LP_ScoltoMark size={48} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <LP_Mono color={LP_BRAND.orangeDeep}>Sign in to continue</LP_Mono>
          <h3 style={{
            margin: '10px 0 6px', fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 32,
            letterSpacing: -0.6, lineHeight: 1.1, color: LP_BRAND.ink,
          }}>
            Hire <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>Scolto.</span>
          </h3>
          <p style={{
            margin: 0, fontSize: 13.5, color: LP_BRAND.muted, lineHeight: 1.5,
          }}>
            Pick how you'd like to sign in.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
          <button
            onClick={onPickGoogle}
            disabled={loadingProvider !== null}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '13px 18px', borderRadius: 11, cursor: loadingProvider ? 'wait' : 'pointer',
              background: LP_BRAND.ink, color: '#F4EFE3', border: 'none',
              fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600,
              opacity: loadingProvider && loadingProvider !== 'google' ? 0.5 : 1,
            }}
          >
            <GoogleIcon size={18} />
            {loadingProvider === 'google' ? 'Signing in…' : 'Continue with Google'}
          </button>
          <button
            onClick={onPickMicrosoft}
            disabled={loadingProvider !== null}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '13px 18px', borderRadius: 11, cursor: loadingProvider ? 'wait' : 'pointer',
              background: '#FFFFFF', color: LP_BRAND.ink,
              border: `1px solid ${LP_BRAND.rule}`,
              fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600,
              opacity: loadingProvider && loadingProvider !== 'microsoft' ? 0.5 : 1,
            }}
          >
            <MicrosoftIcon size={18} />
            {loadingProvider === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
          </button>
        </div>
        <button
          onClick={onClose}
          disabled={loadingProvider !== null}
          style={{
            marginTop: 14, width: '100%', background: 'transparent', border: 'none',
            cursor: loadingProvider ? 'wait' : 'pointer',
            fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 11, color: LP_BRAND.muted,
            letterSpacing: 1.2, textTransform: 'uppercase', padding: '8px 4px',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Waitlist modal ────────────────────────────────────────────────────────────

type WaitlistStatus = 'idle' | 'loading' | 'success' | 'error';

function WaitlistModal({
  open, onClose, interestedIn,
}: {
  open: boolean;
  onClose: () => void;
  interestedIn?: string;
}) {
  const [status, setStatus] = useState<WaitlistStatus>('idle');
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset on close so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      // Defer so the user sees the success state long enough if they close manually.
      const t = setTimeout(() => {
        setStatus('idle');
        setEmail(null);
        setError(null);
      }, 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onPickGoogle = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    setError(null);
    try {
      const { email: capturedEmail, displayName } = await captureGoogleEmail();
      await apiPost('/waitlist', {
        email: capturedEmail,
        display_name: displayName ?? undefined,
        interested_in: interestedIn,
        source: 'landing_page',
      });
      setEmail(capturedEmail);
      setStatus('success');
      // Primary landing conversion. GA4 recommended event name for a captured
      // lead; `has_brief` lets us segment intent-rich signups from bare ones.
      trackEvent('generate_lead', {
        source: 'landing_page',
        has_brief: !!interestedIn,
      });
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // User dismissed the popup - silently return to idle.
        setStatus('idle');
        return;
      }
      console.warn('Waitlist signup failed:', err);
      setError("Something went wrong on our end. Mind trying again?");
      setStatus('error');
    }
  };

  if (!open) return null;

  const isSuccess = status === 'success';

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 14, 12, 0.55)',
        display: 'grid', placeItems: 'center',
        padding: 16, animation: 'lp-fade-in 180ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: LP_BRAND.cream, borderRadius: 18,
          border: `1px solid ${LP_BRAND.rule}`, padding: '32px 28px 24px',
          boxShadow: '0 40px 80px -32px rgba(40,30,20,0.5)',
          fontFamily: "'Inter Tight',sans-serif",
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          {isSuccess ? (
            <div
              style={{
                width: 56, height: 56, borderRadius: '50%',
                background: '#E8F4EE', display: 'grid', placeItems: 'center',
                border: `1px solid ${LP_BRAND.green}33`,
              }}
              aria-hidden
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={LP_BRAND.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            </div>
          ) : (
            <LP_ScoltoMark size={48} />
          )}
        </div>

        {isSuccess ? (
          <div style={{ textAlign: 'center' }}>
            <LP_Mono color={LP_BRAND.green}>You're on the list</LP_Mono>
            <h3 style={{
              margin: '10px 0 6px', fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 30,
              letterSpacing: -0.6, lineHeight: 1.1, color: LP_BRAND.ink,
            }}>
              Nice to meet you.
            </h3>
            <p style={{
              margin: '0 0 4px', fontSize: 14, color: LP_BRAND.muted, lineHeight: 1.55,
            }}>
              We'll email <span style={{ color: LP_BRAND.ink, fontWeight: 600 }}>{email}</span> the moment a seat opens up.
            </p>
            {interestedIn && (
              <p style={{
                margin: '10px auto 0', maxWidth: 320, fontSize: 12, color: LP_BRAND.muted, lineHeight: 1.5,
                fontStyle: 'italic',
              }}>
                We saved what you wanted Scolto to look into, too.
              </p>
            )}
            <button
              onClick={onClose}
              style={{
                marginTop: 22, width: '100%',
                padding: '13px 18px', borderRadius: 11, cursor: 'pointer',
                background: LP_BRAND.ink, color: '#F4EFE3', border: 'none',
                fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600,
              }}
            >
              Back to the page
            </button>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center' }}>
              <LP_Mono color={LP_BRAND.orangeDeep}>Join the waitlist</LP_Mono>
              <h3 style={{
                margin: '10px 0 6px', fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 30,
                letterSpacing: -0.6, lineHeight: 1.1, color: LP_BRAND.ink,
              }}>
                Get <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>early access.</span>
              </h3>
              <p style={{
                margin: 0, fontSize: 13.5, color: LP_BRAND.muted, lineHeight: 1.5,
              }}>
                One click with Google - we'll grab your email and let you know the moment a seat opens up.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
              <button
                onClick={onPickGoogle}
                disabled={status === 'loading'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '13px 18px', borderRadius: 11, cursor: status === 'loading' ? 'wait' : 'pointer',
                  background: LP_BRAND.ink, color: '#F4EFE3', border: 'none',
                  fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600,
                }}
              >
                <GoogleIcon size={18} />
                {status === 'loading' ? 'Just a sec…' : 'Continue with Google'}
              </button>
            </div>
            {status === 'error' && error && (
              <p style={{
                margin: '14px 0 0', fontSize: 12.5, color: '#B83D2A', textAlign: 'center', lineHeight: 1.5,
              }}>
                {error}
              </p>
            )}
            <p style={{
              margin: '14px auto 0', maxWidth: 320, fontSize: 11.5, color: LP_BRAND.muted,
              textAlign: 'center', lineHeight: 1.5,
            }}>
              We only use your email to invite you in - no marketing, no sharing.
            </p>
            <button
              onClick={onClose}
              disabled={status === 'loading'}
              style={{
                marginTop: 10, width: '100%', background: 'transparent', border: 'none',
                cursor: status === 'loading' ? 'wait' : 'pointer',
                fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 11, color: LP_BRAND.muted,
                letterSpacing: 1.2, textTransform: 'uppercase', padding: '8px 4px',
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

const LP_FAQ = () => (
  <section
    id="faq"
    className="lp-section lp-faq"
    style={{ padding: '88px 64px 96px', background: LP_BRAND.cream2, borderTop: `1px solid ${LP_BRAND.rule}` }}
  >
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <LP_Mono color={LP_BRAND.orange} style={{ marginBottom: 16 }}>Frequently asked</LP_Mono>
      <h2
        className="lp-section-h2"
        style={{
          fontFamily: "'Fraunces',serif",
          fontWeight: 400,
          fontSize: 48,
          lineHeight: 1.05,
          letterSpacing: -1.2,
          color: LP_BRAND.ink,
          margin: '0 0 40px',
        }}
      >
        Before you brief it.
      </h2>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: 28, margin: 0 }}>
        {FAQ_ITEMS.map((item) => (
          <div key={item.q} style={{ borderTop: `1px solid ${LP_BRAND.rule}`, paddingTop: 20 }}>
            <dt>
              <h3
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontWeight: 600,
                  fontSize: 19,
                  lineHeight: 1.35,
                  color: LP_BRAND.ink,
                  margin: '0 0 10px',
                }}
              >
                {item.q}
              </h3>
            </dt>
            <dd
              style={{
                fontFamily: "'Inter Tight',sans-serif",
                fontSize: 16,
                lineHeight: 1.6,
                color: LP_BRAND.slate2,
                margin: 0,
              }}
            >
              {item.a}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  </section>
);

// ── Page ──────────────────────────────────────────────────────────────────────

export function LandingPage() {
  // Page-scoped structured data for AI search engines and Google rich results.
  useHead({
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ_ITEMS.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        }),
      },
    ],
  });

  const { signIn, signInWithMicrosoft } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'microsoft' | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistInterest, setWaitlistInterest] = useState<string | undefined>(undefined);

  // The app shell sets a global body { min-width: 1280px } for desktop-only
  // surfaces (see globals.css). The landing page is a public/viral surface
  // that must render on phones - drop the constraint while mounted.
  useEffect(() => {
    const prev = document.body.style.minWidth;
    document.body.style.minWidth = '0';
    return () => { document.body.style.minWidth = prev; };
  }, []);

  const openAuth = () => setAuthOpen(true);
  const closeAuth = () => { if (!loadingProvider) setAuthOpen(false); };

  const openWaitlist = (brief?: string) => {
    setWaitlistInterest(brief);
    setWaitlistOpen(true);
    // Funnel start: dividing this by `generate_lead` gives the waitlist
    // open->submit conversion rate.
    trackEvent('waitlist_open', { has_brief: !!brief });
  };
  const closeWaitlist = () => setWaitlistOpen(false);

  const handlePick = async (provider: 'google' | 'microsoft') => {
    if (loadingProvider) return;
    setLoadingProvider(provider);
    try {
      if (provider === 'google') await signIn();
      else await signInWithMicrosoft();
      setAuthOpen(false);
      trackEvent('login', { method: provider });
    } catch {
      // popup closed or cancelled - handled internally
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="lp-root" style={{
      background: [
        `radial-gradient(1100px 800px at 15% 8%,  ${LP_BRAND.orange}0d 0%, transparent 55%)`,
        `radial-gradient(1100px 800px at 85% 24%, ${LP_BRAND.orange}0d 0%, transparent 55%)`,
        `radial-gradient(1100px 800px at 15% 46%, ${LP_BRAND.orange}0d 0%, transparent 55%)`,
        `radial-gradient(1100px 800px at 85% 66%, ${LP_BRAND.orange}0d 0%, transparent 55%)`,
        `radial-gradient(1100px 800px at 15% 88%, ${LP_BRAND.orange}0d 0%, transparent 55%)`,
        LP_BRAND.cream,
      ].join(', '),
      color: LP_BRAND.ink,
      fontFamily: "'Inter Tight',sans-serif",
    }}>
      <style>{`
        @keyframes lp-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes lp-scan {
          0%   { background-position: 0% -30%; }
          100% { background-position: 0% 130%; }
        }
        @keyframes lp-ring-in {
          from { opacity: 0; transform: scale(0.7); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes lp-ring-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes lp-ring-tick {
          to { opacity: 1; }
        }
        @keyframes lp-bar-grow {
          from { width: 0; }
        }
        @keyframes lp-typing {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50%      { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes lp-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes lp-caret-blink {
          50% { opacity: 0; }
        }

        /* ── Mobile responsive overrides ─────────────────────────────────────
           These only apply below 768px. Desktop rendering is unchanged. */
        @media (max-width: 768px) {
          /* Kill page-wide horizontal scroll. Several sections place
             decorative absolute/rotated children that bleed past the
             viewport (lp-friday-glow, lp-invite-bg, the rotated friday
             card). Clipping at the root is cheaper than chasing each one. */
          .lp-root {
            overflow-x: hidden !important;
          }
          .lp-root .lp-section {
            padding-left: 20px !important;
            padding-right: 20px !important;
            padding-top: 40px !important;
            padding-bottom: 40px !important;
          }
          /* Hero sits right under the nav - keep the gap tight. */
          .lp-root .lp-hero-section {
            padding-top: 20px !important;
            padding-bottom: 32px !important;
          }
          /* Trim the meta pill in the hero so it fits one line. */
          .lp-root .lp-hero-badge {
            margin-bottom: 16px !important;
          }
          .lp-root .lp-hero-badge-extra {
            display: none !important;
          }
          /* The floating "live · 27.4M mentions" pill collides with the
             DailyRead header on small screens - it's noise on mobile. */
          .lp-root .lp-hero-live-pill {
            display: none !important;
          }
          .lp-root .lp-nav {
            padding-left: 16px !important;
            padding-right: 16px !important;
            gap: 10px !important;
          }
          .lp-root .lp-nav-links {
            display: none !important;
          }
          /* Keep the nav CTA on one line at narrow widths and trim its
             padding so the wordmark + button comfortably share the bar. */
          .lp-root .lp-nav-cta {
            padding: 9px 12px !important;
            font-size: 12.5px !important;
            gap: 6px !important;
          }
          /* minmax(0, 1fr) - without the 0 min, a child's min-content can
             expand the column past the container and cause horizontal scroll. */
          .lp-root .lp-2col,
          .lp-root .lp-3col {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 32px !important;
          }
          .lp-root .lp-hero-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 28px !important;
          }
          .lp-root .lp-brief-grid,
          .lp-root .lp-dash-charts,
          .lp-root .lp-why-row,
          .lp-root .lp-price-grid,
          .lp-root .lp-comp-share-row {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .lp-root .lp-hero-h1 {
            font-size: 44px !important;
            line-height: 1.0 !important;
            letter-spacing: -1.2px !important;
          }
          .lp-root .lp-hero-form { max-width: 100% !important; }
          .lp-root .lp-hero-form-wrap { margin-top: 56px !important; }
          .lp-root .lp-hero-watermark { transform: translateY(-75px) !important; }
          /* Hero illustration on mobile: drop the rotations, hide the
             decorative paper-behind + side popups, fit the DailyRead card
             to the viewport instead of scale-transforming the whole rig
             (which left dead whitespace + overflowed right). */
          .lp-root .lp-hero-char {
            overflow: visible;
          }
          .lp-root .lp-hero-illustration {
            height: auto !important;
            padding-top: 24px;
          }
          .lp-root .lp-hero-paper,
          .lp-root .lp-hero-popup {
            display: none !important;
          }
          .lp-root .lp-hero-card-wrap {
            transform: none !important;
            width: 100%;
          }
          .lp-root .lp-hero-glow {
            inset: 0 !important;
          }
          .lp-root .lp-daily-read {
            width: 100% !important;
          }
          .lp-root .lp-section-h2 {
            font-size: 40px !important;
            line-height: 1.02 !important;
            letter-spacing: -1px !important;
          }
          .lp-root .lp-meet-roster {
            justify-content: flex-start !important;
            align-items: flex-start !important;
            flex-wrap: wrap !important;
          }
          /* Roster: 4 fixed-width cards in a row blow past viewport.
             Wrap 2x2 and let each card share the column. */
          .lp-root .lp-meet-cards {
            flex-wrap: wrap !important;
            justify-content: flex-start !important;
            gap: 10px !important;
            width: 100%;
          }
          .lp-root .lp-meet-card {
            width: calc(50% - 5px) !important;
            transform: none !important;
          }
          /* Credibility row: 2-col → stacked; shrink the 140px stat so it
             fits the viewport and the caption gets its own line. */
          .lp-root .lp-credibility-row {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 20px !important;
            padding: 22px 0 !important;
          }
          .lp-root .lp-cred-stat {
            align-items: center !important;
            gap: 16px !important;
            flex-wrap: wrap;
          }
          .lp-root .lp-cred-num {
            font-size: 88px !important;
            letter-spacing: -2px !important;
          }
          .lp-root .lp-cred-caption {
            font-size: 17px !important;
            max-width: 100% !important;
          }
          /* Friday card: drop the -1.2deg tilt (it overhangs the column
             on a narrow viewport) and tame the radial glow so it stays
             inside the gutter instead of bleeding ±120px. */
          .lp-root .lp-friday-card-wrap {
            transform: none !important;
          }
          .lp-root .lp-friday-glow {
            inset: -20px -20px !important;
          }
          .lp-root .lp-friday-live-pill {
            left: 12px !important;
            top: -22px !important;
            transform: none !important;
          }
          .lp-root .lp-sticky {
            position: static !important;
            top: auto !important;
          }
          .lp-root .lp-deliv-preview { min-height: 0 !important; }
          .lp-root .lp-deliv-preview-body { padding: 16px !important; }
          .lp-root .lp-deliv-header {
            flex-wrap: wrap !important;
            gap: 8px !important;
            padding: 10px 12px !important;
          }
          /* Brief preview: stack copy and "receipts" column. */
          .lp-root .lp-brief-grid {
            gap: 20px !important;
          }
          /* Dashboard KPIs: 4 → 2 columns; charts stack. */
          .lp-root .lp-dash-kpis {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
          }
          .lp-root .lp-dash-kpis > div {
            padding: 14px 16px !important;
          }
          .lp-root .lp-dash-kpi-val {
            font-size: 22px !important;
          }
          .lp-root .lp-dash-charts > div {
            border-right: none !important;
            padding: 18px !important;
          }
          /* Report preview: stack contents + excerpt instead of overflowing. */
          .lp-root .lp-report-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 20px !important;
          }
          /* Digest preview: stack the 3 channel cards. */
          .lp-root .lp-digest-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          /* Slide-deck preview: shrink padding, headline, side chart so the
             16:9 slide doesn't look like a billboard cropped to a phone. */
          .lp-root .lp-slide-hero {
            padding: 22px 22px 18px !important;
            aspect-ratio: auto !important;
          }
          .lp-root .lp-slide-h3 {
            font-size: 28px !important;
            letter-spacing: -0.6px !important;
            margin: 10px 0 8px !important;
          }
          .lp-root .lp-slide-sub {
            font-size: 14px !important;
          }
          .lp-root .lp-slide-chart {
            position: static !important;
            width: 100% !important;
            height: auto !important;
            margin-top: 16px !important;
            padding: 10px 12px !important;
          }
          .lp-root .lp-slide-dots {
            position: static !important;
            margin-top: 14px !important;
          }
          /* Slide thumbnail strip: 4 → 2 columns to keep cards legible. */
          .lp-root .lp-slide-thumbs {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
          }
          /* Listens demo: drop the fixed handle width and clamp the
             comment so rows fit a phone column without overflowing. */
          .lp-root .lp-listens-handle {
            min-width: 0 !important;
            max-width: 80px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .lp-root .lp-listens-row {
            gap: 6px !important;
            padding: 6px 8px !important;
          }
          /* Competitive share-of-screen rows: 3-col → stacked. */
          .lp-root .lp-comp-share-row {
            gap: 10px !important;
          }
          .lp-root .lp-comp-share-row > div:first-child {
            min-width: 0 !important;
          }
          /* WhyScolto comparison rows: stack old / Scolto on top of each other. */
          .lp-root .lp-why-row-old {
            border-right: none !important;
            border-bottom: 1px solid #E5E0D4 !important;
          }
          .lp-root .lp-mock-msgs { min-height: 0 !important; }
          .lp-root .lp-invite-bg {
            width: 140vw !important;
            height: 140vw !important;
            top: -20% !important;
          }
          .lp-root .lp-invite-h2 {
            font-size: 64px !important;
            letter-spacing: -1.6px !important;
          }
          .lp-root .lp-footer {
            padding-left: 24px !important;
            padding-right: 24px !important;
          }
          .lp-root .lp-footer-row {
            flex-direction: column !important;
            gap: 28px !important;
          }
          .lp-root .lp-footer-links { gap: 32px !important; }
          .lp-root .lp-footer-bottom {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 10px !important;
            text-align: left !important;
          }
          /* Daily Read card: tighten so the header fits one row and the
             3-col KPI strip doesn't push REACH off the right. */
          .lp-root .lp-daily-head {
            padding: 10px 12px !important;
            gap: 8px !important;
          }
          .lp-root .lp-daily-kpis {
            padding: 12px 12px 4px !important;
          }
          .lp-root .lp-daily-kpis > div {
            padding-left: 8px !important;
            padding-right: 8px !important;
          }
          .lp-root .lp-daily-num {
            font-size: 20px !important;
          }
          .lp-root .lp-daily-reach-badges {
            gap: 3px !important;
          }
          .lp-root .lp-daily-reach-badges > span {
            width: 12px !important;
            height: 12px !important;
            border-radius: 4px !important;
          }
          /* Competitive detection rings: at mobile container widths the
             two rings + their labels collide. Shrink them. */
          .lp-root .lp-comp-ring {
            transform: scale(0.6);
            transform-origin: center;
          }
        }
      `}</style>

      <LP_Nav openAuth={openAuth} openWaitlist={() => openWaitlist()} />
      <LP_Hero openWaitlist={openWaitlist} />
      <LP_MeetScolto />
      <LP_FridayPreview />
      <LP_Credibility />
      <LP_Competitive />
      <LP_Deliverables />
      <LP_Channels />
      <LP_WhyScolto />
      <LP_Pricing openWaitlist={() => openWaitlist()} />
      <LP_FAQ />
      <LP_Invite openWaitlist={() => openWaitlist()} />
      <SiteFooter />

      <AuthModal
        open={authOpen}
        onClose={closeAuth}
        loadingProvider={loadingProvider}
        onPickGoogle={() => handlePick('google')}
        onPickMicrosoft={() => handlePick('microsoft')}
      />
      <WaitlistModal
        open={waitlistOpen}
        onClose={closeWaitlist}
        interestedIn={waitlistInterest}
      />
    </div>
  );
}
