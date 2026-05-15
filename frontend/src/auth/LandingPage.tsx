import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { useAuth } from './useAuth.ts';
import { captureGoogleEmail } from './firebase.ts';
import { apiPost } from '../api/client.ts';
import { ScoltoMark } from '../components/Logo.tsx';

// ── Brand tokens ──────────────────────────────────────────────────────────────
const LP_BRAND = {
  orange:     '#D97757',
  orangeDeep: '#C25E3F',
  orangeSoft: '#F2D5C4',
  ink:        '#1B1815',
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
  const ink = '#1B1815';
  const dark = `color-mix(in oklab, ${hue} 80%, #1B1815)`;
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
type PlatformId =
  | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'reddit'
  | 'slack' | 'whatsapp' | 'gmail' | 'notion';

const PLATFORMS: { id: PlatformId; label: string; color: string; glyph: ReactNode }[] = [
  { id: 'instagram', label: 'Instagram', color: '#E4405F',
    glyph: (<><rect x="6" y="6" width="12" height="12" rx="3.5" fill="none" stroke="#FFF" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="#FFF" strokeWidth="1.8"/><circle cx="15.6" cy="8.4" r="0.9" fill="#FFF"/></>) },
  { id: 'tiktok', label: 'TikTok', color: '#0F0F0F',
    glyph: (<><path d="M13.5 5v8.6a2.7 2.7 0 1 1-2.7-2.7" stroke="#FFF" strokeWidth="1.8" fill="none" strokeLinecap="round"/><path d="M13.5 5c.2 1.7 1.5 3.1 3.3 3.3" stroke="#FFF" strokeWidth="1.8" fill="none" strokeLinecap="round"/></>) },
  { id: 'youtube', label: 'YouTube', color: '#FF1F1F',
    glyph: (<><rect x="4.5" y="7.5" width="15" height="9" rx="2.5" fill="#FFF"/><path d="M10.5 10.2v3.6l3.2-1.8z" fill="#FF1F1F"/></>) },
  { id: 'facebook', label: 'Facebook', color: '#1877F2',
    glyph: (<path d="M13.5 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.2 1.2-1.2h1.3V5.7c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.1-3.2 3.2v1.8H8.7v2.4h2.2V19h2.6z" fill="#FFF"/>) },
  { id: 'x', label: 'X (Twitter)', color: '#0F0F0F',
    glyph: (<path d="M5.5 5h2.8l3.3 4.3L15.5 5h2.3l-4.9 6.1L18 19h-2.8l-3.5-4.5L7.7 19H5.4l5.2-6.5L5.5 5z" fill="#FFF"/>) },
  { id: 'reddit', label: 'Reddit', color: '#FF4500',
    glyph: (<><circle cx="12" cy="13" r="5.8" fill="#FFF"/><circle cx="9.8" cy="12.7" r="0.9" fill="#FF4500"/><circle cx="14.2" cy="12.7" r="0.9" fill="#FF4500"/><path d="M9.5 15.2c.7.6 1.6.9 2.5.9s1.8-.3 2.5-.9" stroke="#FF4500" strokeWidth="1.2" fill="none" strokeLinecap="round"/><circle cx="17" cy="9" r="1.4" fill="#FFF"/><path d="M14.2 9.5c.6-1 1.6-1.7 2.8-1.6" stroke="#FFF" strokeWidth="0.9" fill="none"/></>) },
  { id: 'slack', label: 'Slack', color: '#4A154B',
    glyph: (<><rect x="6" y="10" width="3" height="8" rx="1.5" fill="#ECB22E"/><rect x="10" y="14" width="8" height="3" rx="1.5" fill="#2EB67D"/><rect x="15" y="6" width="3" height="8" rx="1.5" fill="#E01E5A"/><rect x="6" y="7" width="8" height="3" rx="1.5" fill="#36C5F0"/></>) },
  { id: 'whatsapp', label: 'WhatsApp', color: '#25D366',
    glyph: (<path d="M5 19l1.2-3.4A6.5 6.5 0 1 1 9 18.5L5 19zM10 9.5c-.3 0-.6.1-.9.5-.3.4-1.1 1.1-1.1 2.6 0 1.6 1.1 3.1 1.3 3.3.2.2 2.2 3.4 5.4 4.6.7.3 1.3.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.4-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.7.2-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2.1-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5z" fill="#FFF"/>) },
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
        borderRadius: Math.round(size * 0.28),
        background: p.color,
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        boxShadow: '0 4px 10px -4px rgba(0,0,0,0.25)',
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.7} height={size * 0.7} aria-label={p.label}>
        {p.glyph}
      </svg>
    </span>
  );
};

