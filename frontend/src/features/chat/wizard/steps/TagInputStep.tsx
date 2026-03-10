import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from '../../../../components/ui/badge.tsx';
import type { WizardData, StepProps } from '../WizardTypes.ts';

interface TagInputStepProps {
  data: WizardData;
  updateData: (partial: Partial<WizardData>) => void;
  stepProps: StepProps;
}

export function TagInputStep({ data, updateData, stepProps }: TagInputStepProps) {
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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !tagInput && data.keywords.length > 0) {
      updateData({ keywords: data.keywords.slice(0, -1) });
    }
  };

  return (
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
          ref={inputRef}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addTag}
          placeholder={data.keywords.length === 0 ? stepProps.tagPlaceholder : ''}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {data.keywords.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Type a name and press Enter to add
        </p>
      )}
    </div>
  );
}
