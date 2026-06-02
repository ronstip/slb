// Public legal pages — Privacy Policy, Terms of Service, Refund Policy.
//
// These are reachable from the landing-page footer and are required for the
// Lemon Squeezy (merchant-of-record) account review. Styling intentionally
// mirrors the landing page (LandingPage.tsx): paper/cream surfaces, Fraunces
// + Bricolage headings, Inter Tight body, JetBrains Mono labels, the ink/orange
// brand palette. Fonts are loaded globally in index.html.
//
// NOTE: the copy below is solid, honest boilerplate for a B2B SaaS that
// analyses *public* social content and bills usage via credits. It is NOT a
// substitute for review by counsel. Search this file for "[" to find the
// placeholders you must fill before going live (registered entity name).

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

// Legal party named in the Terms/Privacy. Scolto is run as an Israeli sole
// proprietorship (עוסק פטור/מורשה), so there is no company name — the operator's
// personal identity and registration number are intentionally NOT published
// (sensitive personal data). Those live in the Lemon Squeezy account KYC and are
// disclosed on request. Governing law: Israel.
const ENTITY = 'Scolto';
const JURISDICTION = 'Israel';
const SUPPORT_EMAIL = 'support@scolto.com';
const LAST_UPDATED = 'June 1, 2026';

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

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 style={{
    margin: '44px 0 14px', fontFamily: DISPLAY, fontWeight: 500, fontSize: 26,
    lineHeight: 1.15, letterSpacing: '-0.03em', color: C.ink,
  }}>{children}</h2>
);

const H3 = ({ children }: { children: ReactNode }) => (
  <h3 style={{
    margin: '26px 0 8px', fontFamily: BODY, fontWeight: 700, fontSize: 16,
    lineHeight: 1.3, color: C.ink,
  }}>{children}</h3>
);

const P = ({ children }: { children: ReactNode }) => (
  <p style={{
    margin: '0 0 14px', fontFamily: BODY, fontSize: 15.5, lineHeight: 1.65, color: C.ink,
  }}>{children}</p>
);

const UL = ({ children }: { children: ReactNode }) => (
  <ul style={{
    margin: '0 0 16px', paddingLeft: 22, fontFamily: BODY, fontSize: 15.5,
    lineHeight: 1.65, color: C.ink, display: 'flex', flexDirection: 'column', gap: 6,
  }}>{children}</ul>
);

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} style={{ color: C.orangeDeep, textDecoration: 'underline', textUnderlineOffset: 2 }}>
    {children}
  </a>
);

// ── Page shell ──────────────────────────────────────────────────────────────

const LEGAL_LINKS = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/refund', label: 'Refunds' },
] as const;

function LegalShell({
  eyebrow,
  title,
  intro,
  children,
  pageTitle,
  pageDescription,
}: {
  eyebrow: string;
  title: ReactNode;
  intro: ReactNode;
  children: ReactNode;
  pageTitle: string;
  pageDescription: string;
}) {
  useHead({
    title: pageTitle,
    meta: [{ name: 'description', content: pageDescription }],
  });

  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.ink, display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 32px', borderBottom: `1px solid ${C.rule}`, background: C.paper,
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
      <main style={{ flex: 1, width: '100%', maxWidth: 760, margin: '0 auto', padding: '56px 28px 80px' }}>
        <Mono color={C.orangeDeep}>{eyebrow}</Mono>
        <h1 style={{
          margin: '14px 0 0', fontFamily: DISPLAY, fontWeight: 400, fontSize: 48,
          lineHeight: 1.04, letterSpacing: '-0.04em', color: C.ink,
        }}>{title}</h1>
        <p style={{ margin: '16px 0 0', fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.muted, textTransform: 'uppercase' }}>
          Last updated · {LAST_UPDATED}
        </p>
        <div style={{ margin: '28px 0 0', paddingTop: 28, borderTop: `1px solid ${C.rule}` }}>
          <div style={{ fontFamily: BODY, fontSize: 17, lineHeight: 1.6, color: C.ink, marginBottom: 8 }}>
            {intro}
          </div>
          {children}
        </div>
      </main>

      {/* Footer — shared site footer (same as landing page) */}
      <SiteFooter />
    </div>
  );
}

