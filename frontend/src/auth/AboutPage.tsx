import { useNavigate } from 'react-router';
import { useAuth } from './useAuth.ts';
import { Sparkles, Zap, Target, TrendingUp, MessageSquare, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button.tsx';
import { AnimatedBackground } from './AnimatedBackground.tsx';
import { Logo } from '../components/Logo.tsx';

export function AboutPage() {
  const navigate = useNavigate();
  const { isAnonymous, user } = useAuth();
  const isSignedIn = user && !isAnonymous;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      {/* Main Content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-8 py-6">
          <Logo size="md" />
          <Button
            variant="ghost"
            className="gap-2"
            onClick={() => navigate('/')}
          >
            {isSignedIn ? 'Go to App' : 'Try It Free'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </header>

        {/* Hero Section */}
        <main className="flex flex-1 flex-col items-center justify-center px-8 pb-20">
          <div className="mx-auto max-w-4xl text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent-vibrant/20 bg-accent-vibrant/5 px-4 py-1.5 text-sm backdrop-blur-sm">
              <Sparkles className="h-4 w-4 text-accent-vibrant" />
              <span className="text-muted-foreground">AI-Powered Social Intelligence</span>
            </div>

            {/* Main Headline */}
            <h1 className="mb-6 text-6xl font-bold leading-tight tracking-tight">
              The most intelligent way to
              <br />
              <span className="bg-gradient-to-r from-accent-vibrant to-accent-pink bg-clip-text text-transparent">
                listen to social media
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mb-12 text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Get professional social insights in minutes with zero learning curve.
              Simply ask a question, and our AI handles data collection, analysis, and ongoing monitoring.
            </p>

            {/* CTA */}
            <div className="mb-16 flex flex-col items-center gap-4">
              <Button
                size="lg"
                className="gap-2 px-10 text-base h-12 shadow-lg shadow-primary/25"
                onClick={() => navigate('/')}
              >
                {isSignedIn ? 'Go to App' : 'Try It Free'}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <p className="text-sm text-muted-foreground">
                No credit card required &bull; No sign-up needed to start
              </p>
            </div>

            {/* Value Props Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <div className="rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm p-6 text-left hover:bg-card/50 transition-colors">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-vibrant/10">
                  <MessageSquare className="h-5 w-5 text-accent-vibrant" />
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
            <p>&copy; 2026 InsightStream. All rights reserved.</p>
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
