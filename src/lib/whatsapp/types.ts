/** Shared server-side types for the Meta WhatsApp Cloud API integration. */

export type WhatsAppMessageKind =
  | "authentication_otp"
  | "order_confirmation"
  | "order_shipped"
  | "order_delivered"
  | "test";

export type WhatsAppNotificationStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped";

export interface WhatsAppTemplateComponent {
  type: "body" | "button" | "header";
  parameters: { type: "text"; text: string }[];
  sub_type?: "url";
  index?: string;
}

export interface WhatsAppSendSuccess {
  messageId: string;
  waId?: string;
  recipientInput?: string;
}

export interface WhatsAppConfigStatus {
  enabled: boolean;
  sendConfigured: boolean;
  webhookConfigured: boolean;
  apiVersion: string;
  templateLanguage: string;
  missing: string[];
  templates: Record<WhatsAppMessageKind, string | null>;
  webhookPath: string;
}

/** Error raised for configuration, validation, transport and provider failures. */
export class WhatsAppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly providerCode?: number;
  readonly providerSubcode?: number;
  readonly providerTraceId?: string;

  constructor(
    code: string,
    message: string,
    opts: {
      retryable?: boolean;
      httpStatus?: number;
      providerCode?: number;
      providerSubcode?: number;
      providerTraceId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "WhatsAppError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.httpStatus = opts.httpStatus;
    this.providerCode = opts.providerCode;
    this.providerSubcode = opts.providerSubcode;
    this.providerTraceId = opts.providerTraceId;
  }
}