// ── Privacy Policy ──────────────────────────────────────────────────────────

export function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Legal · Privacy"
      title="Privacy Policy"
      pageTitle="Privacy Policy · Scolto"
      pageDescription="How Scolto collects, uses, and protects your information."
      intro={
        <>
          Scolto (“<strong>Scolto</strong>”, “we”, “us”) is a business-to-business software
          service that helps brand, marketing, and insights teams research public social-media
          conversation. This policy explains what personal information we collect, how we use it,
          and the choices you have. Scolto is operated from {JURISDICTION}; for our full
          operator and registration details, contact{' '}
          <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.
        </>
      }
    >
      <H2>1. Information we collect</H2>
      <H3>Account information</H3>
      <P>
        We use Single Sign-On with Google or Microsoft. When you sign in we receive your name,
        email address, and profile picture from that provider. We do not receive or store your
        Google/Microsoft password.
      </P>
      <H3>Content you submit</H3>
      <P>
        The briefs, questions, prompts, and configuration you enter, and the reports, dashboards,
        and other outputs Scolto generates for you. This is your workspace content.
      </P>
      <H3>Usage and device data</H3>
      <P>
        Log data such as IP address, browser type, pages viewed, feature usage, and timestamps,
        collected to operate, secure, and improve the service.
      </P>
      <H3>Billing data</H3>
      <P>
        Payments are processed by our merchant of record, Lemon Squeezy (Lemon Squeezy, LLC). We
        receive order and subscription details (e.g. plan, credit balance, country for tax) but we
        do <strong>not</strong> collect or store your full card number.
      </P>
      <H3>Publicly available content we analyse for you</H3>
      <P>
        To fulfil your research requests, Scolto retrieves and analyses content that is publicly
        available on social platforms and the open web (for example public posts, videos, comments,
        reviews, and press), together with content from licensed data providers. We do not access
        private messages, DMs, or non-public accounts.
      </P>

      <H2>2. How we use information</H2>
      <UL>
        <li>To provide, maintain, and secure the service and your account.</li>
        <li>To run the research you request and deliver briefs, dashboards, and reports.</li>
        <li>To process payments, manage credits, and prevent fraud and abuse.</li>
        <li>To respond to your support requests at <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.</li>
        <li>To analyse and improve product performance and reliability.</li>
        <li>To comply with legal obligations and enforce our terms.</li>
      </UL>
      <P>
        <strong>We do not sell your personal information.</strong> We do not use your workspace
        content (your briefs or generated outputs) to train our or third parties’ general-purpose
        AI models.
      </P>

      <H2>3. Legal bases</H2>
      <P>
        Where the GDPR or similar laws apply, we process personal data on the bases of performance
        of our contract with you, our legitimate interests in operating and improving the service,
        your consent where required, and compliance with legal obligations.
      </P>

      <H2>4. Service providers and sharing</H2>
      <P>
        We share data with vetted providers who process it on our behalf under contract, including:
      </P>
      <UL>
        <li><strong>Google Cloud Platform &amp; Firebase</strong> — hosting, database, authentication.</li>
        <li><strong>Google Vertex AI / Gemini</strong> — AI model processing.</li>
        <li><strong>Lemon Squeezy</strong> — payments and billing (merchant of record).</li>
        <li><strong>Licensed data providers</strong> — supply of public social and web content.</li>
        <li><strong>Analytics and infrastructure providers</strong> — performance and security.</li>
      </UL>
      <P>
        We may also disclose information to comply with law, to protect our rights and users, or as
        part of a merger or acquisition (with notice where required).
      </P>

      <H2>5. International transfers</H2>
      <P>
        We and our providers may process data in countries other than yours. Where required, we rely
        on appropriate safeguards such as the EU Standard Contractual Clauses.
      </P>

      <H2>6. Data retention</H2>
      <P>
        We keep personal data for as long as your account is active and as needed to provide the
        service, then for a reasonable period to meet legal, accounting, and security obligations.
        You can ask us to delete your account and associated workspace content.
      </P>

      <H2>7. Security</H2>
      <P>
        We use industry-standard measures including encryption in transit, access controls, and
        managed cloud infrastructure. No method of transmission or storage is completely secure, but
        we work to protect your information and to notify you of material incidents as required by law.
      </P>

      <H2>8. Your rights</H2>
      <P>
        Depending on your location, you may have the right to access, correct, export, or delete your
        personal data, to object to or restrict certain processing, and to withdraw consent. To
        exercise any right, email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>. You also have
        the right to complain to your local data-protection authority.
      </P>

      <H2>9. Children</H2>
      <P>
        Scolto is a business tool and is not intended for anyone under 18. We do not knowingly collect
        personal data from children.
      </P>

      <H2>10. Changes to this policy</H2>
      <P>
        We may update this policy from time to time. We will post the new version here and update the
        “Last updated” date; material changes will be communicated where appropriate.
      </P>

      <H2>11. Contact</H2>
      <P>
        Questions or requests: <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>. Scolto is
        operated from {JURISDICTION}; full operator details are available on request.
      </P>
    </LegalShell>
  );
}

