import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from './ui/button.tsx';
import {
  isAnalyticsActive,
  getStoredConsent,
  grantAnalyticsConsent,
  denyAnalyticsConsent,
  trackPageView,
} from '../lib/analytics.ts';

/**
 * Cookie-consent gate for GA4 (Consent Mode v2).
 *
 * gtag boots with all storage denied (see lib/analytics.ts), so no analytics
 * cookies are set and no behavioural hits fire until the visitor accepts here.
 * The choice persists in localStorage; the banner only renders when GA is
 * actually live AND no choice has been made yet.
 *
 * On accept we also send the *current* page_view immediately, because the
 * router's initial page_view earlier in this session was suppressed by the
 * denied consent state.
 */
export function ConsentBanner() {
  const location = useLocation();
  // Decided once on mount: GA live + no stored choice. We don't reactively
  // re-check storage; the button handlers drive the dismissal via local state.
  const [open, setOpen] = useState(
    () => isAnalyticsActive() && getStoredConsent() === null,
  );

  if (!open) return null;

  const accept = () => {
    grantAnalyticsConsent();
    trackPageView(location.pathname + location.search);
    setOpen(false);
  };

  const decline = () => {
    denyAnalyticsConsent();
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-border bg-background/95 px-4 py-3 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.25)] backdrop-blur-sm sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-md sm:rounded-xl sm:border"
    >
      <div className="flex flex-col gap-3 sm:gap-2.5">
        <p className="text-sm text-muted-foreground">
          We use analytics cookies to understand how Scolto is used and improve
          it. No ads, no selling your data.{' '}
          <Link to="/privacy" className="underline hover:text-foreground">
            Privacy
          </Link>
          .
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={decline}>
            Decline
          </Button>
          <Button size="sm" onClick={accept}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
