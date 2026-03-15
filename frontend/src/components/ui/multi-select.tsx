import * as React from 'react';
import { CheckIcon, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command.tsx';
import { Badge } from './badge.tsx';

export interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectProps {
  value: string[];
  options: MultiSelectOption[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = (optionValue: string) => {
    onChange(
      value.includes(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue],
    );
  };

  const labelMap = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.value, o.label);
    return m;
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex min-h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 py-1 text-xs shadow-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {value.length === 0 && (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            {value.slice(0, 3).map((v) => (
              <Badge
                key={v}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-5 gap-1 font-normal"
              >
                {labelMap.get(v) ?? v}
                <X
                  className="h-2.5 w-2.5 cursor-pointer hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(v);
                  }}
                />
              </Badge>
            ))}
            {value.length > 3 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-normal">
                +{value.length - 3}
              </Badge>
            )}
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          {options.length > 6 && <CommandInput placeholder="Search..." className="text-xs h-8" />}
          <CommandList>
            <CommandEmpty className="py-3 text-xs">No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    onSelect={() => toggle(option.value)}
                    className="text-xs"
                  >
                    <div
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/30',
                      )}
                    >
                      {isSelected && <CheckIcon className="h-2.5 w-2.5" />}
                    </div>
                    {option.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
