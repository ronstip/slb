import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from '../../../../components/ui/badge.tsx';
import type { WizardData, StepProps } from '../WizardTypes.ts';

interface TextInputStepProps {
  data: WizardData;
  updateData: (partial: Partial<WizardData>) => void;
  stepProps: StepProps;
  onNext: () => void;
}

export function TextInputStep({ data, updateData, stepProps, onNext }: TextInputStepProps) {
  const [tagInput, setTagInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !data.keywords.includes(trimmed)) {
      updateData({ keywords: [...data.keywords, trimmed] });
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    updateData({ keywords: data.keywords.filter((k) => k !== tag) });
  };

  const handleTagKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !tagInput && data.keywords.length > 0) {
      updateData({ keywords: data.keywords.slice(0, -1) });
    }
  };

  const handlePrimaryKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && data.primaryInput.trim()) {
      e.preventDefault();
      onNext();
    }
  };

  return (
    <div className="space-y-5">
      {/* Primary text input */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {stepProps.textLabel}
        </label>
        <input
          ref={inputRef}
          type="text"
          value={data.primaryInput}
          onChange={(e) => updateData({ primaryInput: e.target.value })}
          onKeyDown={handlePrimaryKeyDown}
          placeholder={stepProps.textPlaceholder}
          className="w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Optional tag input */}
      {stepProps.tagLabel && (
        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            {stepProps.tagLabel}
          </label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-2.5 focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-ring">
            {data.keywords.map((kw) => (
              <Badge key={kw} variant="secondary" className="gap-1 bg-foreground/10 text-foreground">
                {kw}
                <button type="button" onClick={() => removeTag(kw)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={addTag}
              placeholder={data.keywords.length === 0 ? stepProps.tagPlaceholder : ''}
              className="min-w-[120px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      )}
    </div>
  );
}
