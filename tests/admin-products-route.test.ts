import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const list = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
vi.mock("@/repositories", () => ({ getBarcodeLabels: () => ({ list, facets: list, getByBarcode: vi.fn() }) }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getWebConnection: () => Promise.reject(new Error("web db down")) }));

const { GET } = await import("@/app/api/v1/admin/products/route");
const { GET: GET_FACETS } = await import("@/app/api/v1/admin/products/facets/route");
const req = (qs = "") => ({ nextUrl: new URL(`http://localhost/api/v1/admin/products${qs}`) }) as never;

describe("GET /api/v1/admin/products", () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue({ kind: "admin", permissions: ["*"] });
    list.mockReset();
  });

  it("refuses requests without an admin session", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    requireAdmin.mockRejectedValue(Object.assign(new Error("Admin login required"), { status: 401, code: "UNAUTHENTICATED" }));
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("turns an unreachable RetailERP into a friendly 503 without leaking internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    list.mockRejectedValue(new Error("querySrv ENOTFOUND _mongodb._tcp.cluster0.e3s8dbr.mongodb.net (mongodb+srv://user:s3cret@cluster0.e3s8dbr.mongodb.net)"));
    for (const [handler, r] of [[GET, req()], [GET_FACETS, undefined]] as const) {
      const res = await (handler as (r?: unknown) => Promise<Response>)(r);
      const text = await res.text();
      expect(res.status).toBe(503);
      expect(JSON.parse(text).error.code).toBe("ERP_UNAVAILABLE");
      expect(text).not.toMatch(/e3s8dbr|mongodb|s3cret|ENOTFOUND/);
    }
    expect(spy.mock.calls.flat().join(" ")).not.toContain("s3cret"); // server log is redacted too
    spy.mockRestore();
  });

  it("still returns ERP rows when the website database is down", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    list.mockResolvedValue({ items: [{ id: "1", barcode: "OU5886", name: "DU-P", slug: "du-p-ou5886" }], total: 1, page: 1, limit: 40, pages: 1, skipped: 0 });
    const res = await GET(req("?q=OU5886"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "1", barcode: "OU5886", name: "DU-P", slug: "du-p-ou5886", web: null }]);
    expect(body.meta).toMatchObject({ total: 1, pages: 1, source: "erp", collection: "barcodeLabel", readOnly: true });
    expect(list).toHaveBeenCalledWith({ q: "OU5886", page: 1, limit: 40 });
    spy.mockRestore();
  });

  it("rejects malformed queries before touching the database", async () => {
    const res = await GET(req("?limit=5000"));
    expect(res.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});
