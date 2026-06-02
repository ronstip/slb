// Public manifesto page - the "why we built Scolto" editorial.
//
// Reachable from the landing-page nav and footer ("Manifesto"). Styling mirrors
// the landing page (LandingPage.tsx) and the legal pages (LegalPages.tsx):
// paper/cream surfaces, Fraunces + Bricolage headings, Inter Tight body,
// JetBrains Mono labels, the ink/orange brand palette. Fonts load globally in
// index.html.

import { type ReactNode, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useHead } from '@unhead/react';
import { ScoltoMark } from '../components/Logo.tsx';
import { SiteFooter } from '../landing/SiteFooter.tsx';

// ── Brand tokens (subset of LandingPage's LP_BRAND) ─────────────────────────
const C = {
  orange: '#D97757',
  orangeDeep: '#C25E3F',
  ink: '#0F1F4D',
  cream: '#F6F4EF',
  paper: '#FBFAF6',
  rule: '#E5E0D4',
  muted: '#6E665A',
  footerBg: '#1A1714',
  footerText: '#D6CFBF',
  footerMuted: '#7E7666',
} as const;

const SERIF = "'Fraunces', serif";
const DISPLAY = "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif";
const BODY = "'Inter Tight', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

// ── Shared primitives ───────────────────────────────────────────────────────

const Mono = ({ children, color, size = 10.5, style = {} }: {
  children: ReactNode; color?: string; size?: number; style?: CSSProperties;
}) => (
  <span style={{
    fontFamily: MONO, fontSize: size, color: color || C.muted,
    letterSpacing: 1.2, textTransform: 'uppercase', ...style,
  }}>{children}</span>
);

const Logo = ({ onDark = false }: { onDark?: boolean }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11, lineHeight: 1 }}>
    <span style={{ display: 'inline-flex', color: onDark ? C.cream : C.ink, flexShrink: 0 }}>
      <ScoltoMark size={28} />
    </span>
    <span style={{
      fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 30,
      letterSpacing: '-0.026em', lineHeight: 1, color: onDark ? C.cream : C.ink,
    }}>Scolto</span>
  </span>
);

// Body paragraph.
const P = ({ children }: { children: ReactNode }) => (
  <p style={{
    margin: '0 0 22px', fontFamily: BODY, fontSize: 18, lineHeight: 1.72, color: C.ink,
  }}>{children}</p>
);

// Editorial lead-in - a bold standalone line between paragraph blocks.
const Lead = ({ children }: { children: ReactNode }) => (
  <p style={{
    margin: '0 0 22px', fontFamily: DISPLAY, fontWeight: 600, fontSize: 22,
    lineHeight: 1.45, letterSpacing: '-0.02em', color: C.ink,
  }}>{children}</p>
);

// Belief callout - the framed "Understanding people is not a data problem" beat.
const Belief = ({ children }: { children: ReactNode }) => (
  <p style={{
    margin: '0 0 22px', padding: '20px 24px',
    borderLeft: `3px solid ${C.orange}`, background: C.cream,
    borderRadius: '0 10px 10px 0',
    fontFamily: DISPLAY, fontWeight: 600, fontSize: 21, lineHeight: 1.5,
    letterSpacing: '-0.018em', color: C.ink,
  }}>{children}</p>
);

const Em = ({ children }: { children: ReactNode }) => (
  <span style={{ fontStyle: 'italic', color: C.orangeDeep }}>{children}</span>
);

// ── Page ────────────────────────────────────────────────────────────────────

