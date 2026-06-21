/* ============================================================
   WORLD CUP · BRAND EXPOSURE LEADERBOARD — DAYS 1–11
   ------------------------------------------------------------
   Cumulative board for the opening run of the tournament,
   true as of Sun 21 Jun 2026.

   Two numbers per brand from the source table:
     sov — SHARE OF VOICE, % of all brand views (col 1, drives the
           ranking + every bar / podium figure the boards render)
     vpp — VIEWS PER POST, avg reach of each post in K (col 2). The
           boards do NOT render this; it's the "efficiency" signal —
           who punches above their share. Drives the Standout note
           and the `viral` sparkle.

   move — vs the days 1–7 board (data_day7.js):
     up   = climbed in rank   down = slipped
     same = held rank         new  = absent from the days 1–7 board
   ============================================================ */
window.WC_DATA = {
  edition:   'World Cup 2026',
  matchday:  'Days 1–11',
  dateLabel: 'Sun 21 Jun 2026',
  window:    'days 1–11 · cumulative',
  totalMentions: '+3B',           // cumulative brand views, days 1–11
  unit:      'views',

  scope: {
    event:   'Opening run',
    segment: 'All brands',
  },

  platforms: ['tiktok', 'instagram', 'x', 'youtube'],

  // No moment-of-the-day photo set. Add { src, caption, credit } to show one.
  moment: null,

  share:     'Share of voice — % of all brand views around the tournament',
  headline:  'Adidas still leads after eleven days.',
  moverNote: 'Hisense is the efficiency story — 116.4K avg views per post on 8.2% share. Verizon & Visa also overperform their footprint.',
  footer:    'Tracked by Scolto',
  url:       'scolto.com',
  handle:    '@scolto',

  // rank order = array order. sov = col 1 (share of views). vpp = col 2 (avg views/post, K).
  brands: [
    { name: 'adidas',         icon: 'adidas',       mono: 'a',  color: '#0A0A0A', fg: '#FFFFFF', sov: 19.0, vpp: 28.9,  move: 'same' },
    { name: 'Nike',           icon: 'nike',         mono: 'N',  color: '#111111', fg: '#FFFFFF', sov: 16.0, vpp: 35.5,  move: 'same' },
    { name: 'Visa',           icon: 'visa',         mono: 'V',  color: '#1A1F71', fg: '#FFFFFF', sov: 11.0, vpp: 60.9,  move: 'up' },
    { name: 'Coca-Cola',      icon: 'cocacola',     mono: 'C',  color: '#E61A27', fg: '#FFFFFF', sov: 8.8,  vpp: 31.5,  move: 'down' },
    { name: 'Hisense',        mono: 'H',  logo: 'https://img.logo.dev/hisense.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',     color: '#006837', fg: '#FFFFFF', sov: 8.2,  vpp: 116.4, move: 'up', viral: true },
    { name: 'Aramco',         mono: 'A',  logo: 'https://img.logo.dev/aramco.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',      color: '#00843D', fg: '#FFFFFF', sov: 6.8,  vpp: 41.8,  move: 'up' },
    { name: 'Qatar Airways',  icon: 'qatarairways', mono: 'Q',  color: '#5C0632', fg: '#FFFFFF', sov: 6.0,  vpp: 23.9,  move: 'down' },
    { name: 'Lenovo',         mono: 'L',  logo: 'https://img.logo.dev/lenovo.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',      color: '#E2231A', fg: '#FFFFFF', sov: 6.0,  vpp: 31.2,  move: 'down' },
    { name: 'Verizon',        mono: 'V',  logo: 'https://img.logo.dev/verizon.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',     color: '#000000', fg: '#FFFFFF', sov: 5.2,  vpp: 66.2,  move: 'up' },
    { name: 'Puma',           icon: 'puma',         mono: 'P',  color: '#1B1B1B', fg: '#FFFFFF', sov: 4.9,  vpp: 19.3,  move: 'up' },
    { name: 'Hyundai',        icon: 'hyundai',      mono: 'H',  color: '#002C5F', fg: '#FFFFFF', sov: 4.8,  vpp: 30.6,  move: 'down' },
    { name: "McDonald's",     mono: 'M',  logo: 'https://img.logo.dev/mcdonalds.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true', color: '#FFBC0D', fg: '#DA291C', sov: 3.4,  vpp: 68.9,  move: 'up' },
  ],
};
