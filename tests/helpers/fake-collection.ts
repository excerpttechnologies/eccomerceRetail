/* Small in-memory stand-in for the Mongoose model methods used by the WhatsApp tests. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

const clone = (row: Row): Row => ({ ...row });
const value = (row: Row, path: string) => path.split(".").reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), row);
const setValue = (row: Row, path: string, next: unknown) => {
  const keys = path.split(".");
  let cur = row;
  for (const key of keys.slice(0, -1)) cur = (cur[key] ??= {});
  cur[keys[keys.length - 1]] = next;
};
const comparable = (v: unknown): any => (v instanceof Date ? v.getTime() : v);
const equal = (a: unknown, b: unknown) => {
  if (a instanceof Date || b instanceof Date) return comparable(a) === comparable(b);
  return String(a) === String(b);
};

function matches(row: Row, filter: Row): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or") {
      if (!(expected as Row[]).some((part) => matches(row, part))) return false;
      continue;
    }
    if (key === "$and") {
      if (!(expected as Row[]).every((part) => matches(row, part))) return false;
      continue;
    }
    const actual = value(row, key);
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const condition = expected as Row;
      if ("$in" in condition && !(condition.$in as unknown[]).some((v) => equal(actual, v))) return false;
      if ("$ne" in condition && equal(actual, condition.$ne)) return false;
      if ("$exists" in condition && (actual !== undefined) !== condition.$exists) return false;
      if ("$lt" in condition && !(comparable(actual) < comparable(condition.$lt))) return false;
      if ("$lte" in condition && !(comparable(actual) <= comparable(condition.$lte))) return false;
      if ("$gt" in condition && !(comparable(actual) > comparable(condition.$gt))) return false;
      if ("$gte" in condition && !(comparable(actual) >= comparable(condition.$gte))) return false;
      continue;
    }
    if (!equal(actual, expected)) return false;
  }
  return true;
}

function applyUpdate(row: Row, update: Row, inserting = false) {
  if (inserting) for (const [key, next] of Object.entries(update.$setOnInsert ?? {})) setValue(row, key, next);
  for (const [key, next] of Object.entries(update.$set ?? {})) setValue(row, key, next);
  for (const [key, amount] of Object.entries(update.$inc ?? {})) setValue(row, key, Number(value(row, key) ?? 0) + Number(amount));
  for (const key of Object.keys(update.$unset ?? {})) setValue(row, key, undefined);
}

class FindOneQuery {
  private rows: Row[];
  constructor(rows: Row[], private readonly filter: Row) {
    this.rows = rows.filter((row) => matches(row, filter));
  }
  sort(spec: Row) {
    const [key, direction] = Object.entries(spec)[0] ?? [];
    if (key) this.rows.sort((a, b) => (comparable(value(a, key))! > comparable(value(b, key))! ? 1 : -1) * Number(direction));
    return this;
  }
  select() { return this; }
  async lean() { return this.rows.length ? clone(this.rows[0]) : null; }
}

class FindManyQuery {
  private rows: Row[];
  private skipped = 0;
  private capped = Infinity;
  constructor(rows: Row[], filter: Row) {
    this.rows = rows.filter((row) => matches(row, filter));
  }
  sort(spec: Row) {
    const [key, direction] = Object.entries(spec)[0] ?? [];
    if (key) this.rows.sort((a, b) => (comparable(value(a, key))! > comparable(value(b, key))! ? 1 : -1) * Number(direction));
    return this;
  }
  select() { return this; }
  skip(n: number) { this.skipped = n; return this; }
  limit(n: number) { this.capped = n; return this; }
  async lean() { return this.rows.slice(this.skipped, this.skipped + this.capped).map(clone); }
}

export class FakeCollection {
  rows: Row[] = [];
  private seq = 0;
  private id() { return String(++this.seq).padStart(24, "0"); }
  readonly model = {
    findOne: (filter: Row) => new FindOneQuery(this.rows, filter),
    find: (filter: Row) => new FindManyQuery(this.rows, filter),
    countDocuments: async (filter: Row) => this.rows.filter((row) => matches(row, filter)).length,
    exists: async (filter: Row) => this.rows.some((row) => matches(row, filter)),
    create: async (doc: Row) => {
      const row = { _id: this.id(), ...doc, createdAt: doc.createdAt ?? new Date(), updatedAt: new Date() };
      this.rows.push(row);
      return clone(row);
    },
    updateOne: async (filter: Row, update: Row, options: { upsert?: boolean } = {}) => {
      let row = this.rows.find((candidate) => matches(candidate, filter));
      if (!row && options.upsert) {
        row = { _id: this.id(), createdAt: new Date() };
        this.rows.push(row);
        applyUpdate(row, update, true);
        row.updatedAt = new Date();
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      if (!row) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      applyUpdate(row, update);
      row.updatedAt = new Date();
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
    findOneAndUpdate: (filter: Row, update: Row, options: { upsert?: boolean } = {}) => {
      let row = this.rows.find((candidate) => matches(candidate, filter));
      let inserting = false;
      if (!row && options.upsert) {
        row = { _id: this.id(), createdAt: new Date() };
        this.rows.push(row);
        inserting = true;
      }
      if (row) {
        applyUpdate(row, update, inserting);
        row.updatedAt = new Date();
      }
      return { lean: async () => (row ? clone(row) : null) };
    },
    findOneAndDelete: async (filter: Row) => {
      const index = this.rows.findIndex((row) => matches(row, filter));
      if (index < 0) return null;
      return clone(this.rows.splice(index, 1)[0]);
    },
    deleteOne: async (filter: Row) => {
      const index = this.rows.findIndex((row) => matches(row, filter));
      if (index < 0) return { deletedCount: 0 };
      this.rows.splice(index, 1);
      return { deletedCount: 1 };
    },
    deleteMany: async (filter: Row) => {
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => !matches(row, filter));
      return { deletedCount: before - this.rows.length };
    },
    updateMany: async (filter: Row, update: Row) => {
      const matched = this.rows.filter((row) => matches(row, filter));
      for (const row of matched) {
        applyUpdate(row, update);
        row.updatedAt = new Date();
      }
      return { matchedCount: matched.length, modifiedCount: matched.length };
    },
  };
}
