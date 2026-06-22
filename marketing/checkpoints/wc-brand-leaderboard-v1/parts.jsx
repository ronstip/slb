// Shared primitives for the three leaderboard layouts.
// Exported to window so each board file (Babel-isolated) can read them.
(function () {
  const C = {
    cream:  '#F6F4EF',
    cream2: '#EFEBE2',
    paper:  '#FBFAF6',
    ink:    '#0F1F4D',   // brand navy — mirrors LP_BRAND.ink on the landing page (was near-black #1A1714)
    slate:  '#3A4467',   // cooled to a muted navy so secondary text harmonises with the navy ink
    rule:   '#E5E0D4',
    ruleSoft: 'rgba(229,224,212,0.7)',
    muted:  '#6A7090',   // cooled warm-gray → navy-tinted gray
    orange: '#D97757',
    orangeDeep: '#C25E3F',
    orangeSoft: '#F2D5C4',
    up:     '#2F8E6C',
    down:   '#C0573C',
    flat:   '#A29A8B',
  };
  const FONT = {
    display: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
    serif:   "'Fraunces', Georgia, serif",
    sans:    "'Inter Tight', 'Inter', system-ui, sans-serif",
    mono:    "'JetBrains Mono', ui-monospace, monospace",
  };

  // ── Mono eyebrow ────────────────────────────────────────────────
  function Eyebrow({ children, color, size = 12, style = {} }) {
    return (
      <span style={{
        fontFamily: FONT.mono, fontSize: size, fontWeight: 500,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: color || C.muted, ...style,
      }}>{children}</span>
    );
  }

  // ── Scolto corner mark ──────────────────────────────────────────
  function Mark({ size = 34, dot = C.orange, stroke = C.ink }) {
    const sw = Math.max(3, size / 22), W = 64, ARM = 14;
    return (
      <svg viewBox={`-1 -1 ${W + 2} ${W + 2}`} width={size} height={size}
        fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="butt"
        strokeLinejoin="miter" style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}>
        <path d={`M0 ${ARM} V0 H${ARM}`} />
        <path d={`M${W - ARM} 0 H${W} V${ARM}`} />
        <path d={`M${W} ${W - ARM} V${W} H${W - ARM}`} />
        <path d={`M${ARM} ${W} H0 V${W - ARM}`} />
        <circle cx={W / 2} cy={W / 2} r="7" fill={dot} stroke="none" />
      </svg>
    );
  }

  // ── Brand tile — real logo glyph (logos.js, tinted in the brand colour)
  //    when brand.icon is set; brand.logo image URL as second option;
  //    monogram fallback otherwise ────────────────────────────
  function BrandTile({ brand, size = 52, radius }) {
    const r = radius != null ? radius : Math.round(size * 0.26);
    const chip = {
      width: size, height: size, flexShrink: 0, borderRadius: r,
      background: '#FFFFFF', border: `1px solid ${C.rule}`, boxSizing: 'border-box',
      display: 'inline-grid', placeItems: 'center', overflow: 'hidden',
      boxShadow: '0 1px 2px rgba(26,23,20,0.12)',
    };
    const path = brand.icon && window.WC_LOGOS && window.WC_LOGOS[brand.icon];
    if (path) {
      return (
        <span style={chip}>
          <svg viewBox="0 0 24 24" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} style={{ display: 'block' }}>
            <path d={path} fill={brand.color} />
          </svg>
        </span>
      );
    }
    if (brand.logo) {
      return (
        <span style={chip}>
          <img src={brand.logo} alt={brand.name} referrerPolicy="no-referrer"
            style={{ width: '70%', height: '70%', objectFit: 'contain', display: 'block' }} />
        </span>
      );
    }
    return (
      <span style={{
        width: size, height: size, flexShrink: 0,
        borderRadius: r,
        background: brand.color, color: brand.fg,
        display: 'inline-grid', placeItems: 'center',
        boxShadow: '0 1px 2px rgba(26,23,20,0.20)',
        outline: '1px solid rgba(0,0,0,0.06)',
        fontFamily: FONT.serif, fontWeight: 600,
        fontSize: size * 0.5, lineHeight: 1, letterSpacing: '-0.02em',
      }}>{brand.mono}</span>
    );
  }

  // ── Movement indicator (arrow / dash only — never a number) ─────
  function Move({ move, size = 18 }) {
    const s = size;
    if (move === 'same') {
      return (
        <svg width={s} height={s} viewBox="0 0 18 18" style={{ display: 'block' }}>
          <rect x="3" y="8" width="12" height="2.2" rx="1.1" fill={C.flat} />
        </svg>
      );
    }
    if (move === 'new') {
      // "Viral" — solid flame glyph (Heroicons fire), tinted with the hot accent
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path fillRule="evenodd" clipRule="evenodd" fill={C.orange}
            d="M12.963 2.286a.75.75 0 0 0-1.071-.136 9.742 9.742 0 0 0-3.539 6.177 7.547 7.547 0 0 1-1.705-1.715.75.75 0 0 0-1.152-.082A9 9 0 1 0 15.68 4.534a7.46 7.46 0 0 1-2.717-2.248ZM15.75 14.25a3.75 3.75 0 1 1-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 0 1 1.925-3.547 3.75 3.75 0 0 1 3.255 3.719Z" />
        </svg>
      );
    }
    const up = move === 'up';
    return (
      <svg width={s} height={s} viewBox="0 0 18 18" style={{ display: 'block' }}>
        <path d={up ? 'M9 3 L15 12 L3 12 Z' : 'M9 15 L3 6 L15 6 Z'}
          fill={up ? C.up : C.down} />
      </svg>
    );
  }

  // ── Sparkline (filled area + stroke + last-point dot) ───────────
  function Spark({ values, color = C.orangeDeep, width = 96, height = 30, strokeW = 1.8 }) {
    const max = Math.max(...values), min = Math.min(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - 3 - ((v - min) / range) * (height - 6);
      return [x, y];
    });
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = d + ` L ${width - 1} ${height - 1} L 1 ${height - 1} Z`;
    const last = pts[pts.length - 1];
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
        <path d={area} fill={color} opacity="0.10" />
        <path d={d} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
      </svg>
    );
  }

  // ── Platform badges (IG / TikTok / X / YouTube) ─────────────────
  // Brand glyphs lifted from ui_kits/marketing/shared.jsx — do not substitute.
  const PLATFORMS = {
    instagram: { color: 'radial-gradient(circle at 72% 108%, #FEDA77 0%, #F58529 40%, #DD2A7B 72%, #8134AF 94%, #515BD4 112%)', glyph: (<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" fill="#FFF" />) },
    tiktok:    { color: '#57534E', glyph: (<path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.3 0 .59.05.86.12V9.01a6.32 6.32 0 00-.86-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.98a8.21 8.21 0 004.77 1.52V7.05a4.83 4.83 0 01-1-.36z" fill="#FFF" />) },
    x:         { color: '#0F0F0F', glyph: (<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="#FFF" />) },
    youtube:   { color: '#E03030', glyph: (<path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFF" />) },
  };

  function PlatformBadge({ id, size = 26 }) {
    const p = PLATFORMS[id] || PLATFORMS.x;
    return (
      <span style={{
        width: size, height: size, borderRadius: Math.round(size * 0.24),
        background: p.color, display: 'inline-grid', placeItems: 'center', flexShrink: 0,
        boxShadow: '0 1px 2px rgba(15,12,8,0.18)', outline: '1px solid rgba(0,0,0,0.05)',
      }}>
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} style={{ display: 'block' }}>{p.glyph}</svg>
      </span>
    );
  }

  // "measured across" badge row — makes the data source obvious
  function Sources({ ids, size = 26, label = 'measured across' }) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {label && <Eyebrow size={10} style={{ whiteSpace: 'nowrap' }}>{label}</Eyebrow>}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          {ids.map(id => <PlatformBadge key={id} id={id} size={size} />)}
        </span>
      </span>
    );
  }

  // ── Scope chips — declare WHAT is being measured ────────────────
  function ScopeChips({ scope }) {
    const chip = (label, value, hot) => (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 13px',
        borderRadius: 999, background: '#FFFFFF',
        border: `1px solid ${hot ? 'rgba(217,119,87,0.55)' : C.rule}`,
        boxShadow: '0 1px 2px rgba(40,30,20,0.06)',
      }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 9.5, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ width: 3, height: 3, borderRadius: 999, background: hot ? C.orange : C.rule, flexShrink: 0 }} />
        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: hot ? C.orangeDeep : C.ink, whiteSpace: 'nowrap' }}>{value}</span>
      </span>
    );
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {chip('event', scope.event)}
        {chip('segment', scope.segment, true)}
      </span>
    );
  }

  // ── Arrow legend (used in footers) ──────────────────────────────
  function Legend() {
    const item = (move, label) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Move move={move} size={14} />
        <Eyebrow size={10}>{label}</Eyebrow>
      </span>
    );
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 18 }}>
        {item('up', 'climbing')}
        {item('down', 'slipping')}
        {item('same', 'held')}
        {item('new', 'Viral')}
      </span>
    );
  }

  // ── Football glyph (classic stitched ball) ──────────────────────
  function Football({ size = 40 }) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10.6" fill="#FFFFFF" stroke={C.ink} strokeWidth="1.4" />
        {/* central pentagon */}
        <path d="M12 8.6 L15.23 10.95 L14.0 14.75 L10.0 14.75 L8.77 10.95 Z" fill={C.ink} />
        {/* stitches from each pentagon vertex out to the rim */}
        <g stroke={C.ink} strokeWidth="1.3" strokeLinecap="round">
          <line x1="12" y1="8.6" x2="12" y2="1.6" />
          <line x1="15.23" y1="10.95" x2="21.9" y2="8.8" />
          <line x1="14.0" y1="14.75" x2="18.1" y2="20.4" />
          <line x1="10.0" y1="14.75" x2="5.9" y2="20.4" />
          <line x1="8.77" y1="10.95" x2="2.1" y2="8.8" />
        </g>
      </svg>
    );
  }

  // Fallback lockup used only if the official logo file is missing.
  function EmblemFallback({ size }) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
        <Football size={size * 0.82} />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.muted, whiteSpace: 'nowrap' }}>FIFA World Cup</span>
          <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 25, letterSpacing: '-0.02em', color: C.ink, marginTop: 3, whiteSpace: 'nowrap' }}>
            2026<span style={{ color: C.orange }}> ·</span> <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: C.muted, verticalAlign: '2px' }}>USA·CAN·MEX</span>
          </span>
        </span>
      </span>
    );
  }

  // ── World Cup 2026 emblem — the official "26" trophy lockup ──────
  //    Transparent PNG straight on the board, no chip. The white "FIFA"
  //    wordmark stays legible because it's reversed out of the black "6"
  //    numeral behind it — the black is what reads against the cream.
  //    Falls back to a football lockup if the file isn't there yet.
  const WC_LOGO_SRC = './logos/wc26.png';
  function WCEmblem({ size = 52 }) {
    const [ok, setOk] = React.useState(true);
    if (!ok) return <EmblemFallback size={size * 0.82} />;
    return (
      <img src={WC_LOGO_SRC} alt="FIFA World Cup 2026" onError={() => setOk(false)}
        style={{ height: size, width: 'auto', display: 'block' }} />
    );
  }

  // ── Dateline — the masthead kicker that sits ABOVE the title ─────
  //    Big tracked caps so the day this snapshot covers reads first.
  function Dateline({ matchday, dateLabel, align = 'center', size = 15.5 }) {
    const hair = (w) => <span style={{ width: w, height: 1.5, background: C.rule, flexShrink: 0 }} />;
    const text = (
      <span style={{ fontFamily: FONT.mono, fontSize: size, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.ink, whiteSpace: 'nowrap' }}>
        {matchday}<span style={{ color: C.orange, margin: '0 0.55em', fontWeight: 700 }}>·</span>{dateLabel}
      </span>
    );
    if (align === 'center') {
      return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>{hair(64)}{text}{hair(64)}</div>;
    }
    return <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>{text}{hair(56)}</div>;
  }

  // ── Scope strip — slim underlined event · segment line under the title
  function ScopeStrip({ scope, align = 'center', size = 18 }) {
    const text = (
      <span style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: size, letterSpacing: '-0.01em', color: C.ink, whiteSpace: 'nowrap' }}>
        {scope.event}<span style={{ color: C.muted, margin: '0 0.6em', fontWeight: 400 }}>·</span><span style={{ color: C.orangeDeep, borderBottom: `2px solid ${C.orange}`, paddingBottom: 2 }}>{scope.segment}</span>
      </span>
    );
    const row = (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', gap: 7 }}>
        {text}
      </span>
    );
    if (align === 'center') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <span style={{ width: 40, height: 1, background: C.rule }} />{row}<span style={{ width: 40, height: 1, background: C.rule }} />
        </div>
      );
    }
    return <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>{row}<span style={{ flex: 1, height: 1, background: C.rule }} /></div>;
  }

  Object.assign(window, { WC_C: C, WC_FONT: FONT, WCEyebrow: Eyebrow, WCMark: Mark, WCBrandTile: BrandTile, WCMove: Move, WCSpark: Spark, WCLegend: Legend, WCPlatformBadge: PlatformBadge, WCSources: Sources, WCScopeChips: ScopeChips, WCEmblem: WCEmblem, WCDateline: Dateline, WCScopeStrip: ScopeStrip });
})();
