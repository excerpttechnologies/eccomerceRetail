import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { fail, handler, ok } from "@/lib/api/response";
import { getCustomerSession } from "@/lib/auth";
import { clearCart, getCartToken, getCartView } from "@/lib/cart-server";
import { getWebConnection } from "@/lib/db";
import { createGatewayOrder, verifyRazorpaySignature } from "@/lib/payments";
import { CouponModel } from "@/models/web/commerce.models";
import { getCustomers, getOrders, getSite } from "@/repositories";

export const dynamic = "force-dynamic";

const AddressSchema = z.object({
  name: z.string().min(2).max(80),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile"),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/),
  country: z.string().default("India"),
});

/**
 * POST /api/v1/checkout
 * Body: { address, paymentMode: "COD" | "RAZORPAY", email?, saveAddress?, payment?: {orderId,paymentId,signature} }
 * Flow: server cart → validate stock/price → create customer (guest by mobile) → create order (ERP-shaped) → clear cart.
 * For RAZORPAY without `payment`, returns a gateway order to open the checkout widget; call again with `payment` to confirm.
 */
export const POST = handler(async (req: NextRequest) => {
  const b = await parseBody(
    req,
    z.object({
      address: AddressSchema,
      paymentMode: z.enum(["COD", "RAZORPAY"]),
      email: z.string().email().optional(),
      saveAddress: z.boolean().default(true),
      payment: z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() }).optional(),
    }),
  );
  if (!b.ok) return b.res;

  const token = await getCartToken(false);
  if (!token) return fail("EMPTY_CART", "Your bag is empty", 409);
  const cart = await getCartView(token);
  if (!cart.lines.length) return fail("EMPTY_CART", "Your bag is empty", 409);
  if (cart.unavailable.length) return fail("UNAVAILABLE", "Some items in your bag are no longer available", 409, cart.unavailable);
  if (cart.totals.couponError) return fail("COUPON_INVALID", cart.totals.couponError, 422);

  const settings = await getSite().settings();
  if (b.data.paymentMode === "COD" && settings.commerce?.codEnabled === false) return fail("COD_DISABLED", "Cash on delivery is not available", 422);

  // Razorpay two-step
  if (b.data.paymentMode === "RAZORPAY" && !b.data.payment) {
    const gw = await createGatewayOrder(cart.totals.netAmount, token.slice(0, 12));
    return ok({ step: "payment", gateway: gw });
  }
  if (b.data.paymentMode === "RAZORPAY" && b.data.payment) {
    const { orderId, paymentId, signature } = b.data.payment;
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) return fail("PAYMENT_INVALID", "Payment could not be verified", 402);
  }

  const session = await getCustomerSession();
  const customers = getCustomers();
  const customer = session ? await customers.getById(session.sub) : null;
  const cust = customer ?? (await customers.upsertByMobile({ mobile: b.data.address.phone, name: b.data.address.name, email: b.data.email }));
  if (b.data.saveAddress) {
    const exists = cust.addresses.some((a) => a.pincode === b.data.address.pincode && a.line1 === b.data.address.line1);
    if (!exists) await customers.setAddresses(cust.id, [...cust.addresses, { ...b.data.address, isDefault: cust.addresses.length === 0 }]);
  }

  const order = await getOrders().create({
    customerId: cust.id,
    items: cart.lines.map((l) => {
      const rate = l.product.pricing.sellingPrice;
      const gross = rate * l.qty;
      const gstRate = l.product.pricing.gstPercent ?? 5;
      return { productId: l.product.id, sku: l.sku, name: l.product.name, image: l.product.images[0], qty: l.qty, rate, discount: 0, gst: Math.round((gross - gross / (1 + gstRate / 100)) * 100) / 100, amount: gross };
    }),
    subTotal: cart.totals.subTotal,
    discountTotal: cart.totals.couponDiscount,
    gstTotal: cart.totals.gstTotal,
    shippingCharge: cart.totals.shippingCharge,
    netAmount: cart.totals.netAmount,
    paymentMode: b.data.paymentMode,
    shippingAddress: b.data.address,
    storeId: settings.defaultStoreId ?? undefined,
    couponCode: cart.couponCode,
  });

  if (cart.couponCode) await CouponModel(await getWebConnection()).updateOne({ code: cart.couponCode }, { $inc: { usedCount: 1 } });
  if (b.data.paymentMode === "RAZORPAY") await getOrders().updateStatus(order.orderNo, "Confirmed", `Paid via Razorpay ${b.data.payment?.paymentId}`, "system");
  await clearCart(token);

  return ok({ step: "done", orderNo: order.orderNo, netAmount: order.netAmount }, undefined, { status: 201 });
});
