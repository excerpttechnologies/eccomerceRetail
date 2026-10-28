import { env } from "@/lib/env";
import { WhatsAppError, type WhatsAppConfigStatus, type WhatsAppMessageKind } from "./types";

/**
 * Server-only WhatsApp configuration. Never import this module from a client component:
 * it reads access tokens from `env`.
 */

const TEMPLATE_ENV: Record<WhatsAppMessageKind, keyof typeof env> = {
  authentication_otp: "WHATSAPP_OTP_TEMPLATE",
  order_confirmation: "WHATSAPP_ORDER_CONFIRMATION_TEMPLATE",
  order_shipped: "WHATSAPP_ORDER_SHIPPED_TEMPLATE",
  order_delivered: "WHATSAPP_ORDER_DELIVERED_TEMPLATE",
  test: "WHATSAPP_TEST_TEMPLATE",
};

export interface WhatsAppConfig {
  enabled: boolean;
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  apiVersion: string;
  verifyToken?: string;
  appSecret?: string;
  templateLanguage: string;
  defaultCountryCode: string;
  templates: Record<WhatsAppMessageKind, string | undefined>;
  requestTimeoutMs: number;
  maxAttempts: number;
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpMaxPerHour: number;
  trackingTokenDays: number;
  otpIncludeButton: boolean;
  otpBodyParams: number;
}

export function getWhatsAppConfig(): WhatsAppConfig {
  return {
    enabled: env.WHATSAPP_ENABLED,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    apiVersion: env.WHATSAPP_API_VERSION,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
    defaultCountryCode: env.WHATSAPP_DEFAULT_COUNTRY_CODE,
    templates: {
      authentication_otp: env.WHATSAPP_OTP_TEMPLATE,
      order_confirmation: env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE,
      order_shipped: env.WHATSAPP_ORDER_SHIPPED_TEMPLATE,
      order_delivered: env.WHATSAPP_ORDER_DELIVERED_TEMPLATE,
      test: env.WHATSAPP_TEST_TEMPLATE,
    },
    requestTimeoutMs: env.WHATSAPP_REQUEST_TIMEOUT_MS,
    maxAttempts: env.WHATSAPP_MAX_ATTEMPTS,
    otpTtlMinutes: env.WHATSAPP_OTP_TTL_MINUTES,
    otpMaxAttempts: env.WHATSAPP_OTP_MAX_ATTEMPTS,
    otpResendCooldownSeconds: env.WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS,
    otpMaxPerHour: env.WHATSAPP_OTP_MAX_PER_HOUR,
    trackingTokenDays: env.WHATSAPP_TRACKING_TOKEN_DAYS,
    otpIncludeButton: env.WHATSAPP_OTP_INCLUDE_BUTTON,
    otpBodyParams: env.WHATSAPP_OTP_BODY_PARAMS,
  };
}

/** Missing env variable names, without exposing values. */
export function missingWhatsAppConfig(kind?: WhatsAppMessageKind): string[] {
  const c = getWhatsAppConfig();
  const missing: string[] = [];
  if (!c.accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!c.phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (kind && !c.templates[kind]) missing.push(TEMPLATE_ENV[kind] as string);
  return missing;
}

export function isWhatsAppEnabled(): boolean {
  return getWhatsAppConfig().enabled;
}

export function isWhatsAppSendConfigured(kind?: WhatsAppMessageKind): boolean {
  const c = getWhatsAppConfig();
  return c.enabled && !!c.accessToken && !!c.phoneNumberId && (!kind || !!c.templates[kind]);
}

export function isWhatsAppOtpAvailable(): boolean {
  return isWhatsAppSendConfigured("authentication_otp");
}

export function whatsappConfigStatus(): WhatsAppConfigStatus {
  const c = getWhatsAppConfig();
  const missing = missingWhatsAppConfig();
  const requiredTemplates: WhatsAppMessageKind[] = ["authentication_otp", "order_confirmation", "order_shipped", "order_delivered"];
  for (const kind of requiredTemplates) {
    if (!c.templates[kind]) missing.push(TEMPLATE_ENV[kind] as string);
  }
  const webhookMissing = [
    ...(!c.verifyToken ? ["WHATSAPP_VERIFY_TOKEN"] : []),
    ...(!c.appSecret ? ["WHATSAPP_APP_SECRET"] : []),
  ];
  return {
    enabled: c.enabled,
    sendConfigured: !!c.accessToken && !!c.phoneNumberId,
    webhookConfigured: !!c.verifyToken && !!c.appSecret,
    apiVersion: c.apiVersion,
    templateLanguage: c.templateLanguage,
    missing: [...new Set([...missing, ...webhookMissing])],
    templates: {
      authentication_otp: c.templates.authentication_otp ?? null,
      order_confirmation: c.templates.order_confirmation ?? null,
      order_shipped: c.templates.order_shipped ?? null,
      order_delivered: c.templates.order_delivered ?? null,
      test: c.templates.test ?? null,
    },
    webhookPath: "/api/v1/webhooks/whatsapp",
  };
}

export function requireWhatsAppSend(kind: WhatsAppMessageKind): { config: WhatsAppConfig; templateName: string } {
  const c = getWhatsAppConfig();
  if (!c.enabled) {
    throw new WhatsAppError("WHATSAPP_DISABLED", "WhatsApp integration is disabled. Set WHATSAPP_ENABLED=true to enable it.");
  }
  const missing = missingWhatsAppConfig(kind);
  if (missing.length) {
    throw new WhatsAppError(
      "WHATSAPP_NOT_CONFIGURED",
      `WhatsApp is not configured. Missing: ${missing.join(", ")}. The rest of the store continues to work.`,
    );
  }
  return { config: c, templateName: c.templates[kind]! };
}