// ── Terms of Service ────────────────────────────────────────────────────────

export function TermsPage() {
  return (
    <LegalShell
      eyebrow="Legal · Terms"
      title="Terms of Service"
      pageTitle="Terms of Service · Scolto"
      pageDescription="The terms that govern your use of the Scolto service."
      intro={
        <>
          These Terms of Service (“Terms”) govern your access to and use of Scolto (the “Service”),
          operated from {JURISDICTION}. By creating an account or
          using the Service, you agree to these Terms. If you are using the Service on behalf of an
          organisation, you represent that you are authorised to bind that organisation.
        </>
      }
    >
      <H2>1. The Service</H2>
      <P>
        Scolto is a software-as-a-service platform that researches publicly available social-media
        and web content on your behalf and produces briefs, dashboards, reports, and related
        outputs. We may update, improve, or change features over time.
      </P>

      <H2>2. Accounts and eligibility</H2>
      <P>
        You must be at least 18 and able to form a binding contract. You sign in through Google or
        Microsoft Single Sign-On and are responsible for activity under your account. Keep your
        login credentials secure and notify us of any unauthorised use.
      </P>

      <H2>3. Credits, billing, and payment</H2>
      <UL>
        <li>The Service is billed on a usage basis using <strong>credits</strong>. Running analyses consumes credits from your balance.</li>
        <li>Payments are processed by <strong>Lemon Squeezy (Lemon Squeezy, LLC)</strong>, our merchant of record and authorised reseller. Your purchase is also subject to Lemon Squeezy’s terms.</li>
        <li>Prices are shown at checkout and may exclude taxes, which are added as required by law.</li>
        <li>Credits are consumed as you use the Service. Refunds are governed by our <Link to="/refund" style={{ color: C.orangeDeep, textDecoration: 'underline', textUnderlineOffset: 2 }}>Refund Policy</Link>.</li>
        <li>We may change prices or plans prospectively, with notice for active subscriptions.</li>
      </UL>

      <H2>4. Acceptable use</H2>
      <P>You agree not to:</P>
      <UL>
        <li>Use the Service unlawfully or in violation of any third-party rights or platform terms.</li>
        <li>Attempt to access private, non-public, or restricted data through the Service.</li>
        <li>Reverse engineer, resell, or sublicense the Service except as expressly permitted.</li>
        <li>Interfere with, overload, or disrupt the Service or its infrastructure.</li>
        <li>Use outputs to harass, discriminate, or otherwise cause harm.</li>
      </UL>

      <H2>5. Your content and ownership</H2>
      <P>
        You retain ownership of the briefs you submit and the outputs generated for you. You grant us
        a limited licence to host and process this content solely to provide the Service. We own the
        Service itself, including its software, models integration, and brand. We do not use your
        workspace content to train general-purpose AI models.
      </P>

      <H2>6. Third-party data and accuracy</H2>
      <P>
        The Service analyses public content and uses AI models, which can produce errors or
        incomplete results. Outputs are provided for informational purposes and are not professional,
        legal, financial, or investment advice. You are responsible for verifying outputs before
        relying on them.
      </P>

      <H2>7. Intellectual property of third parties</H2>
      <P>
        Public content surfaced by the Service may belong to its respective owners. You are
        responsible for ensuring your use of any output complies with applicable rights and platform
        terms.
      </P>

      <H2>8. Disclaimers</H2>
      <P>
        The Service is provided “as is” and “as available”, without warranties of any kind, whether
        express or implied, including merchantability, fitness for a particular purpose, and
        non-infringement, to the maximum extent permitted by law.
      </P>

      <H2>9. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, neither {ENTITY} nor its suppliers will be liable for
        any indirect, incidental, special, consequential, or punitive damages, or any loss of profits
        or data. Our total liability for any claim relating to the Service will not exceed the amount
        you paid us in the three months before the event giving rise to the claim.
      </P>

      <H2>10. Indemnity</H2>
      <P>
        You agree to indemnify and hold harmless {ENTITY} from claims arising out of your misuse of
        the Service or violation of these Terms.
      </P>

      <H2>11. Termination</H2>
      <P>
        You may stop using the Service at any time. We may suspend or terminate access if you breach
        these Terms or to protect the Service or other users. Sections that by their nature should
        survive termination will survive.
      </P>

      <H2>12. Governing law</H2>
      <P>
        These Terms are governed by the laws of {JURISDICTION}, without regard to conflict-of-law
        rules, and the competent courts of {JURISDICTION} will have jurisdiction, except where
        mandatory consumer law provides otherwise.
      </P>

      <H2>13. Changes</H2>
      <P>
        We may update these Terms. We will post the new version here and update the “Last updated”
        date; continued use after changes means you accept them.
      </P>

      <H2>14. Contact</H2>
      <P>
        Questions: <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.
      </P>
    </LegalShell>
  );
}

