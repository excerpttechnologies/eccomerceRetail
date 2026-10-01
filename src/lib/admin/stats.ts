/* eslint-disable @typescript-eslint/no-explicit-any */
import { getWebConnection } from "@/lib/db";
import { ORDER_FIELDS as O, ORDER_ITEM_FIELDS as OI } from "@/lib/erp-mapping";
import { OrderModel } from "@/models/erp/order.model";
import { CustomerModel } from "@/models/erp/customer.model";
import { CartModel, EnquiryModel, ReviewModel } from "@/models/web/commerce.models";
import { getMasterData } from "@/repositories";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Dashboard KPIs — web orders live in the web DB with ERP field names, so we query by mapping. */
export async function dashboardStats() {
  const conn = await getWebConnection();
  const Orders = OrderModel(conn);
  const now = new Date();
  const start30 = new Date(now.getTime() - 30 * 864e5);
  const startToday = new Date(now.toISOString().slice(0, 10));
  const created = O.createdAt;
  const net = `$${O.netAmount}`;

  const [today, last30, statusCounts, byDay, pendingReviews, newEnquiries, abandoned, customers, stock, topSkus] = await Promise.all([
    Orders.aggregate([{ $match: { [created]: { $gte: startToday } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: net } } }]),
    Orders.aggregate([{ $match: { [created]: { $gte: start30 } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: net } } }]),
    Orders.aggregate([{ $group: { _id: `$${O.orderStatus}`, n: { $sum: 1 } } }]),
    Orders.aggregate([{ $match: { [created]: { $gte: start30 } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: `$${created}` } }, orders: { $sum: 1 }, revenue: { $sum: net } } }, { $sort: { _id: 1 } }]),
    ReviewModel(conn).countDocuments({ status: "pending" }),
    EnquiryModel(conn).countDocuments({ status: "new" }),
    CartModel(conn).countDocuments({ "items.0": { $exists: true }, lastActivityAt: { $lt: new Date(now.getTime() - 864e5) } }),
    CustomerModel(conn).countDocuments({}),
    getMasterData().products.stockSummary(),
    Orders.aggregate([{ $match: { [created]: { $gte: start30 } } }, { $unwind: `$${O.items}` }, { $group: { _id: `$${O.items}.${OI.sku}`, name: { $first: `$${O.items}.${OI.name}` }, qty: { $sum: `$${O.items}.${OI.qty}` }, revenue: { $sum: `$${O.items}.${OI.amount}` } } }, { $sort: { revenue: -1 } }, { $limit: 8 }]),
  ]);

  // fill missing days
  const series: { date: string; orders: number; revenue: number }[] = [];
  const map = new Map(byDay.map((d: any) => [d._id, d]));
  for (let i = 29; i >= 0; i--) {
    const d = day(new Date(now.getTime() - i * 864e5));
    const row: any = map.get(d);
    series.push({ date: d, orders: row?.orders ?? 0, revenue: row?.revenue ?? 0 });
  }

  return {
    today: { orders: today[0]?.orders ?? 0, revenue: today[0]?.revenue ?? 0 },
    last30: { orders: last30[0]?.orders ?? 0, revenue: last30[0]?.revenue ?? 0, aov: last30[0]?.orders ? Math.round(last30[0].revenue / last30[0].orders) : 0 },
    statusCounts: Object.fromEntries(statusCounts.map((s: any) => [s._id, s.n])),
    series,
    pendingReviews,
    newEnquiries,
    abandonedCarts: abandoned,
    customers,
    stock,
    topSkus: topSkus.map((t: any) => ({ sku: t._id, name: t.name, qty: t.qty, revenue: t.revenue })),
  };
}

export async function reports(from: Date, to: Date) {
  const conn = await getWebConnection();
  const Orders = OrderModel(conn);
  const created = O.createdAt;
  const match = { [created]: { $gte: from, $lte: to }, [O.orderStatus]: { $ne: "Cancelled" } };
  const net = `$${O.netAmount}`;
  const [byDay, byPayment, byStatus, byCategory, byCoupon, byCity] = await Promise.all([
    Orders.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: `$${created}` } }, orders: { $sum: 1 }, revenue: { $sum: net } } }, { $sort: { _id: 1 } }]),
    Orders.aggregate([{ $match: match }, { $group: { _id: `$${O.paymentMode}`, orders: { $sum: 1 }, revenue: { $sum: net } } }]),
    Orders.aggregate([{ $match: match }, { $group: { _id: `$${O.orderStatus}`, orders: { $sum: 1 } } }]),
    Orders.aggregate([{ $match: match }, { $unwind: `$${O.items}` }, { $group: { _id: `$${O.items}.${OI.sku}`, qty: { $sum: `$${O.items}.${OI.qty}` }, revenue: { $sum: `$${O.items}.${OI.amount}` }, name: { $first: `$${O.items}.${OI.name}` } } }, { $sort: { revenue: -1 } }, { $limit: 20 }]),
    Orders.aggregate([{ $match: { ...match, [O.couponCode]: { $nin: [null, ""] } } }, { $group: { _id: `$${O.couponCode}`, orders: { $sum: 1 }, discount: { $sum: `$${O.discountTotal}` } } }]),
    Orders.aggregate([{ $match: match }, { $group: { _id: `$${O.shippingAddress}.city`, orders: { $sum: 1 }, revenue: { $sum: net } } }, { $sort: { revenue: -1 } }, { $limit: 10 }]),
  ]);
  return { byDay, byPayment, byStatus, topProducts: byCategory, byCoupon, byCity };
}
