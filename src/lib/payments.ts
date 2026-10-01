import { createHmac, randomBytes } from "node:crypto";

/**
 * Razorpay stub. Real integration: `npm i razorpay`, create the order with the
 * SDK using RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET and verify the signature with
 * `verifyRazorpaySignature` below (the HMAC recipe is Razorpay's real one).
 */
export interface GatewayOrder {
  gateway: "razorpay";
  gatewayOrderId: string;
  amount: number; // paise
  currency: "INR";
  keyId: string;
  stub: boolean;
}

export async function createGatewayOrder(amountInr: number, receipt: string): Promise<GatewayOrder> {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "rzp_test_stub";
  // TODO: replace with `await razorpay.orders.create({ amount, currency: "INR", receipt })`
  return { gateway: "razorpay", gatewayOrderId: `order_stub_${randomBytes(6).toString("hex")}_${receipt}`, amount: Math.round(amountInr * 100), currency: "INR", keyId, stub: !process.env.RAZORPAY_KEY_SECRET };
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return signature === "stub_signature"; // dev/stub mode
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return expected === signature;
}
