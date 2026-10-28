# WhatsApp Cloud API integration

Woven Essence talks directly to Meta's **official WhatsApp Cloud API**. Geeky Chat and other
providers are not used. The integration is disabled unless every required setting is present,
so a missing token or template can never block the storefront, login, checkout or admin.

## What is implemented

| Feature | Implementation |
| --- | --- |
| WhatsApp OTP login | `src/lib/otp.ts`, `src/app/api/v1/auth/otp/*`, `src/components/account/otp-login.tsx` |
| Order confirmation | Checkout writes a durable outbox row, then sends after the response |
| Shipped notification | Admin order transition `Shipped`, with real AWB and optional courier name |
| Delivered notification | Admin order transition `Delivered` |
| Delivery status webhooks | `src/app/api/v1/webhooks/whatsapp/route.ts` |
| Admin diagnostics & history | `/admin/notifications` and `/api/v1/admin/whatsapp/*` |
| Retry worker | `src/app/api/v1/cron/whatsapp` (queued rows left by restarts/outages) |
| Secure tracking links | Signed, order-scoped, expiring JWT links (`/track-order?token=…`) |

Notification delivery status is deliberately separate from order and payment status. A Meta
failure never cancels, confirms or changes an order.

## API version and endpoints

Meta's current stable Graph API version is **v26.0** (July 2026). The integration defaults to
`v26.0` and allows a deliberate override with `WHATSAPP_API_VERSION`.

- Send message: `POST https://graph.facebook.com/{version}/{phone-number-id}/messages`
- Authentication: `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}`
- Content type: `application/json`
- Webhook verification: `GET /api/v1/webhooks/whatsapp`
- Delivery callbacks: `POST /api/v1/webhooks/whatsapp` with `X-Hub-Signature-256`

The webhook signature is HMAC-SHA256 of the **raw request body**, keyed with the Meta app
secret. Requests with a missing or invalid signature are rejected with HTTP 401.

## Required server environment

Copy the block from `.env.example`; never commit a real `.env`. These values must stay on the
server, never in a `NEXT_PUBLIC_*` variable and never in client components.

```dotenv
WHATSAPP_ENABLED=false
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_API_VERSION=v26.0
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_TEMPLATE_LANGUAGE=en_US
WHATSAPP_OTP_TEMPLATE=wovenessence_otp
WHATSAPP_OTP_INCLUDE_BUTTON=true
WHATSAPP_OTP_BODY_PARAMS=2
WHATSAPP_ORDER_CONFIRMATION_TEMPLATE=
WHATSAPP_ORDER_SHIPPED_TEMPLATE=
WHATSAPP_ORDER_DELIVERED_TEMPLATE=
WHATSAPP_TEST_TEMPLATE=
CRON_SECRET=
```

Optional tuning and their defaults:

```dotenv
WHATSAPP_DEFAULT_COUNTRY_CODE=91
WHATSAPP_OTP_BODY_PARAMS=2
WHATSAPP_OTP_TTL_MINUTES=1
WHATSAPP_OTP_MAX_ATTEMPTS=5
WHATSAPP_OTP_RESEND_COOLDOWN_SECONDS=60
WHATSAPP_OTP_MAX_PER_HOUR=5
WHATSAPP_MAX_ATTEMPTS=3
WHATSAPP_REQUEST_TIMEOUT_MS=8000
WHATSAPP_TRACKING_TOKEN_DAYS=90
```

Where to obtain the credentials:

1. **Meta Developer App** → create/select an app with the WhatsApp product.
2. **WhatsApp → API Setup**: copy the **Phone number ID** and **WhatsApp Business Account ID**.
3. **WhatsApp → Configuration → Edit**: create the webhook (below); copy the **Verify token**
   you chose into `WHATSAPP_VERIFY_TOKEN`.
