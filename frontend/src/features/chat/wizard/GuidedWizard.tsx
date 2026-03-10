import { Search, BarChart3, ArrowLeft, ArrowRight, Play, Loader2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { cn } from '../../../lib/utils.ts';
import type { WizardConfig } from './WizardTypes.ts';
import { useWizard } from './useWizard.ts';
import { TextInputStep } from './steps/TextInputStep.tsx';
import { TagInputStep } from './steps/TagInputStep.tsx';
import { PlatformStep } from './steps/PlatformStep.tsx';
import { TimeRangeStep } from './steps/TimeRangeStep.tsx';
import { CollectionSelectStep } from './steps/CollectionSelectStep.tsx';

interface GuidedWizardProps {
  config: WizardConfig;
  onClose: () => void;
  onSend: (text: string) => void;
}

export function GuidedWizard({ config, onClose, onSend }: GuidedWizardProps) {
  const wizard = useWizard({ config, onSend });

  const Icon = config.icon === 'search' ? Search : BarChart3;

  const handleNextOrSubmit = () => {
    if (wizard.isLastStep) {
      wizard.submit();
    } else {
      wizard.goNext();
    }
  };

  const renderStep = () => {
    const step = wizard.currentStepDef;
    switch (step.component) {
      case 'text_input':
        return (
          <TextInputStep
            data={wizard.data}
            updateData={wizard.updateData}
            stepProps={step.props}
            onNext={handleNextOrSubmit}
          />
        );
      case 'tag_input':
        return (
          <TagInputStep
            data={wizard.data}
            updateData={wizard.updateData}
            stepProps={step.props}
          />
        );
      case 'platform_select':
        return (
          <PlatformStep
            data={wizard.data}
            updateData={wizard.updateData}
          />
        );
      case 'time_range':
        return (
          <TimeRangeStep
            data={wizard.data}
            updateData={wizard.updateData}
            stepProps={step.props}
          />
        );
      case 'collection_select':
        return (
          <CollectionSelectStep
            data={wizard.data}
            updateData={wizard.updateData}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="rounded-2xl border border-accent-vibrant/20 bg-gradient-to-b from-accent-vibrant/5 to-background shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-vibrant/10">
              <Icon className="h-3.5 w-3.5 text-accent-vibrant" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{config.title}</h3>
              <p className="text-[11px] text-muted-foreground">
                Step {wizard.currentStepIndex + 1} of {wizard.totalSteps}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {config.steps.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    i === wizard.currentStepIndex
                      ? 'w-4 bg-foreground'
                      : i < wizard.currentStepIndex
                        ? 'w-1.5 bg-foreground/40'
                        : 'w-1.5 bg-foreground/15',
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Step content */}
        <div className="px-5 py-5" key={wizard.currentStepIndex}>
          {renderStep()}
        </div>

        {/* Error */}
        {wizard.error && (
          <div className="px-5 pb-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {wizard.error}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/30 px-5 py-3.5">
          <div>
            {wizard.currentStepIndex > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={wizard.goBack}
                disabled={wizard.submitting}
                className="gap-1.5 text-xs"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
          </div>

          <Button
            size="sm"
            onClick={handleNextOrSubmit}
            disabled={!wizard.canGoNext || wizard.submitting}
            className="gap-1.5 text-xs"
          >
            {wizard.submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Starting...
              </>
            ) : wizard.isLastStep ? (
              config.category === 'collect' ? (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Start Collection
                </>
              ) : (
                <>
                  <ArrowRight className="h-3.5 w-3.5" />
                  Analyze
                </>
              )
            ) : (
              <>
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