// ── Hero ──────────────────────────────────────────────────────────────────────

const LP_TEMPLATES = [
  { label: 'Track my brand',          hint: 'weekly read across every platform' },
  { label: 'Watch a campaign',        hint: 'before / during / after window' },
  { label: 'Compare two competitors', hint: 'side-by-side qualitative read' },
  { label: 'Spot a rising trend',     hint: 'early-signal listening' },
];

const ROTATING_DELIVERABLES = [
  'Writes the brief.',
  'Builds the dashboard.',
  'Spots the competitors.',
  'Ships the slide deck.',
  'Delivers the deep-dive.',
  'Schedules the listening.',
];

const RotatingWord = ({
  words,
  color,
  interval = 2200,
}: {
  words: string[];
  color: string;
  interval?: number;
}) => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI(v => (v + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '');
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        verticalAlign: 'baseline',
        overflow: 'hidden',
        minWidth: '0.001px',
      }}
    >
      <span style={{ visibility: 'hidden', whiteSpace: 'nowrap' }}>{longest}</span>
      {words.map((w, idx) => (
        <span
          key={w}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            whiteSpace: 'nowrap',
            fontStyle: 'italic',
            color,
            opacity: idx === i ? 1 : 0,
            transform: idx === i ? 'translateY(0)' : 'translateY(0.4em)',
            transition: 'opacity 480ms ease, transform 520ms cubic-bezier(.2,.7,.2,1)',
          }}
        >
          {w}
        </span>
      ))}
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
          speech cut-off is the only loud negative thread — and it's still climbing on TikTok.
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
        <LP_FeedThumb photo={OSCARS.jordan}   platform="instagram" handle="@eentertainment" caption="Michael B. Jordan: 'Yo momma, what's up?' — Best Actor speech for Sinners" meta="4.1M · 1:24" />
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

const LP_HeroCharacter = () => (
  <div className="lp-hero-illustration" style={{ position: 'relative', height: 660, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
    <div className="lp-hero-glow" style={{
      position: 'absolute', inset: '30px 20px 30px 20px', borderRadius: 28,
      background: `radial-gradient(120% 90% at 65% 30%, ${LP_BRAND.orange}24 0%, ${LP_BRAND.orange}0d 40%, transparent 75%)`,
    }} />
    <div className="lp-hero-paper" style={{
      position: 'absolute', right: 0, top: 18, width: 460, height: 600,
      background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 18,
      transform: 'rotate(2.5deg)', opacity: 0.55,
      boxShadow: '0 30px 60px -40px rgba(40,30,20,0.2)',
    }} />
    <div className="lp-hero-card-wrap" style={{
      position: 'relative', zIndex: 2,
      transform: 'rotate(-1.4deg)',
      filter: 'drop-shadow(0 30px 60px rgba(40,30,20,0.18))',
    }}>
      <LP_DailyRead />
      <div className="lp-hero-live-pill" style={{
        position: 'absolute', top: -30, left: 38, display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 13px 6px 9px', background: LP_BRAND.ink, color: LP_BRAND.cream, borderRadius: 99,
        boxShadow: '0 14px 28px -16px rgba(40,30,20,0.45)', zIndex: 4, transform: 'rotate(-0.6deg)',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange,
          boxShadow: `0 0 0 4px ${LP_BRAND.orange}44`,
          animation: 'lp-pulse 1.6s ease-in-out infinite',
        }} />
        <LP_Mono size={9.5} color={LP_BRAND.cream}>live · 27.4M mentions / 7d</LP_Mono>
      </div>
    </div>

    <div className="lp-hero-popup" style={{ position: 'absolute', bottom: 8, right: -4, width: 248, zIndex: 5, transform: 'rotate(3deg)' }}>
      <div style={{
        background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 12,
        padding: '10px 12px', boxShadow: '0 24px 40px -22px rgba(40,30,20,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <img src={OSCARS.dicaprio} alt="" referrerPolicy="no-referrer"
            style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11.5, fontWeight: 600, color: LP_BRAND.ink }}>@PopCrave</div>
            <LP_Mono size={8.5}>x · 24s ago · +1.2k</LP_Mono>
          </div>
          <span style={{
            width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange,
            boxShadow: `0 0 0 4px ${LP_BRAND.orange}33`,
            animation: 'lp-pulse 1.6s ease-in-out infinite',
          }} />
        </div>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: LP_BRAND.ink, lineHeight: 1.4 }}>
          leo's "TFW you didn't agree to this" face when Conan put him on the jumbotron ðŸ’€
        </div>
      </div>
    </div>

    <div className="lp-hero-popup" style={{ position: 'absolute', top: 80, right: -18, width: 230, zIndex: 3, transform: 'rotate(4deg)' }}>
      <div style={{
        background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 12,
        padding: '10px 12px', boxShadow: '0 22px 36px -22px rgba(40,30,20,0.32)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <LP_PlatformBadge id="reddit" size={20} />
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, fontWeight: 600, color: LP_BRAND.ink }}>r/oscars</div>
            <LP_Mono size={8.5}>u/kpopstandkr · 4.8k ↑</LP_Mono>
          </div>
        </div>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11.5, color: LP_BRAND.ink, lineHeight: 1.4 }}>
          why did they cut Yu Han Lee off mid-speech? first K-pop Oscar in history and this is how they handle it…
        </div>
      </div>
    </div>
  </div>
);

