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
import { DASHBOARD_REPORT_PROMPT } from './dashboard-report-prompt.ts';

interface DashboardReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
}

export function DashboardReportDialog({ open, onOpenChange, onSubmit }: DashboardReportDialogProps) {
  const [framing, setFraming] = useState('');

  function handleSubmit() {
    const trimmed = framing.trim();
    const userBlock = trimmed
      ? `**User-supplied framing for this session:**\n${trimmed}\n\nTreat this framing as the primary lens. Every section, every finding, every recommendation must connect back to it. If the data does not support the user's framing, say so directly rather than forcing the analysis to fit.`
      : `**No user-supplied framing.** Infer the strategic question from the agent's data scope and proceed.`;

    onSubmit(`${DASHBOARD_REPORT_PROMPT}\n\n---\n\n${userBlock}`);
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
          <DialogTitle>Dashboard Report</DialogTitle>
          <DialogDescription>
            Describe the framing for this report. The agent will generate a full live dashboard from a template, iterating section by section. The more specific the framing, the sharper the report.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="dashboard-report-framing">What kind of dashboard report?</Label>
            <Textarea
              id="dashboard-report-framing"
              placeholder="e.g. weekly competitive brand report — week of 2026-05-04 → 2026-05-11, focus on Bennett's positioning vs Netanyahu, Smotrich, Ben-Gvir, and the Eisenkot/Liberman flank"
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
          <Button onClick={handleSubmit}>Run Dashboard Report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
