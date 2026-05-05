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
import { STRATEGIC_PLANNING_PROMPT } from './strategic-planning-prompt.ts';

interface StrategicPlanningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
}

export function StrategicPlanningDialog({ open, onOpenChange, onSubmit }: StrategicPlanningDialogProps) {
  const [framing, setFraming] = useState('');

  function handleSubmit() {
    const trimmed = framing.trim();
    const userBlock = trimmed
      ? `**User-supplied framing for this session:**\n${trimmed}\n\nTreat this framing as the primary lens. Every section, every finding, every recommendation must connect back to it. If the data does not support the user's framing, say so directly rather than forcing the analysis to fit.`
      : `**No user-supplied framing.** Infer the strategic question from the agent's data scope and proceed.`;

    onSubmit(`${STRATEGIC_PLANNING_PROMPT}\n\n---\n\n${userBlock}`);
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
          <DialogTitle>Strategic Planning</DialogTitle>
          <DialogDescription>
            Describe the kind of strategic planning you need. The more specific the framing, the sharper the report.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="planning-framing">What kind of strategic planning?</Label>
            <Textarea
              id="planning-framing"
              placeholder="e.g. competitive positioning vs. peers ahead of Q3 launch — what should we own, what should we cede, what to watch for in the next 30 days"
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
          <Button onClick={handleSubmit}>Run Strategic Planning</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
