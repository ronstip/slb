import { Info } from 'lucide-react';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.tsx';

/** Small "(i)" hint used to explain admin/billing concepts inline.
 *
 *  Lives at the feature root rather than inside any one section because both
 *  FinanceSection and UserDetailSection use it (cost-vs-billed tooltips,
 *  plan/tier/wallet help, "Untagged" agent bucket explainer).
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <UITooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="More info">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-line text-xs leading-relaxed">{text}</TooltipContent>
    </UITooltip>
  );
}
