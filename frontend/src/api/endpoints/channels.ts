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

export interface VerifyStartResponse {
  status: string;
  expires_in: number;
  /** Present only in dev when the channel is unconfigured (OTP send stubbed). */
  dev_code?: string;
}

export function listChannels(): Promise<ChannelsResponse> {
  return apiGet<ChannelsResponse>('/me/channels');
}

export function startWhatsAppVerify(phone: string): Promise<VerifyStartResponse> {
  return apiPost<VerifyStartResponse>('/me/channels/whatsapp/verify-start', { phone });
}

export function confirmWhatsAppVerify(phone: string, code: string): Promise<{ status: string; e164: string }> {
  return apiPost('/me/channels/whatsapp/verify-confirm', { phone, code });
}

export function unbindWhatsApp(phone: string): Promise<{ status: string; e164: string }> {
  return apiPost('/me/channels/whatsapp/unbind', { phone });
}
