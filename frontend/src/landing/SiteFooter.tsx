// Shared site footer ("lower banner") for all public pages - the landing page,
// the manifesto, and the legal pages. This is the canonical footer; the landing
// page is the source of truth for its design. Self-contained (no import from
// LandingPage.tsx) so it can be reused without dragging in the whole landing
// module. Fonts load globally in index.html.

import { type ReactNode, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ScoltoMark } from '../components/Logo.tsx';

const BRAND = {
  cream: '#F6F4EF',
} as const;

const Mono = ({ children, color, size = 10.5, style = {} }: {
  children: ReactNode; color?: string; size?: number; style?: CSSProperties;
}) => (
  <span style={{
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: size, color: color || '#6E665A', letterSpacing: 1.2,
    textTransform: 'uppercase', ...style,
  }}>{children}</span>
);

const Logo = () => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 32 * 0.375, lineHeight: 1 }}>
    <span style={{ display: 'inline-flex', color: BRAND.cream, flexShrink: 0 }}>
      <ScoltoMark size={32} />
    </span>
    <span style={{
      fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 400, fontSize: 42,
      letterSpacing: '-0.026em', lineHeight: 1, color: BRAND.cream,
    }}>Scolto</span>
  </span>
);

export const SiteFooter = () => (
  <footer className="lp-footer" style={{ padding: '40px 64px 48px', background: '#1A1714', color: '#D6CFBF', borderTop: `1px solid #3A352A` }}>
    <div className="lp-footer-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 48, flexWrap: 'wrap' }}>
      <div style={{ maxWidth: 300 }}>
        <div style={{ marginBottom: 14 }}>
          <Link to="/" aria-label="Scolto home" style={{ textDecoration: 'none' }}><Logo /></Link>
        </div>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 13, color: '#A29A8B', lineHeight: 1.55 }}>
          The first AI agent on social - reads the internet so you don't have to.
        </div>
      </div>
      <div className="lp-footer-links" style={{ display: 'flex', gap: 64, fontFamily: "'Inter Tight',sans-serif", fontSize: 13 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <Mono size={9.5} color="#7E7666" style={{ marginBottom: 4 }}>Product</Mono>
          <a href="/#how-it-works" style={{ color: '#D6CFBF', textDecoration: 'none' }}>How it works</a>
          <Link to="/" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Examples</Link>
          <Link to="/" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Changelog</Link>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <Mono size={9.5} color="#7E7666" style={{ marginBottom: 4 }}>Company</Mono>
          <Link to="/" style={{ color: '#D6CFBF', textDecoration: 'none' }}>About</Link>
          <Link to="/" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Careers</Link>
          <Link to="/manifesto" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Manifesto</Link>
          <a href="mailto:support@scolto.com" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Contact us</a>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <Mono size={9.5} color="#7E7666" style={{ marginBottom: 4 }}>Legal</Mono>
          <Link to="/privacy" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Privacy</Link>
          <Link to="/terms" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Terms</Link>
          <Link to="/refund" style={{ color: '#D6CFBF', textDecoration: 'none' }}>Refunds</Link>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <Mono size={9.5} color="#7E7666" style={{ marginBottom: 4 }}>Social</Mono>
          <a href="https://www.linkedin.com/company/scolto" target="_blank" rel="noopener noreferrer" style={{ color: '#D6CFBF', textDecoration: 'none' }}>LinkedIn</a>
          <a href="https://x.com/ScoltoSocial" target="_blank" rel="noopener noreferrer" style={{ color: '#D6CFBF', textDecoration: 'none' }}>X</a>
        </div>
      </div>
    </div>
    <div className="lp-footer-bottom" style={{
      marginTop: 36, paddingTop: 18, borderTop: '1px solid #2A2520',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <Mono size={9.5} color="#7E7666">© 2026 Scolto - the first AI agent on social</Mono>
      <Mono size={9.5} color="#7E7666">made for people who'd rather read than scroll</Mono>
    </div>
  </footer>
);
