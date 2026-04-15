import { Label } from '../../../components/ui/label.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';
import type { AgentContext } from '../../../api/endpoints/agents.ts';

interface AgentContextEditorProps {
  context: AgentContext;
  onChange: (ctx: AgentContext) => void;
}

const FIELDS: Array<{
  key: keyof AgentContext;
  label: string;
  placeholder: string;
}> = [
  {
    key: 'mission',
    label: 'Mission',
    placeholder: "The Agent will monitor/track/analyze\u2026",
  },
  {
    key: 'world_context',
    label: 'World Context',
    placeholder:
      "Broad landscape, industry dynamics, key players, recent events\u2026",
  },
  {
    key: 'relevance_boundaries',
    label: 'Relevance Scope',
    placeholder: "What's in scope vs out of scope for this agent\u2026",
  },
  {
    key: 'analytical_lens',
    label: 'Analytical Lens',
    placeholder: "Whose perspective matters, what signals to prioritize\u2026",
  },
];

export function AgentContextEditor({ context, onChange }: AgentContextEditorProps) {
  return (
    <div className="space-y-3">
      {FIELDS.map(({ key, label, placeholder }) => (
        <div key={key}>
          <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {label}
          </Label>
          <Textarea
            value={context[key] || ''}
            onChange={(e) => onChange({ ...context, [key]: e.target.value })}
            placeholder={placeholder}
            className="text-xs min-h-12"
          />
        </div>
      ))}
    </div>
  );
}

export const EMPTY_CONTEXT: AgentContext = {
  mission: '',
  world_context: '',
  relevance_boundaries: '',
  analytical_lens: '',
};
