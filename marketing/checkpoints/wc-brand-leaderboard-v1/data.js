/* ============================================================
   WORLD CUP · BRAND EXPOSURE LEADERBOARD — DAILY DATA
   ------------------------------------------------------------
   This is the ONE file you edit each day before exporting the
   post. Everything in the three layouts reads from here.

   Per brand:
     name   — brand name as it should read
     icon   — key into logos.js (real brand glyph, tinted with 'color',
              rendered on a white chip). Add new brands by dropping an
              SVG in logos/ and regenerating logos.js, or set 'logo' to
              an image path instead. No icon/logo = monogram tile.
     mono   — 1–2 letter monogram fallback
     color  — fallback tile background (use the brand's own colour)
     fg     — monogram colour ('#FFF' on dark tiles)
     sov    — share of voice, % of all World-Cup brand chatter
     move   — 'up' | 'down' | 'same' | 'new'  (arrow only, no number)
     spark  — last 7 days of SoV (oldest → today) for the trend line
   ============================================================ */
window.WC_DATA = {
  edition:   'World Cup 2026',
  matchday:  'Matchday 12',
  dateLabel: 'Wed 24 Jun 2026',
  window:    '24h',
  totalMentions: '8.4M',          // total WC brand mentions in the window
  unit:      'views',

  // ── SCOPE — declare exactly what this board measures ────────────
  // event:   'All tournament' | 'Group stage' | 'MEX – USA · Opening match' …
  // segment: 'All brands' | 'Footwear' | 'Airlines' | 'Beverages' …
  scope: {
    event:   'All tournament',
    segment: 'All brands',
  },

  // platforms the measure is drawn from (order = display order)
  platforms: ['tiktok', 'instagram', 'x', 'youtube'],

  // ── MOMENT — optional photo of the day. Set to null to hide. ──────
  // src: project-relative image path ('' = empty drop-zone you can drag onto)
  moment: {
    src: '',
    caption: 'The boot cam at full time — the clip everyone quoted.',
    credit: 'via TikTok · 1.2M views',
  },

  share:     'Share of voice — % of all brand conversation around the tournament',
  // the one-line editorial read for the day
  headline:  'Adidas takes top spot as the boot war heats up.',
  moverNote: 'Red Bull +4 — touchline stunt clips drove the biggest jump.',
  footer:    'Tracked by Scolto',
  url:       'scolto.com',
  handle:    '@scolto',

  brands: [
    { name: 'adidas', icon: 'adidas',         mono: 'a',  color: '#0A0A0A', fg: '#FFFFFF', sov: 18.4, move: 'up',   spark: [12.1,13.0,12.6,14.2,15.8,17.1,18.4] },
    { name: 'Nike', icon: 'nike',           mono: 'N',  color: '#111111', fg: '#FFFFFF', sov: 15.1, move: 'down', spark: [19.2,18.4,17.9,17.0,16.1,15.6,15.1] },
    { name: 'Coca-Cola', icon: 'cocacola',      mono: 'C',  color: '#E61A27', fg: '#FFFFFF', sov: 11.7, move: 'same', spark: [11.0,11.4,11.2,11.9,11.5,11.6,11.7] },
    { name: 'Qatar Airways', icon: 'qatarairways',  mono: 'Q',  color: '#5C0632', fg: '#FFFFFF', sov: 8.9,  move: 'up',   spark: [6.1,6.4,7.0,7.3,8.0,8.4,8.9] },
    { name: 'Visa', icon: 'visa',           mono: 'V',  color: '#1A1F71', fg: '#FFFFFF', sov: 7.2,  move: 'same', spark: [7.0,7.3,7.1,6.9,7.2,7.1,7.2] },
    { name: 'Red Bull', icon: 'redbull', mono: 'RB', color: '#D6001C', fg: '#FFFFFF', sov: 6.5,  move: 'up',   spark: [3.2,3.6,4.0,4.5,5.4,6.0,6.5] },
    { name: 'Hyundai', icon: 'hyundai',        mono: 'H',  color: '#002C5F', fg: '#FFFFFF', sov: 5.8,  move: 'down', spark: [7.4,7.0,6.7,6.4,6.1,5.9,5.8] },
    { name: "McDonald's", icon: 'mcdonalds',     mono: 'M',  color: '#E8A000', fg: '#FFFFFF', sov: 4.9,  move: 'same', spark: [4.6,4.8,4.7,5.0,4.8,4.9,4.9] },
    { name: 'Puma', icon: 'puma',           mono: 'P',  color: '#1B1B1B', fg: '#FFFFFF', sov: 4.3,  move: 'up',   spark: [3.0,3.1,3.4,3.6,3.9,4.1,4.3] },
    { name: 'Mastercard', icon: 'mastercard',     mono: 'm',  color: '#EB6909', fg: '#FFFFFF', sov: 3.6,  move: 'down', spark: [4.8,4.5,4.3,4.0,3.8,3.7,3.6] },
    { name: 'Sony', icon: 'sony',           mono: 'S',  color: '#0B0B0B', fg: '#FFFFFF', sov: 2.9,  move: 'new',  spark: [0,0,0,0,1.6,2.4,2.9] },
    { name: 'Kia', icon: 'kia', mono: 'K', color: '#05141F', fg: '#FFFFFF', sov: 2.4,  move: 'down', spark: [3.4,3.2,3.0,2.8,2.6,2.5,2.4] },
  ],
};