const LP_Hero = ({ openWaitlist }: { openWaitlist: (brief?: string) => void }) => {
  const [brief, setBrief] = useState('');
  const PLACEHOLDERS = [
    'Track how the 98th Oscars are landing across every platform this week…',
    'Tell me the moment sentiment turns on the KPop Demon Hunters speech cut-off…',
    "Find every reaction video to Michael B. Jordan's upset Best Actor win…",
    'Compare buzz for One Battle After Another vs. Sinners after Sunday night…',
  ];
  const [phIdx, setPhIdx] = useState(0);
  useEffect(() => {
    if (brief) return;
    const id = setInterval(() => setPhIdx(v => (v + 1) % PLACEHOLDERS.length), 3800);
    return () => clearInterval(id);
  }, [brief]);

  return (
    <section className="lp-section lp-hero-section" style={{ padding: '48px 64px 80px', position: 'relative' }}>
      <div className="lp-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: 56, alignItems: 'center' }}>
        <div>
          <div className="lp-hero-badge" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 22,
            padding: '6px 14px 6px 8px', borderRadius: 99, background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`,
          }}>
            <LP_AgentBot hue={LP_BRAND.orange} variant={1} size={24} />
            <LP_Mono size={10} color={LP_BRAND.orangeDeep}>Open beta · meet Scolto</LP_Mono>
            <span className="lp-hero-badge-extra" style={{ width: 1, height: 14, background: LP_BRAND.rule }} />
            <span className="lp-hero-badge-extra"><LP_Mono size={10}>AI social listening</LP_Mono></span>
          </div>

          <h1 className="lp-hero-h1" style={{
            margin: 0, fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 92,
            lineHeight: 0.94, letterSpacing: -2.6, color: LP_BRAND.ink,
          }}>
            Your first<br />
            <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>AI brand researcher.</span>
          </h1>

          <p style={{
            margin: '24px 0 0', maxWidth: 560,
            fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 23,
            lineHeight: 1.35, color: LP_BRAND.ink, letterSpacing: -0.2,
          }}>
            Watches the <em style={{ color: LP_BRAND.orangeDeep }}>video.</em>{' '}
            Reads the <em style={{ color: LP_BRAND.orangeDeep }}>comments.</em>{' '}
            <RotatingWord words={ROTATING_DELIVERABLES} color={LP_BRAND.orangeDeep} />
          </p>

          <p style={{
            margin: '16px 0 0', maxWidth: 520, fontFamily: "'Inter Tight',sans-serif", fontSize: 15.5,
            color: LP_BRAND.muted, lineHeight: 1.55,
          }}>
            Scolto is a team of senior AI analysts that listens across every social platform - and ships you the report, the dashboard, the deck and the digest. All from one sentence.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); openWaitlist(brief.trim() || undefined); }} className="lp-hero-form" style={{ marginTop: 32, maxWidth: 620 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{
                width: 7, height: 7, borderRadius: 99, background: '#3DA37D',
                boxShadow: '0 0 0 3px rgba(61,163,125,0.2)',
              }} />
              <LP_Mono size={10.5} color={LP_BRAND.ink}>Brief Scolto · it'll scope the work before you finish typing</LP_Mono>
            </div>
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                background: '#FFFFFF', border: `2px solid ${LP_BRAND.rule}`, borderRadius: 18,
                padding: '18px 18px 16px',
                boxShadow: '0 24px 60px -28px rgba(40,30,20,0.28)',
                transition: 'border-color 160ms ease, box-shadow 160ms ease',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = LP_BRAND.orange;
                e.currentTarget.style.boxShadow = `0 0 0 6px ${LP_BRAND.orange}1f, 0 24px 60px -28px rgba(40,30,20,0.28)`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = LP_BRAND.rule;
                e.currentTarget.style.boxShadow = '0 24px 60px -28px rgba(40,30,20,0.28)';
              }}
            >
              <textarea
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={PLACEHOLDERS[phIdx]}
                style={{
                  border: 'none', outline: 'none', background: 'transparent', resize: 'none',
                  fontFamily: "'Inter Tight',sans-serif", fontSize: 18, color: LP_BRAND.ink,
                  lineHeight: 1.45, padding: 0, minHeight: 78,
                }}
              />
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                paddingTop: 12, borderTop: `1px solid ${LP_BRAND.rule}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <LP_Mono size={9.5}>listens on</LP_Mono>
                  {(['instagram','tiktok','youtube','x','reddit','facebook'] as PlatformId[]).map(p => (
                    <LP_PlatformBadge key={p} id={p} size={20} />
                  ))}
                </div>
                <button
                  type="submit"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '13px 22px', borderRadius: 11, border: 'none', cursor: 'pointer',
                    background: LP_BRAND.ink, color: '#F4EFE3',
                    fontFamily: "'Inter Tight',sans-serif", fontSize: 14.5, fontWeight: 600,
                    whiteSpace: 'nowrap', boxShadow: '0 8px 20px -8px rgba(40,30,20,0.5)',
                  }}
                >
                  Get early access
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {LP_TEMPLATES.map(t => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setBrief(t.label + ' - ' + t.hint)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 13px', borderRadius: 99,
                    border: `1px solid ${LP_BRAND.rule}`, background: '#FFFFFF', cursor: 'pointer',
                    fontFamily: "'Inter Tight',sans-serif", fontSize: 12.5, color: LP_BRAND.ink,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = LP_BRAND.orange; e.currentTarget.style.color = LP_BRAND.orangeDeep; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = LP_BRAND.rule; e.currentTarget.style.color = LP_BRAND.ink; }}
                >
                  <span style={{ color: LP_BRAND.orange, fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 11 }}>+</span>
                  {t.label}
                </button>
              ))}
            </div>
          </form>

          <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex' }}>
              {[PEOPLE.creator1, PEOPLE.creator3, PEOPLE.creator4, PEOPLE.creator5].map((src, i) => (
                <img key={i} src={src} alt="" referrerPolicy="no-referrer"
                  style={{
                    width: 30, height: 30, borderRadius: '50%', objectFit: 'cover',
                    border: `2px solid ${LP_BRAND.cream}`, marginLeft: i === 0 ? 0 : -8,
                  }} />
              ))}
            </div>
            <LP_Mono size={10.5}>62 brand teams hired Scolto this week</LP_Mono>
          </div>
        </div>

        <div className="lp-hero-char">
          <LP_HeroCharacter />
        </div>
      </div>
    </section>
  );
};

