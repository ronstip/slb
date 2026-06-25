import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { ApiError } from '../../../api/client.ts';
import {
  listChannels,
  startWhatsAppLink,
  unbindWhatsApp,
  type BoundWhatsAppNumber,
} from '../../../api/endpoints/channels.ts';

/** Map a backend `detail` code (ApiError body is JSON `{detail}`) to copy. */
const ERROR_COPY: Record<string, string> = {
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

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

export function ChannelsSection() {
  const [numbers, setNumbers] = useState<BoundWhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Linking state: once we hand out a deep link we poll for the new binding.
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const baselineRef = useRef(0);

  const fetchNumbers = async (): Promise<BoundWhatsAppNumber[]> => {
    const res = await listChannels();
    setNumbers(res.whatsapp);
    return res.whatsapp;
  };

  const refresh = async () => {
    try {
      await fetchNumbers();
    } catch {
      toast.error('Could not load linked channels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  // While a deep link is pending, poll for the inbound to land the binding.
  useEffect(() => {
    if (!deepLink) return;
    const started = Date.now();
    const id = setInterval(async () => {
      try {
        const list = await fetchNumbers();
        if (list.length > baselineRef.current) {
          clearInterval(id);
          setDeepLink(null);
          toast.success('WhatsApp number linked');
        }
      } catch { /* transient — keep polling */ }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        clearInterval(id);
        setDeepLink(null);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [deepLink]);

  const handleLink = async () => {
    setBusy(true);
    try {
      baselineRef.current = numbers.length;
      const res = await startWhatsAppLink();
      setDeepLink(res.deep_link);
      // Open WhatsApp prefilled; the user just hits send.
      window.open(res.deep_link, '_blank', 'noopener');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start linking'));
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

          {/* Add flow — open WhatsApp prefilled, send, we detect the inbound. */}
          {deepLink ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for your WhatsApp message…
              </div>
              <p className="text-xs text-muted-foreground">
                WhatsApp should have opened with a pre-filled message — just tap
                send. If it didn’t open, use the button below. We’ll link the
                number the moment your message arrives.
              </p>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="secondary">
                  <a href={deepLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Open WhatsApp
                  </a>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeepLink(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Button onClick={handleLink} disabled={busy} size="sm">
                {busy ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MessageCircle className="mr-2 h-3.5 w-3.5" />
                )}
                Link WhatsApp
              </Button>
              <p className="text-xs text-muted-foreground">
                Opens WhatsApp with a one-time message to send us — no codes to type.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
