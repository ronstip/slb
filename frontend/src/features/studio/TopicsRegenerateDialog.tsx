import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import {
  regenerateAgentTopics,
  type RegenerateTopicsBody,
} from '../../api/endpoints/topics.ts';
import type { TopicsRegenerateResult } from '../../api/types.ts';

type Algorithm = 'brothers_v1' | 'llm_taxonomy_v2';

interface TopicsRegenerateDialogProps {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAlgorithm?: Algorithm;
  initialWindowDays?: number;
}

export function TopicsRegenerateDialog({
  agentId,
  open,
  onOpenChange,
  initialAlgorithm = 'llm_taxonomy_v2',
  initialWindowDays = 7,
}: TopicsRegenerateDialogProps) {
  const queryClient = useQueryClient();

  const [algorithm, setAlgorithm] = useState<Algorithm>(initialAlgorithm);
  const [windowDays, setWindowDays] = useState<number>(initialWindowDays);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sampleSize, setSampleSize] = useState<string>('');
  const [batchSize, setBatchSize] = useState<string>('');
  const [saveAsDefault, setSaveAsDefault] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<TopicsRegenerateResult | null>(null);

  const mutation = useMutation({
    mutationFn: async (): Promise<TopicsRegenerateResult> => {
      const body: RegenerateTopicsBody = {
        algorithm_version: algorithm,
        window_days: windowDays,
        save_as_default: saveAsDefault,
      };
      if (sampleSize) body.sample_size = parseInt(sampleSize, 10);
      if (batchSize) body.batch_size = parseInt(batchSize, 10);
      return regenerateAgentTopics(agentId, body);
    },
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ['topics', agentId] });
    },
  });

  const isRunning = mutation.isPending;
  const showLlmFields = algorithm === 'llm_taxonomy_v2';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isRunning) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Regenerate topics</DialogTitle>
          <DialogDescription>
            Replaces the current topic set for this agent. Typical wall time: 30-60s
            for LLM Taxonomy, 60-120s for Brothers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label>Algorithm</Label>
            <RadioGroup
              value={algorithm}
              onValueChange={(v) => setAlgorithm(v as Algorithm)}
              disabled={isRunning}
              className="flex flex-col gap-2"
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="llm_taxonomy_v2" id="alg-llm" className="mt-0.5" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">LLM Taxonomy</span>
                  <span className="text-xs text-muted-foreground">
                    Two-pass Gemini pipeline, news-headline topics with strategic framing.
                    Recommended.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="brothers_v1" id="alg-brothers" className="mt-0.5" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Brothers (embeddings)</span>
                  <span className="text-xs text-muted-foreground">
                    HDBSCAN over embeddings. Larger, broader topics. Original algorithm.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          {showLlmFields && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="window-days">Window (days)</Label>
              <Input
                id="window-days"
                type="number"
                min={1}
                max={90}
                value={windowDays}
                onChange={(e) => setWindowDays(Math.max(1, parseInt(e.target.value || '7', 10)))}
                disabled={isRunning}
              />
              <p className="text-xs text-muted-foreground">
                Posts within this many days of now are eligible for topic clustering.
              </p>
            </div>
          )}

          {showLlmFields && (
            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="text-xs text-muted-foreground hover:text-foreground transition"
                disabled={isRunning}
              >
                {advancedOpen ? '▾' : '▸'} Advanced
              </button>
              {advancedOpen && (
                <div className="flex flex-col gap-3 pl-3 mt-2 border-l border-border">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sample-size" className="text-xs">Sample size</Label>
                    <Input
                      id="sample-size"
                      type="number"
                      min={50}
                      placeholder="default 1000"
                      value={sampleSize}
                      onChange={(e) => setSampleSize(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="batch-size" className="text-xs">Batch size (pass-1)</Label>
                    <Input
                      id="batch-size"
                      type="number"
                      min={10}
                      placeholder="default 100"
                      value={batchSize}
                      onChange={(e) => setBatchSize(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <Label htmlFor="save-default" className="flex flex-col cursor-pointer">
              <span className="text-sm">Save as default</span>
              <span className="text-xs text-muted-foreground">
                Future automatic regenerations will use these settings.
              </span>
            </Label>
            <Switch
              id="save-default"
              checked={saveAsDefault}
              onCheckedChange={setSaveAsDefault}
              disabled={isRunning}
            />
          </div>

          {mutation.isError && (
            <p className="text-xs text-destructive">
              Failed: {(mutation.error as Error).message}
            </p>
          )}

          {lastResult && !mutation.isError && (
            <div className="rounded-md bg-secondary px-3 py-2 text-xs flex flex-col gap-0.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Topics produced</span>
                <span className="font-medium">{lastResult.topics_count}</span>
              </div>
              {lastResult.estimated_pool_count != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated coverage</span>
                  <span className="font-medium">
                    ~{lastResult.estimated_pool_count} of {lastResult.pool_size}
                    {lastResult.estimated_pool_coverage_pct != null
                      ? ` (${lastResult.estimated_pool_coverage_pct.toFixed(0)}%)`
                      : ''}
                  </span>
                </div>
              )}
              {lastResult.wall_sec != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Wall time</span>
                  <span className="font-medium">{lastResult.wall_sec.toFixed(1)}s</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRunning}
          >
            Close
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={isRunning}>
            {isRunning ? 'Running…' : 'Regenerate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
