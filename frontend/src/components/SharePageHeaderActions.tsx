import { Check, Download, Loader2, Share2 } from 'lucide-react';
import { Button } from './ui/button.tsx';

interface SharePageHeaderActionsProps {
  downloading: boolean;
  copied: boolean;
  /** Omit to hide the Download button (e.g. presentation shares — no DOM to capture). */
  onDownload?: () => void;
  onShare: () => void;
}

/** Compact [Download][Share] pair for public share pages. Icon-only on
 *  narrow screens (the typical mobile share viewer); icon + label at `sm`+. */
export function SharePageHeaderActions({
  downloading,
  copied,
  onDownload,
  onShare,
}: SharePageHeaderActionsProps) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {onDownload && (
        <Button
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={downloading}
          className="h-8 gap-1.5 px-2 sm:px-3"
          aria-label="Download as PDF"
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline text-xs">PDF</span>
        </Button>
      )}
      <Button
        size="sm"
        onClick={onShare}
        className="h-8 gap-1.5 px-2 sm:px-3"
        aria-label="Share link"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Share2 className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline text-xs">{copied ? 'Copied' : 'Share'}</span>
      </Button>
    </div>
  );
}
