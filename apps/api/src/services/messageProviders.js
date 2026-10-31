import { internationalPhone } from '@salon/shared/messaging';

// Delivery adapters. Each returns { ok, providerRef?, error? } and never throws, so the sender job can record the outcome.

const TIMEOUT_MS = 10_000;
export const WHATSAPP_CLOUD_URL = 'https://graph.facebook.com/v21.0';

async function readJson(res) {
  const text = await res.text().catch(() => '');
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

async function post({ fetchImpl, timeoutMs }, url, headers, payload) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { res, ...(await readJson(res)) };
}

const httpError = (res, json, text) =>
  `Provider responded ${res.status}: ${(json?.error?.message ?? json?.message ?? text ?? '').toString().slice(0, 200) || res.statusText}`;

const PROVIDERS = {
  async CONSOLE({ channel, to, body, kind, logger }) {
    logger?.info({ channel, to, kind, body }, 'Message logged by the CONSOLE provider (not delivered)');
    return { ok: true, providerRef: 'console' };
  },

  async WEBHOOK({ channel, to, body, kind, config, http }) {
    if (!config?.url) return { ok: false, error: 'Webhook URL is not configured' };
    const headers = config.headerName && config.headerValue ? { [config.headerName]: config.headerValue } : {};
    const { res, json, text } = await post(http, config.url, headers, { channel, to, body, kind });
    if (!res.ok) return { ok: false, error: httpError(res, json, text) };
    const ref = json?.id ?? json?.messageId ?? null;
    return { ok: true, providerRef: ref === null ? null : String(ref) };
  },

  async WHATSAPP_CLOUD({ to, body, config, http }) {
    if (!config?.phoneNumberId || !config?.accessToken) return { ok: false, error: 'WhatsApp Cloud API is not configured' };
    const { res, json, text } = await post(
      http,
      `${WHATSAPP_CLOUD_URL}/${encodeURIComponent(config.phoneNumberId)}/messages`,
      { Authorization: `Bearer ${config.accessToken}` },
      { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
    );
    if (!res.ok) return { ok: false, error: httpError(res, json, text) };
    return { ok: true, providerRef: json?.messages?.[0]?.id ?? null };
  },
};

/**
 * Send one message right away with `provider` ('CONSOLE' | 'WEBHOOK' | 'WHATSAPP_CLOUD').
 * Phone recipients are normalised to digits with a country code. `fetch` can be injected for tests.
 */
export async function sendMessage({
  channel, provider, config, to, body, kind, logger, fetch: fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS,
}) {
  const send = PROVIDERS[provider];
  if (!send) return { ok: false, error: `Unknown provider ${provider}` };
  const recipient = channel === 'EMAIL' ? String(to ?? '').trim() : internationalPhone(to);
  if (!recipient) return { ok: false, error: 'No recipient' };
  try {
    return await send({ channel, to: recipient, body, kind, config, logger, http: { fetchImpl, timeoutMs } });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ok: false,
      error: timedOut ? `Provider did not respond within ${timeoutMs / 1000} s` : `Could not reach provider: ${err?.message ?? err}`,
    };
  }
}
