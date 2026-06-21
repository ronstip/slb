/* ============================================================
   WORLD CUP · BRAND EXPOSURE LEADERBOARD — DAYS 1–7
   ------------------------------------------------------------
   Cumulative board for the opening week of the tournament,
   true as of Wed 17 Jun 2026.

   Two numbers per brand from the source table:
     sov — SHARE OF VOICE, % of all brand views (col 1, drives the
           ranking + every bar / podium figure the boards render)
     vpp — VIEWS PER POST, avg reach of each post in K (col 2). The
           boards do NOT render this; it's the "efficiency" signal —
           who punches above their share. Drives the Standout note
           and the `viral` sparkle.

   move — vs the days 1–4 board (data_day4.js):
     up   = climbed in rank   down = slipped
     same = held rank         new  = absent from the days 1–4 board
   ============================================================ */
window.WC_DATA = {
  edition:   'World Cup 2026',
  matchday:  'Days 1–7',
  dateLabel: 'Wed 17 Jun 2026',
  window:    'days 1–7 · cumulative',
  totalMentions: '+2B',           // cumulative brand views, days 1–7
  unit:      'views',

  scope: {
    event:   'Opening week',
    segment: 'All brands',
  },

  platforms: ['tiktok', 'instagram', 'x', 'youtube'],

  // No moment-of-the-day photo set. Add { src, caption, credit } to show one.
  moment: null,

  share:     'Share of voice — % of all brand views around the tournament',
  headline:  'Adidas still leads after the first week.',
  moverNote: 'Capelli Sport is the efficiency story — 237K avg views per post on 3.6% share. Hisense & Verizon also overperform their footprint.',
  footer:    'Tracked by Scolto',
  url:       'scolto.com',
  handle:    '@scolto',

  // rank order = array order. sov = col 1 (share of views). vpp = col 2 (avg views/post, K).
  brands: [
    { name: 'adidas',         icon: 'adidas',       mono: 'a',  color: '#0A0A0A', fg: '#FFFFFF', sov: 20.0, vpp: 19.9,  move: 'same' },
    { name: 'Nike',           icon: 'nike',         mono: 'N',  color: '#111111', fg: '#FFFFFF', sov: 14.0, vpp: 24.2,  move: 'same' },
    { name: 'Coca-Cola',      icon: 'cocacola',     mono: 'C',  color: '#E61A27', fg: '#FFFFFF', sov: 12.0, vpp: 32.6,  move: 'same' },
    { name: 'Visa',           icon: 'visa',         mono: 'V',  color: '#1A1F71', fg: '#FFFFFF', sov: 9.2,  vpp: 45.6,  move: 'same' },
    { name: 'Qatar Airways',  icon: 'qatarairways', mono: 'Q',  color: '#5C0632', fg: '#FFFFFF', sov: 7.6,  vpp: 25.0,  move: 'same' },
    { name: 'Hisense',        mono: 'H',  logo: 'https://img.logo.dev/hisense.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',     color: '#006837', fg: '#FFFFFF', sov: 7.5,  vpp: 94.1,  move: 'up', viral: true },
    { name: 'Lenovo',         mono: 'L',  logo: 'https://img.logo.dev/lenovo.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',      color: '#E2231A', fg: '#FFFFFF', sov: 6.7,  vpp: 30.8,  move: 'down' },
    { name: 'Hyundai',        icon: 'hyundai',      mono: 'H',  color: '#002C5F', fg: '#FFFFFF', sov: 5.7,  vpp: 32.2,  move: 'up' },
    { name: 'Aramco',         mono: 'A',  logo: 'https://img.logo.dev/aramco.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',      color: '#00843D', fg: '#FFFFFF', sov: 5.5,  vpp: 25.8,  move: 'down' },
    { name: 'Verizon',        mono: 'V',  logo: 'https://img.logo.dev/verizon.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true',     color: '#000000', fg: '#FFFFFF', sov: 5.2,  vpp: 57.6,  move: 'up' },
    { name: 'Capelli Sport',  mono: 'C',  logo: 'https://img.logo.dev/capellisport.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true', color: '#C8102E', fg: '#FFFFFF', sov: 3.6,  vpp: 237.1, move: 'up', viral: true },
    { name: 'Puma',           icon: 'puma',         mono: 'P',  color: '#1B1B1B', fg: '#FFFFFF', sov: 3.5,  vpp: 7.3,   move: 'down' },
  ],
};