// ── Capabilities (Meet Scolto) ────────────────────────────────────────────────

const ListensDemo = () => {
  const FEED: { p: PlatformId; h: string; c: string; t: string; hi?: boolean }[] = [
    { p: 'tiktok',    h: '@rundotmaya',                  c: 'first run in the Drift is wild',     t: '+218' },
    { p: 'reddit',    h: 'u/easydaze · r/RunningShoes',  c: '$180 for a tempo is steep…',         t: '+2.1k' },
    { p: 'instagram', h: '@marathon.caro',               c: 'tempo day in the volt drift',        t: '+412' },
    { p: 'youtube',   h: '@running.deep',                c: '100 mi review · Halo Drift',         t: '+88k', hi: true },
    { p: 'x',         h: '@velo_run',                    c: 'drift runs ½ size small btw',        t: '+33' },
  ];
  return (
    <div className="lp-listens-demo" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: '#3DA37D', animation: 'lp-pulse 1.6s ease-in-out infinite' }} />
        <LP_Mono size={9} color={LP_BRAND.muted}>live · 1,204 new mentions in the last hour</LP_Mono>
      </div>
      {FEED.map((r, i) => (
        <div key={i} className="lp-listens-row" style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px', borderRadius: 8,
          background: r.hi ? '#FFF7F1' : LP_BRAND.paper,
          border: r.hi ? `1px solid ${LP_BRAND.orange}` : `1px solid ${LP_BRAND.rule}`,
        }}>
          <LP_PlatformBadge id={r.p} size={16} />
          <span className="lp-listens-handle" style={{ minWidth: 96, display: 'inline-block' }}>
            <LP_Mono size={9}>{r.h}</LP_Mono>
          </span>
          <span className="lp-listens-text" style={{
            flex: 1, minWidth: 0, fontFamily: "'Inter Tight',sans-serif", fontSize: 11.5,
            color: LP_BRAND.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{r.c}</span>
          <LP_Mono size={9} color={r.hi ? LP_BRAND.orangeDeep : LP_BRAND.muted}>{r.t}</LP_Mono>
        </div>
      ))}
    </div>
  );
};

