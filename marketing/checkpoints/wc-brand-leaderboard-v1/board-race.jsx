// Direction C — "The Race": proportional share-of-voice bars.
(function () {
  function BoardRace({ data, height = 1350 }) {
    const C = window.WC_C, F = window.WC_FONT;
    const { WCEyebrow: Eyebrow, WCMark: Mark, WCBrandTile: Tile, WCMove: Move, WCLegend: Legend, WCSources: Sources, WCEmblem: Emblem, WCDateline: Dateline, WCScopeStrip: ScopeStrip } = window;
    const D = data || window.WC_DATA;
    const compact = height < 1200;
    const max = Math.max(...D.brands.map(b => b.sov));

    return (
      <div style={{ width: 1080, height, boxSizing: 'border-box', background: C.cream, position: 'relative', overflow: 'hidden', fontFamily: F.sans, color: C.ink, display: 'flex', flexDirection: 'column', padding: compact ? '40px 60px 36px' : '54px 60px 44px' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 55% at 18% 4%, rgba(217,119,87,0.13) 0%, rgba(217,119,87,0.04) 42%, transparent 72%)', pointerEvents: 'none' }} />

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

        {/* title band */}
        <div style={{ marginTop: compact ? 20 : 30, position: 'relative' }}>
          <Dateline matchday={D.matchday} dateLabel={D.dateLabel} align="left" size={compact ? 14 : 15.5} />
          <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: compact ? 58 : 76, lineHeight: 0.96, letterSpacing: '-0.04em', color: C.ink, marginTop: compact ? 11 : 14 }}>Brand exposure</div>
        </div>

        {/* scope strip + sources */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: compact ? 14 : 18, position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0 }}><ScopeStrip scope={D.scope} align="left" size={compact ? 18 : 20} /></div>
          <Eyebrow size={11} style={{ whiteSpace: 'nowrap' }}>share of voice / {D.totalMentions} {D.unit || 'views'}</Eyebrow>
          <Sources ids={D.platforms} size={24} />
        </div>

        {/* biggest-mover callout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 14, padding: '9px 14px 9px 9px', background: '#FFFFFF', border: `1px solid ${C.rule}`, borderRadius: 12, boxShadow: '0 1px 2px rgba(40,30,20,0.06)', position: 'relative' }}>
          {D.moment && (
            <image-slot id="wc-moment-race" radius="8"
              placeholder="photo"
              src={D.moment.src || undefined}
              style={{ width: 52, height: 52, display: 'block', flexShrink: 0 }}></image-slot>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 999, background: 'rgba(47,142,108,0.12)', flexShrink: 0 }}><Move move="up" size={16} /></span>
          <span style={{ fontFamily: F.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.up, flexShrink: 0 }}>Standout</span>
          <span style={{ fontFamily: F.serif, fontWeight: 400, fontSize: 14, color: C.slate, letterSpacing: '-0.01em' }}>{D.moverNote}</span>
        </div>

        {/* bars */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', marginTop: 14, position: 'relative' }}>
          {D.brands.map((b, i) => {
            const rank = i + 1;
            const leader = rank === 1;
            const pct = (b.sov / max) * 100;
            const fill = leader
              ? `linear-gradient(90deg, ${C.orangeDeep}, ${C.orange})`
              : `linear-gradient(90deg, ${C.ink}, ${C.slate})`;
            return (
              <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, maxHeight: 104 }}>
                <span style={{ width: 34, textAlign: 'center', fontFamily: F.serif, fontWeight: leader ? 500 : 400, fontSize: leader ? (compact ? 25 : 30) : (compact ? 21 : 25), color: leader ? C.orangeDeep : C.slate, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{rank}</span>
                <Tile brand={b} size={compact ? 34 : 42} />
                <span style={{ width: 196, display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, minWidth: 0 }}>
                  <span style={{ fontFamily: F.sans, fontWeight: 600, fontSize: compact ? 18 : 21, letterSpacing: '-0.015em', color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{b.name}</span>
                  {b.viral && <Move move="new" size={compact ? 15 : 17} />}
                </span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ flex: 1, height: compact ? 26 : 34, background: 'rgba(26,23,20,0.05)', borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%', background: fill, borderRadius: 999, boxShadow: leader ? '0 4px 14px -6px rgba(217,119,87,0.6)' : 'none' }} />
                  </div>
                  <span style={{ width: 86, textAlign: 'right', flexShrink: 0, fontFamily: F.serif, fontWeight: leader ? 500 : 400, fontSize: leader ? (compact ? 27 : 32) : (compact ? 22 : 27), color: leader ? C.orangeDeep : C.ink, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{b.sov.toFixed(1)}<span style={{ fontSize: compact ? 13 : 15, color: leader ? C.orangeDeep : C.muted }}>%</span></span>
                  <span style={{ width: 22, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><Move move={b.move} size={compact ? 16 : 18} /></span>
                </div>
              </div>
            );
          })}
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
  window.BoardRace = BoardRace;
})();
