import { apiError, json, requireAdmin } from "../../../../../lib/api";
import {
  getStorage,
  hasStorage,
  MAINTENANCE_KEY,
  MIGRATION_KEY,
  writeJson,
} from "../../../../../lib/storage";
import {
  emptyMigration,
  hasSourceConfig,
  migrationSourceType,
  readMigrationState,
  MigrationState,
} from "../../../../../lib/migration";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  if (!hasStorage()) {
    return json(
      { error: "请先配置主 COS 的环境变量" },
      { status: 400 },
    );
  }
  const body = ((await request.json().catch(() => ({}))) ?? {}) as {
    sourcePrefix?: string;
    targetPrefix?: string;
    sourceType?: "legacy_api" | "s3";
  };
  const sourceType = body.sourceType ?? migrationSourceType();
  if (sourceType !== "legacy_api" && sourceType !== "s3") {
    return json({ error: "迁移源类型无效" }, { status: 400 });
  }
  if (!hasSourceConfig(sourceType)) {
    return json({ error: "所选迁移源尚未配置" }, { status: 400 });
  }
  try {
    const current = await readMigrationState();
    if (current.status === "running") {
      return json({ error: "迁移已经在进行中", state: current }, { status: 409 });
    }
    const state: MigrationState = {
      ...emptyMigration,
      status: "running",
      sourceType,
      startedAt: new Date().toISOString(),
      sourcePrefix:
        typeof body.sourcePrefix === "string"
          ? body.sourcePrefix.trim().slice(0, 240)
          : "",
      targetPrefix:
        typeof body.targetPrefix === "string"
          ? body.targetPrefix.trim().slice(0, 240)
          : (process.env.MIGRATION_TARGET_PREFIX ?? "").slice(0, 240),
      sourceCursor: null,
      sourcePage: sourceType === "legacy_api" ? 1 : undefined,
      maintenance: true,
    };
    const store = getStorage();
    await writeJson(store, MIGRATION_KEY, state);
    await writeJson(store, MAINTENANCE_KEY, {
      enabled: true,
      message: "服务器正在重启更新",
      startedAt: state.startedAt,
    });
    return json({ success: true, state });
  } catch (error) {
    return apiError(error, 503);
  }
}
