import { apiError, json, requireAdmin } from "../../../../../lib/api";
import {
  getStorage,
  hasStorage,
  MAINTENANCE_KEY,
  MIGRATION_KEY,
  writeJson,
} from "../../../../../lib/storage";
import { readMigrationState } from "../../../../../lib/migration";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  if (!hasStorage()) {
    return json({ error: "主 COS 尚未配置" }, { status: 503 });
  }
  try {
    const store = getStorage();
    const state = await readMigrationState();
    const stopped = {
      ...state,
      status: "stopped" as const,
      maintenance: false,
      finishedAt: new Date().toISOString(),
    };
    await writeJson(store, MIGRATION_KEY, stopped);
    await writeJson(store, MAINTENANCE_KEY, { enabled: false });
    return json({ success: true, state: stopped });
  } catch (error) {
    return apiError(error, 503);
  }
}
