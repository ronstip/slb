import { ArrowRight, Check, Loader2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { useGuidedFlowStore } from '../../../stores/guided-flow-store.ts';
import type { WizardStepCardData } from '../../../stores/guided-flow-store.ts';
import { TextInputStep } from '../wizard/steps/TextInputStep.tsx';
import { TagInputStep } from '../wizard/steps/TagInputStep.tsx';
import { PlatformStep } from '../wizard/steps/PlatformStep.tsx';
import { TimeRangeStep } from '../wizard/steps/TimeRangeStep.tsx';
import { CollectionSelectStep } from '../wizard/steps/CollectionSelectStep.tsx';

function CompletedStepSummary({ summary }: { summary: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-foreground/5 px-3 py-2">
      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      <span className="text-sm text-muted-foreground">{summary}</span>
    </div>
  );
}

function canAdvanceStep(component: string, data: { primaryInput: string; keywords: string[]; platforms: string[]; selectedCollectionIds: string[] }): boolean {
  switch (component) {
    case 'text_input':
      return data.primaryInput.trim().length > 0;
    case 'tag_input':
      return data.keywords.length > 0;
    case 'platform_select':
      return data.platforms.length > 0;
    case 'time_range':
      return true;
    case 'collection_select':
      return data.selectedCollectionIds.length > 0;
    default:
      return true;
  }
}

export function WizardStepCard({ data: cardData }: { data: WizardStepCardData }) {
  const flowData = useGuidedFlowStore((s) => s.data);
  const updateData = useGuidedFlowStore((s) => s.updateData);
  const advanceStep = useGuidedFlowStore((s) => s.advanceStep);
  const cancelFlow = useGuidedFlowStore((s) => s.cancelFlow);
  const submitting = useGuidedFlowStore((s) => s.submitting);
  const error = useGuidedFlowStore((s) => s.error);

  if (cardData.status === 'completed') {
    return <CompletedStepSummary summary={cardData.summary || ''} />;
  }

  const stepDef = cardData.stepDef;
  const isLastStep = cardData.stepIndex === cardData.totalSteps - 1;
  const canAdvance = canAdvanceStep(stepDef.component, flowData);

  const handleAdvance = () => {
    if (canAdvance && !submitting) advanceStep();
  };

  const renderStep = () => {
    switch (stepDef.component) {
      case 'text_input':
        return (
          <TextInputStep
            data={flowData}
            updateData={updateData}
            stepProps={stepDef.props}
            onNext={handleAdvance}
          />
        );
      case 'tag_input':
        return (
          <TagInputStep
            data={flowData}
            updateData={updateData}
            stepProps={stepDef.props}
          />
        );
      case 'platform_select':
        return (
          <PlatformStep
            data={flowData}
            updateData={updateData}
          />
        );
      case 'time_range':
        return (
          <TimeRangeStep
            data={flowData}
            updateData={updateData}
            stepProps={stepDef.props}
          />
        );
      case 'collection_select':
        return (
          <CollectionSelectStep
            data={flowData}
            updateData={updateData}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="mt-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="rounded-xl border border-border/60 bg-card/50 p-4">
        {renderStep()}

        {error && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={cancelFlow}
            className="flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>

          <Button
            size="sm"
            onClick={handleAdvance}
            disabled={!canAdvance || submitting}
            className="gap-1.5 text-xs"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Starting...
              </>
            ) : isLastStep ? (
              <>
                <ArrowRight className="h-3.5 w-3.5" />
                Start Collection
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Step progress dots */}
      {cardData.totalSteps > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {Array.from({ length: cardData.totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === cardData.stepIndex
                  ? 'w-4 bg-foreground'
                  : i < cardData.stepIndex
                    ? 'w-1.5 bg-foreground/40'
                    : 'w-1.5 bg-foreground/15'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
