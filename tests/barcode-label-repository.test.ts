import { beforeEach, describe, expect, it, vi } from "vitest";

const { aggregate, countDocuments } = vi.hoisted(() => ({
  aggregate: vi.fn(),
  countDocuments: vi.fn(),
}));

vi.mock("@/models/erp/barcode-label.model", () => ({
  BarcodeLabelModel: () => ({ aggregate, countDocuments }),
}));

const { MongoBarcodeLabelRepository } = await import("@/repositories/mongo/barcode-label.repository");

describe("barcode label series", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggregate.mockResolvedValue([]);
    countDocuments.mockResolvedValue(0);
  });

  it.each(["8A", "9A"])("filters the ERP barcode field by the %s series prefix", async (seriesPrefix) => {
    const repository = new MongoBarcodeLabelRepository(async () => ({} as never));

    await repository.list({ group: "sarees-group", seriesPrefix, limit: 8 });

    expect(aggregate.mock.calls[0][0][0].$match).toEqual({
      $and: [
        { barcodeNo: new RegExp(`^${seriesPrefix}`, "i") },
        { groupId: "sarees-group" },
      ],
    });
  });

  it("matches any selected ERP group or business for storefront clothing catalogues", async () => {
    const repository = new MongoBarcodeLabelRepository(async () => ({} as never));

    await repository.list({ groupIds: ["sarees-group", "fabric-group"], businessIds: ["textiles-business"], limit: 96 });

    expect(aggregate.mock.calls[0][0][0].$match).toEqual({
      $or: [
        { groupId: { $in: ["sarees-group", "fabric-group"] } },
        { businessId: { $in: ["textiles-business"] } },
      ],
    });
  });
});
