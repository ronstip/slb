import { useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './useAuth.ts';
import { Logo } from '../components/Logo.tsx';

// ── Design tokens (D4 palette) ────────────────────────────────────────────────
const ACCENT = '#FF6B3D';
const INK    = '#0f0e0c';
const INK2   = '#181614';
const INK3   = '#26221e';
const PAPER  = '#f0ebe0';
const MUTED  = '#8a857c';

const fontSerif = '"Instrument Serif", "Times New Roman", serif';
const fontMono  = '"JetBrains Mono", ui-monospace, monospace';
const fontSans  = '"Inter Tight", "Inter", system-ui, sans-serif';

// ── Shared UI primitives ──────────────────────────────────────────────────────

function PulseDot({ color = ACCENT, size = 8 }: { color?: string; size?: number }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, animation: 'lp-pulse 1.6s ease-out infinite', opacity: 0.5 }} />
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color }} />
    </span>
  );
}

function Sparkline({ height = 40, color = PAPER, seed = 1 }: { height?: number; color?: string; seed?: number }) {
  const [pts, setPts] = useState<number[]>(() => Array(40).fill(0.5));
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      setPts(prev => {
        const next = prev.slice(1);
        const v = 0.3 + 0.5 * Math.abs(Math.sin((i + seed * 17) * 0.3) + 0.4 * Math.sin(i * 0.11 + seed));
        next.push(Math.max(0.05, Math.min(0.95, v)));
        i++;
        return next;
      });
    }, 120);
    return () => clearInterval(id);
  }, [seed]);

  const d = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * 100;
    const y = height - p * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Typing({ text, speed = 30 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    setShown('');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return <span style={{ whiteSpace: 'pre-line' }}>{shown}<span style={{ opacity: 0.5 }}>▍</span></span>;
}

// ── HeroAnimation ──────────────────────────────────────────────────────────────

interface Mention { id: number; src: string; t: string; txt: string; s: number; c: string; }

const MENTION_SAMPLES: Omit<Mention, 'id'>[] = [
  { src: 'x',      t: '@maeve_b',       txt: 'okay but the new packaging is actually beautiful', s: 0.82, c: '+' },
  { src: 'reddit', t: 'r/ProductDesign', txt: 'the unboxing is genuinely a moment',               s: 0.71, c: '+' },
  { src: 'tiktok', t: '@unbox.daily',    txt: 'underrated drop of the year',                      s: 0.68, c: '+' },
  { src: 'x',      t: '@kev.codes',      txt: 'shipping speed needs work tbh',                    s: -0.32, c: '-' },
  { src: 'news',   t: 'TechCrunch',      txt: 'the brand quietly raised $40M',                    s: 0.45, c: '+' },
  { src: 'tiktok', t: '@stylefiles',     txt: 'obsessed with this colorway',                      s: 0.78, c: '+' },
  { src: 'reddit', t: 'r/marketing',     txt: 'their social game is unmatched',                   s: 0.65, c: '+' },
  { src: 'x',      t: '@dora.w',         txt: 'customer service was rough this week',             s: -0.41, c: '-' },
];

function HeroAnimation() {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [tick, setTick]         = useState(0);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      setMentions(prev => {
        const s = MENTION_SAMPLES[i % MENTION_SAMPLES.length];
        i++;
        return [...prev.slice(-5), { ...s, id: Date.now() + Math.random() }];
      });
    }, 1400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let raf: number;
    const loop = () => { setTick(t => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sentiment     = 0.71 + Math.sin(tick * 0.02) * 0.04;
  const angle         = -90 + sentiment * 180;
  const circumference = 2 * Math.PI * 92;

  return (
    <div style={{ position: 'relative', height: 520, background: INK2, border: `1px solid ${INK3}`, borderRadius: 8, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}>
      {/* Window chrome */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${INK3}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: fontMono, fontSize: 11, color: PAPER, letterSpacing: 0.4, textTransform: 'uppercase' }}>agent · acme brand pulse</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PulseDot color={ACCENT} size={6} />
          <span style={{ fontFamily: fontMono, fontSize: 10, color: ACCENT, letterSpacing: 0.4, textTransform: 'uppercase' }}>listening</span>
        </span>
      </div>

      <div style={{ position: 'relative', height: 'calc(100% - 44px)' }}>
        {/* Pulse rings */}
        <div style={{ position: 'absolute', left: '50%', top: '44%', transform: 'translate(-50%, -50%)', width: 260, height: 260, pointerEvents: 'none' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ position: 'absolute', inset: 0, border: `1px solid ${ACCENT}`, borderRadius: '50%', animation: 'lp-ring 4s ease-out infinite', animationDelay: `${i * 1.3}s`, opacity: 0 }} />
          ))}
        </div>

        {/* Sentiment dial */}
        <div style={{ position: 'absolute', left: '50%', top: '44%', transform: 'translate(-50%, -50%)', width: 210, height: 210 }}>
          <svg viewBox="0 0 220 220" width="210" height="210">
            <circle cx="110" cy="110" r="92" fill="none" stroke={INK3} strokeWidth="1" />
            <circle cx="110" cy="110" r="92" fill="none" stroke={ACCENT} strokeWidth="2"
              strokeDasharray={`${sentiment * circumference} ${circumference}`}
              transform="rotate(-90 110 110)" strokeLinecap="round" />
            {Array.from({ length: 36 }).map((_, i) => {
              const a = (i / 36) * Math.PI * 2;
              return <line key={i} x1={110 + Math.cos(a) * 78} y1={110 + Math.sin(a) * 78} x2={110 + Math.cos(a) * 84} y2={110 + Math.sin(a) * 84} stroke={PAPER} strokeOpacity="0.15" strokeWidth="1" />;
            })}
            <line x1="110" y1="110" x2={110 + Math.cos((angle * Math.PI) / 180) * 68} y2={110 + Math.sin((angle * Math.PI) / 180) * 68} stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
            <circle cx="110" cy="110" r="4" fill={ACCENT} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontFamily: fontMono, fontSize: 9, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>sentiment</span>
            <span style={{ fontFamily: fontSerif, fontSize: 52, color: PAPER, lineHeight: 1 }}>+{sentiment.toFixed(2)}</span>
            <span style={{ fontFamily: fontMono, fontSize: 10, color: ACCENT, marginTop: 4, letterSpacing: 0.5 }}>↑ +0.12 vs last week</span>
          </div>
        </div>

        {/* Floating mention bubbles */}
        <div style={{ position: 'absolute', left: 14, top: 14, width: 190, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mentions.slice(-3).map((m, i) => (
            <div key={m.id} style={{ background: INK, border: `1px solid ${INK3}`, padding: '8px 10px', borderRadius: 6, animation: 'lp-float-in 0.6s ease-out', opacity: i === 0 ? 0.4 : i === 1 ? 0.7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontFamily: fontMono, fontSize: 9, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>{m.src} · {m.t}</span>
                <span style={{ fontFamily: fontMono, fontSize: 9, color: m.s > 0 ? ACCENT : '#ff5c5c' }}>{m.c}{Math.abs(m.s).toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11, color: PAPER, lineHeight: 1.4 }}>{m.txt}</div>
            </div>
          ))}
        </div>

        {/* Source counts */}
        <div style={{ position: 'absolute', right: 14, top: 14, width: 148 }}>
          <div style={{ fontFamily: fontMono, fontSize: 9, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>sources · live</div>
          {[
            { name: 'x.com',   count: 842, w: 100 },
            { name: 'reddit',  count: 421, w: 50  },
            { name: 'tiktok',  count: 318, w: 38  },
            { name: 'news',    count: 156, w: 19  },
            { name: 'youtube', count: 105, w: 12  },
          ].map(s => (
            <div key={s.name} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontFamily: fontMono, fontSize: 10, color: PAPER }}>{s.name}</span>
                <span style={{ fontFamily: fontMono, fontSize: 10, color: ACCENT }}>{s.count}</span>
              </div>
              <div style={{ height: 2, background: INK3, borderRadius: 1, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: ACCENT, width: `${s.w}%`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Bottom sparkline */}
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, background: INK, border: `1px solid ${INK3}`, padding: 12, borderRadius: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: fontMono, fontSize: 9, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>volume · last 12h</span>
            <span style={{ fontFamily: fontMono, fontSize: 9, color: ACCENT }}>● 4,217/min · ↑18%</span>
          </div>
          <Sparkline height={40} color={ACCENT} seed={2} />
        </div>
      </div>
    </div>
  );
}

// ── SocialOrbit ───────────────────────────────────────────────────────────────

interface Pulse { id: number; platform: number; born: number; sentiment: number; }
interface Chip  { id: number; p: string; t: string; born: number; y: number; }

const ORBIT_SAMPLES = [
  { p: 'x',      t: '@maeve · loving the new drop'       },
  { p: 'tiktok', t: '@unbox · this is the one'           },
  { p: 'reddit', t: 'r/design · genuinely well-made'     },
  { p: 'ig',     t: '@stylefiles · obsessed'             },
  { p: 'yt',     t: 'Tech Daily · review (8.2/10)'       },
  { p: 'news',   t: 'TechCrunch · raises $40M'           },
  { p: 'li',     t: 'VP Marketing · this is brilliant'   },
];

const PLATFORMS_ORBIT = [
  { name: 'X',         color: '#ffffff', glyph: '𝕏'  },
  { name: 'TikTok',    color: '#ff4d80', glyph: '♪'  },
  { name: 'Reddit',    color: '#ff5722', glyph: 'ⓡ'  },
  { name: 'Instagram', color: '#e1306c', glyph: '◉'  },
  { name: 'YouTube',   color: '#ff3030', glyph: '▶'  },
  { name: 'News',      color: PAPER,     glyph: '✦'  },
  { name: 'LinkedIn',  color: '#4a90e2', glyph: 'in' },
];

function SocialOrbit() {
  const [tick,   setTick]   = useState(0);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [chips,  setChips]  = useState<Chip[]>([]);

  useEffect(() => {
    let raf: number;
    const t0 = performance.now();
    const loop = (now: number) => { setTick((now - t0) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setPulses(prev => {
        const next = prev.filter(p => performance.now() - p.born < 2200);
        next.push({ id: Math.random(), platform: Math.floor(Math.random() * 7), born: performance.now(), sentiment: Math.random() > 0.25 ? 1 : -1 });
        return next;
      });
    }, 280);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      setChips(prev => {
        const next = prev.filter(m => performance.now() - m.born < 4000);
        const s = ORBIT_SAMPLES[i % ORBIT_SAMPLES.length];
        next.push({ id: Math.random(), ...s, born: performance.now(), y: Math.random() * 0.8 + 0.1 });
        i++;
        return next;
      });
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const W = 560; const H = 500;
  const cx = W / 2; const cy = H / 2;
  const orbitR = 170;

  const platformPos = (i: number) => {
    const angle = (i / PLATFORMS_ORBIT.length) * Math.PI * 2 + tick * 0.08 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * orbitR, y: cy + Math.sin(angle) * orbitR, angle };
  };

  return (
    <div style={{ position: 'relative', height: H, background: INK2, border: `1px solid ${INK3}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}>
      {/* Chrome */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${INK3}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 5 }}>
        <span style={{ fontFamily: fontMono, fontSize: 11, color: PAPER, letterSpacing: 0.4, textTransform: 'uppercase' }}>agent · listening across the web</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PulseDot color={ACCENT} size={6} />
          <span style={{ fontFamily: fontMono, fontSize: 10, color: ACCENT, letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {(4217 + Math.round(Math.sin(tick) * 80)).toLocaleString()} mentions/min
          </span>
        </span>
      </div>

      <svg width={W} height={H - 44} viewBox={`0 0 ${W} ${H - 44}`} style={{ position: 'absolute', left: 0, top: 44 }}>
        {[orbitR, orbitR - 45, orbitR - 90, orbitR - 130].map((r, i) => (
          <circle key={r} cx={cx} cy={cy - 22} r={r} fill="none" stroke={PAPER} strokeOpacity={0.04 + i * 0.01} strokeWidth="1" strokeDasharray={i === 0 ? '0' : '2 6'} />
        ))}
        {PLATFORMS_ORBIT.map((_, i) => {
          const pos = platformPos(i);
          return <line key={i} x1={pos.x} y1={pos.y - 22} x2={cx} y2={cy - 22} stroke={PAPER} strokeOpacity="0.05" strokeWidth="1" />;
        })}
        {pulses.map(pulse => {
          const t = (performance.now() - pulse.born) / 2000;
          if (t > 1) return null;
          const pos = platformPos(pulse.platform);
          const px = pos.x + (cx - pos.x) * t;
          const py = (pos.y - 22) + (cy - 22 - (pos.y - 22)) * t;
          const color = pulse.sentiment > 0 ? ACCENT : '#ff5c5c';
          return (
            <g key={pulse.id} opacity={Math.sin(t * Math.PI)}>
              <circle cx={px} cy={py} r={3} fill={color} />
              <circle cx={px} cy={py} r={6} fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="1" />
            </g>
          );
        })}
        {/* Center pulsing rings */}
        {[0, 1, 2].map(i => {
          const t = ((tick * 0.5) + i * 0.4) % 1.2;
          const r = 28 + t * 50;
          const op = Math.max(0, 0.5 - t * 0.5);
          return <circle key={i} cx={cx} cy={cy - 22} r={r} fill="none" stroke={ACCENT} strokeWidth="1" opacity={op} />;
        })}
        <circle cx={cx} cy={cy - 22} r="30" fill={INK} stroke={ACCENT} strokeWidth="2" />
        <circle cx={cx} cy={cy - 22} r="23" fill="none" stroke={ACCENT} strokeOpacity="0.3" strokeWidth="1" strokeDasharray="2 4" />
        {PLATFORMS_ORBIT.map((p, i) => {
          const pos = platformPos(i);
          return (
            <g key={p.name} transform={`translate(${pos.x},${pos.y - 22})`}>
              <circle r="19" fill={INK} stroke={INK3} strokeWidth="1" />
              <circle r="19" fill={p.color} fillOpacity="0.1" />
              <text textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill={p.color} style={{ fontFamily: p.name === 'LinkedIn' ? fontMono : 'system-ui, sans-serif' }}>{p.glyph}</text>
            </g>
          );
        })}
        {PLATFORMS_ORBIT.map((p, i) => {
          const pos = platformPos(i);
          const lx = cx + Math.cos(pos.angle) * (orbitR + 30);
          const ly = cy - 22 + Math.sin(pos.angle) * (orbitR + 30);
          return <text key={`l-${p.name}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize="8" fill={MUTED} style={{ fontFamily: fontMono, letterSpacing: 0.5, textTransform: 'uppercase' }}>{p.name}</text>;
        })}
      </svg>

      {/* Center label overlay */}
      <div style={{ position: 'absolute', left: cx, top: cy + 22, transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none', zIndex: 4 }}>
        <div style={{ fontFamily: fontMono, fontSize: 8, color: MUTED, letterSpacing: 1, textTransform: 'uppercase' }}>your brand</div>
        <div style={{ fontFamily: fontSerif, fontSize: 18, color: PAPER, lineHeight: 1, marginTop: 2, fontStyle: 'italic' }}>ACME</div>
      </div>

      {/* Mention chips */}
      <div style={{ position: 'absolute', right: 10, top: 56, bottom: 10, width: 170, pointerEvents: 'none' }}>
        {chips.slice(-4).map(m => {
          const age = (performance.now() - m.born) / 4000;
          const opacity = age < 0.15 ? age / 0.15 : age > 0.85 ? (1 - age) / 0.15 : 1;
          return (
            <div key={m.id} style={{ position: 'absolute', right: 0, top: `${m.y * 80}%`, background: INK, border: `1px solid ${INK3}`, padding: '6px 8px', borderRadius: 6, opacity, maxWidth: 170 }}>
              <div style={{ fontFamily: fontMono, fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{m.p}</div>
              <div style={{ fontSize: 10, color: PAPER, lineHeight: 1.3 }}>{m.t}</div>
            </div>
          );
        })}
      </div>

      {/* Bottom HUD */}
      <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', gap: 8, zIndex: 3 }}>
        {[
          { l: 'sources',       v: '7'     },
          { l: 'mentions /24h', v: '12.4K' },
          { l: 'sentiment',     v: '+0.71' },
          { l: 'anomalies',     v: '3', c: '#ff5c5c' },
        ].map(s => (
          <div key={s.l} style={{ flex: 1, background: INK, border: `1px solid ${INK3}`, padding: '7px 8px', borderRadius: 4 }}>
            <div style={{ fontFamily: fontMono, fontSize: 7, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>{s.l}</div>
            <div style={{ fontFamily: fontSerif, fontSize: 15, color: s.c ?? PAPER, lineHeight: 1.1, marginTop: 2 }}>{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Auth icon helpers ─────────────────────────────────────────────────────────

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MicrosoftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" style={{ flexShrink: 0 }}>
      <path fill="#f3f3f3" d="M0 0h23v23H0z" />
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function LandingPage() {
  const { signIn, signInWithMicrosoft } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'microsoft' | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  const handleSignIn = async (provider: 'google' | 'microsoft') => {
    if (loadingProvider) return;
    setLoadingProvider(provider);
    try {
      if (provider === 'google') await signIn();
      else await signInWithMicrosoft();
    } catch {
      // popup closed or cancelled — handled internally
    } finally {
      setLoadingProvider(null);
    }
  };

  // Inline sub-components using design tokens
  const Mono = ({ children, color = MUTED, size = 11 }: { children: ReactNode; color?: string; size?: number }) => (
    <span style={{ fontFamily: fontMono, fontSize: size, color, letterSpacing: 0.4, textTransform: 'uppercase' as const }}>{children}</span>
  );

  const Eyebrow = ({ children }: { children: ReactNode }) => (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <span style={{ width: 24, height: 1, background: ACCENT, display: 'inline-block' }} />
      <Mono color={ACCENT}>{children}</Mono>
    </div>
  );

  const heroFade = (delay: number): React.CSSProperties => ({
    transition: 'opacity 700ms ease-out, transform 700ms ease-out',
    transitionDelay: `${delay}ms`,
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'none' : 'translateY(24px)',
  });

  // Shared button styles
  const btnPrimary: React.CSSProperties = {
    background: ACCENT, color: INK, border: 'none', padding: '15px 22px',
    fontSize: 14, fontWeight: 600, cursor: 'pointer', borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: fontSans,
    opacity: loadingProvider ? 0.7 : 1,
  };
  const btnSecondary: React.CSSProperties = {
    background: 'transparent', color: PAPER, border: `1px solid ${INK3}`, padding: '15px 22px',
    fontSize: 14, cursor: 'pointer', borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: fontSans,
    opacity: loadingProvider ? 0.7 : 1,
  };

  return (
    <div style={{ '--primary': ACCENT, minHeight: '100vh', background: INK, color: PAPER, fontFamily: fontSans, overflowX: 'hidden' } as React.CSSProperties}>
      <style>{`
        @keyframes lp-pulse   { 0% { transform:scale(1); opacity:.6 } 100% { transform:scale(2.4); opacity:0 } }
        @keyframes lp-ring    { 0% { transform:scale(0.5); opacity:0.5 } 100% { transform:scale(1.4); opacity:0 } }
        @keyframes lp-float-in { 0% { opacity:0; transform:translateY(8px) } 100% { opacity:1; transform:translateY(0) } }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{ padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${INK3}`, position: 'sticky', top: 0, zIndex: 50, background: INK }}>
        <Logo size="sm" />
        <div style={{ display: 'flex', gap: 28, fontSize: 13, color: MUTED }}>
          <span style={{ cursor: 'default' }}>Product</span>
          <span style={{ cursor: 'default' }}>Use cases</span>
          <span style={{ cursor: 'default' }}>Pricing</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button style={{ background: 'transparent', color: MUTED, border: 'none', fontSize: 13, cursor: 'pointer', padding: '8px 4px', fontFamily: fontSans }} onClick={() => handleSignIn('google')} disabled={loadingProvider !== null}>
            Sign in
          </button>
          <button style={{ background: ACCENT, color: INK, border: 'none', padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, fontFamily: fontSans }} onClick={() => handleSignIn('google')} disabled={loadingProvider !== null}>
            {loadingProvider === 'google' ? 'Signing in…' : 'Start free →'}
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ padding: '80px 40px 56px' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56, alignItems: 'center' }}>
          <div>
            <div style={heroFade(0)}><Eyebrow>Social listening · reimagined</Eyebrow></div>
            <h1 style={{ ...heroFade(80), fontFamily: fontSerif, fontSize: 'clamp(56px, 7.5vw, 112px)', lineHeight: 0.93, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 32px' }}>
              Hear what the<br />
              internet is saying<br />
              <span style={{ fontStyle: 'italic', color: ACCENT }}>about you.</span>
            </h1>
            <p style={{ ...heroFade(160), fontSize: 18, lineHeight: 1.55, color: PAPER, opacity: 0.75, margin: '0 0 32px', maxWidth: 520 }}>
              Deploy AI agents that monitor your brand across every major platform. Just describe your goal — dashboards, reports, briefings — delivered while you do other work.
            </p>
            <div style={{ ...heroFade(240), display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
              <button style={{ ...btnPrimary, padding: '16px 22px', fontSize: 14 }} onClick={() => handleSignIn('google')} disabled={loadingProvider !== null}>
                <GoogleIcon size={18} />
                {loadingProvider === 'google' ? 'Signing in…' : <span>Build my agent <span style={{ fontFamily: fontSerif, fontStyle: 'italic', fontSize: 16 }}>— free</span></span>}
              </button>
              <button style={{ ...btnSecondary, padding: '16px 22px', fontSize: 14 }} onClick={() => handleSignIn('microsoft')} disabled={loadingProvider !== null}>
                <MicrosoftIcon size={18} />
                {loadingProvider === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
              </button>
            </div>
            <div style={{ ...heroFade(300), display: 'flex', gap: 24, marginTop: 20 }}>
              <Mono>✓ no card</Mono><Mono>✓ 3 min setup</Mono><Mono>✓ cancel anytime</Mono>
            </div>
          </div>
          <div style={heroFade(340)}>
            <HeroAnimation />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '80px 40px' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 48, flexWrap: 'wrap' as const, gap: 16 }}>
            <div>
              <Eyebrow>How it works</Eyebrow>
              <h2 style={{ fontFamily: fontSerif, fontSize: 'clamp(38px, 4.5vw, 64px)', lineHeight: 0.95, fontWeight: 400, letterSpacing: '-0.02em', margin: 0 }}>
                Three steps. <span style={{ fontStyle: 'italic', color: ACCENT }}>Three minutes.</span>
              </h2>
            </div>
            <Mono>no onboarding call · no csm · no pilot</Mono>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {[
              { n: '01', t: 'Describe', b: '"Track every mention of our brand and three competitors. Flag tone shifts." That\'s the brief.', code: '> intent: brand_pulse' },
              { n: '02', t: 'Approve',  b: 'The agent scopes sources, metrics, schedule. You read it like a memo. Edit. Deploy.',                  code: '> agent.plan ✓'      },
              { n: '03', t: 'Receive',  b: 'Monday emails. Friday slide decks. Anomaly pings the second something matters. Forever.',               code: '> schedule.live'    },
            ].map(s => (
              <div key={s.n} style={{ background: INK2, border: `1px solid ${INK3}`, borderRadius: 6, padding: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
                  <span style={{ fontFamily: fontSerif, fontSize: 56, color: ACCENT, fontStyle: 'italic', lineHeight: 1 }}>{s.n}</span>
                  <Mono size={10}>{s.code}</Mono>
                </div>
                <h3 style={{ fontFamily: fontSerif, fontSize: 36, fontWeight: 400, margin: '0 0 12px', letterSpacing: '-0.01em', color: PAPER }}>{s.t}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.55, color: PAPER, opacity: 0.7, margin: 0 }}>{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRODUCT / SOCIAL ORBIT ── */}
      <section style={{ padding: '0 40px 80px' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 56, alignItems: 'center' }}>
          <div>
            <Eyebrow>The product, in passing</Eyebrow>
            <h2 style={{ fontFamily: fontSerif, fontSize: 'clamp(34px, 4vw, 56px)', lineHeight: 0.95, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 20px' }}>
              Every platform, <span style={{ fontStyle: 'italic' }}>one room.</span>
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.55, color: PAPER, opacity: 0.7, margin: 0, maxWidth: 440 }}>
              X, TikTok, Reddit, Instagram, YouTube, news, LinkedIn — your agent listens across all of them at once. Every mention, weighted, scored, routed back to you.
            </p>
            <div style={{ marginTop: 28 }}>
              {[
                { k: '01', t: '7+ sources, no API juggling'  },
                { k: '02', t: 'Real-time, not yesterday\'s data' },
                { k: '03', t: 'Sentiment, scored per mention' },
              ].map(r => (
                <div key={r.k} style={{ display: 'flex', gap: 16, alignItems: 'baseline', padding: '12px 0', borderTop: `1px solid ${INK3}` }}>
                  <Mono color={ACCENT}>{r.k}</Mono>
                  <span style={{ fontFamily: fontSerif, fontSize: 19, color: PAPER }}>{r.t}</span>
                </div>
              ))}
            </div>
          </div>
          <SocialOrbit />
        </div>
      </section>

      {/* ── INTERACTIVE DEMO ── */}
      <section style={{ padding: '0 40px 80px' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', background: INK2, border: `1px solid ${INK3}`, borderRadius: 8, padding: 32, display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 48, alignItems: 'start' }}>
          <div>
            <Eyebrow>Try it now</Eyebrow>
            <h2 style={{ fontFamily: fontSerif, fontSize: 'clamp(30px, 3.5vw, 48px)', lineHeight: 1.0, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 16px' }}>
              Type what you want to know.<br /><span style={{ fontStyle: 'italic', color: ACCENT }}>Watch it scope.</span>
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: PAPER, opacity: 0.7, margin: 0 }}>
              This is the actual onboarding. Drop a brand or topic — Veille builds the agent's plan in real time.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginTop: 24 }}>
              {['Track Liquid Death', 'Allbirds vs Hoka', 'Watch our CEO', 'AI in beauty'].map(q => (
                <span key={q} style={{ fontFamily: fontMono, fontSize: 11, color: PAPER, padding: '6px 10px', background: INK, border: `1px solid ${INK3}`, borderRadius: 3 }}>→ {q}</span>
              ))}
            </div>
          </div>
          <div style={{ background: INK, border: `1px solid ${INK3}`, borderRadius: 6 }}>
            <div style={{ borderBottom: `1px solid ${INK3}`, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Mono size={11} color={PAPER}>veille · onboarding</Mono>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PulseDot color={ACCENT} size={5} /><Mono size={10}>live</Mono></span>
            </div>
            <div style={{ padding: 16, fontSize: 12, lineHeight: 1.7 }}>
              <Mono size={10}>&gt; you</Mono>
              <div style={{ color: PAPER, fontSize: 14, margin: '4px 0 14px' }}>
                Track Liquid Death across X, TikTok, Reddit. Weekly recap.
              </div>
              <Mono size={10}>&gt; veille · scoping</Mono>
              <div style={{ color: PAPER, fontSize: 12, margin: '4px 0 12px' }}>
                <Typing text={'✓ entity: Liquid Death (verified)\n✓ sources: x · tiktok · reddit\n✓ metrics: volume · sentiment · sov\n✓ schedule: monday 9am\n✓ delivery: email + dashboard + 4-slide deck'} speed={16} />
              </div>
              <div style={{ borderTop: `1px solid ${INK3}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Mono size={11}>setup: 0.47s</Mono>
                <button style={{ background: ACCENT, color: INK, border: 'none', padding: '8px 14px', fontFamily: fontMono, fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 3 }} onClick={() => handleSignIn('google')} disabled={loadingProvider !== null}>
                  {loadingProvider === 'google' ? 'Signing in…' : 'Deploy ↵'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURE GRID ── */}
      <section style={{ padding: '0 40px 80px' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto' }}>
          <div style={{ marginBottom: 40 }}>
            <Eyebrow>What every agent ships</Eyebrow>
            <h2 style={{ fontFamily: fontSerif, fontSize: 'clamp(38px, 4.5vw, 64px)', fontWeight: 400, letterSpacing: '-0.02em', margin: 0, lineHeight: 0.95 }}>
              One sentence in. <span style={{ fontStyle: 'italic', color: ACCENT }}>Five finished things out.</span>
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>

            {/* Dashboards — 2×2 */}
            <div style={{ gridColumn: 'span 2', gridRow: 'span 2', background: INK2, border: `1px solid ${INK3}`, borderRadius: 6, padding: 28 }}>
              <Mono color={ACCENT}>01 · dashboards</Mono>
              <h3 style={{ fontFamily: fontSerif, fontSize: 36, fontWeight: 400, margin: '10px 0 10px', letterSpacing: '-0.01em', lineHeight: 1.05, color: PAPER }}>A live view of your room.</h3>
              <p style={{ fontSize: 14, color: PAPER, opacity: 0.65, lineHeight: 1.5, margin: '0 0 20px', maxWidth: 380 }}>Volume, sentiment, share-of-voice, top creators, anomaly heatmap. Open it in a tab and forget it.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                {[{ l: 'Volume', v: '12.4K', d: '+18%' }, { l: 'Sentiment', v: '+0.71', d: '+0.12' }, { l: 'SoV', v: '34%', d: '+4%' }].map(m => (
                  <div key={m.l} style={{ background: INK, padding: 12, borderRadius: 4, border: `1px solid ${INK3}` }}>
                    <Mono size={9}>{m.l}</Mono>
                    <div style={{ fontFamily: fontSerif, fontSize: 24, marginTop: 4, color: PAPER }}>{m.v}</div>
                    <Mono size={10} color={ACCENT}>{m.d}</Mono>
                  </div>
                ))}
              </div>
              <div style={{ background: INK, padding: 14, borderRadius: 4, border: `1px solid ${INK3}` }}>
                <Sparkline height={70} color={ACCENT} seed={9} />
              </div>
            </div>

            {/* PDF Reports */}
            <div style={{ gridColumn: 'span 2', background: INK2, border: `1px solid ${INK3}`, borderRadius: 6, padding: 28 }}>
              <Mono color={ACCENT}>02 · pdf reports</Mono>
              <h3 style={{ fontFamily: fontSerif, fontSize: 26, fontWeight: 400, margin: '8px 0 8px', letterSpacing: '-0.01em', color: PAPER }}>Weekly briefs, branded.</h3>
              <p style={{ fontSize: 13, color: PAPER, opacity: 0.6, lineHeight: 1.5, margin: '0 0 14px' }}>Auto-generated. Your colors. Boardroom-grade.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[1, 2].map(i => (
                  <div key={i} style={{ background: INK, padding: 14, borderRadius: 4, height: 96, border: `1px solid ${INK3}` }}>
                    <div style={{ fontFamily: fontSerif, fontSize: 12, marginBottom: 6, color: PAPER }}>Q2 Recap</div>
                    <div style={{ height: 3, background: ACCENT, width: '55%', marginBottom: 4 }} />
                    <div style={{ height: 2, background: INK3, marginBottom: 3 }} />
                    <div style={{ height: 2, background: INK3, width: '70%', marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 24 }}>
                      {[40, 60, 30, 70, 55, 80, 45].map((h, j) => <div key={j} style={{ flex: 1, height: `${h}%`, background: ACCENT, opacity: 0.6 }} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Slide Decks */}
            <div style={{ gridColumn: 'span 2', background: INK2, border: `1px solid ${INK3}`, borderRadius: 6, padding: 28 }}>
              <Mono color={ACCENT}>03 · slide decks</Mono>
              <h3 style={{ fontFamily: fontSerif, fontSize: 26, fontWeight: 400, margin: '8px 0 8px', letterSpacing: '-0.01em', color: PAPER }}>Drop-in for the meeting.</h3>
              <p style={{ fontSize: 13, color: PAPER, opacity: 0.6, lineHeight: 1.5, margin: '0 0 14px' }}>Auto-built every Friday. Editable. On-brand.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, height: 96 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ background: INK, padding: 10, borderRadius: 3, border: i === 1 ? `1px solid ${ACCENT}` : `1px solid ${INK3}` }}>
                    <div style={{ fontFamily: fontSerif, fontSize: 10, marginBottom: 4, color: PAPER }}>Slide {i}</div>
                    <div style={{ height: 2, background: ACCENT, width: '40%', marginBottom: 3 }} />
                    <div style={{ height: 1.5, background: INK3, marginBottom: 2 }} />
                    <div style={{ height: 1.5, background: INK3, width: '70%', marginBottom: 6 }} />
                    <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 22 }}>
                      {[30, 60, 40, 80, 50].map((h, j) => <div key={j} style={{ flex: 1, height: `${h}%`, background: INK3 }} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Email Briefings */}
            <div style={{ gridColumn: 'span 2', background: INK2, border: `1px solid ${INK3}`, borderRadius: 6, padding: 28 }}>
              <Mono color={ACCENT}>04 · email briefings</Mono>
              <h3 style={{ fontFamily: fontSerif, fontSize: 26, fontWeight: 400, margin: '8px 0 14px', letterSpacing: '-0.01em', color: PAPER }}>A 60-second read with your coffee.</h3>
              <div style={{ background: INK, padding: 14, borderRadius: 4, border: `1px solid ${INK3}`, fontFamily: fontMono, fontSize: 11, lineHeight: 1.7 }}>
                <Mono size={10}>From: veille@</Mono><br />
                <Mono size={10}>Subject: your week, in 3 bullets</Mono>
                <div style={{ borderTop: `1px solid ${INK3}`, marginTop: 8, paddingTop: 8, color: PAPER }}>
                  <span style={{ color: ACCENT }}>↑</span> Sentiment recovered post-launch (+0.18)<br />
                  <span style={{ color: '#ff5c5c' }}>⚠</span> One TikTok creator at 2.1M reach<br />
                  <span style={{ color: MUTED }}>→</span> Competitor went quiet (3rd week)
                </div>
              </div>
            </div>

            {/* Scheduled Runs */}
            <div style={{ gridColumn: 'span 2', background: INK2, border: `1px solid ${INK3}`, borderRadius: 6, padding: 28 }}>
              <Mono color={ACCENT}>05 · scheduled runs</Mono>
              <h3 style={{ fontFamily: fontSerif, fontSize: 26, fontWeight: 400, margin: '8px 0 14px', letterSpacing: '-0.01em', color: PAPER }}>"Every Monday at 9."</h3>
              <div style={{ background: INK, padding: 14, borderRadius: 4, border: `1px solid ${INK3}` }}>
                {[
                  { t: 'MON 09:00',  l: 'weekly recap → leadership@' },
                  { t: 'DAILY 07:30', l: 'anomaly digest'             },
                  { t: 'ON SPIKE',   l: 'slack #pulse-alerts'         },
                  { t: 'FRI 17:00',  l: 'slide deck → drive'          },
                ].map((r, i) => (
                  <div key={r.t} style={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: 12, padding: '7px 0', borderTop: i > 0 ? `1px solid ${INK3}` : 'none', alignItems: 'center' }}>
                    <Mono size={10} color={ACCENT}>{r.t}</Mono>
                    <span style={{ fontFamily: fontMono, fontSize: 12, color: PAPER }}>{r.l}</span>
                    <PulseDot color={ACCENT} size={5} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── COMPARISON ── */}
      <section style={{ borderTop: `1px solid ${INK3}` }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', padding: '80px 40px', display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 56, alignItems: 'start' }}>
          <div>
            <Eyebrow>A quiet comparison</Eyebrow>
            <h2 style={{ fontFamily: fontSerif, fontSize: 'clamp(34px, 4vw, 56px)', lineHeight: 0.95, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 20px' }}>
              The legacy suites are fine.<br /><span style={{ fontStyle: 'italic', color: ACCENT }}>If you have a quarter to spare.</span>
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: PAPER, opacity: 0.7, margin: 0, maxWidth: 440 }}>
              We respect the incumbents. But social listening shouldn't require procurement, six-week pilots, and a customer success manager named Greg.
            </p>
          </div>
          <div style={{ background: INK2, border: `1px solid ${INK3}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', padding: '14px 20px', background: INK3 }}>
              <Mono>capability</Mono><Mono>legacy suites</Mono><Mono color={ACCENT}>veille</Mono>
            </div>
            {[
              ['Time to first dashboard', '2–6 weeks',           '3 minutes'       ],
              ['Setup',                   'Onboarding + training','Type a sentence'  ],
              ['Monthly minimum',         '$800 – $3,000',        'Free · from $20'  ],
              ['Slides & reports',        'Manual',               'Auto-generated'   ],
              ['Email briefings',         'Add-on / DIY',         'Native'           ],
              ['Cancel',                  'Annual contract',      'One click'        ],
            ].map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', padding: '16px 20px', borderTop: `1px solid ${INK3}`, alignItems: 'center', fontSize: 13 }}>
                <span style={{ fontFamily: fontSerif, fontSize: 17, color: PAPER }}>{r[0]}</span>
                <span style={{ color: MUTED }}>{r[1]}</span>
                <span style={{ color: ACCENT, fontWeight: 500 }}>✓ {r[2]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{ borderTop: `1px solid ${INK3}`, padding: '100px 40px 80px', textAlign: 'center' }}>
        <Eyebrow>Start listening</Eyebrow>
        <h2 style={{ fontFamily: fontSerif, fontSize: 'clamp(60px, 9.5vw, 140px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 0.9, margin: '16px 0 40px' }}>
          Stop reading.<br /><span style={{ fontStyle: 'italic', color: ACCENT }}>Start listening.</span>
        </h2>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' as const, marginBottom: 20 }}>
          <button style={{ ...btnPrimary, padding: '18px 28px', fontSize: 15 }} onClick={() => handleSignIn('google')} disabled={loadingProvider !== null}>
            <GoogleIcon size={18} />
            {loadingProvider === 'google' ? 'Signing in…' : 'Build my first agent — free'}
          </button>
          <button style={{ ...btnSecondary, padding: '18px 28px', fontSize: 15 }} onClick={() => handleSignIn('microsoft')} disabled={loadingProvider !== null}>
            <MicrosoftIcon size={18} />
            {loadingProvider === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
          </button>
        </div>
        <Mono>no card · 3 min · cancel anytime</Mono>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: `1px solid ${INK3}`, padding: '40px 40px 28px' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap' as const, gap: 24 }}>
          <div>
            <Logo size="sm" />
            <div style={{ marginTop: 10 }}><Mono>© 2026 Veille · social listening, simplified</Mono></div>
          </div>
          <div style={{ display: 'flex', gap: 40, fontFamily: fontMono, fontSize: 11, color: MUTED, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: PAPER }}>Product</span>
              <span>Features</span>
              <span>Pricing</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: PAPER }}>Legal</span>
              <span>Privacy</span>
              <span>Terms</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