4. **App settings → Basic**: copy the **App secret** into `WHATSAPP_APP_SECRET`.
5. **Business settings → System users**: create a system user, assign the app and the WhatsApp
   asset, and generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`. Use that long-lived token, not the 24-hour test token.
6. The sending number must be verified/registered. Business verification and a payment method
   are required for production messaging. Templates must be approved before they can be sent.

## Templates to create

Create these in **WhatsApp Manager → Account tools → Message templates**. The template name and
language must match the environment variables exactly. Do not invent template IDs: the API uses
names plus the language code.

### 1. OTP authentication template (`WHATSAPP_OTP_TEMPLATE`)

- Category: **Authentication**
- Format: copy-code button (recommended) or zero-tap/button-less
- Body: the approved template uses two variables:
  `OTP Code: {{1}}. This is your OTP code for {{2}}. For your security, do not share this code.`
  where `{{1}}` is the code and `{{2}}` is the purpose (`Login`).
- The code is sent as the first body parameter and, for a copy-code template, again as button
  `0` (`sub_type: url`). The purpose is sent as the second body parameter.
- Set `WHATSAPP_OTP_BODY_PARAMS=2` for this template; use `1` for Meta's standard
  one-variable authentication template.
- If the approved template has **no button**, set `WHATSAPP_OTP_INCLUDE_BUTTON=false`.

The approved template in this environment is `wovenessence_otp`, language `en_US`, with a
**1-minute** code-expiration footer. Set `WHATSAPP_OTP_TTL_MINUTES=1` so the server expiry
matches the message. OTP login is WhatsApp-only; the legacy SMS channel is disabled because
the repository has no SMS provider.

### 2. Order confirmation (`WHATSAPP_ORDER_CONFIRMATION_TEMPLATE`)

- Category: **Utility**
- Body parameters must be in this exact order:

| # | Parameter | Source |
| --- | --- | --- |
| 1 | Customer name | order shipping address |
| 2 | Order number | server-generated order |
| 3 | Product summary | order items, name x quantity |
| 4 | Order total | server-calculated INR total |
| 5 | Delivery address | order shipping address |
| 6 | Tracking URL | signed, order-scoped link |

Example body:

```text
Hello {{1}}!

Thank you for shopping with Woven Essence.

Your order {{2}} has been confirmed successfully.

Items: {{3}}
Order total: {{4}}
Delivery address: {{5}}

Track your order here:
{{6}}

Thank you for choosing Woven Essence!
```

### 3. Order shipped (`WHATSAPP_ORDER_SHIPPED_TEMPLATE`)

- Category: **Utility**
- Parameters in order: `{{1}}` customer name, `{{2}}` order number, `{{3}}` courier name,
  `{{4}}` AWB/tracking number, `{{5}}` tracking URL.

```text
Hello {{1}}!

Your Woven Essence order {{2}} has been shipped.

Courier: {{3}}
Tracking number: {{4}}

Track your order:
{{5}}

Thank you for shopping with Woven Essence!
```

A shipping notification is only queued when the order is actually `Shipped` **and** has an AWB.
If the courier name is blank, the message uses “our courier partner” rather than inventing one.

### 4. Order delivered (`WHATSAPP_ORDER_DELIVERED_TEMPLATE`)

- Category: **Utility**
- Parameters in order: `{{1}}` customer name, `{{2}}` order number, `{{3}}` tracking URL.

```text
Hello {{1}}!

Your Woven Essence order {{2}} has been delivered.

You can view the order here:
{{3}}

Thank you for shopping with Woven Essence!
```

### 5. Admin test template (`WHATSAPP_TEST_TEMPLATE`, optional)

- Category: **Utility**, one body variable.
- Example body: `Woven Essence test message: {{1}}`
- Used only by **Admin → WhatsApp → Send test**. Without it the test button is disabled; OTP
  and order messages are not used for tests.

WhatsApp template rules apply: keep the body within Meta's limits (1,024 characters), keep the
parameter order fixed, and use the same language code as `WHATSAPP_TEMPLATE_LANGUAGE`.

## Webhook setup

Production callback URL:

```text
https://wovenessence.in/api/v1/webhooks/whatsapp
```

1. Set the correct `WHATSAPP_ENABLED=true`, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`,
   then restart the application. The GET verification only works when the integration is enabled.
2. In **Meta App Dashboard → WhatsApp → Configuration**, click **Edit**, enter the callback URL
   and the same verify token, and save. Meta sends a GET request; a 200 response completes
   verification.
3. Subscribe to the **messages** webhook field. Delivery statuses (`sent`, `delivered`, `read`,
   `failed`) arrive as POST requests.
4. Meta signs every POST with `X-Hub-Signature-256`. The route verifies the raw body before
   parsing. Invalid signatures are rejected.
5. Duplicate callbacks are deduplicated by message id + status + timestamp. Status updates are
   monotonic, and a late failure cannot downgrade a delivered/read message.

The webhook only updates the `whatsappNotifications` collection. It never changes
`orderStatus` or `paymentStatus`: a WhatsApp delivery is not a physical delivery.

## Order and OTP flows

### OTP

1. The login page shows the WhatsApp option only when the integration, access token, phone id
   and authentication template are all configured. If they are missing, the OTP tab is hidden
   and email/password login remains available.
2. The server normalises the Indian mobile number, applies a per-number cooldown and hourly
   limits plus a hashed-IP limit, and generates a cryptographically random 6-digit code.
