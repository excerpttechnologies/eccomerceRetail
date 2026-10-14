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

  it("filters category labels by exact referenced barcodeLabel IDs before pagination", async () => {
    const repository = new MongoBarcodeLabelRepository(async () => ({} as never));

    await repository.list({ labelIds: ["6a9905f8ee2f8f36193a0ce2"], limit: 96 });

    expect(aggregate.mock.calls[0][0][0].$match._id.$in[0].toString()).toBe("6a9905f8ee2f8f36193a0ce2");
  });

  it("resolves unique existing barcodeLabel IDs from exact ERP Item group references", async () => {
    const itemAggregate = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: "label-1" }, { _id: "label-2" }]) });
    const collection = vi.fn(() => ({ aggregate: itemAggregate }));
    const repository = new MongoBarcodeLabelRepository(async () => ({ db: { collection } }) as never);

    await expect(repository.getLabelIdsForItemGroups(["6a9905f8ee2f8f36193a0ce2"])).resolves.toEqual(["label-1", "label-2"]);
    const pipeline = itemAggregate.mock.calls[0][0];
    expect(pipeline[0].$match).toMatchObject({
      group: { $in: [expect.anything()] },
      "barcodeManagement.sourceBarcodeLabel": { $type: "objectId" },
    });
    expect(pipeline[0].$match.group.$in[0].toString()).toBe("6a9905f8ee2f8f36193a0ce2");
    expect(pipeline[1]).toEqual({ $group: { _id: "$barcodeManagement.sourceBarcodeLabel" } });
    expect(pipeline[2]).toEqual({ $lookup: { from: "barcodeLabel", localField: "_id", foreignField: "_id", as: "label" } });
  });

  it("limits public catalogues to in-stock labels with positive or unspecified quantity", async () => {
    const repository = new MongoBarcodeLabelRepository(async () => ({} as never));

    await repository.list({ availableOnly: true, limit: 48 });

    const match = aggregate.mock.calls[0][0][0].$match.$and;
    expect(match[0]).toEqual({ status: "IN_STOCK" });
    expect(match[1].$expr.$or[1]).toEqual({
      $gt: [
        {
          $ifNull: [
            { $convert: { input: "$qtyNum", to: "double", onError: null, onNull: null } },
            { $convert: { input: "$qty", to: "double", onError: null, onNull: null } },
          ],
        },
        0,
      ],
    });
  });

  it("matches a detail URL to one ERP label by barcode", async () => {
    const repository = new MongoBarcodeLabelRepository(async () => ({} as never));

    await repository.list({ barcodes: ["8A1101"], limit: 1 });

    expect(aggregate.mock.calls[0][0][0].$match).toEqual({ barcodeNo: { $in: ["8A1101"] } });
  });
});
