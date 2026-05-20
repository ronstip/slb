import { useState, useCallback } from 'react';
import type { DashboardOrientation } from '../features/studio/dashboard/types-social-dashboard.ts';

interface UseSharePageActionsArgs {
  title: string;
  getTarget: () => HTMLElement | null;
  orientation?: DashboardOrientation;
}

export function useSharePageActions({
  title,
  getTarget,
  orientation = 'horizontal',
}: UseSharePageActionsArgs) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDownload = useCallback(async () => {
    const el = getTarget();
    if (!el) return;
    setDownloading(true);
    try {
      const { exportDashboardPdf } = await import(
        '../features/studio/dashboard/exportDashboardPdf.ts'
      );
      await exportDashboardPdf(el, title, orientation);
    } finally {
      setDownloading(false);
    }
  }, [getTarget, title, orientation]);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // User dismissed the native sheet — don't fall through to copy.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — nothing actionable */
    }
  }, [title]);

  return { downloading, copied, handleDownload, handleShare };
}
