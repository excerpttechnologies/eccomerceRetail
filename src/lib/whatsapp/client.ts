import { createHmac, timingSafeEqual } from "node:crypto";
import { getWhatsAppConfig, requireWhatsAppSend } from "./config";
import { WhatsAppError, type WhatsAppSendSuccess, type WhatsAppTemplateComponent } from "./types";

const GRAPH_BASE = "https://graph.facebook.com";

/** Digits-only E.164-ish number suitable for Meta's `to` field. */
export function normaliseWhatsAppNumber(input: string, defaultCountryCode = getWhatsAppConfig().defaultCountryCode): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) throw new WhatsAppError("WHATSAPP_INVALID_PHONE", "Enter a valid mobile number with country code.");
  let value = digits;
  if (value.length === 10) value = `${defaultCountryCode}${value}`;
  if (value.length < 8 || value.length > 15) {
    throw new WhatsAppError("WHATSAPP_INVALID_PHONE", "Enter a valid mobile number with country code.");
  }
  return value;
}

export function maskPhone(input: string): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function retryableForStatus(status: number, providerCode?: number): boolean {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  // Meta rate limits and temporary service errors.
  return [1, 2, 4, 17, 32, 613, 130429, 131048, 131056].includes(providerCode ?? -1);
}

function parseProviderError(status: number, payload: unknown): WhatsAppError {
  const err = (payload as { error?: Record<string, unknown> } | null)?.error ?? {};
  const code = typeof err.code === "number" ? err.code : undefined;
  const subcode = typeof err.error_subcode === "number" ? err.error_subcode : undefined;
  const trace = typeof err.fbtrace_id === "string" ? err.fbtrace_id : undefined;
  const rawMessage = typeof err.message === "string" ? err.message : `WhatsApp API returned HTTP ${status}`;
  const message = rawMessage.replace(/\s+/g, " ").slice(0, 500);
  return new WhatsAppError("WHATSAPP_PROVIDER_ERROR", message, {
    retryable: retryableForStatus(status, code),
    httpStatus: status,
    providerCode: code,
    providerSubcode: subcode,
    providerTraceId: trace,
  });
}

async function postMessage(payload: Record<string, unknown>, kind: Parameters<typeof requireWhatsAppSend>[0]): Promise<WhatsAppSendSuccess> {
  const { config } = requireWhatsAppSend(kind);

  const url = `${GRAPH_BASE}/${config.apiVersion}/${encodeURIComponent(config.phoneNumberId!)}/messages`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      cache: "no-store",
    });
  } catch (cause) {
    // Never include the request body (it can contain an OTP) or the token in the error.
    throw new WhatsAppError("WHATSAPP_NETWORK_ERROR", "Could not reach WhatsApp. Please try again.", {
      retryable: true,
      cause,
    });
  }

  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const parsed = parseProviderError(response.status, json);
    throw parsed;
  }

  const messages = (json as { messages?: { id?: string }[] } | null)?.messages;
  const messageId = messages?.[0]?.id;
  if (!messageId) {
    throw new WhatsAppError("WHATSAPP_BAD_RESPONSE", "WhatsApp accepted the request but did not return a message id.", {
      retryable: false, // A blind retry could duplicate the message.
      httpStatus: response.status,
    });
  }
  const contact = (json as { contacts?: { input?: string; wa_id?: string }[] } | null)?.contacts?.[0];
  return {
    messageId,
    waId: contact?.wa_id,
    recipientInput: contact?.input,
  };
}

/** Send an approved authentication template (copy-code or button-less). */
export async function sendAuthenticationOtp(to: string, code: string): Promise<WhatsAppSendSuccess> {
  const { config, templateName } = requireWhatsAppSend("authentication_otp");
  const bodyParameters: { type: "text"; text: string }[] = [{ type: "text", text: code }];
  // The current wovenessence_otp template has a second body variable: {{2}} is
  // the purpose of the code ("Login"). Standard one-variable templates omit it.
  if (config.otpBodyParams >= 2) {
    bodyParameters.push({ type: "text", text: "Login" });
  }
  const components: WhatsAppTemplateComponent[] = [
    { type: "body", parameters: bodyParameters },
  ];
  if (config.otpIncludeButton) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: code }],
    });
  }
  return postMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normaliseWhatsAppNumber(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: config.templateLanguage },
      components,
    },
  }, "authentication_otp");
}

/** Send an approved Utility template with positional body parameters. */
export async function sendUtilityTemplate(
  kind: "order_confirmation" | "order_shipped" | "order_delivered" | "test",
  to: string,
  bodyParameters: string[],
): Promise<WhatsAppSendSuccess> {
  const { config, templateName } = requireWhatsAppSend(kind);
  if (bodyParameters.length > 20) {
    throw new WhatsAppError("WHATSAPP_TEMPLATE_PARAMS", "Too many template parameters.");
  }
  for (const parameter of bodyParameters) {
    if (parameter.length > 1024) {
      throw new WhatsAppError("WHATSAPP_TEMPLATE_PARAMS", "A WhatsApp template parameter exceeds the 1024-character limit.");
    }
  }
  return postMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normaliseWhatsAppNumber(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: config.templateLanguage },
      components: [{ type: "body", parameters: bodyParameters.map((text) => ({ type: "text", text })) }],
    },
  }, kind);
}

/**
 * Verify Meta's `X-Hub-Signature-256` header. The raw request body must be used,
 * not a re-serialised object.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algorithm, provided] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !provided) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Safe error summary for DB/admin display. Never includes tokens or request bodies. */
export function whatsAppErrorSummary(error: unknown): string {
  if (error instanceof WhatsAppError) {
    const meta = [
      error.httpStatus ? `HTTP ${error.httpStatus}` : "",
      error.providerCode ? `code ${error.providerCode}` : "",
      error.providerSubcode ? `subcode ${error.providerSubcode}` : "",
    ].filter(Boolean).join(", ");
    return `${error.message}${meta ? ` (${meta})` : ""}`.slice(0, 500);
  }
  return (error instanceof Error ? error.message : "Unknown WhatsApp error").slice(0, 500);
}
