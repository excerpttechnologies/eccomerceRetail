import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";
import { getWhatsAppConfig } from "./config";

const AUDIENCE = "woven-essence-order-track";
const secret = () => new TextEncoder().encode(env.JWT_SECRET);

/**
 * Signed, expiring tracking links for WhatsApp messages. The token is scoped to one
 * order and cannot be used as a customer/admin session.
 */
export async function createOrderTrackingToken(orderNo: string): Promise<string> {
  return new SignJWT({ scope: "order_track", orderNo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(orderNo)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${getWhatsAppConfig().trackingTokenDays}d`)
    .sign(secret());
}

export async function verifyOrderTrackingToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: AUDIENCE });
    if (payload.scope !== "order_track" || typeof payload.orderNo !== "string") return null;
    if (payload.sub !== payload.orderNo) return null;
    return payload.orderNo;
  } catch {
    return null;
  }
}

export async function orderTrackingUrl(orderNo: string): Promise<string> {
  const token = await createOrderTrackingToken(orderNo);
  const base = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  return `${base}/track-order?token=${encodeURIComponent(token)}`;
}
