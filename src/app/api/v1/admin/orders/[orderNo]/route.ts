import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api/body";
import { fail, handler, ok } from "@/lib/api/response";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getWebConnection } from "@/lib/db";
import { AdminUserModel } from "@/models/web/commerce.models";
import { getCustomers, getOrders } from "@/repositories";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ orderNo: string }> };

const FLOW: Record<string, string[]> = {
  Placed: ["Confirmed", "Cancelled"],
  Confirmed: ["Packed", "Cancelled"],
  Packed: ["Shipped", "Cancelled"],
  Shipped: ["Delivered", "Returned"],
  Delivered: ["Returned"],
  Cancelled: [],
  Returned: [],
};

export const GET = handler(async (_req: NextRequest, ctx: Ctx) => {
  await requireAdmin("orders:read");
  const order = await getOrders().getByOrderNo((await ctx.params).orderNo);
  if (!order) return fail("NOT_FOUND", "Order not found", 404);
  const customer = await getCustomers().getById(order.customerId);
  const actorEmails = [...new Set((order.statusHistory ?? []).map((entry) => entry.by?.trim().toLowerCase()).filter((email): email is string => !!email && email.includes("@")))];
  const staffLinks: Record<string, string> = {};
  if (actorEmails.length) {
    const staff = await AdminUserModel(await getWebConnection()).find({ email: { $in: actorEmails }, profile: { $exists: true } }, { _id: 1, email: 1 }).lean();
    for (const person of staff) staffLinks[person.email] = String(person._id);
  }
  return ok({ ...order, customer, staffLinks, allowedTransitions: FLOW[order.orderStatus] ?? [] });
});

/** PATCH { status?, note?, awbNo? } — enforces the fulfilment workflow. */
export const PATCH = handler(async (req: NextRequest, ctx: Ctx) => {
  const actor = await requireAdmin("orders:write");
  const { orderNo } = await ctx.params;
  const b = await parseBody(req, z.object({ status: z.enum(["Placed", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled", "Returned"]).optional(), note: z.string().max(500).optional(), awbNo: z.string().max(60).optional() }));
  if (!b.ok) return b.res;
  const repo = getOrders();
  const before = await repo.getByOrderNo(orderNo);
  if (!before) return fail("NOT_FOUND", "Order not found", 404);
  if (b.data.status === "Cancelled" || b.data.status === "Returned") await requireAdmin("orders:refund");
  let order = before;
  if (b.data.awbNo) order = (await repo.setAwb(orderNo, b.data.awbNo)) ?? order;
  if (b.data.status && b.data.status !== before.orderStatus) {
    if (!(FLOW[before.orderStatus] ?? []).includes(b.data.status)) return fail("INVALID_TRANSITION", `Cannot move an order from ${before.orderStatus} to ${b.data.status}`, 422);
    order = (await repo.updateStatus(orderNo, b.data.status, b.data.note, actor.email)) ?? order;
  }
  await audit(actor, "order.update", "order", orderNo, { status: before.orderStatus, awbNo: before.awbNo }, { status: order.orderStatus, awbNo: order.awbNo, note: b.data.note }, req);
  return ok(order);
});
