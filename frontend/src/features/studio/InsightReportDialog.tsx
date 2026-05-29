import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Button } from '../../components/ui/button.tsx';
import { INSIGHT_REPORT_PROMPT } from './insight-report-prompt.ts';

interface InsightReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
}

export function InsightReportDialog({ open, onOpenChange, onSubmit }: InsightReportDialogProps) {
  const [framing, setFraming] = useState('');

  function handleSubmit() {
    const trimmed = framing.trim();
    const userBlock = trimmed
      ? `**User-supplied framing for this session:**\n${trimmed}\n\nTreat this framing as the anchoring-event lens for the entire brief. The anchoring event named in the header, the coined concept introduced in §1, the strength→weakness narratives in §3, and the operative recommendations in §4 should all flow from this framing. **Verify the event date via web grounding before writing — the corpus post date is NOT the event date.** If the data does not support the user's framing, say so directly rather than forcing the analysis to fit.`
      : `**No user-supplied framing.** Infer the anchoring event by scanning window_metrics / daily_metrics for the highest-density time window in the corpus and identifying the event from sample posts in that window. Then verify the event date via web grounding before writing anything.`;

    onSubmit(`${INSIGHT_REPORT_PROMPT}\n\n---\n\n${userBlock}`);
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) setFraming('');
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Insight Report</DialogTitle>
          <DialogDescription>
            Generates a senior strategist's memo anchored on a specific event — coined-concept §1 bottom line, three-bullet numbers picture, strength→weakness narrative diagnosis, operative recommendations with verbatim slogans, and a receipts appendix. The more specific the anchoring event and framing, the sharper the brief.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="insight-report-framing">What's the anchoring event and framing?</Label>
            <Textarea
              id="insight-report-framing"
              placeholder="e.g. Uvda profile of Eisenkot aired 2026-05-22, 39h window around broadcast; focus on whether the human-portrait framing landed or backfired against rivals' attack vectors. Coin one concept for the central tension."
              value={framing}
              onChange={(e) => setFraming(e.target.value)}
              rows={6}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Optional, but strongly recommended. Leave blank to let the agent infer the anchoring event from the densest window in the data.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Create Insight Report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
