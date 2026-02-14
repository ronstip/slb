import { useState, useRef, useEffect } from 'react';
import { Play, Edit2, CheckCircle2 } from 'lucide-react';
import type { DesignResearchResult } from '../../../api/types.ts';
import { PLATFORM_LABELS } from '../../../lib/constants.ts';
import { CollectionForm } from '../../sources/CollectionForm.tsx';
import { Card } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';

interface ResearchDesignCardProps {
  data: DesignResearchResult;
}

export function ResearchDesignCard({ data }: ResearchDesignCardProps) {
  const [formVisible, setFormVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formVisible && formContainerRef.current) {
      requestAnimationFrame(() => {
        formContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [formVisible]);

  return (
    <Card className="mt-3 border-primary/15 bg-accent/30 p-4">
      <h4 className="text-sm font-semibold text-foreground">Research Design</h4>

      <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        <div className="flex gap-2">
          <span className="text-muted-foreground/60">Platforms:</span>
          <span>{data.summary.platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ')}</span>
        </div>
        {data.summary.keywords.length > 0 && (
          <div className="flex gap-2">
            <span className="text-muted-foreground/60">Keywords:</span>
            <span>{data.summary.keywords.join(', ')}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="text-muted-foreground/60">Time range:</span>
          <span>{data.summary.time_range}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground/60">Estimated:</span>
          <span>
            ~{data.summary.estimated_posts} posts · ~{data.summary.estimated_time_minutes} min
          </span>
        </div>
      </div>

      {!formVisible && !submitted && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => setFormVisible(true)} className="h-7 gap-1.5 text-xs">
            <Play className="h-3 w-3" />
            Start Collection
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFormVisible(true)}
            className="h-7 gap-1.5 text-xs"
          >
            <Edit2 className="h-3 w-3" />
            Edit
          </Button>
        </div>
      )}

      {formVisible && !submitted && (
        <div ref={formContainerRef} className="mt-3 rounded-xl border border-border bg-card">
          <CollectionForm
            prefill={data.config}
            onClose={() => setFormVisible(false)}
            variant="inline"
            onSubmitSuccess={() => setSubmitted(true)}
          />
        </div>
      )}

      {submitted && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-status-complete/30 bg-status-complete/5 px-3 py-2 text-xs text-status-complete">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Collection started successfully.
        </div>
      )}
    </Card>
  );
}