3. Only a salted SHA-256 hash is stored in `otpCodes`; the code is bound to the phone number and
   purpose. The raw code is never logged.
4. Meta's authentication template is sent. A provider failure deletes the pending code and
   returns a safe error; authentication is never bypassed.
5. Verification caps wrong attempts atomically, rejects expired codes, atomically consumes the
   code on success, then creates the existing customer session. Resends invalidate previous codes.

There is intentionally no automatic linking of an unverified phone to an existing customer.
The OTP-verified path attaches the session to the matching customer after the phone is proven.

### Order confirmation

- **COD**: checkout accepts the order as `Placed`, writes an outbox row and sends after the HTTP
  response. Admin can later move it to `Confirmed`; the idempotency key prevents a second
  confirmation.
- **Prepaid (Razorpay)**: the order is only created after the existing server-side signature
  verification succeeds. The confirmation is queued after the order is updated to `Confirmed`.
- Failed or missing payment verification never reaches order creation, so no false confirmation
  is sent.
- If WhatsApp is disabled/misconfigured, checkout still succeeds and the order remains valid.

The outbox row is written before the response. Delivery runs through Next.js `after()`, so Meta
latency does not affect checkout. The secured cron endpoint retries rows that a restart or
temporary outage leaves queued; permanent failures remain visible for manual retry in Admin →
WhatsApp.

## Admin diagnostics

`/admin/notifications` (permission `settings:write`) shows:

- whether WhatsApp is enabled and whether sending/webhooks have all required settings;
- missing environment variable **names** only — never token/secret values;
- template names and API version;
- notification history with masked recipient, order number, provider message id, attempts,
  delivery status and a safe error summary;
- retry controls for eligible failed/queued rows;
- a test form that uses only the optional test template.

Test and retry actions are written to the existing audit log. The admin API requires an admin
session; the cron endpoint requires `Authorization: Bearer $CRON_SECRET`.

## Deploying and restarting

The application reads configuration at server start. After changing `.env`/server environment
variables:

```bash
npm ci
npm run build
# restart the existing Node/Next.js process using the deployment's normal service manager
```

Do not restart production services without the required deployment approval. Do not paste
tokens into logs, shell history, tickets or chat.

Suggested enable sequence:

1. Leave `WHATSAPP_ENABLED=false`; add credentials/templates to the server environment.
2. Run `npm run build` and restart.
3. Set `WHATSAPP_ENABLED=true`, add `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`, restart.
4. Verify the webhook in Meta.
5. Open **Admin → WhatsApp** and send a test message to an authorised number.
6. Test OTP login with a real test phone.
7. Place a low-value COD test order and confirm the outbox row and webhook status.
8. Test Shipped/Delivered with a test AWB before using real customer numbers.

### Notification retry cron

Run every few minutes from the existing scheduler:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://wovenessence.in/api/v1/cron/whatsapp?limit=20"
```

Retries use exponential backoff (1, 2, 4 … minutes, capped at 60) up to
`WHATSAPP_MAX_ATTEMPTS`. Permanent failures stay visible in admin for investigation.

## Rollback / disable

Set `WHATSAPP_ENABLED=false` and restart. No new messages are queued. Existing order, payment,
login, tracking and admin flows keep working; email/password login remains available. Any queued
rows are marked skipped when processed. To revert code, deploy the previous release; no database
migration is required because the new collections are additive.

## Verification commands

```bash
npm test
npm run typecheck
npm run build
```

Automated tests mock Meta and never send real customer messages.

## Limitations and production status

- **This integration is not production-verified yet.** It has no real Meta credentials,
  approved templates, public HTTPS webhook or live end-to-end delivery evidence in this
  environment. Do not claim production readiness until those exist and a real test phone has
  completed OTP, confirmation, shipped and delivered flows.
- Razorpay remains the repository's stub integration; only the WhatsApp work is complete here.
  Prepaid confirmation relies on the existing signature-verification flow.
- OTP login is WhatsApp-only. The old SMS path is intentionally disabled: its provider was a
  stub that returned success without sending a code. The API rejects `channel: "sms"` with
  `OTP_CHANNEL_UNAVAILABLE`; if WhatsApp is not configured, the OTP tab is hidden and
  email/password login remains the fallback.
- No cancel/refund/out-for-delivery template is implemented because those events do not have an
  approved template or a distinct existing workflow. Do not add a template without deciding the
  exact customer wording and event transition.
- Courier name is an optional website-only order field entered by admin; there is no courier API.
- Meta may rate-limit, reject a template, or report a failed delivery. The order remains valid
  and the failure is recorded in the notification history.
