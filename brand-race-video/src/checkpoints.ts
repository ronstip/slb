// The four REAL cumulative checkpoints, ported verbatim from the marketing
// data files (data_pre_tournament.js → data_day4.js → data_day7.js →
// data_day11.js). The race animates across these in order.
export interface Brand {
  name: string;
  icon?: string; // key into WC_LOGOS (tinted glyph)
  logo?: string; // image URL (logo.dev) when no glyph exists
  mono: string; // monogram fallback
  color: string; // brand color (tints glyph / monogram-tile bg)
  fg: string; // monogram text color
  sov: number;
  move: 'up' | 'down' | 'same' | 'new';
  viral?: boolean;
}
export interface Checkpoint {
  key: string;
  matchday: string;
  dateLabel: string;
  scope: { event: string; segment: string };
  totalMentions: string;
  unit: string;
  moverNote: string;
  brands: Brand[];
}

const LOGO = (slug: string) =>
  `https://img.logo.dev/${slug}?token=pk_Ips9o4LxTsynWxsa32aS7Q&size=128&format=png&retina=true`;

export const platforms = ['tiktok', 'instagram', 'x', 'youtube'];
export const footer = 'Tracked by Scolto';
export const url = 'scolto.com';

export const CHECKPOINTS: Checkpoint[] = [
  {
    key: 'pre',
    matchday: 'Pre-tournament',
    dateLabel: 'Thu 11 Jun 2026',
    scope: { event: 'Pre-Tournament', segment: 'All brands' },
    totalMentions: '+1B',
    unit: 'views',
    moverNote: 'Ranked 7th in share of voice, Volkswagen is doing it most efficiently.',
    brands: [
      { name: 'adidas', icon: 'adidas', mono: 'a', color: '#0A0A0A', fg: '#FFFFFF', sov: 32.0, move: 'same' },
      { name: 'Nike', icon: 'nike', mono: 'N', color: '#111111', fg: '#FFFFFF', sov: 30.0, move: 'same' },
      { name: 'Coca-Cola', icon: 'cocacola', mono: 'C', color: '#E61A27', fg: '#FFFFFF', sov: 12.0, move: 'same' },
      { name: 'Puma', icon: 'puma', mono: 'P', color: '#1B1B1B', fg: '#FFFFFF', sov: 9.1, move: 'same' },
      { name: 'Hyundai', icon: 'hyundai', mono: 'H', color: '#002C5F', fg: '#FFFFFF', sov: 3.1, move: 'same' },
      { name: 'Qatar Airways', icon: 'qatarairways', mono: 'Q', color: '#5C0632', fg: '#FFFFFF', sov: 2.9, move: 'same' },
      { name: 'Volkswagen', icon: 'volkswagen', mono: 'VW', color: '#001E50', fg: '#FFFFFF', sov: 2.9, move: 'same', viral: true },
      { name: 'Budweiser', mono: 'B', logo: LOGO('budweiser.com'), color: '#C8102E', fg: '#FFFFFF', sov: 2.1, move: 'same' },
      { name: 'Visa', icon: 'visa', mono: 'V', color: '#1A1F71', fg: '#FFFFFF', sov: 2.0, move: 'same' },
      { name: 'ESPN', mono: 'E', logo: LOGO('espn.com'), color: '#CC0000', fg: '#FFFFFF', sov: 2.0, move: 'same' },
      { name: "McDonald's", icon: 'mcdonalds', mono: 'M', color: '#E8A000', fg: '#FFFFFF', sov: 1.4, move: 'same' },
      { name: 'Emirates', icon: 'emirates', mono: 'E', color: '#D71921', fg: '#FFFFFF', sov: 1.4, move: 'same' },
    ],
  },
  {
    key: 'day4',
    matchday: 'Days 1–4',
    dateLabel: 'Sun 14 Jun 2026',
    scope: { event: 'Opening four days', segment: 'All brands' },
    totalMentions: '+1B',
    unit: 'views',
    moverNote: 'Mengniu & Michelob ULTRA punch above their weight — ~50K avg views per post on bottom-half share.',
    brands: [
      { name: 'adidas', icon: 'adidas', mono: 'a', color: '#0A0A0A', fg: '#FFFFFF', sov: 25.0, move: 'same' },
      { name: 'Nike', icon: 'nike', mono: 'N', color: '#111111', fg: '#FFFFFF', sov: 18.0, move: 'same' },
      { name: 'Coca-Cola', icon: 'cocacola', mono: 'C', color: '#E61A27', fg: '#FFFFFF', sov: 13.0, move: 'same' },
      { name: 'Visa', icon: 'visa', mono: 'V', color: '#1A1F71', fg: '#FFFFFF', sov: 10.0, move: 'up' },
      { name: 'Qatar Airways', icon: 'qatarairways', mono: 'Q', color: '#5C0632', fg: '#FFFFFF', sov: 8.5, move: 'up' },
      { name: 'Lenovo', mono: 'L', logo: LOGO('lenovo.com'), color: '#E2231A', fg: '#FFFFFF', sov: 6.4, move: 'same' },
      { name: 'Aramco', mono: 'A', logo: LOGO('aramco.com'), color: '#00843D', fg: '#FFFFFF', sov: 3.6, move: 'same' },
      { name: 'Michelob ULTRA', mono: 'M', logo: LOGO('michelobultra.com'), color: '#041E42', fg: '#FFFFFF', sov: 3.5, move: 'new', viral: true },
      { name: "McDonald's", icon: 'mcdonalds', mono: 'M', color: '#E8A000', fg: '#FFFFFF', sov: 3.1, move: 'up' },
      { name: 'Puma', icon: 'puma', mono: 'P', color: '#1B1B1B', fg: '#FFFFFF', sov: 2.9, move: 'down' },
      { name: 'Bank of America', mono: 'B', logo: LOGO('bankofamerica.com'), color: '#012169', fg: '#FFFFFF', sov: 2.8, move: 'same' },
      { name: 'Mengniu', mono: 'M', logo: LOGO('mengniu.com'), color: '#E60012', fg: '#FFFFFF', sov: 2.3, move: 'new', viral: true },
    ],
  },
  {
    key: 'day7',
    matchday: 'Days 1–7',
    dateLabel: 'Wed 17 Jun 2026',
    scope: { event: 'Opening week', segment: 'All brands' },
    totalMentions: '+2B',
    unit: 'views',
    moverNote: 'Capelli Sport is the efficiency story — 237K avg views per post on 3.6% share. Hisense & Verizon also overperform their footprint.',
    brands: [
      { name: 'adidas', icon: 'adidas', mono: 'a', color: '#0A0A0A', fg: '#FFFFFF', sov: 20.0, move: 'same' },
      { name: 'Nike', icon: 'nike', mono: 'N', color: '#111111', fg: '#FFFFFF', sov: 14.0, move: 'same' },
      { name: 'Coca-Cola', icon: 'cocacola', mono: 'C', color: '#E61A27', fg: '#FFFFFF', sov: 12.0, move: 'same' },
      { name: 'Visa', icon: 'visa', mono: 'V', color: '#1A1F71', fg: '#FFFFFF', sov: 9.2, move: 'same' },
      { name: 'Qatar Airways', icon: 'qatarairways', mono: 'Q', color: '#5C0632', fg: '#FFFFFF', sov: 7.6, move: 'same' },
      { name: 'Hisense', mono: 'H', logo: LOGO('hisense.com'), color: '#006837', fg: '#FFFFFF', sov: 7.5, move: 'up', viral: true },
      { name: 'Lenovo', mono: 'L', logo: LOGO('lenovo.com'), color: '#E2231A', fg: '#FFFFFF', sov: 6.7, move: 'down' },
      { name: 'Hyundai', icon: 'hyundai', mono: 'H', color: '#002C5F', fg: '#FFFFFF', sov: 5.7, move: 'up' },
      { name: 'Aramco', mono: 'A', logo: LOGO('aramco.com'), color: '#00843D', fg: '#FFFFFF', sov: 5.5, move: 'down' },
      { name: 'Verizon', mono: 'V', logo: LOGO('verizon.com'), color: '#000000', fg: '#FFFFFF', sov: 5.2, move: 'up' },
      { name: 'Capelli Sport', mono: 'C', logo: LOGO('capellisport.com'), color: '#C8102E', fg: '#FFFFFF', sov: 3.6, move: 'up', viral: true },
      { name: 'Puma', icon: 'puma', mono: 'P', color: '#1B1B1B', fg: '#FFFFFF', sov: 3.5, move: 'down' },
    ],
  },
  {
    key: 'day11',
    matchday: 'Days 1–11',
    dateLabel: 'Sun 21 Jun 2026',
    scope: { event: 'Opening run', segment: 'All brands' },
    totalMentions: '+3B',
    unit: 'views',
    moverNote: 'Hisense is the efficiency story — 116.4K avg views per post on 8.2% share. Verizon & Visa also overperform their footprint.',
    brands: [
      { name: 'adidas', icon: 'adidas', mono: 'a', color: '#0A0A0A', fg: '#FFFFFF', sov: 19.0, move: 'same' },
      { name: 'Nike', icon: 'nike', mono: 'N', color: '#111111', fg: '#FFFFFF', sov: 16.0, move: 'same' },
      { name: 'Visa', icon: 'visa', mono: 'V', color: '#1A1F71', fg: '#FFFFFF', sov: 11.0, move: 'up' },
      { name: 'Coca-Cola', icon: 'cocacola', mono: 'C', color: '#E61A27', fg: '#FFFFFF', sov: 8.8, move: 'down' },
      { name: 'Hisense', mono: 'H', logo: LOGO('hisense.com'), color: '#006837', fg: '#FFFFFF', sov: 8.2, move: 'up', viral: true },
      { name: 'Aramco', mono: 'A', logo: LOGO('aramco.com'), color: '#00843D', fg: '#FFFFFF', sov: 6.8, move: 'up' },
      { name: 'Qatar Airways', icon: 'qatarairways', mono: 'Q', color: '#5C0632', fg: '#FFFFFF', sov: 6.0, move: 'down' },
      { name: 'Lenovo', mono: 'L', logo: LOGO('lenovo.com'), color: '#E2231A', fg: '#FFFFFF', sov: 6.0, move: 'down' },
      { name: 'Verizon', mono: 'V', logo: LOGO('verizon.com'), color: '#000000', fg: '#FFFFFF', sov: 5.2, move: 'up' },
      { name: 'Puma', icon: 'puma', mono: 'P', color: '#1B1B1B', fg: '#FFFFFF', sov: 4.9, move: 'up' },
      { name: 'Hyundai', icon: 'hyundai', mono: 'H', color: '#002C5F', fg: '#FFFFFF', sov: 4.8, move: 'down' },
      { name: "McDonald's", mono: 'M', logo: LOGO('mcdonalds.com'), color: '#FFBC0D', fg: '#DA291C', sov: 3.4, move: 'up' },
    ],
  },
  {
    key: 'day12',
    matchday: 'Days 1–12',
    dateLabel: 'Mon 22 Jun 2026',
    scope: { event: 'Opening twelve days', segment: 'All brands' },
    totalMentions: '+3B',
    unit: 'views',
    moverNote:
      "Betano is the breakout — 153.4K avg views per post on 4.1% share, the most efficient on the board. Hisense & McDonald's also punch above their footprint.",
    brands: [
      { name: 'adidas', icon: 'adidas', mono: 'a', color: '#0A0A0A', fg: '#FFFFFF', sov: 23.0, move: 'same' },
      { name: 'Nike', icon: 'nike', mono: 'N', color: '#111111', fg: '#FFFFFF', sov: 18.0, move: 'same' },
      { name: 'Visa', icon: 'visa', mono: 'V', color: '#1A1F71', fg: '#FFFFFF', sov: 9.6, move: 'same' },
      { name: 'Coca-Cola', icon: 'cocacola', mono: 'C', color: '#E61A27', fg: '#FFFFFF', sov: 7.4, move: 'same' },
      { name: 'Puma', icon: 'puma', mono: 'P', color: '#1B1B1B', fg: '#FFFFFF', sov: 7.1, move: 'up' },
      { name: 'Hisense', mono: 'H', logo: LOGO('hisense.com'), color: '#006837', fg: '#FFFFFF', sov: 6.8, move: 'down', viral: true },
      { name: 'Lenovo', mono: 'L', logo: LOGO('lenovo.com'), color: '#E2231A', fg: '#FFFFFF', sov: 6.1, move: 'up' },
      { name: "McDonald's", mono: 'M', logo: LOGO('mcdonalds.com'), color: '#FFBC0D', fg: '#DA291C', sov: 5.1, move: 'up' },
      { name: 'Aramco', mono: 'A', logo: LOGO('aramco.com'), color: '#00843D', fg: '#FFFFFF', sov: 5.0, move: 'down' },
      { name: 'Verizon', mono: 'V', logo: LOGO('verizon.com'), color: '#000000', fg: '#FFFFFF', sov: 4.4, move: 'down' },
      { name: 'Betano', mono: 'B', logo: LOGO('betano.com'), color: '#00A94F', fg: '#FFFFFF', sov: 4.1, move: 'new', viral: true },
      { name: 'Qatar Airways', icon: 'qatarairways', mono: 'Q', color: '#5C0632', fg: '#FFFFFF', sov: 4.0, move: 'down' },
    ],
  },
  {
    key: 'day14',
    matchday: 'Days 1–14',
    dateLabel: 'Wed 24 Jun 2026',
    scope: { event: 'Opening run', segment: 'All brands' },
    totalMentions: '+5B',
    unit: 'views',
    moverNote:
      "Hisense is the efficiency story — 102.0K avg views per post, the only brand going viral. Verizon & McDonald's also punch far above their share (100.6K / 89.8K).",
    brands: [
      { name: 'adidas', icon: 'adidas', mono: 'a', color: '#0A0A0A', fg: '#FFFFFF', sov: 17.0, move: 'same' },
      { name: 'Nike', icon: 'nike', mono: 'N', color: '#111111', fg: '#FFFFFF', sov: 13.0, move: 'same' },
      { name: 'Visa', icon: 'visa', mono: 'V', color: '#1A1F71', fg: '#FFFFFF', sov: 11.0, move: 'same' },
      { name: 'Coca-Cola', icon: 'cocacola', mono: 'C', color: '#E61A27', fg: '#FFFFFF', sov: 8.3, move: 'same' },
      { name: 'Hisense', mono: 'H', logo: LOGO('hisense.com'), color: '#006837', fg: '#FFFFFF', sov: 8.3, move: 'up', viral: true },
      { name: 'Puma', icon: 'puma', mono: 'P', color: '#1B1B1B', fg: '#FFFFFF', sov: 7.8, move: 'down' },
      { name: 'Qatar Airways', icon: 'qatarairways', mono: 'Q', color: '#5C0632', fg: '#FFFFFF', sov: 6.7, move: 'up' },
      { name: 'Verizon', mono: 'V', logo: LOGO('verizon.com'), color: '#000000', fg: '#FFFFFF', sov: 6.6, move: 'up' },
      { name: 'Lenovo', mono: 'L', logo: LOGO('lenovo.com'), color: '#E2231A', fg: '#FFFFFF', sov: 6.0, move: 'down' },
      { name: 'Aramco', mono: 'A', logo: LOGO('aramco.com'), color: '#00843D', fg: '#FFFFFF', sov: 5.6, move: 'down' },
      { name: 'Hyundai', icon: 'hyundai', mono: 'H', color: '#002C5F', fg: '#FFFFFF', sov: 5.0, move: 'new' },
      { name: "McDonald's", mono: 'M', logo: LOGO('mcdonalds.com'), color: '#FFBC0D', fg: '#DA291C', sov: 4.9, move: 'down' },
    ],
  },
  {
    key: 'jul1',
    matchday: 'Days 1–21',
    dateLabel: 'Wed 1 Jul 2026',
    scope: { event: 'Opening run', segment: 'All brands' },
    totalMentions: '+8B',
    unit: 'views',
    moverNote:
      "Verizon is the efficiency story — 105.4K avg views per post, the only brand going viral. Hisense & McDonald's also punch far above their share (81.8K / 76.7K).",
    brands: [
      { name: 'adidas', icon: 'adidas', mono: 'a', color: '#0A0A0A', fg: '#FFFFFF', sov: 16.0, move: 'same' },
      { name: 'Nike', icon: 'nike', mono: 'N', color: '#111111', fg: '#FFFFFF', sov: 12.0, move: 'same' },
      { name: 'Visa', icon: 'visa', mono: 'V', color: '#1A1F71', fg: '#FFFFFF', sov: 11.0, move: 'same' },
      { name: 'Coca-Cola', icon: 'cocacola', mono: 'C', color: '#E61A27', fg: '#FFFFFF', sov: 9.8, move: 'same' },
      { name: 'Puma', icon: 'puma', mono: 'P', color: '#1B1B1B', fg: '#FFFFFF', sov: 9.1, move: 'up' },
      { name: 'Hisense', mono: 'H', logo: LOGO('hisense.com'), color: '#006837', fg: '#FFFFFF', sov: 7.2, move: 'down' },
      { name: 'Qatar Airways', icon: 'qatarairways', mono: 'Q', color: '#5C0632', fg: '#FFFFFF', sov: 6.6, move: 'same' },
      { name: 'Hyundai', icon: 'hyundai', mono: 'H', color: '#002C5F', fg: '#FFFFFF', sov: 6.3, move: 'up' },
      { name: 'Verizon', mono: 'V', logo: LOGO('verizon.com'), color: '#000000', fg: '#FFFFFF', sov: 6.2, move: 'down', viral: true },
      { name: 'Lenovo', mono: 'L', logo: LOGO('lenovo.com'), color: '#E2231A', fg: '#FFFFFF', sov: 6.0, move: 'down' },
      { name: 'Aramco', mono: 'A', logo: LOGO('aramco.com'), color: '#00843D', fg: '#FFFFFF', sov: 5.2, move: 'down' },
      { name: "McDonald's", mono: 'M', logo: LOGO('mcdonalds.com'), color: '#FFBC0D', fg: '#DA291C', sov: 4.3, move: 'same' },
    ],
  },
];
