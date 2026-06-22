// Direction B — "Podium": top three on a podium, the rest give chase.
(function () {
  function BoardPodium({ data, height = 1350 }) {
    const C = window.WC_C, F = window.WC_FONT;
    const { WCEyebrow: Eyebrow, WCMark: Mark, WCBrandTile: Tile, WCMove: Move, WCLegend: Legend, WCSources: Sources, WCEmblem: Emblem, WCDateline: Dateline, WCScopeStrip: ScopeStrip } = window;
    const D = data || window.WC_DATA;
    const compact = height < 1200;
    const top3 = D.brands.slice(0, 3);
    const chase = D.brands.slice(3);
    const hasMoment = !!D.moment;
    const k = compact ? 0.8 : 1;
    // podium visual order: 2nd, 1st, 3rd
    const podium = [
      { b: top3[1], rank: 2, h: Math.round(330 * k), w: 290, tile: compact ? 50 : 60, accent: C.ink },
      { b: top3[0], rank: 1, h: Math.round(384 * k), w: 336, tile: compact ? 60 : 72, accent: C.orange },
      { b: top3[2], rank: 3, h: Math.round(300 * k), w: 290, tile: compact ? 50 : 60, accent: C.slate },
    ];

    const RankBadge = ({ rank, leader }) => (
      <span style={{
        width: leader ? 44 : 38, height: leader ? 44 : 38, borderRadius: 999,
        background: leader ? C.orange : '#FFFFFF',
        border: leader ? 'none' : `1.5px solid ${C.ink}`,
        color: leader ? '#FFF7F0' : C.ink,
        display: 'inline-grid', placeItems: 'center', flexShrink: 0,
        fontFamily: F.serif, fontWeight: 500, fontSize: leader ? 24 : 20, letterSpacing: '-0.02em',
        boxShadow: leader ? '0 6px 18px -8px rgba(217,119,87,0.7)' : 'none',
      }}>{rank}</span>
    );

    return (
      <div style={{ width: 1080, height, boxSizing: 'border-box', background: C.cream, position: 'relative', overflow: 'hidden', fontFamily: F.sans, color: C.ink, display: 'flex', flexDirection: 'column', padding: compact ? '40px 60px 36px' : '54px 60px 44px' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(110% 50% at 50% 8%, rgba(217,119,87,0.14) 0%, rgba(217,119,87,0.04) 44%, transparent 72%)', pointerEvents: 'none' }} />

        {/* WC emblem — oversized, absolutely placed so it owns more space without pushing the layout */}
        <div style={{ position: 'absolute', top: compact ? 28 : 34, right: compact ? 44 : 52, zIndex: 3 }}>
          <Emblem size={compact ? 132 : 162} />
        </div>

        {/* top utility row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Mark size={38} />
            <span style={{ fontFamily: F.serif, fontStyle: 'italic', fontWeight: 400, fontSize: 32, letterSpacing: '-0.02em', color: C.ink }}>Scolto</span>
          </div>
        </div>

        {/* title — centered */}
        <div style={{ textAlign: 'center', marginTop: compact ? 14 : 20, position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: compact ? 9 : 12 }}>
            <Dateline matchday={D.matchday} dateLabel={D.dateLabel} align="center" size={compact ? 14 : 15.5} />
          </div>
          <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: compact ? 50 : 64, lineHeight: 0.96, letterSpacing: '-0.04em', color: C.ink, marginTop: compact ? 8 : 11 }}>Brand exposure</div>
          <div style={{ fontFamily: F.serif, fontWeight: 300, fontSize: compact ? 17 : 19, lineHeight: 1.3, color: C.slate, marginTop: compact ? 7 : 9 }}>
            Who owns the conversation — <span style={{ fontStyle: 'italic', color: C.orangeDeep }}>share of voice</span> across {D.totalMentions} {D.unit || 'mentions'}.
          </div>
          {/* scope strip + sources */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: compact ? 12 : 16 }}>
            <ScopeStrip scope={D.scope} align="center" size={compact ? 17 : 19} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: compact ? 9 : 12 }}>
            <Sources ids={D.platforms} size={24} />
          </div>
        </div>

        {/* podium */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 20, marginTop: compact ? 18 : 24, position: 'relative' }}>
          {podium.map(({ b, rank, h, w, tile }) => {
            const leader = rank === 1;
            const accent = leader ? C.orange : (rank === 2 ? C.ink : C.slate);
            return (
              <div key={b.name} style={{
                width: w, height: h, background: '#FFFFFF', borderRadius: 18,
                border: `1px solid ${leader ? 'rgba(217,119,87,0.5)' : C.rule}`,
                boxShadow: leader ? '0 32px 70px -34px rgba(40,30,20,0.34)' : '0 18px 44px -28px rgba(40,30,20,0.22)',
                position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                padding: leader ? '22px 24px 24px' : '20px 22px 22px',
              }}>
                {/* accent top bar */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: accent }} />
                {/* watermark rank */}
                <div style={{ position: 'absolute', right: -12, bottom: -34, fontFamily: F.serif, fontWeight: 600, fontSize: compact ? 160 : 200, lineHeight: 1, color: leader ? 'rgba(217,119,87,0.08)' : 'rgba(26,23,20,0.05)', letterSpacing: '-0.04em', pointerEvents: 'none' }}>{rank}</div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
                  <RankBadge rank={rank} leader={leader} />
                  {leader
                    ? <span style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#FFF7F0', background: C.orange, padding: '4px 9px', borderRadius: 999 }}>Leader</span>
                    : <Move move={b.move} size={20} />}
                </div>

                <div style={{ position: 'relative' }}>
                  <Tile brand={b} size={tile} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: compact ? 11 : 14 }}>
                    <span style={{ fontFamily: F.sans, fontWeight: 600, fontSize: leader ? (compact ? 25 : 29) : (compact ? 21 : 24), letterSpacing: '-0.02em', color: C.ink, lineHeight: 1.05 }}>{b.name}</span>
                    {b.viral && <Move move="new" size={leader ? 20 : 18} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 7 }}>
                    <span style={{ fontFamily: F.serif, fontWeight: leader ? 500 : 400, fontSize: leader ? (compact ? 46 : 54) : (compact ? 37 : 43), letterSpacing: '-0.03em', color: leader ? C.orangeDeep : C.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{b.sov.toFixed(1)}<span style={{ fontSize: leader ? (compact ? 22 : 25) : (compact ? 18 : 21), color: leader ? C.orangeDeep : C.muted }}>%</span></span>
                    {leader && <Move move={b.move} size={22} />}
                  </div>
                  <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, marginTop: 9 }}>Share of voice</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* the chase + moment of the day */}
        <div style={{ marginTop: compact ? 18 : 26, flex: 1, display: 'flex', gap: 28, position: 'relative', minHeight: 0 }}>
          {/* chase list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 2 }}>
              <Eyebrow size={11} style={{ whiteSpace: 'nowrap' }}>The chase</Eyebrow>
              <div style={{ flex: 1, height: 1, background: C.rule }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {chase.map((b, i) => (
                <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, maxHeight: 88, borderBottom: i === chase.length - 1 ? 'none' : `1px solid ${C.ruleSoft}` }}>
                  <span style={{ width: 32, fontFamily: F.serif, fontWeight: 400, fontSize: compact ? 20 : 24, color: C.slate, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{i + 4}</span>
                  <Tile brand={b} size={compact ? 28 : 34} />
                  <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontFamily: F.sans, fontWeight: 600, fontSize: compact ? 16.5 : 19, letterSpacing: '-0.015em', color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{b.name}</span>
                    {b.viral && <Move move="new" size={compact ? 14 : 16} />}
                  </span>
                  <span style={{ fontFamily: F.serif, fontWeight: 400, fontSize: compact ? 20 : 24, color: C.ink, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{b.sov.toFixed(1)}<span style={{ fontSize: compact ? 12 : 14, color: C.muted }}>%</span></span>
                  <span style={{ width: 22, display: 'flex', justifyContent: 'center' }}><Move move={b.move} size={compact ? 15 : 17} /></span>
                </div>
              ))}
            </div>
          </div>

          {/* moment of the day (optional — set moment: null in data.js to hide) */}
          {hasMoment && (
            <div style={{ width: compact ? 270 : 320, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 2 }}>
                <Eyebrow size={11} style={{ whiteSpace: 'nowrap' }}>Moment of the day</Eyebrow>
                <div style={{ flex: 1, height: 1, background: C.rule }} />
              </div>
              <div style={{ flex: 1, marginTop: 12, position: 'relative', minHeight: 0 }}>
                <image-slot id="wc-moment-podium" radius="14"
                  placeholder="drop the day's defining photo"
                  src={D.moment.src || undefined}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}></image-slot>
              </div>
              <div style={{ fontFamily: F.serif, fontStyle: 'italic', fontWeight: 300, fontSize: 17, lineHeight: 1.35, color: C.slate, marginTop: 12 }}>{D.moment.caption}</div>
              <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginTop: 6 }}>{D.moment.credit}</div>
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.rule}`, position: 'relative' }}>
          <Legend />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: F.mono, fontSize: 11.5, color: C.muted, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{D.footer} · <span style={{ fontWeight: 600, color: C.orangeDeep }}>{D.url}</span></span>
          </div>
        </div>
      </div>
    );
  }
  window.BoardPodium = BoardPodium;
})();
