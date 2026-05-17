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
import { CREATE_REPORT_PROMPT } from './create-report-prompt.ts';

interface CreateReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
}

export function CreateReportDialog({ open, onOpenChange, onSubmit }: CreateReportDialogProps) {
  const [framing, setFraming] = useState('');

  function handleSubmit() {
    const trimmed = framing.trim();
    const userBlock = trimmed
      ? `**User-supplied framing for this session:**\n${trimmed}\n\nTreat this framing as the primary lens. The thesis sentence at the top of the report, the three contrarian findings in "What you'd miss", which Battle-Map cells get flagged as critical, and the argument of the longread should all flow from this framing. If the data does not support the user's framing, say so directly rather than forcing the analysis to fit.`
      : `**No user-supplied framing.** Infer the strategic question from the agent's data scope and proceed.`;

    onSubmit(`${CREATE_REPORT_PROMPT}\n\n---\n\n${userBlock}`);
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
          <DialogTitle>Create Report</DialogTitle>
          <DialogDescription>
            Generates <em>The Brief</em> — a strategist's memo with a one-sentence thesis, three contrarian findings, a risk/opportunity battle map, three shippable moves with sample copy, and a 1,500–2,000 word longread, backed by supporting tables. The more specific the framing, the sharper the thesis.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="create-report-framing">What kind of report?</Label>
            <Textarea
              id="create-report-framing"
              placeholder="e.g. weekly intel — week of 2026-05-04 → 2026-05-11, focus on Bennett's positioning vs Netanyahu, Smotrich, Ben-Gvir; the thesis should land on whether the mental-fitness frame has consolidated, and what to ship on Monday"
              value={framing}
              onChange={(e) => setFraming(e.target.value)}
              rows={6}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Optional, but strongly recommended. Leave blank to let the agent infer the question from the data scope.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Create Report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
