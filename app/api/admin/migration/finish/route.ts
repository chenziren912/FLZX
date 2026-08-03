import { apiError, json, requireAdmin } from "../../../../../lib/api";
import {
  getStorage,
  hasStorage,
  MAINTENANCE_KEY,
  MIGRATION_KEY,
  writeJson,
} from "../../../../../lib/storage";
import { MigrationState, readMigrationState } from "../../../../../lib/migration";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  if (!hasStorage()) {
    return json({ error: "主 COS 尚未配置" }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    force?: boolean;
  };
  try {
    const store = getStorage();
    const state = await readMigrationState();
    if (state.status !== "ready_to_finalize" && !body.force) {
      return json(
        { error: "迁移尚未完成，如需强制恢复请明确确认", state },
        { status: 409 },
      );
    }
    const finished: MigrationState = {
      ...state,
      status: "finished",
      finishedAt: new Date().toISOString(),
      maintenance: false,
    };
    await writeJson(store, MIGRATION_KEY, finished);
    await writeJson(store, MAINTENANCE_KEY, {
      enabled: false,
      finishedAt: finished.finishedAt,
    });
    return json({ success: true, state: finished });
  } catch (error) {
    return apiError(error, 503);
  }
}