// ── Refund Policy ───────────────────────────────────────────────────────────

export function RefundPage() {
  return (
    <LegalShell
      eyebrow="Legal · Refunds"
      title="Refund Policy"
      pageTitle="Refund Policy · Scolto"
      pageDescription="Scolto's refund terms for credit purchases and subscriptions."
      intro={
        <>
          We want you to be satisfied with Scolto. This policy explains when purchases can be
          refunded. Payments are processed by our merchant of record, Lemon Squeezy (Lemon Squeezy,
          LLC); refunds are issued through Lemon Squeezy to your original payment method.
        </>
      }
    >
      <H2>1. 14-day refund on unused credits</H2>
      <P>
        You can request a full refund of a credit purchase within <strong>14 days</strong> of the
        purchase date, provided the credits have <strong>not been used</strong>. We refund the unused
        portion of that purchase.
      </P>

      <H2>2. Consumed credits are non-refundable</H2>
      <P>
        Credits that have already been spent on analyses are non-refundable, because the underlying
        computing and data costs have been incurred. If only part of a purchase has been used, the
        remaining unused credits may still qualify under the 14-day window above.
      </P>

      <H2>3. Subscriptions</H2>
      <P>
        If you are on a recurring plan, you can cancel at any time to stop future renewals. Cancelling
        stops the next charge; it does not automatically refund the current period unless required by
        law or covered by the 14-day unused-credit rule above.
      </P>

      <H2>4. Your statutory rights</H2>
      <P>
        Nothing in this policy limits any non-waivable rights you have under applicable consumer law
        (for example, the statutory rights of consumers in the EU and UK). Where such rights apply,
        they take precedence over this policy.
      </P>

      <H2>5. How to request a refund</H2>
      <P>
        Email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A> with the email address used to
        purchase and your Lemon Squeezy order number. We aim to respond within 5 business days.
        Approved refunds are processed by Lemon Squeezy to your original payment method, typically
        within 5–10 business days depending on your provider.
      </P>

      <H2>6. Contact</H2>
      <P>
        Questions about a charge or refund: <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.
      </P>
    </LegalShell>
  );
}
