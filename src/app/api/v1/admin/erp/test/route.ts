import { handler, ok } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { ERP_COLLECTIONS } from "@/lib/erp-mapping";
import { getMasterData } from "@/repositories";

export const dynamic = "force-dynamic";
/** POST — "Test RetailERP connection" button. */
export const POST = handler(async () => {
  await requireAdmin("settings:write");
  const master = getMasterData();
  const ping = await master.ping();
  return ok({ ...ping, dataSource: env.DATA_SOURCE, readOnly: master.readOnly, dbName: ping.dbName ?? env.ERP_DB_NAME, collections: ping.collections, mappedCollections: ERP_COLLECTIONS });
});
