/* ============================================================
   WORLD CUP · BRAND EXPOSURE LEADERBOARD — DAYS 1–21
   ------------------------------------------------------------
   Cumulative board through three weeks of the tournament,
   true as of Wed 1 Jul 2026.

   Two numbers per brand from the source table:
     sov — SHARE OF VOICE, % of all brand views (col 1, drives the
           ranking + every bar / podium figure the boards render)
     vpp — VIEWS PER POST, avg reach of each post in K (col 2). The
           boards do NOT render this; it's the "efficiency" signal —
           who punches above their share. Drives the Standout note
           and the `viral` sparkle.

   move — vs the days 1–14 board (data_day14.js):
     up   = climbed in rank   down = slipped
     same = held rank         new  = absent from the days 1–14 board
   ============================================================ */
window.WC_DATA = {
  edition:   'World Cup 2026',
  matchday:  'Days 1–21',
  dateLabel: 'Wed 1 Jul 2026',
  window:    'days 1–21 · cumulative',
  totalMentions: '+8B',           // cumulative brand views, days 1–21
  unit:      'views',

  scope: {
    event:   'Opening run',
    segment: 'All brands',
  },

  platforms: ['tiktok', 'instagram', 'x', 'youtube'],

  // No moment-of-the-day photo set. Add { src, caption, credit } to show one.
  moment: null,

  share:     'Share of voice — % of all brand views around the tournament',
  headline:  'Adidas still leads after three weeks.',
  moverNote: 'Verizon is the efficiency story — 105.4K avg views per post, the only brand going viral. Hisense & McDonald\'s also punch far above their share (81.8K / 76.7K).',
  footer:    'Tracked by Scolto',
  url:       'scolto.com',
  handle:    '@scolto',

  // rank order = array order. sov = col 1 (share of views). vpp = col 2 (avg views/post, K).
  brands: [
    { name: 'adidas',         icon: 'adidas',       mono: 'a',  color: '#0A0A0A', fg: '#FFFFFF', sov: 16.0, vpp: 30.8,  move: 'same' },
    { name: 'Nike',           icon: 'nike',         mono: 'N',  color: '#111111', fg: '#FFFFFF', sov: 12.0, vpp: 38.4,  move: 'same' },
    { name: 'Visa',           icon: 'visa',         mono: 'V',  color: '#1A1F71', fg: '#FFFFFF', sov: 11.0, vpp: 71.6,  move: 'same' },
    { name: 'Coca-Cola',      icon: 'cocacola',     mono: 'C',  color: '#E61A27', fg: '#FFFFFF', sov: 9.8,  vpp: 42.5,  move: 'same' },
    { name: 'Puma',           icon: 'puma',         mono: 'P',  color: '#1B1B1B', fg: '#FFFFFF', sov: 9.1,  vpp: 45.2,  move: 'up' },
    { name: 'Hisense',        mono: 'H',  logo: 'https://img.logo.dev/hisense.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',     color: '#006837', fg: '#FFFFFF', sov: 7.2,  vpp: 81.8,  move: 'down' },
    { name: 'Qatar Airways',  icon: 'qatarairways', mono: 'Q',  color: '#5C0632', fg: '#FFFFFF', sov: 6.6,  vpp: 31.1,  move: 'same' },
    { name: 'Hyundai',        icon: 'hyundai',      mono: 'H',  color: '#002C5F', fg: '#FFFFFF', sov: 6.3,  vpp: 49.2,  move: 'up' },
    { name: 'Verizon',        mono: 'V',  logo: 'https://img.logo.dev/verizon.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',     color: '#000000', fg: '#FFFFFF', sov: 6.2,  vpp: 105.4, move: 'down', viral: true },
    { name: 'Lenovo',         mono: 'L',  logo: 'https://img.logo.dev/lenovo.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',      color: '#E2231A', fg: '#FFFFFF', sov: 6.0,  vpp: 45.4,  move: 'down' },
    { name: 'Aramco',         mono: 'A',  logo: 'https://img.logo.dev/aramco.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',      color: '#00843D', fg: '#FFFFFF', sov: 5.2,  vpp: 33.6,  move: 'down' },
    { name: "McDonald's",     mono: 'M',  logo: 'https://img.logo.dev/mcdonalds.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true', color: '#FFBC0D', fg: '#DA291C', sov: 4.3,  vpp: 76.7,  move: 'same' },
  ],
};
