import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils.ts';
import { PostEmbed } from './PostEmbed.tsx';

interface EmbedCarouselProps {
  urls: string[];
}

export function EmbedCarousel({ urls }: EmbedCarouselProps) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(Math.max(0, index), urls.length - 1);
  const prev = () => setIndex((i) => (i - 1 + urls.length) % urls.length);
  const next = () => setIndex((i) => (i + 1) % urls.length);

  return (
    <div className="relative w-full flex flex-col items-center gap-2">
      <div className="relative w-full flex justify-center">
        <button
          type="button"
          onClick={prev}
          aria-label="Previous post"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 rounded-full border border-border bg-background/90 backdrop-blur-sm shadow-sm flex items-center justify-center hover:bg-background"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="w-full px-10 flex justify-center">
          {/* Re-mount per index so platform SDK widgets refresh cleanly. */}
          <PostEmbed key={`${safeIndex}-${urls[safeIndex]}`} url={urls[safeIndex]} />
        </div>
        <button
          type="button"
          onClick={next}
          aria-label="Next post"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 rounded-full border border-border bg-background/90 backdrop-blur-sm shadow-sm flex items-center justify-center hover:bg-background"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 pt-1">
        {urls.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Go to post ${i + 1}`}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === safeIndex ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50',
            )}
          />
        ))}
        <span className="ml-2 text-[11px] text-muted-foreground">
          {safeIndex + 1} / {urls.length}
        </span>
      </div>
    </div>
  );
}
