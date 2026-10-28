import { z } from "zod";

/**
 * Server-only env. Never import from a client component.
 */
const blankToUndefined = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const envFlag = (v: unknown) => {
  // Returning undefined for absent/blank values is deliberate: it lets `.default(...)`
  // apply. Returning false here would silently disable defaults such as the OTP copy-code
  // button when a deployment omits that optional variable.
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    if (!v.trim()) return undefined;
    return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  }
  return Boolean(v);
};
const envInt = (fallback: number, min: number, max: number) =>
  z.preprocess((v) => (v === undefined || v === "" ? fallback : Number(v)), z.number().int().min(min).max(max)).default(fallback);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATA_SOURCE: z.enum(["mock", "erp"]).default("mock"),
    MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017"),
    WEB_DB_NAME: z.string().min(1).default("woven_essence_web"),
    LEGACY_BRIDGE_BRANCH_ID: z.string().optional(),
    ERP_MONGODB_URI: z.string().optional(),
    /** Same as ERP_MONGODB_URI — the name the RetailERP backend's .env uses. ERP_MONGODB_URI wins if both are set. */
    ERP_MONGO_URI: z.string().optional(),
    ERP_DB_NAME: z.string().min(1).default("grooretailerp1"),
    /** Origin of the deployed RetailERP web app. Relative ERP image paths (e.g. /august_8A_images/4A1142.jpg) are served from here. */
    ERP_IMAGE_BASE: z.string().optional(),
    /** Comma-separated DigitalOcean Spaces bucket hosts ERP images may come from (keep in sync with next.config.ts). */
    ERP_IMAGE_SPACES_HOSTS: z.string().default("templeimg.blr1.digitaloceanspaces.com"),
    /** Optional DigitalOcean Spaces keys. When set, private ERP images in those buckets are served via fresh presigned URLs. */
    DO_SPACES_KEY: z.string().optional(),
    DO_SPACES_SECRET: z.string().optional(),
    /** NVIDIA API key (nvapi-…, from build.nvidia.com) for Admin → AI Assistant. Server-only; never sent to the browser. */
    NVIDIA_API_KEY: z.string().optional(),
    /** Chat model served by the NVIDIA API; it must support tool calling. */
    NVIDIA_MODEL: z.string().optional(),
    NVIDIA_BASE_URL: z.string().optional(),
    JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-please-now"),
    JWT_EXPIRES_IN: z.string().default("7d"),
    NEXT_PUBLIC_SITE_URL: z.string().default("http://localhost:3000"),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),

    /* ---------- Meta WhatsApp Cloud API (server-only) ---------- */
    WHATSAPP_ENABLED: z.preprocess(envFlag, z.boolean()).default(false),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
    /** Graph API version used for /messages. Meta's current stable version is v26.0 (July 2026). */
    WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/, "Expected a Graph API version such as v26.0").default("v26.0"),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    /** Language/locale of the approved templates. Must match WhatsApp Manager exactly. Defaults to en_US, the current wovenessence_otp locale. */
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en_US"),
    WHATSAPP_OTP_TEMPLATE: z.string().optional(),
    /** Authentication copy-code templates need the code in both the body and the URL button. Set false only for a button-less template. */
    WHATSAPP_OTP_INCLUDE_BUTTON: z.preprocess(envFlag, z.boolean()).default(true),
    /**
     * Number of body variables in the approved OTP template. The standard Meta
     * authentication template uses 1 (the code). The current wovenessence_otp
     * template uses 2: the code and the purpose ("Login").
     */
    WHATSAPP_OTP_BODY_PARAMS: envInt(2, 1, 2),
    WHATSAPP_ORDER_CONFIRMATION_TEMPLATE: z.string().optional(),
    WHATSAPP_ORDER_SHIPPED_TEMPLATE: z.string().optional(),
    WHATSAPP_ORDER_DELIVERED_TEMPLATE: z.string().optional(),
    /** Optional single-variable Utility template used by Admin → WhatsApp → Send test. */
    WHATSAPP_TEST_TEMPLATE: z.string().optional(),
    WHATSAPP_DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,4}$/).default("91"),
    /** Minutes a login code stays valid. Must match the approved template's code-expiration footer. */
    WHATSAPP_OTP_TTL_MINUTES: envInt(1, 1, 90),
    WHATSAPP_OTP_MAX_ATTEMPTS: envInt(5, 1, 20),
    WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS: envInt(60, 10, 3600),
    WHATSAPP_OTP_MAX_PER_HOUR: envInt(5, 1, 30),
    WHATSAPP_MAX_ATTEMPTS: envInt(3, 1, 10),
    WHATSAPP_REQUEST_TIMEOUT_MS: envInt(8000, 1000, 60000),
    WHATSAPP_TRACKING_TOKEN_DAYS: envInt(90, 1, 365),
    /** Enables the authenticated cron endpoint for queued notification retries. */
    CRON_SECRET: z.string().optional(),
  })
  .transform((e) => ({
    ...e,
    ERP_MONGODB_URI: blankToUndefined(e.ERP_MONGODB_URI) ?? blankToUndefined(e.ERP_MONGO_URI) ?? e.MONGODB_URI,
    LEGACY_BRIDGE_BRANCH_ID: blankToUndefined(e.LEGACY_BRIDGE_BRANCH_ID),
    ERP_IMAGE_BASE: blankToUndefined(e.ERP_IMAGE_BASE)?.replace(/\/+$/, ""),
    ERP_IMAGE_SPACES_HOSTS: e.ERP_IMAGE_SPACES_HOSTS.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    DO_SPACES_KEY: blankToUndefined(e.DO_SPACES_KEY),
    DO_SPACES_SECRET: blankToUndefined(e.DO_SPACES_SECRET),
    NVIDIA_API_KEY: blankToUndefined(e.NVIDIA_API_KEY),
    NVIDIA_MODEL: blankToUndefined(e.NVIDIA_MODEL) ?? "nvidia/nemotron-3-super-120b-a12b",
    NVIDIA_BASE_URL: blankToUndefined(e.NVIDIA_BASE_URL)?.replace(/\/+$/, "") ?? "https://integrate.api.nvidia.com/v1",
    RAZORPAY_KEY_ID: blankToUndefined(e.RAZORPAY_KEY_ID),
    RAZORPAY_KEY_SECRET: blankToUndefined(e.RAZORPAY_KEY_SECRET),
    WHATSAPP_ACCESS_TOKEN: blankToUndefined(e.WHATSAPP_ACCESS_TOKEN),
    WHATSAPP_PHONE_NUMBER_ID: blankToUndefined(e.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_BUSINESS_ACCOUNT_ID: blankToUndefined(e.WHATSAPP_BUSINESS_ACCOUNT_ID),
    WHATSAPP_VERIFY_TOKEN: blankToUndefined(e.WHATSAPP_VERIFY_TOKEN),
    WHATSAPP_APP_SECRET: blankToUndefined(e.WHATSAPP_APP_SECRET),
    WHATSAPP_OTP_TEMPLATE: blankToUndefined(e.WHATSAPP_OTP_TEMPLATE),
    WHATSAPP_ORDER_CONFIRMATION_TEMPLATE: blankToUndefined(e.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE),
    WHATSAPP_ORDER_SHIPPED_TEMPLATE: blankToUndefined(e.WHATSAPP_ORDER_SHIPPED_TEMPLATE),
    WHATSAPP_ORDER_DELIVERED_TEMPLATE: blankToUndefined(e.WHATSAPP_ORDER_DELIVERED_TEMPLATE),
    WHATSAPP_TEST_TEMPLATE: blankToUndefined(e.WHATSAPP_TEST_TEMPLATE),
    CRON_SECRET: blankToUndefined(e.CRON_SECRET),
  }));

const rawEnv = {
  ...process.env,
  MONGODB_URI: process.env.MONGODB_URI ?? process.env.MONGO_URI,
  ERP_MONGODB_URI: process.env.ERP_MONGODB_URI ?? process.env.ERP_MONGO_URI,
};

export const env = schema.parse(rawEnv);
export type Env = typeof env;