const SeesDemo = () => {
  const frames = [
    {
      photo: PEOPLE.athlete, t: '0:08', kind: 'creator',
      overlay: (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          padding: '2px 6px', borderRadius: 4, background: 'rgba(217,119,87,0.95)',
          fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 7.5, color: '#FFF',
          fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap',
        }}>@running.deep</div>
      ),
    },
    {
      photo: PEOPLE.sneakers, t: '0:14', kind: 'product',
      overlay: (
        <div style={{
          position: 'absolute', top: '38%', left: '22%',
          padding: '1.5px 5px', borderRadius: 3, background: 'rgba(217,119,87,0.95)',
          fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 7, color: '#FFF',
          fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}>DRIFT V2</div>
      ),
    },
    {
      photo: PEOPLE.sportPair, t: '0:22', kind: 'text',
      overlay: (
        <div style={{
          position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%,-50%) rotate(-3deg)',
          padding: '3px 6px', borderRadius: 3, background: '#FFFFFF',
          fontFamily: "'Inter Tight', sans-serif", fontSize: 8.5, color: '#1B1815',
          fontWeight: 800, letterSpacing: 0.2, whiteSpace: 'nowrap', lineHeight: 1.05,
          textAlign: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}>RUNS ½<br />SIZE SMALL</div>
      ),
    },
    {
      photo: PEOPLE.runner, t: '0:31', kind: 'scene',
      overlay: (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          padding: '2px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)',
          fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 7, color: '#FFF',
          fontWeight: 600, letterSpacing: 0.4, whiteSpace: 'nowrap',
        }}>TREADMILL · 8'/MI</div>
      ),
    },
  ];
  const log = [
    { k: 'logo',    v: 'Halo wordmark · tongue',    c: 96 },
    { k: 'product', v: 'Drift Vol. 2 · volt',       c: 94 },
    { k: 'text',    v: '"runs ½ size small"',       c: 89 },
    { k: 'scene',   v: 'treadmill · pace test',     c: 91 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, borderRadius: 8,
        overflow: 'hidden', border: `1px solid ${LP_BRAND.rule}`, background: '#0F0F0F',
      }}>
        {frames.map((f, i) => (
          <div key={i} style={{ position: 'relative', aspectRatio: '3 / 4', overflow: 'hidden' }}>
            <img src={f.photo} alt="" referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.7) 100%)' }} />
            {f.overlay}
            <div style={{
              position: 'absolute', top: 4, left: 4, padding: '1px 4px', borderRadius: 3,
              background: 'rgba(0,0,0,0.55)', fontFamily: "'JetBrains Mono', ui-monospace",
              fontSize: 7.5, color: '#FFF', letterSpacing: 0.4, fontWeight: 600,
            }}>{f.t}</div>
            <div style={{
              position: 'absolute', bottom: 4, left: 4, right: 4,
              fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 7.5, color: '#FFF',
              letterSpacing: 0.3, lineHeight: 1.2, fontWeight: 600, textTransform: 'uppercase',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            }}>{f.kind}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: LP_BRAND.orange, animation: 'lp-pulse 1.6s ease-in-out infinite' }} />
        <LP_Mono size={9} color={LP_BRAND.muted}>extracted from 47 sec review · 4 entities found</LP_Mono>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {log.map((row, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '54px 1fr auto', alignItems: 'center', gap: 8,
            padding: '5px 8px', background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 6,
          }}>
            <LP_Mono size={8.5}>{row.k}</LP_Mono>
            <span style={{
              fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: LP_BRAND.ink,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{row.v}</span>
            <span style={{
              fontFamily: "'JetBrains Mono', ui-monospace", fontSize: 9,
              color: row.c >= 90 ? LP_BRAND.orangeDeep : LP_BRAND.muted, fontWeight: 600,
            }}>{row.c}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const DeliversDemo = () => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
    {[
      { k: 'the memo',      sub: '2-page brief',          icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6' },
      { k: 'the dashboard', sub: 'live metrics',          icon: 'M4 4h16v6H4z M4 14h7v6H4z M13 14h7v6h-7z' },
      { k: 'the slides',    sub: 'deck for Friday',       icon: 'M4 5h16v11H4z M9 20h6 M12 16v4' },
      { k: 'the digest',    sub: 'email + Slack + WA',    icon: 'M3 7l9 6 9-6 M3 7v10h18V7' },
    ].map((d, i) => (
      <div key={i} style={{
        background: LP_BRAND.paper, border: `1px solid ${LP_BRAND.rule}`, borderRadius: 9,
        padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <span style={{
          width: 28, height: 28, borderRadius: 8, background: `${LP_BRAND.orange}1a`,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
            stroke={LP_BRAND.orangeDeep} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={d.icon} />
          </svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 13, color: LP_BRAND.ink, lineHeight: 1.1 }}>{d.k}</div>
          <LP_Mono size={8.5}>{d.sub}</LP_Mono>
        </div>
      </div>
    ))}
  </div>
);

const LP_JobCard = ({
  n, verb, noun, body, demo, accent,
}: {
  n: string; verb: string; noun: string; body: string; demo: ReactNode; accent?: boolean;
}) => (
  <article style={{
    background: '#FFFFFF',
    border: accent ? `1px solid ${LP_BRAND.orange}` : `1px solid ${LP_BRAND.rule}`,
    borderRadius: 18, padding: '26px 26px 24px',
    boxShadow: accent ? '0 24px 60px -36px rgba(217,119,87,0.45)' : '0 18px 40px -32px rgba(40,30,20,0.16)',
    display: 'flex', flexDirection: 'column', gap: 18,
  }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
      <span style={{
        fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 40, fontWeight: 300,
        color: accent ? LP_BRAND.orange : LP_BRAND.muted, lineHeight: 1,
      }}>{n}</span>
      <h3 style={{
        margin: 0, fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 32,
        letterSpacing: -0.6, color: LP_BRAND.ink, lineHeight: 1.05,
      }}>
        {verb} <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>{noun}</span>
      </h3>
    </div>
    <p style={{
      margin: 0, fontFamily: "'Inter Tight',sans-serif", fontSize: 14.5,
      color: LP_BRAND.ink, opacity: 0.78, lineHeight: 1.55,
    }}>{body}</p>
    <div style={{ marginTop: 'auto', borderTop: `1px solid ${LP_BRAND.rule}`, paddingTop: 16 }}>
      {demo}
    </div>
  </article>
);

const LP_MeetScolto = () => {
  const VARIANTS = [
    { hue: LP_BRAND.orange, v: 1, name: 'Scolto', role: 'social listening' },
    { hue: LP_BRAND.purple, v: 0, name: 'Scolto', role: 'trend detection' },
    { hue: LP_BRAND.green,  v: 3, name: 'Scolto', role: 'campaign tracking' },
    { hue: LP_BRAND.blue,   v: 2, name: 'Scolto', role: 'competitive intel' },
  ];
  return (
    <section className="lp-section" style={{
      padding: '96px 64px 84px', background: LP_BRAND.cream2,
      borderTop: `1px solid ${LP_BRAND.rule}`, borderBottom: `1px solid ${LP_BRAND.rule}`,
    }}>
      <div className="lp-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'end', marginBottom: 48 }}>
        <div>
          <LP_Mono>Meet your researcher</LP_Mono>
          <h2 className="lp-section-h2" style={{
            margin: '14px 0 0', fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 72,
            letterSpacing: -1.8, lineHeight: 0.95, color: LP_BRAND.ink,
          }}>
            A team of senior analysts<br />
            in <span style={{ fontStyle: 'italic', fontWeight: 400, color: LP_BRAND.orangeDeep }}>one sentence.</span>
          </h2>
          <p style={{
            margin: '22px 0 0', maxWidth: 520,
            fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 20, lineHeight: 1.4,
            color: LP_BRAND.ink, letterSpacing: -0.1,
          }}>
            Scolto is an <em>AI social-listening platform</em> built as a roster of senior analyst agents. You hand them a brief; they go to work across every platform - listening, watching, analyzing, enriching - and deliver the read-out in whatever shape your team needs.
          </p>
        </div>
        <div className="lp-meet-roster" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 8, paddingBottom: 8 }}>
          {VARIANTS.map((v, i) => (
            <div key={i} style={{
              padding: '18px 14px 12px', borderRadius: 14, background: '#FFFFFF',
              border: `1px solid ${LP_BRAND.rule}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 128,
              transform: i % 2 ? 'translateY(-6px)' : 'none',
            }}>
              <LP_AgentBot hue={v.hue} variant={v.v} size={64} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontSize: 16, color: LP_BRAND.ink }}>{v.name}</div>
                <LP_Mono size={9} style={{ display: 'block', marginTop: 2 }}>{v.role}</LP_Mono>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lp-3col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
        <LP_JobCard
          n="01" verb="Listens" noun="on every platform."
          body="Scolto runs continuous social listening across TikTok, Instagram, YouTube, X, Reddit, Facebook and the open web. It doesn't sample - it ingests the whole conversation, including the replies under the replies."
          demo={<ListensDemo />}
        />
        <LP_JobCard
          n="02" verb="Sees" noun="what's in the frame."
          body="Its vision agents watch the video frame-by-frame - detecting logos, products, packaging and on-screen text. It tells you which brand showed up, for how long, where in the frame, and how visible it was."
          demo={<SeesDemo />}
        />
        <LP_JobCard
          n="03" verb="Delivers" noun="in any shape."
          body="Then its writer-agent ships the read-out. A two-page memo. An executive dashboard. A slide deck for Friday. A scheduled brief by email, Slack, or WhatsApp. Same intelligence, every room."
          demo={<DeliversDemo />}
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
    <section className="lp-section" style={{ padding: '96px 64px 80px' }}>
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
          Brandwatch, Sprinklr, Talkwalker - they all ship the same thing in the end: a dashboard with a search bar, and a deal that asks you to fill it. Scolto ships a researcher that fills it for you, and tells you what it found.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { a: 'Hands you a dashboard.',                 b: 'Hands you a brief, a deck, a dashboard, and a digest.' },
          { a: 'Counts mentions and scores sentiment.',  b: 'Reads the post, watches the video, weighs the comment thread.' },
          { a: 'Surfaces a spike. You investigate why.', b: 'Tells you why, and which creator is the swing voter.' },
          { a: 'Locks you into a $30k annual seat.',     b: 'Pay only for the work it does - usage-based, no annual contract.' },
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
      <LP_Mono color={LP_BRAND.orangeDeep}>Come build your first agent</LP_Mono>
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
        Type one sentence. It'll spend the rest of the week reading the internet about it, and write you back what it found.
      </p>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 32, padding: 8, paddingLeft: 20,
        background: '#FFFFFF', border: `1px solid ${LP_BRAND.rule}`, borderRadius: 99,
        boxShadow: '0 24px 50px -28px rgba(40,30,20,0.24)',
      }}>
        <LP_Mono size={11}>get the email when it's your turn →</LP_Mono>
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
      <div style={{ marginTop: 18 }}><LP_Mono size={10}>private beta · one click with Google · no spam</LP_Mono></div>
    </div>
  </section>
);

// ── Footer ────────────────────────────────────────────────────────────────────

const LP_Footer = () => (
  <footer className="lp-footer" style={{ padding: '40px 64px 48px', background: '#1A1714', color: '#D6CFBF', borderTop: `1px solid ${LP_BRAND.ruleDark}` }}>
    <div className="lp-footer-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 48, flexWrap: 'wrap' }}>
      <div style={{ maxWidth: 300 }}>
        <div style={{ marginBottom: 14 }}>
          <LP_ScoltoLogo markSize={32} fontSize={42} onDark />
        </div>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 13, color: '#A29A8B', lineHeight: 1.55 }}>
          A researcher that reads the internet so you don't have to.
        </div>
      </div>
      <div className="lp-footer-links" style={{ display: 'flex', gap: 64, fontFamily: "'Inter Tight',sans-serif", fontSize: 13 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <LP_Mono size={9.5} color="#7E7666" style={{ marginBottom: 4 }}>Product</LP_Mono>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>How it works</a>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>Examples</a>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>Changelog</a>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <LP_Mono size={9.5} color="#7E7666" style={{ marginBottom: 4 }}>Company</LP_Mono>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>About</a>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>Careers</a>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>Manifesto</a>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <LP_Mono size={9.5} color="#7E7666" style={{ marginBottom: 4 }}>Legal</LP_Mono>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>Privacy</a>
          <a style={{ color: '#D6CFBF', textDecoration: 'none' }}>Terms</a>
        </div>
      </div>
    </div>
    <div className="lp-footer-bottom" style={{
      marginTop: 36, paddingTop: 18, borderTop: '1px solid #2A2520',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <LP_Mono size={9.5} color="#7E7666">© 2026 Scolto - your AI brand researcher</LP_Mono>
      <LP_Mono size={9.5} color="#7E7666">made for people who'd rather read than scroll</LP_Mono>
    </div>
  </footer>
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
      <a style={{ color: LP_BRAND.ink, textDecoration: 'none', cursor: 'default' }}>How it works</a>
      <a style={{ color: LP_BRAND.ink, textDecoration: 'none', cursor: 'default' }}>What it ships</a>
      <a style={{ color: LP_BRAND.ink, textDecoration: 'none', cursor: 'default' }}>Manifesto</a>
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
        style={{
          padding: '10px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
          background: LP_BRAND.ink, color: '#F4EFE3',
          fontFamily: "'Inter Tight',sans-serif", fontSize: 13, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 8,
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
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // User dismissed the popup — silently return to idle.
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
              <LP_Mono color={LP_BRAND.orangeDeep}>Private beta · join the waitlist</LP_Mono>
              <h3 style={{
                margin: '10px 0 6px', fontFamily: "'Fraunces',serif", fontWeight: 400, fontSize: 30,
                letterSpacing: -0.6, lineHeight: 1.1, color: LP_BRAND.ink,
              }}>
                Get <span style={{ fontStyle: 'italic', color: LP_BRAND.orangeDeep }}>early access.</span>
              </h3>
              <p style={{
                margin: 0, fontSize: 13.5, color: LP_BRAND.muted, lineHeight: 1.5,
              }}>
                One click with Google — we'll grab your email and let you know the moment a seat opens up.
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
              We only use your email to invite you in — no marketing, no sharing.
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function LandingPage() {
  const { signIn, signInWithMicrosoft } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'microsoft' | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistInterest, setWaitlistInterest] = useState<string | undefined>(undefined);

  // The app shell sets a global body { min-width: 1280px } for desktop-only
  // surfaces (see globals.css). The landing page is a public/viral surface
  // that must render on phones — drop the constraint while mounted.
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
  };
  const closeWaitlist = () => setWaitlistOpen(false);

  const handlePick = async (provider: 'google' | 'microsoft') => {
    if (loadingProvider) return;
    setLoadingProvider(provider);
    try {
      if (provider === 'google') await signIn();
      else await signInWithMicrosoft();
      setAuthOpen(false);
    } catch {
      // popup closed or cancelled — handled internally
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="lp-root" style={{
      background: LP_BRAND.cream, color: LP_BRAND.ink,
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

        /* ── Mobile responsive overrides ─────────────────────────────────────
           These only apply below 768px. Desktop rendering is unchanged. */
        @media (max-width: 768px) {
          .lp-root .lp-section {
            padding-left: 20px !important;
            padding-right: 20px !important;
            padding-top: 40px !important;
            padding-bottom: 40px !important;
          }
          /* Hero sits right under the nav — keep the gap tight. */
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
             DailyRead header on small screens — it's noise on mobile. */
          .lp-root .lp-hero-live-pill {
            display: none !important;
          }
          .lp-root .lp-nav {
            padding-left: 18px !important;
            padding-right: 18px !important;
            gap: 10px !important;
          }
          .lp-root .lp-nav-links,
          .lp-root .lp-nav-signin {
            display: none !important;
          }
          /* minmax(0, 1fr) — without the 0 min, a child's min-content can
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
          .lp-root .lp-comp-share-row {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .lp-root .lp-hero-h1 {
            font-size: 44px !important;
            line-height: 1.0 !important;
            letter-spacing: -1.2px !important;
          }
          .lp-root .lp-hero-form { max-width: 100% !important; }
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
            flex-wrap: wrap !important;
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
      <LP_Competitive />
      <LP_Deliverables />
      <LP_Channels />
      <LP_WhyScolto />
      <LP_Invite openWaitlist={() => openWaitlist()} />
      <LP_Footer />

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