export function ManifestoPage() {
  useHead({
    title: 'Manifesto · Scolto',
    meta: [{
      name: 'description',
      content:
        "We'd rather read than scroll. Why we built Scolto - a researcher, not another dashboard. Understanding people is a reading problem, and AI can finally read meaning.",
    }],
  });

  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.ink, display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 32px', borderBottom: `1px solid ${C.rule}`, background: C.paper,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <Link to="/" aria-label="Scolto home" style={{ textDecoration: 'none' }}>
          <Logo />
        </Link>
        <Link to="/" style={{
          fontFamily: BODY, fontSize: 13.5, fontWeight: 600, color: C.ink, textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 7,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          Back to home
        </Link>
      </header>

      {/* Body */}
      <main style={{ flex: 1, width: '100%', maxWidth: 920, margin: '0 auto', padding: '64px 24px 96px' }}>
        <Mono color={C.orangeDeep}>Manifesto</Mono>
        <h1 style={{
          margin: '16px 0 0', fontFamily: DISPLAY, fontWeight: 400, fontSize: 60,
          lineHeight: 1.02, letterSpacing: '-0.04em', color: C.ink,
        }}>
          We'd rather read <br />than <Em>scroll.</Em>
        </h1>

        <div style={{ margin: '36px 0 0', paddingTop: 36, borderTop: `1px solid ${C.rule}` }}>
          <Lead>The hard part was never finding the conversation. It was understanding it.</Lead>

          <P>
            For twenty years, social listening competed on the wrong thing. More sources. More
            mentions. Faster charts. The industry got very good at counting what people say about
            you - and no better at telling you what it means.
          </P>

          <P>
            So you got a dashboard. A search bar, and a deal that asks you to fill it. It hands you
            the second layer - the volume, the sentiment score - and then it stops. The third layer,
            the one actually worth paying for - what happened, why it matters, what to do - it hands
            back to you. To read by hand. In a video it can't watch, a thread it can't weigh,
            languages it can't follow.
          </P>

          <Lead>We did that work. We sat in those rooms.</Lead>

          <P>
            We're a team that lives on a junction: human intelligence and artificial intelligence,
            at the same table. Cognitive scientists and social psychologists who study why a crowd
            turns on a brand overnight, why one comment travels and a thousand don't, what a person
            actually means underneath what they post - beside the AI people who can teach a machine
            to read exactly that. Not behavior first, then technology. Both, together. Almost no one
            in this industry sits where we sit.
          </P>

          <P>
            And we watched it break. Products and customers vanishing into noise. Sharp teams
            burning weeks turning mess into a clean story - by hand, every week, forever. We
            couldn't stand it.
          </P>

          <Lead>Here's what we believe that the dashboards don't:</Lead>

          <Belief>
            <span style={{ display: 'block', marginBottom: 12 }}>
              Understanding people is not a data problem. It's a <Em>reading problem.</Em>
            </span>
            <span style={{
              display: 'block', fontFamily: BODY, fontWeight: 400, fontSize: 18,
              lineHeight: 1.72, letterSpacing: 'normal', color: C.ink,
            }}>
              And reading - watching the video, catching the sarcasm, weighing whether two thousand
              angry posts outweigh fifty thousand happy ones - was something only a human could do.
              So that's who it got dumped on.
            </span>
          </Belief>

          <Lead>That changed.</Lead>

          <P>
            AI can finally do the thing it never could: read meaning. Watch the video and see the
            logo, the price, the room. Read the complaint in Korean and the reply in Spanish and
            know they're the same complaint. Understand tone, context, intention - the human layer.
            The bottleneck was never the data. It was a machine that could understand it. Now
            there's one.
          </P>

          <p style={{
            margin: '0 0 22px', fontFamily: DISPLAY, fontWeight: 600, fontSize: 22,
            lineHeight: 1.45, letterSpacing: '-0.02em', color: C.ink,
          }}>
            That's Scolto. Not another dashboard. <Em>A researcher.</Em>
          </p>

          <P>
            You brief it in a sentence - a question, some context, the format you need. Then it
            reads the internet on your schedule. Once a week, if that's your rhythm. In real time if
            you need to know the moment a story breaks - something almost nothing in this industry
            can actually do. It writes back the brief your CEO needs, the deck for the meeting, the
            read your CMO can act on. And they can brief it themselves - no analyst in the middle.
            The work an agency does in weeks, Scolto does in minutes.
          </P>

          <P>
            And we are obsessive about being right. Every claim is cited to the post, clip or comment
            - timecoded - it came from. If Scolto can't source something, it tells you, instead of
            guessing. An insight you can't trust isn't an insight. It's a liability.
          </P>

          <P>
            This is the bet: the era of the search-bar-and-a-seat is over. Brands shouldn't have to
            choose between flying blind and drowning in data. Understanding your own category should
            feel less like an investigation and more like asking the sharpest person in the room
            what they're seeing right now.
          </P>

          <Lead>We built that person.</Lead>

          {/* CTA */}
          <div style={{ marginTop: 40, paddingTop: 36, borderTop: `1px solid ${C.rule}`, display: 'flex', justifyContent: 'center' }}>
            <Link to="/" style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              padding: '14px 24px', borderRadius: 10, textDecoration: 'none',
              background: C.ink, color: '#F4EFE3',
              fontFamily: BODY, fontSize: 15, fontWeight: 600,
              boxShadow: '0 8px 20px -10px rgba(40,30,20,0.5)',
            }}>
              Get early access
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer - shared site footer (same as landing page) */}
      <SiteFooter />
    </div>
  );
}
