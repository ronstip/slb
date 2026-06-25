import { useEffect, useState } from 'react';
import { MessageCircle, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { ApiError } from '../../../api/client.ts';
import {
  listChannels,
  startWhatsAppVerify,
  confirmWhatsAppVerify,
  unbindWhatsApp,
  type BoundWhatsAppNumber,
} from '../../../api/endpoints/channels.ts';

/** Map a backend `detail` code (ApiError body is JSON `{detail}`) to copy. */
const ERROR_COPY: Record<string, string> = {
  number_unavailable: 'That number is already linked to another account.',
  too_many_numbers: 'You’ve reached the maximum number of linked numbers.',
  cooldown: 'Please wait a moment before requesting another code.',
  rate_limited: 'Too many codes requested for this number today. Try again later.',
  send_failed: 'Could not send the code. Check the number and try again.',
  invalid_code: 'That code is incorrect or has expired.',
  not_configured: 'WhatsApp linking isn’t available right now.',
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    try {
      const detail = JSON.parse(err.body)?.detail;
      if (typeof detail === 'string' && ERROR_COPY[detail]) return ERROR_COPY[detail];
    } catch { /* body not JSON */ }
  }
  return fallback;
}

function formatNumber(e164: string): string {
  return e164.startsWith('+') ? e164 : `+${e164}`;
}

export function ChannelsSection() {
  const [numbers, setNumbers] = useState<BoundWhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(true);

  // Two-step add flow: 'idle' → 'code' (awaiting the OTP) .
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const res = await listChannels();
      setNumbers(res.whatsapp);
    } catch {
      toast.error('Could not load linked channels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleStart = async () => {
    if (!phone.trim()) return;
    setBusy(true);
    try {
      const res = await startWhatsAppVerify(phone.trim());
      setStep('code');
      if (res.dev_code) {
        toast.info(`Dev code: ${res.dev_code}`, { duration: 30000 });
      } else {
        toast.success('Code sent to WhatsApp');
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start verification'));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      await confirmWhatsAppVerify(phone.trim(), code.trim());
      toast.success('WhatsApp number linked');
      setStep('idle');
      setPhone('');
      setCode('');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not verify the code'));
    } finally {
      setBusy(false);
    }
  };

  const handleUnbind = async (e164: string) => {
    setBusy(true);
    try {
      await unbindWhatsApp(e164);
      toast.success('Number unlinked');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not unlink the number'));
    } finally {
      setBusy(false);
    }
  };

  const cancelAdd = () => {
    setStep('idle');
    setCode('');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </CardTitle>
          <CardDescription>
            Link a WhatsApp number to chat with Scolto and receive updates there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Bound numbers */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : numbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No WhatsApp numbers linked yet.</p>
          ) : (
            <ul className="space-y-2">
              {numbers.map((n) => (
                <li
                  key={n.e164}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">{formatNumber(n.e164)}</span>
                    {n.verified_at && (
                      <span className="text-xs text-muted-foreground">
                        linked {new Date(n.verified_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() => handleUnbind(n.e164)}
                    aria-label={`Unlink ${formatNumber(n.e164)}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Add flow */}
          {step === 'idle' ? (
            <div className="space-y-2">
              <Label htmlFor="wa-phone">Add a number</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="wa-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="max-w-xs"
                  disabled={busy}
                />
                <Button onClick={handleStart} disabled={busy || !phone.trim()} size="sm">
                  {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
                  Send code
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                We’ll send a 6-digit code to that number on WhatsApp.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="wa-code">Enter the code sent to {formatNumber(phone)}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="wa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  className="max-w-[8rem]"
                  disabled={busy}
                />
                <Button onClick={handleConfirm} disabled={busy || !code.trim()} size="sm">
                  {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Verify
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelAdd} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
