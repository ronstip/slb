import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './useAuth.ts';
import { Logo } from '../components/Logo.tsx';
import { Button } from '../components/ui/button.tsx';
import { PlatformIcon } from '../components/PlatformIcon.tsx';
import {
  ArrowRight,
  Sparkles,
  BarChart3,
  Bell,
  Shield,
  Zap,
  TrendingUp,
  Bot,
} from 'lucide-react';

// ── Scroll-animation primitives ───────────────────────────────────────────────

type AnimDir = 'up' | 'left' | 'right' | 'scale' | 'fade';

/** Returns a ref + boolean that flips true once the element enters the viewport. */
function useInView(threshold = 0.15): { ref: React.RefObject<HTMLDivElement | null>; inView: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -60px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}

/**
 * Wraps children in a div that slides/fades in when it enters the viewport.
 */
function AnimateIn({
  children,
  direction = 'up',
  delay = 0,
  className = '',
  threshold,
}: {
  children?: ReactNode;
  direction?: AnimDir;
  delay?: number;
  className?: string;
  threshold?: number;
}) {
  const { ref, inView } = useInView(threshold);

  const hidden: Record<AnimDir, string> = {
    up:    'opacity-0 translate-y-10',
    left:  'opacity-0 -translate-x-14',
    right: 'opacity-0 translate-x-14',
    scale: 'opacity-0 scale-90',
    fade:  'opacity-0',
  };

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${inView ? 'opacity-100 translate-x-0 translate-y-0 scale-100' : hidden[direction]} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

// ── Branded icons ─────────────────────────────────────────────────────────────

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 23 23">
      <path fill="#f3f3f3" d="M0 0h23v23H0z" />
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M12 1h10v10H12z" />
      <path fill="#05a6f0" d="M1 12h10v10H1z" />
      <path fill="#ffba08" d="M12 12h10v10H12z" />
    </svg>
  );
}

// ── Section sub-components ────────────────────────────────────────────────────

function FeatureCard({
  icon,
  iconBg,
  title,
  desc,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="group rounded-2xl border border-border/60 bg-card/50 p-6 hover:bg-card hover:border-border hover:shadow-sm transition-all duration-200">
      <div className={`h-11 w-11 rounded-xl ${iconBg} flex items-center justify-center mb-5`}>
        {icon}
      </div>
      <h3 className="font-semibold text-base mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function StepCard({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="h-16 w-16 rounded-2xl bg-accent-vibrant/10 border border-accent-vibrant/20 flex items-center justify-center mb-5 relative z-10">
        <span className="text-xl font-bold text-accent-vibrant">{number}</span>
      </div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{desc}</p>
    </div>
  );
}

