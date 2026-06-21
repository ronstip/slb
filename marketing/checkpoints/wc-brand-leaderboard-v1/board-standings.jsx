// Direction A — "The Standings": an editorial league table.
(function () {
  function BoardStandings() {
    const C = window.WC_C, F = window.WC_FONT;
    const { WCEyebrow: Eyebrow, WCMark: Mark, WCBrandTile: Tile, WCMove: Move, WCSpark: Spark, WCLegend: Legend } = window;
    const D = window.WC_DATA;

    const ColHead = ({ children, style }) => (
      <div style={{ fontFamily: F.mono, fontSize: 10.5, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, ...style }}>{children}</div>
    );

    return (
      <div style={{ width: 1080, height: 1350, boxSizing: 'border-box', background: C.cream, position: 'relative', overflow: 'hidden', fontFamily: F.sans, color: C.ink, display: 'flex', flexDirection: 'column', padding: '54px 60px 44px' }}>
        {/* warm radial glow behind header */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 60% at 78% 0%, rgba(217,119,87,0.13) 0%, rgba(217,119,87,0.04) 42%, transparent 72%)', pointerEvents: 'none' }} />

        {/* top utility row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Mark size={30} />
            <span style={{ fontFamily: F.serif, fontStyle: 'italic', fontWeight: 400, fontSize: 26, letterSpacing: '-0.02em', color: C.ink }}>Scolto</span>
          </div>
          <Eyebrow size={12}>{D.edition} · Brand Watch</Eyebrow>
        </div>

        {/* title band */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 34, position: 'relative' }}>
          <div>
            <Eyebrow size={12} color={C.orangeDeep}>Daily brand exposure</Eyebrow>
            <div style={{ fontFamily: F.display, fontWeight: 500, fontSize: 76, lineHeight: 0.96, letterSpacing: '-0.04em', color: C.ink, marginTop: 12 }}>The standings</div>
            <div style={{ fontFamily: F.serif, fontWeight: 300, fontSize: 21, lineHeight: 1.3, color: C.slate, marginTop: 12, maxWidth: 560 }}>
              Share of voice — <span style={{ fontStyle: 'italic', color: C.orangeDeep }}>% of every brand mention</span> around the tournament.
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, paddingBottom: 4 }}>
            <div style={{ fontFamily: F.serif, fontWeight: 300, fontSize: 30, lineHeight: 1, color: C.ink, letterSpacing: '-0.02em' }}>{D.matchday}</div>
            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.muted, marginTop: 8, letterSpacing: '0.04em' }}>{D.dateLabel}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '5px 11px', borderRadius: 999, background: '#FFFFFF', border: `1px solid ${C.rule}`, boxShadow: '0 1px 2px rgba(40,30,20,0.06)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: '#34D399', boxShadow: '0 0 0 3px rgba(52,211,153,0.25)' }} />
              <span style={{ fontFamily: F.mono, fontSize: 11.5, fontWeight: 600, color: C.ink, letterSpacing: '0.02em' }}>{D.totalMentions} {D.unit || 'mentions'} / {D.window}</span>
            </div>
          </div>
        </div>

        {/* column header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 26, paddingBottom: 12, borderBottom: `1.5px solid ${C.ink}`, position: 'relative' }}>
          <ColHead style={{ width: 54 }}>Rank</ColHead>
          <ColHead style={{ flex: 1 }}>Brand</ColHead>
          <ColHead style={{ width: 100, textAlign: 'center' }}>7-day</ColHead>
          <ColHead style={{ width: 118, textAlign: 'right' }}>Share of voice</ColHead>
          <ColHead style={{ width: 26, textAlign: 'center' }} />
        </div>

        {/* rows */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {D.brands.map((b, i) => {
            const rank = i + 1;
            const leader = rank === 1;
            return (
              <div key={b.name} style={{
                display: 'flex', alignItems: 'center', gap: 24, flex: 1,
                borderBottom: i === D.brands.length - 1 ? 'none' : `1px solid ${C.ruleSoft}`,
                position: 'relative', paddingLeft: leader ? 14 : 0,
              }}>
                {leader && <div style={{ position: 'absolute', left: -60, right: -60, top: 4, bottom: 4, background: 'linear-gradient(90deg, rgba(217,119,87,0.12), rgba(217,119,87,0.03) 70%, transparent)', zIndex: 0 }} />}
                {leader && <div style={{ position: 'absolute', left: -60, top: 8, bottom: 8, width: 5, background: C.orange, borderRadius: 999 }} />}

                <div style={{ width: 54, display: 'flex', alignItems: 'baseline', gap: 2, position: 'relative', zIndex: 1 }}>
                  <span style={{ fontFamily: F.serif, fontWeight: leader ? 500 : 400, fontSize: leader ? 44 : 36, lineHeight: 1, letterSpacing: '-0.03em', color: leader ? C.orangeDeep : C.ink, fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
                </div>

                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16, position: 'relative', zIndex: 1, minWidth: 0 }}>
                  <Tile brand={b} size={leader ? 58 : 50} />
                  <span style={{ fontFamily: F.sans, fontWeight: 600, fontSize: leader ? 30 : 26, letterSpacing: '-0.02em', color: C.ink, whiteSpace: 'nowrap', flexShrink: 0 }}>{b.name}</span>
                </div>

                <div style={{ width: 100, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
                  <Spark values={b.spark} color={leader ? C.orangeDeep : C.muted} width={96} height={32} />
                </div>

                <div style={{ width: 118, textAlign: 'right', position: 'relative', zIndex: 1 }}>
                  <span style={{ fontFamily: F.serif, fontWeight: leader ? 500 : 400, fontSize: leader ? 42 : 34, letterSpacing: '-0.03em', color: leader ? C.orangeDeep : C.ink, fontVariantNumeric: 'tabular-nums' }}>{b.sov.toFixed(1)}</span>
                  <span style={{ fontFamily: F.serif, fontWeight: 400, fontSize: 18, color: leader ? C.orangeDeep : C.muted, marginLeft: 2 }}>%</span>
                </div>

                <div style={{ width: 26, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
                  <Move move={b.move} size={20} />
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.rule}`, position: 'relative' }}>
          <Legend />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: F.mono, fontSize: 11.5, color: C.muted, letterSpacing: '0.06em' }}>{D.footer} · <span style={{ fontWeight: 600, color: C.orangeDeep }}>{D.url}</span></span>
          </div>
        </div>
      </div>
    );
  }
  window.BoardStandings = BoardStandings;
})();
