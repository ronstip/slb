/* ============================================================
   WORLD CUP · BRAND EXPOSURE LEADERBOARD — PRE-TOURNAMENT
   ------------------------------------------------------------
   Baseline board (before kickoff). Built from the updated table:
   only RANK, BRAND NAME, and SHARE OF VOICE (= % of views).
   All other columns from the source table are ignored.

   move is 'same' for every brand — pre-tournament has no prior
   day to move against, so the indicator stays flat (baseline).
   ============================================================ */
(function () {
  // Apple glyph (simple-icons, 24x24) — injected so the chip renders a
  // real logo instead of a monogram. Original logos.js stays untouched.
  // simple-icons (24x24) glyphs injected so chips render real logos instead of
  // monograms. Original logos.js stays untouched.
  window.WC_LOGOS = window.WC_LOGOS || {};
  if (!window.WC_LOGOS.volkswagen) {
    window.WC_LOGOS.volkswagen = "M12 0C5.36 0 0 5.36 0 12S5.36 24 12 24 24 18.64 24 12 18.64 0 12 0M12 1.41C13.2 1.41 14.36 1.63 15.43 2L12.13 9.13C12.09 9.17 12.09 9.26 12 9.26S11.91 9.17 11.87 9.13L8.57 2C9.64 1.63 10.8 1.42 12 1.42M6.9 2.74L10.72 10.97C10.8 11.14 10.89 11.19 11 11.19H13C13.12 11.19 13.2 11.14 13.29 10.97L17.06 2.74C18.64 3.64 20 4.93 20.96 6.47L15.6 16.84C15.56 16.93 15.5 16.97 15.47 16.97C15.39 16.97 15.39 16.89 15.34 16.84L13.29 12.3C13.2 12.13 13.12 12.09 13 12.09H11C10.89 12.09 10.8 12.13 10.71 12.3L8.66 16.84C8.61 16.89 8.62 16.97 8.53 16.97C8.44 16.97 8.44 16.89 8.4 16.84L3 6.47C3.94 4.93 5.32 3.64 6.9 2.74M2.06 8.53L8.23 20.53C8.31 20.7 8.4 20.83 8.62 20.83C8.83 20.83 8.91 20.7 9 20.53L11.87 14.14C11.91 14.06 11.96 14 12 14C12.09 14 12.09 14.1 12.13 14.14L15.04 20.53C15.13 20.7 15.21 20.83 15.43 20.83C15.64 20.83 15.73 20.7 15.81 20.53L22 8.53C22.37 9.6 22.59 10.76 22.59 12C22.54 17.79 17.79 22.59 12 22.59C6.21 22.59 1.46 17.79 1.46 12C1.46 10.8 1.67 9.65 2.06 8.53Z";
  }
  if (!window.WC_LOGOS.emirates) {
    window.WC_LOGOS.emirates = "M6.247 15.56l-1.386 1.385c.945.945 1.26 1.386 1.323 1.827.063-.063 1.323-1.134 1.323-1.512 0-.567-.378-.756-1.26-1.7m-3.15-2.458h-.755s.756.441.756 1.45v3.4c0 2.205 1.826 4.284 4.031 4.284h1.827c1.134 0 1.512-.252 2.142-.882l.692-.693c.378-.44.82-.755.82-1.952v-1.134c0-.945-.568-1.386-.82-1.638l-.63-.63v2.268s.441.504.693.63c.945.756.19 2.078-.692 2.078H7.066c-1.89-.063-3.402-1.637-3.465-3.527v-1.827c0-1.827-.503-1.827-.503-1.827m5.92 2.457l-1.385 1.386c.945.945 1.26 1.386 1.323 1.827.063-.063 1.323-1.134 1.323-1.512 0-.567-.378-.82-1.26-1.7M11.853 0l-.944.945c-.378.378-.252 1.134.504 1.89v1.89c0 .188-.19.377-.19.377s-1.133-1.008-2.14-1.008H7.57c-.945 0-1.7.882-1.827.945-.504.504-.504 1.45-.126 1.89L6.688 8s-.252-1.7 0-2.835c.063-.252.378-.567.693-.567l2.457 1.89-2.835 2.96c-.126.127-.504.379-.882.379-.44 0-.63-.252-.819-.504v1.386c0 .44.63.945 1.197.945h3.78c.252 0 .567-.063.819-.315l1.26-1.26c.188-.19.251-.441.251-.756V7.874c0-1.386-1.07-2.457-1.07-2.457s.251-.189.251-.756V3.213s.441.44.504.63l.82-.82c.377-.377-.253-1.07-.505-1.385C11.853.818 11.853 0 11.853 0M7.13 9.953c.378-.19.441-.315.756-.693l2.394-2.52s1.322 1.386 1.763 2.142c.19.378.441 1.07-.692 1.07H7.13M3.915 7.056h-.692c.44.252.755 1.008.755 1.449v2.772c0 .755.567 3.464 3.024 3.464h7.118v4.536c0 .755-.252 1.196-.44 1.385l-1.072 1.008h.504l1.953-1.763c.378-.441.819-.882.819-2.268V14.74l.819-.819 1.386-1.323c0 1.134.567 1.638 1.07 1.638a1.26 1.26 0 0 0 .756-.315l1.26-1.197c.567-.567.882-2.33-.504-2.33-.882 0-1.89 1.26-1.952 1.386-.315-.19-.567-.63-.567-.63v1.07c-.126.19-.693.63-1.134.63h-1.134v-1.07c0-.504.189-1.071.44-1.323l1.072-1.008h-.504l-2.142 1.953c-.378.44-.63 1.26-.63 1.448H6.058c-1.008 0-1.638-1.007-1.638-1.826v-2.08c0-1.7-.44-1.889-.504-1.889m16.315 6.047c-.189 0-.378-.063-.63-.252-.251-.189-.692-.819-.692-.819.126-.125.504-.251.818-.251.252 0 .504.063.567.189.441.566.378 1.133-.063 1.133M16.893 0L14.75 1.953c-.126.126-.63.882-.63 1.764v5.606c0 .378-.252.945-.44 1.134l-1.072 1.008h.504l2.016-1.827c.252-.252.756-.882.756-1.953V2.331c0-.82.378-1.26.567-1.45L17.397 0h-.504m.315 14.362v2.205l.756.819c.63.63.567 1.827-1.323 3.653a3.78 3.78 0 0 1-2.583 1.197h-3.401L12.672 24h1.386c1.386 0 2.646-.567 3.465-1.449.756-.819 1.197-1.89 1.134-3.023V16.63c0-1.008-.63-1.575-.756-1.7-.126 0-.693-.568-.693-.568Z";
  }

  window.WC_DATA = {
    edition:   'World Cup 2026',
    matchday:  'FIFA World Cup 2026 · Social',
    dateLabel: 'Thu 11 Jun 2026',
    window:    'season-to-date',
    totalMentions: '+1B',           // total brand views across the build-up window
    unit:      'views',

    scope: {
      event:   'Pre-Tournament',
      segment: 'All brands',
    },

    platforms: ['tiktok', 'instagram', 'x', 'youtube'],

    // No moment-of-the-day before the tournament starts.
    moment: null,

    share:     'Share of voice — % of all brand views around the tournament',
    headline:  'Adidas leads the pre-tournament build-up.',
    moverNote: 'Ranked 7th in share of voice, Volkswagen is doing it most efficiently.',
    footer:    'Tracked by Scolto',
    url:       'scolto.com',
    handle:    '@scolto',

    // rank order = array order. sov = share of VIEWS from the updated table.
    brands: [
      { name: 'adidas',         icon: 'adidas',        mono: 'a',  color: '#0A0A0A', fg: '#FFFFFF', sov: 32.0, move: 'same' },
      { name: 'Nike',           icon: 'nike',          mono: 'N',  color: '#111111', fg: '#FFFFFF', sov: 30.0, move: 'same' },
      { name: 'Coca-Cola',      icon: 'cocacola',      mono: 'C',  color: '#E61A27', fg: '#FFFFFF', sov: 12.0, move: 'same' },
      { name: 'Puma',           icon: 'puma',          mono: 'P',  color: '#1B1B1B', fg: '#FFFFFF', sov: 9.1,  move: 'same' },
      { name: 'Hyundai',        icon: 'hyundai',       mono: 'H',  color: '#002C5F', fg: '#FFFFFF', sov: 3.1,  move: 'same' },
      { name: 'Qatar Airways',  icon: 'qatarairways',  mono: 'Q',  color: '#5C0632', fg: '#FFFFFF', sov: 2.9,  move: 'same' },
      { name: 'Volkswagen',     icon: 'volkswagen',    mono: 'VW', color: '#001E50', fg: '#FFFFFF', sov: 2.9,  move: 'same', viral: true },
      { name: 'Budweiser',      mono: 'B',             logo: 'https://img.logo.dev/budweiser.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true', color: '#C8102E', fg: '#FFFFFF', sov: 2.1,  move: 'same' },
      { name: 'Visa',           icon: 'visa',          mono: 'V',  color: '#1A1F71', fg: '#FFFFFF', sov: 2.0,  move: 'same' },
      { name: 'ESPN',           mono: 'E',             logo: 'https://img.logo.dev/espn.com?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true', color: '#CC0000', fg: '#FFFFFF', sov: 2.0,  move: 'same' },
      { name: "McDonald's",     icon: 'mcdonalds',     mono: 'M',  color: '#E8A000', fg: '#FFFFFF', sov: 1.4,  move: 'same' },
      { name: 'Emirates',       icon: 'emirates',      mono: 'E',  color: '#D71921', fg: '#FFFFFF', sov: 1.4,  move: 'same' },
    ],
  };
})();