function StatItem({ number, label }: { number: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-accent-vibrant to-accent-blue bg-clip-text text-transparent">
        {number}
      </div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

// Simplified in-app mockup preview
function AppMockup() {
  return (
    <div className="rounded-xl overflow-hidden border border-border/70 shadow-2xl shadow-black/15 bg-card">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/60 border-b border-border/60">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-destructive/50" />
          <div className="h-3 w-3 rounded-full bg-accent-amber/50" />
          <div className="h-3 w-3 rounded-full bg-accent-success/50" />
        </div>
        <div className="flex-1 mx-4 h-6 rounded-md bg-background/80 border border-border/50 flex items-center px-3">
          <span className="text-xs text-muted-foreground">app.veille.io</span>
        </div>
      </div>

      {/* App layout */}
      <div className="flex h-[380px] text-xs">
        {/* Left sidebar */}
        <div className="w-[200px] shrink-0 bg-card/80 border-r border-border/50 flex flex-col p-2 gap-0.5">
          <div className="flex items-center gap-2 px-2 py-2 mb-1">
            <Logo size="sm" showText />
          </div>
          <div className="px-2.5 py-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-accent flex items-center gap-2">
            <span className="h-3.5 w-3.5 opacity-60">＋</span> New Agent
          </div>
          <div className="mt-2 mb-1 px-2 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">Recent</div>
          {[
            { label: 'Nike Brand Agent', active: true },
            { label: 'Adidas Tracker', active: false },
            { label: 'Campaign Analyst', active: false },
            { label: 'Sentiment Monitor', active: false },
          ].map(({ label, active }) => (
            <div
              key={label}
              className={`px-2.5 py-1.5 rounded-md text-[11px] truncate ${
                active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
              }`}
            >
              {label}
            </div>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-2 px-2 py-2 border-t border-border/40 mt-1">
            <div className="h-6 w-6 rounded-full bg-accent-vibrant/20 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-accent-vibrant">S</span>
            </div>
            <span className="text-[11px] text-muted-foreground">sarah@brand.co</span>
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex-1 flex flex-col p-3 gap-2.5 overflow-hidden bg-background/50">
          <div className="text-[10px] font-medium text-muted-foreground/60 pb-1 border-b border-border/30">
            Nike Brand Agent
          </div>
          <div className="self-end max-w-[75%] bg-primary text-primary-foreground rounded-xl rounded-tr-sm px-3 py-2 text-[11px]">
            Track Nike brand mentions on Instagram and Reddit this week
          </div>
          <div className="self-start flex items-center gap-1.5 text-[10px] text-muted-foreground/70 bg-muted/50 rounded-lg px-2.5 py-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-accent-vibrant animate-pulse" />
            Collecting from Instagram · Reddit…
          </div>
          <div className="self-start max-w-[82%] bg-card border border-border/50 rounded-xl rounded-tl-sm px-3 py-2 text-[11px] space-y-1.5">
            <p className="font-medium text-foreground">Found 2,847 Nike mentions this week.</p>
            <p className="text-muted-foreground leading-relaxed">
              Sentiment: <span className="text-accent-success font-medium">68% positive</span>,{' '}
              <span className="text-muted-foreground font-medium">22% neutral</span>,{' '}
              <span className="text-destructive font-medium">10% negative</span>. Top theme: Air Max launch (+↑42%).
            </p>
          </div>
          <div className="self-end max-w-[65%] bg-primary text-primary-foreground rounded-xl rounded-tr-sm px-3 py-2 text-[11px]">
            Build me a sentiment dashboard
          </div>
          <div className="self-start flex items-center gap-1.5 text-[10px] text-muted-foreground/70 bg-muted/50 rounded-lg px-2.5 py-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-accent-amber animate-pulse" />
            Building dashboard…
          </div>
        </div>

        {/* Right analytics panel */}
        <div className="w-[210px] shrink-0 border-l border-border/50 p-3 flex flex-col gap-3 bg-background/30">
          <div className="text-[11px] font-semibold text-foreground">Brand Sentiment</div>
          <div className="space-y-2">
            {[
              { label: 'Positive', pct: 68, cls: 'bg-accent-success' },
              { label: 'Neutral', pct: 22, cls: 'bg-muted-foreground/40' },
              { label: 'Negative', pct: 10, cls: 'bg-destructive/70' },
            ].map(({ label, pct, cls }) => (
              <div key={label}>
                <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                  <span>{label}</span><span>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-muted/40 border border-border/40 p-2.5">
            <div className="text-[10px] text-muted-foreground mb-1.5">Weekly mentions</div>
            <div className="flex items-end gap-0.5 h-14">
              {[38, 52, 44, 68, 82, 61, 90].map((h, i) => (
                <div key={i} className="flex-1 rounded-sm bg-accent-vibrant/60" style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1">
              <span>Mon</span><span>Sun</span>
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 border border-border/40 p-2.5">
            <div className="text-[10px] text-muted-foreground mb-2">Top sources</div>
            <div className="space-y-1.5">
              {[
                { platform: 'instagram', label: 'Instagram', count: '1.2k' },
                { platform: 'reddit', label: 'Reddit', count: '843' },
              ].map(({ platform, label, count }) => (
                <div key={platform} className="flex items-center gap-1.5">
                  <PlatformIcon platform={platform} className="h-3 w-3" />
                  <span className="text-[10px] text-muted-foreground flex-1">{label}</span>
                  <span className="text-[10px] font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

// Feature data — direction used for the scroll-in animation per card
const FEATURES: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  desc: string;
  dir: AnimDir;
}[] = [
  {
    icon: <Bot className="h-5 w-5 text-accent-vibrant" />,
    iconBg: 'bg-accent-vibrant/10',
    title: 'Always-On Agents',
    desc: 'Deploy AI agents that monitor brand mentions, hashtags, and keywords around the clock across every major social platform.',
    dir: 'left',
  },
  {
    icon: <Zap className="h-5 w-5 text-accent-amber" />,
    iconBg: 'bg-accent-amber/10',
    title: 'Zero Configuration',
    desc: 'Just describe what you want in plain English. Your agent automatically configures data collection, runs analysis, and builds reports.',
    dir: 'up',
  },
  {
    icon: <BarChart3 className="h-5 w-5 text-accent-blue" />,
    iconBg: 'bg-accent-blue/10',
    title: 'Instant Dashboards & Reports',
    desc: 'Agents generate charts, summaries, and presentations automatically. Share polished findings with your team in one click.',
    dir: 'right',
  },
  {
    icon: <Bell className="h-5 w-5 text-accent-pink" />,
    iconBg: 'bg-accent-pink/10',
    title: 'Crisis Detection',
    desc: 'Your agents alert you the moment a negative trend emerges. Respond to issues before they become brand-damaging crises.',
    dir: 'left',
  },
  {
    icon: <TrendingUp className="h-5 w-5 text-accent-success" />,
    iconBg: 'bg-accent-success/10',
    title: 'Competitor Intelligence',
    desc: "Agents track how you stack up against competitors. Understand who's winning the conversation and discover gaps to exploit.",
    dir: 'up',
  },
  {
    icon: <Shield className="h-5 w-5 text-chart-5" />,
    iconBg: 'bg-chart-5/10',
    title: 'Research → Monitoring',
    desc: 'Every one-time analysis becomes automated monitoring with one click. Turn any question into a recurring agent.',
    dir: 'right',
  },
];

export function LandingPage() {
  const { signIn, signInWithMicrosoft } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'microsoft' | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  const handleSignIn = async (provider: 'google' | 'microsoft') => {
    if (loadingProvider) return;
    setLoadingProvider(provider);
    try {
      if (provider === 'google') await signIn();
      else await signInWithMicrosoft();
    } catch {
      // handled internally (popup closed, etc.)
    } finally {
      setLoadingProvider(null);
    }
  };

  // Hero entrance (mount-based, not scroll-based)
  const heroFade = (delay: number) =>
    `transition-all duration-700 ease-out ${delay ? `[transition-delay:${delay}ms]` : ''} ${
      mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
    }`;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── Decorative blobs ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none">
        <div className="absolute -top-[20%] right-[5%] w-[50vw] h-[50vw] max-w-[700px] max-h-[700px] rounded-full bg-accent-vibrant/6 blur-[120px]" />
        <div className="absolute top-[35%] -left-[15%] w-[45vw] h-[45vw] max-w-[600px] max-h-[600px] rounded-full bg-accent-pink/5 blur-[100px]" />
        <div className="absolute bottom-[5%] right-[15%] w-[35vw] h-[35vw] max-w-[500px] max-h-[500px] rounded-full bg-accent-blue/5 blur-[80px]" />
      </div>

      {/* ── NAVBAR ── */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo size="sm" />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSignIn('google')}
              disabled={loadingProvider !== null}
            >
              Sign in
            </Button>
            <Button
              size="sm"
              className="gap-1.5 shadow-sm"
              onClick={() => handleSignIn('google')}
              disabled={loadingProvider !== null}
            >
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── HERO (side-by-side) ── */}
      <section className="relative pt-20 pb-16 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left column — text */}
          <div>
            <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium mb-8 bg-accent-vibrant/10 text-accent-vibrant border border-accent-vibrant/20 ${heroFade(0)}`}>
              <Sparkles className="h-3.5 w-3.5" />
              AI agents for social brand intelligence
            </div>
            <h1 className={`text-5xl sm:text-6xl font-bold tracking-tight leading-[1.06] mb-6 ${heroFade(80)}`}>
              Your brand is being
              <br />talked about.
              <br />
              <span className="bg-gradient-to-r from-accent-vibrant to-accent-blue bg-clip-text text-transparent">
                Are you listening?
              </span>
            </h1>
            <p className={`text-lg text-muted-foreground max-w-xl leading-relaxed mb-10 ${heroFade(160)}`}>
              Deploy AI agents that monitor your brand across Instagram, TikTok, Reddit, X, and YouTube in real time.
              Just describe your goal — your agents collect, analyze sentiment, and surface what matters.
            </p>
            <div className={`flex flex-col sm:flex-row items-start gap-3 mb-3 ${heroFade(240)}`}>
              <Button
                size="lg"
                className="h-12 px-8 gap-2.5 text-base w-full sm:w-auto shadow-lg shadow-accent-vibrant/25"
                onClick={() => handleSignIn('google')}
                disabled={loadingProvider !== null}
              >
                <GoogleIcon className="h-5 w-5" />
                {loadingProvider === 'google' ? 'Signing in…' : 'Continue with Google'}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-8 gap-2.5 text-base w-full sm:w-auto"
                onClick={() => handleSignIn('microsoft')}
                disabled={loadingProvider !== null}
              >
                <MicrosoftIcon className="h-5 w-5" />
                {loadingProvider === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
              </Button>
            </div>
          </div>

          {/* Right column — app mockup */}
          <div className={heroFade(340)}>
            <AppMockup />
          </div>
        </div>
      </section>

      {/* ── PLATFORMS ── */}
      <section className="py-14 border-y border-border/50 overflow-hidden">
        <div className="max-w-4xl mx-auto px-6">
          <AnimateIn direction="fade" className="text-center mb-8">
            <p className="text-xs text-muted-foreground/70 uppercase tracking-widest font-medium">
              Your agents monitor every major platform
            </p>
          </AnimateIn>
          <div className="flex items-center justify-center gap-8 md:gap-14 flex-wrap">
            {([
              { platform: 'instagram', label: 'Instagram' },
              { platform: 'tiktok',    label: 'TikTok' },
              { platform: 'twitter',   label: 'X / Twitter' },
              { platform: 'reddit',    label: 'Reddit' },
              { platform: 'youtube',   label: 'YouTube' },
            ] as const).map(({ platform, label }, i) => (
              <AnimateIn key={platform} direction="up" delay={i * 80}>
                <div className="flex flex-col items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
                  <PlatformIcon platform={platform} className="h-7 w-7" />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="py-20 px-6 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <AnimateIn direction="up" className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Your AI-powered social media analysts
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Deploy agents that work around the clock to track, analyze, and report on what people are saying about your brand.
            </p>
          </AnimateIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon, iconBg, title, desc, dir }, i) => (
              <AnimateIn key={title} direction={dir} delay={Math.floor(i / 3) * 100}>
                <FeatureCard icon={icon} iconBg={iconBg} title={title} desc={desc} />
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-20 px-6 bg-muted/20 border-y border-border/40 overflow-hidden">
        <div className="max-w-4xl mx-auto">
          <AnimateIn direction="up" className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How it works</h2>
            <p className="text-muted-foreground text-lg">From idea to insight in under a minute.</p>
          </AnimateIn>

          <div className="grid md:grid-cols-3 gap-10 relative">
            {/* Connector line — fades in after steps */}
            <AnimateIn direction="fade" delay={400} className="hidden md:block absolute top-8 left-[calc(33%+2rem)] right-[calc(33%+2rem)] h-px bg-gradient-to-r from-accent-vibrant/30 via-accent-vibrant/60 to-accent-vibrant/30" />

            <AnimateIn direction="left" delay={0}>
              <StepCard
                number="01"
                title="Describe your goal"
                desc="Tell Veille what you want to track — a brand, campaign, competitor, or keyword. Your agent handles the rest."
              />
            </AnimateIn>

            <AnimateIn direction="scale" delay={150}>
              <StepCard
                number="02"
                title="Agent collects and analyzes"
                desc="Your agent gathers relevant posts from across social platforms and runs deep sentiment and trend analysis automatically."
              />
            </AnimateIn>

            <AnimateIn direction="right" delay={0}>
              <StepCard
                number="03"
                title="Get insights instantly"
                desc="Receive interactive charts, written summaries, and shareable reports in seconds. Set up ongoing monitoring with one click."
              />
            </AnimateIn>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="py-16 px-6 overflow-hidden">
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-8">
          {[
            { number: '50M+',  label: 'Posts analyzed' },
            { number: '15+',   label: 'Social platforms' },
            { number: '< 60s', label: 'Time to first insight' },
          ].map(({ number, label }, i) => (
            <AnimateIn key={label} direction="up" delay={i * 120}>
              <StatItem number={number} label={label} />
            </AnimateIn>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-24 px-6 border-t border-border/50 overflow-hidden">
        <AnimateIn direction="scale" threshold={0.2} className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium mb-8 bg-accent-vibrant/10 text-accent-vibrant border border-accent-vibrant/20">
            <Sparkles className="h-3.5 w-3.5" />
            Get started today
          </div>
          <h2 className="text-3xl md:text-5xl font-bold leading-tight mb-6">
            Your audience is talking.
            <br />
            <span className="text-muted-foreground">Deploy your agents.</span>
          </h2>
          <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
            Join brands using Veille to understand their social presence, track competitors,
            and stay ahead of trends — all powered by AI agents.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              className="h-12 px-10 gap-2.5 text-base shadow-lg shadow-accent-vibrant/20 w-full sm:w-auto"
              onClick={() => handleSignIn('google')}
              disabled={loadingProvider !== null}
            >
              <GoogleIcon className="h-5 w-5" />
              {loadingProvider === 'google' ? 'Signing in…' : 'Get started with Google'}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-10 gap-2.5 text-base w-full sm:w-auto"
              onClick={() => handleSignIn('microsoft')}
              disabled={loadingProvider !== null}
            >
              <MicrosoftIcon className="h-5 w-5" />
              {loadingProvider === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
            </Button>
          </div>
        </AnimateIn>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border/50 px-6 py-8">
        <AnimateIn direction="fade">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <Logo size="sm" />
            <p>&copy; 2026 Veille. All rights reserved.</p>
            <div className="flex gap-6">
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
              <a href="#" className="hover:text-foreground transition-colors">Contact</a>
            </div>
          </div>
        </AnimateIn>
      </footer>
    </div>
  );
}
