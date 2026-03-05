import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Button } from '../../components/ui/button.tsx';

const CHART_STYLES = [
  { value: 'bar chart', label: 'Bar Chart' },
  { value: 'pie chart', label: 'Pie / Donut' },
  { value: 'line chart', label: 'Line Chart' },
  { value: 'table', label: 'Table' },
] as const;

const METRICS = [
  { value: 'post count', label: 'Post Count' },
  { value: 'views', label: 'Views' },
  { value: 'likes', label: 'Likes' },
  { value: 'comments', label: 'Comments' },
  { value: 'shares', label: 'Shares' },
] as const;

const GROUP_BY = [
  { value: 'sentiment', label: 'Sentiment' },
  { value: 'theme', label: 'Theme / Topic' },
  { value: 'platform', label: 'Platform' },
  { value: 'content type', label: 'Content Type' },
  { value: 'language', label: 'Language' },
  { value: 'channel', label: 'Channel' },
  { value: 'entity', label: 'Entity' },
  { value: 'date', label: 'Date' },
] as const;

interface ChartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
}

export function ChartDialog({ open, onOpenChange, onSubmit }: ChartDialogProps) {
  const [style, setStyle] = useState('');
  const [metric, setMetric] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [instructions, setInstructions] = useState('');

  function handleSubmit() {
    const parts: string[] = ['Create a'];

    if (style) parts.push(style);
    else parts.push('chart');

    if (metric) parts.push(`showing ${metric}`);
    if (groupBy) parts.push(`by ${groupBy}`);

    parts.push('for the selected sources.');

    if (instructions.trim()) parts.push(instructions.trim());

    onSubmit(parts.join(' '));
    onOpenChange(false);
  }

  function reset() {
    setStyle('');
    setMetric('');
    setGroupBy('');
    setInstructions('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Chart</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="chart-style">Chart Style</Label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger id="chart-style">
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                {CHART_STYLES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="chart-metric">Metric</Label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger id="chart-metric">
                <SelectValue placeholder="Post Count" />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="chart-group">Group By</Label>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger id="chart-group">
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                {GROUP_BY.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="chart-instructions">Additional Instructions</Label>
            <Textarea
              id="chart-instructions"
              placeholder="e.g. only positive sentiment, last 7 days..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
