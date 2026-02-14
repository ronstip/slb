import { useAuth } from './useAuth.ts';
import { Sparkles, Zap, Target, TrendingUp, MessageSquare } from 'lucide-react';
import { Button } from '../components/ui/button.tsx';
import { AnimatedBackground } from './AnimatedBackground.tsx';
import { Logo } from '../components/Logo.tsx';

export function SignInPage() {
  const { signIn, signInWithMicrosoft } = useAuth();

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      {/* Main Content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-8 py-6">
          <Logo size="md" />
        </header>

        {/* Hero Section */}
        <main className="flex flex-1 flex-col items-center justify-center px-8 pb-20">
          <div className="mx-auto max-w-4xl text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm backdrop-blur-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">AI-Powered Social Intelligence</span>
            </div>

            {/* Main Headline */}
            <h1 className="mb-6 text-6xl font-bold leading-tight tracking-tight">
              The most intelligent way to
              <br />
              <span className="bg-gradient-to-r from-primary to-chart-5 bg-clip-text text-transparent">
                listen to social media
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mb-12 text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Get professional social insights in minutes with zero learning curve.
              Simply ask a question, and our AI handles data collection, analysis, and ongoing monitoring.
            </p>

            {/* CTA Buttons */}
            <div className="mb-16 flex flex-col items-center gap-4">
              <div className="flex gap-3">
                <Button
                  size="lg"
                  className="gap-2 px-8 text-base h-12 shadow-lg shadow-primary/25"
                  onClick={signIn}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Sign in with Google
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  className="gap-2 px-8 text-base h-12 backdrop-blur-sm bg-card/50"
                  onClick={signInWithMicrosoft}
                >
                  <svg className="h-5 w-5" viewBox="0 0 23 23">
                    <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
                    <path fill="#f35325" d="M1 1h10v10H1z"/>
                    <path fill="#81bc06" d="M12 1h10v10H12z"/>
                    <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                    <path fill="#ffba08" d="M12 12h10v10H12z"/>
                  </svg>
                  Sign in with Microsoft
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                No credit card required • Start analyzing in seconds
              </p>
            </div>

            {/* Value Props Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-6 text-left hover:bg-card/50 transition-colors">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">Conversational Interface</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Just ask questions in plain English. No complex dashboards, filters, or Boolean queries required.
                </p>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-6 text-left hover:bg-card/50 transition-colors">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-chart-2/10">
                  <Zap className="h-5 w-5 text-chart-2" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">Instant Setup</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Get insights in minutes, not weeks. AI automatically configures data collection based on your questions.
                </p>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-6 text-left hover:bg-card/50 transition-colors">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-chart-3/10">
                  <Target className="h-5 w-5 text-chart-3" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">Pay Per Use</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Only pay for what you need. No annual contracts or enterprise licensing. ~$20 per query, $12/mo for monitoring.
                </p>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-6 text-left hover:bg-card/50 transition-colors md:col-span-3">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-chart-5/10">
                  <TrendingUp className="h-5 w-5 text-chart-5" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">Research Becomes Monitoring</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every question can automatically become ongoing monitoring. Track your brand, competitors, and market trends continuously with one click.
                </p>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border/50 backdrop-blur-sm px-8 py-6">
          <div className="mx-auto max-w-6xl flex items-center justify-between text-sm text-muted-foreground">
            <p>© 2026 InsightStream. All rights reserved.</p>
            <div className="flex gap-6">
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
              <a href="#" className="hover:text-foreground transition-colors">Contact</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
