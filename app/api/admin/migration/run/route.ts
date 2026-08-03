import { apiError, json, requireAdmin } from "../../../../../lib/api";
import {
  getStorage,
  getStorage as getSourceStorage,
  MIGRATION_KEY,
  writeJson,
} from "../../../../../lib/storage";
import {
  hasSourceConfig,
  migrationApiBase,
  migrationSourceType,
  MigrationState,
  readMigrationState,
} from "../../../../../lib/migration";
import {
  importLegacyAnnouncements,
  importLegacyPage,
} from "../../../../../lib/legacy-migration";

function targetKey(sourceKey: string, targetPrefix: string) {
  const cleanPrefix = targetPrefix.replace(/^\/+|\/+$/g, "");
  return cleanPrefix ? cleanPrefix + "/" + sourceKey : sourceKey;
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  const body = (await request.json().catch(() => ({}))) as {
    batchSize?: number;
  };
  const batchSize = Math.max(1, Math.min(Number(body.batchSize) || 5, 20));
  try {
    const state = await readMigrationState();
    if (state.status !== "running") {
      return json({ error: "当前没有正在运行的迁移", state }, { status: 409 });
    }
    const sourceType = state.sourceType ?? migrationSourceType();
    if (!hasSourceConfig(sourceType)) {
      return json({ error: "迁移源尚未配置" }, { status: 400 });
    }
    const target = getStorage();

    if (sourceType === "legacy_api") {
      const pageNumber = Math.max(1, state.sourcePage ?? 1);
      const pageResult = await importLegacyPage(
        migrationApiBase(),
        pageNumber,
      );
      const nextState: MigrationState = {
        ...state,
        sourceType,
        sourcePage: pageResult.currentPage + 1,
        lastKey: "legacy-api-page-" + pageResult.currentPage,
        copied: state.copied + pageResult.copied,
        skipped: state.skipped + pageResult.skipped,
        errors: [...state.errors],
      };
      if (!state.announcementsImported) {
        nextState.copied += await importLegacyAnnouncements(migrationApiBase());
        nextState.announcementsImported = true;
      }
      if (pageResult.currentPage >= pageResult.totalPages) {
        nextState.status = "ready_to_finalize";
        nextState.sourceCursor = null;
      }
      await writeJson(target, MIGRATION_KEY, nextState);
      return json({ success: true, state: nextState });
    }

    const source = getSourceStorage("migration");
    const page = await source.listObjects(
      state.sourcePrefix ?? "",
      state.sourceCursor ?? null,
      batchSize,
    );
    const nextState: MigrationState = {
      ...state,
      errors: [...state.errors],
    };
    for (const sourceKey of page.keys) {
      const destination = targetKey(sourceKey, state.targetPrefix ?? "");
      try {
        if (await target.headObject(destination)) {
          nextState.skipped += 1;
          nextState.lastKey = sourceKey;
          continue;
        }
        const response = await source.getObjectStream(sourceKey);
        if (!response.body) {
          throw new Error("源文件没有可读取的数据流");
        }
        await target.putObjectStream(
          destination,
          response.body,
          response.headers.get("content-type") ?? "application/octet-stream",
        );
        nextState.copied += 1;
        nextState.lastKey = sourceKey;
      } catch (error) {
        nextState.failed += 1;
        if (nextState.errors.length < 20) {
          nextState.errors.push(sourceKey + ": " + (error instanceof Error ? error.message : "未知错误"));
        }
      }
    }
    nextState.sourceCursor = page.nextCursor;
    if (page.complete) {
      nextState.status = "ready_to_finalize";
    }
    await writeJson(target, MIGRATION_KEY, nextState);
    return json({ success: true, state: nextState });
  } catch (error) {
    return apiError(error, 503);
  }
}
