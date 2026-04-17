import { Label } from '../../../components/ui/label.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';
import type { Constitution } from '../../../api/endpoints/agents.ts';

interface ConstitutionEditorProps {
  constitution: Constitution;
  onChange: (c: Constitution) => void;
}

const FIELDS: Array<{
  key: keyof Constitution;
  label: string;
  placeholder: string;
}> = [
  {
    key: 'identity',
    label: 'Identity',
    placeholder: "Who this agent is — its role, analytical character, and voice…",
  },
  {
    key: 'mission',
    label: 'Mission',
    placeholder: "Operational: what to monitor/deliver. Theoretical: what understanding to build over time…",
  },
  {
    key: 'methodology',
    label: 'Methodology',
    placeholder: "How it thinks — evidence standards, when to be conservative vs. exploratory…",
  },
  {
    key: 'scope_and_relevance',
    label: 'Scope & Relevance',
    placeholder: "What's signal vs. noise — entities, themes, domains to focus on…",
  },
  {
    key: 'standards',
    label: 'Standards',
    placeholder: "Quality bar — confidence thresholds, what to never claim without evidence…",
  },
  {
    key: 'perspective',
    label: 'Perspective',
    placeholder: "Whose lens to use, what decisions this analysis serves…",
  },
];

export function ConstitutionEditor({ constitution, onChange }: ConstitutionEditorProps) {
  return (
    <div className="space-y-3">
      {FIELDS.map(({ key, label, placeholder }) => (
        <div key={key}>
          <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {label}
          </Label>
          <Textarea
            value={constitution[key] || ''}
            onChange={(e) => onChange({ ...constitution, [key]: e.target.value })}
            placeholder={placeholder}
            className="text-xs min-h-12"
          />
        </div>
      ))}
    </div>
  );
}

export const EMPTY_CONSTITUTION: Constitution = {
  identity: '',
  mission: '',
  methodology: '',
  scope_and_relevance: '',
  standards: '',
  perspective: '',
};

/** @deprecated Use ConstitutionEditor and EMPTY_CONSTITUTION instead. */
export { ConstitutionEditor as AgentContextEditor };
/** @deprecated Use EMPTY_CONSTITUTION instead. */
export const EMPTY_CONTEXT = {
  mission: '',
  world_context: '',
  relevance_boundaries: '',
  analytical_lens: '',
};
