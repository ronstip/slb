import { apiGet, apiPost } from '../client.ts';

// Spec §11 — web self-serve WhatsApp number linking.

export interface BoundWhatsAppNumber {
  e164: string;
  verified_at?: string | null;
  label?: string | null;
}

export interface ChannelsResponse {
  whatsapp: BoundWhatsAppNumber[];
}

export interface LinkStartResponse {
  /** wa.me deep link prefilled with the one-time token — open to confirm. */
  deep_link: string;
  expires_in: number;
  /** Present only in dev so local testing can craft the inbound by hand. */
  dev_token?: string;
}

export function listChannels(): Promise<ChannelsResponse> {
  return apiGet<ChannelsResponse>('/me/channels');
}

/** Mint a link token + deep link. The user sends it from their own WhatsApp;
 *  the number is bound on inbound (no OTP, no template — spec §11). */
export function startWhatsAppLink(): Promise<LinkStartResponse> {
  return apiPost<LinkStartResponse>('/me/channels/whatsapp/link-start', {});
}

export function unbindWhatsApp(phone: string): Promise<{ status: string; e164: string }> {
  return apiPost('/me/channels/whatsapp/unbind', { phone });
}
