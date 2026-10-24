import type { Order } from "@/domain/types";
import { formatINR } from "@/lib/utils";
import { orderTrackingUrl } from "./tracking";

const truncate = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`);

export function productSummary(order: Order, maxLength = 500): string {
  const parts: string[] = [];
  let omitted = 0;
  for (const [index, item] of order.items.entries()) {
    const name = truncate((item.name || item.sku).trim(), 120);
    const part = `${name} x ${item.qty}`;
    if (parts.join(", ").length + part.length + 2 > maxLength) {
      omitted = order.items.length - index;
      break;
    }
    parts.push(part);
  }
  const summary = parts.join(", ");
  return omitted > 0 ? `${summary} and ${omitted} more item${omitted === 1 ? "" : "s"}` : summary;
}

export function deliveryAddress(order: Order, maxLength = 300): string {
  const a = order.shippingAddress;
  return truncate(
    [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", "),
    maxLength,
  );
}

export function customerName(order: Order): string {
  return order.shippingAddress.name?.trim() || "Customer";
}

export async function orderConfirmationParams(order: Order): Promise<string[]> {
  const trackingUrl = await orderTrackingUrl(order.orderNo);
  return [
    customerName(order),
    order.orderNo,
    productSummary(order),
    formatINR(order.netAmount),
    deliveryAddress(order),
    trackingUrl,
  ];
}

export async function shippingParams(order: Order): Promise<string[]> {
  if (!order.awbNo?.trim()) {
    throw new Error("Cannot send a shipping message without an AWB / tracking number.");
  }
  const trackingUrl = await orderTrackingUrl(order.orderNo);
  return [
    customerName(order),
    order.orderNo,
    order.courierName?.trim() || "our courier partner",
    order.awbNo.trim(),
    trackingUrl,
  ];
}

export async function deliveryParams(order: Order): Promise<string[]> {
  const trackingUrl = await orderTrackingUrl(order.orderNo);
  return [customerName(order), order.orderNo, trackingUrl];
}
