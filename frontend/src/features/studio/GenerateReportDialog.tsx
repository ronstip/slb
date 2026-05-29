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
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group.tsx';
import {
  REPORT_TYPES,
  DEFAULT_REPORT_TYPE_ID,
  getReportType,
  type ReportTypeId,
} from './report-types.ts';
import { cn } from '../../lib/utils.ts';

interface GenerateReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
}

export function GenerateReportDialog({ open, onOpenChange, onSubmit }: GenerateReportDialogProps) {
  const [typeId, setTypeId] = useState<ReportTypeId>(DEFAULT_REPORT_TYPE_ID);
  const [framing, setFraming] = useState('');

  const selected = getReportType(typeId);

  function handleSubmit() {
    const userBlock = selected.buildFramingBlock(framing.trim());
    onSubmit(`${selected.basePrompt}\n\n---\n\n${userBlock}`);
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFraming('');
      setTypeId(DEFAULT_REPORT_TYPE_ID);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate Report</DialogTitle>
          <DialogDescription>
            Pick the report type, then describe the framing. The more specific the framing, the sharper the output.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label>Report type</Label>
            <RadioGroup
              value={typeId}
              onValueChange={(v) => setTypeId(v as ReportTypeId)}
              className="grid gap-2"
            >
              {REPORT_TYPES.map((t) => {
                const isSelected = t.id === typeId;
                return (
                  <label
                    key={t.id}
                    htmlFor={`report-type-${t.id}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                      isSelected
                        ? 'border-foreground/40 bg-muted/40'
                        : 'border-border hover:bg-muted/30',
                    )}
                  >
                    <RadioGroupItem id={`report-type-${t.id}`} value={t.id} className="mt-1" />
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-block h-2 w-2 rounded-full', t.swatchClass)} />
                        <span className="text-sm font-semibold">{t.label}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="generate-report-framing">Framing / instructions</Label>
            <Textarea
              id="generate-report-framing"
              placeholder={selected.framingPlaceholder}
              value={framing}
              onChange={(e) => setFraming(e.target.value)}
              rows={5}
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
          <Button onClick={handleSubmit}>Generate {selected.label}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
