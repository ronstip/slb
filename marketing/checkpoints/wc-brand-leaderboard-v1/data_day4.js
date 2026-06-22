/* ============================================================
   WORLD CUP · BRAND EXPOSURE LEADERBOARD — DAYS 1–4
   ------------------------------------------------------------
   Cumulative board for the opening four days of the tournament,
   true as of Sun 14 Jun 2026.

   Two numbers per brand from the source table:
     sov — SHARE OF VOICE, % of all brand views (col 1, drives the
           ranking + every bar / podium figure the boards render)
     vpp — VIEWS PER POST, avg reach of each post in K (col 2). The
           boards do NOT render this; it's the "efficiency" signal —
           who punches above their share. Drives the Standout note
           and the `viral` sparkle.

   move — vs the pre-tournament baseline (data_pre_tournament.js):
     up   = climbed in rank   down = slipped
     same = held rank         new  = absent pre-tournament
   ============================================================ */
window.WC_DATA = {
  edition:   'World Cup 2026',
  matchday:  'Days 1–4',
  dateLabel: 'Sun 14 Jun 2026',
  window:    'days 1–4 · cumulative',
  totalMentions: '+1B',           // cumulative brand views, days 1–4
  unit:      'views',

  scope: {
    event:   'Opening four days',
    segment: 'All brands',
  },

  platforms: ['tiktok', 'instagram', 'x', 'youtube'],

  // No moment-of-the-day photo set. Add { src, caption, credit } to show one.
  moment: null,

  share:     'Share of voice — % of all brand views around the tournament',
  headline:  'Adidas leads the opening four days.',
  moverNote: 'Mengniu & Michelob ULTRA punch above their weight — ~50K avg views per post on bottom-half share.',
  footer:    'Tracked by Scolto',
  url:       'scolto.com',
  handle:    '@scolto',

  // rank order = array order. sov = col 1 (share of views). vpp = col 2 (avg views/post, K).
  brands: [
    { name: 'adidas',          icon: 'adidas',       mono: 'a',  color: '#0A0A0A', fg: '#FFFFFF', sov: 25.0, vpp: 10.7, move: 'same' },
    { name: 'Nike',            icon: 'nike',         mono: 'N',  color: '#111111', fg: '#FFFFFF', sov: 18.0, vpp: 15.8, move: 'same' },
    { name: 'Coca-Cola',       icon: 'cocacola',     mono: 'C',  color: '#E61A27', fg: '#FFFFFF', sov: 13.0, vpp: 14.8, move: 'same' },
    { name: 'Visa',            icon: 'visa',         mono: 'V',  color: '#1A1F71', fg: '#FFFFFF', sov: 10.0, vpp: 18.0, move: 'up' },
    { name: 'Qatar Airways',   icon: 'qatarairways', mono: 'Q',  color: '#5C0632', fg: '#FFFFFF', sov: 8.5,  vpp: 10.0, move: 'up' },
    { name: 'Lenovo',          mono: 'L',  logo: 'https://img.logo.dev/lenovo.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',        color: '#E2231A', fg: '#FFFFFF', sov: 6.4,  vpp: 11.7, move: 'same' },
    { name: 'Aramco',          mono: 'A',  logo: 'https://img.logo.dev/aramco.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',        color: '#00843D', fg: '#FFFFFF', sov: 3.6,  vpp: 6.8,  move: 'same' },
    { name: 'Michelob ULTRA',  mono: 'M',  logo: 'https://img.logo.dev/michelobultra.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true', color: '#041E42', fg: '#FFFFFF', sov: 3.5,  vpp: 50.3, move: 'new', viral: true },
    { name: "McDonald's",      icon: 'mcdonalds',    mono: 'M',  color: '#E8A000', fg: '#FFFFFF', sov: 3.1,  vpp: 8.7,  move: 'up' },
    { name: 'Puma',            icon: 'puma',         mono: 'P',  color: '#1B1B1B', fg: '#FFFFFF', sov: 2.9,  vpp: 4.8,  move: 'down' },
    { name: 'Bank of America', mono: 'B',  logo: 'https://img.logo.dev/bankofamerica.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true', color: '#012169', fg: '#FFFFFF', sov: 2.8,  vpp: 33.9, move: 'same' },
    { name: 'Mengniu',         mono: 'M',  logo: 'https://img.logo.dev/mengniu.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',       color: '#E60012', fg: '#FFFFFF', sov: 2.3,  vpp: 51.3, move: 'new', viral: true },
  ],
};
