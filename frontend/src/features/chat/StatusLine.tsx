interface StatusLineProps {
  text: string;
}

export function StatusLine({ text }: StatusLineProps) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50" />
      <span className="text-xs text-muted-foreground/70">{text}</span>
    </div>
  );
}
