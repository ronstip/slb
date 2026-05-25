import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { getTopUpOptions, topUp } from '../../../api/endpoints/settings.ts';
import { ApiError } from '../../../api/client.ts';

/** Quick prepaid top-up. Presets come from the backend; selecting one starts a
 *  provider checkout (dormant until billing is configured → friendly notice). */
export function TopUpDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState<number | null>(null);

  const { data: options = [] } = useQuery({
    queryKey: ['billing', 'topup-options'],
    queryFn: getTopUpOptions,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const handle = async (amountCents: number) => {
    setSubmitting(amountCents);
    try {
      const { url } = await topUp(amountCents);
      window.location.href = url;
    } catch (e) {
      const notConfigured = e instanceof ApiError && e.status === 501;
      toast.error(
        notConfigured
          ? 'Payments are not enabled yet — please check back soon.'
          : 'Could not start checkout. Please try again.',
      );
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top up credit</DialogTitle>
          <DialogDescription>
            Add prepaid credit to your account. You're only charged for the work you run.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 pt-2">
          {options.map((o) => (
            <Button
              key={o.amount_cents}
              variant={o.popular ? 'default' : 'outline'}
              disabled={submitting !== null}
              onClick={() => handle(o.amount_cents)}
            >
              {submitting === o.amount_cents ? 'Redirecting…' : o.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
