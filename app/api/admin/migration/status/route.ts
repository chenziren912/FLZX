import { apiError, json, requireAdmin } from "../../../../../lib/api";
import { hasStorage } from "../../../../../lib/storage";
import {
  hasSourceConfig,
  migrationSourceType,
  readMigrationState,
} from "../../../../../lib/migration";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  try {
    const state = await readMigrationState();
    return json({
      state,
      sourceType: migrationSourceType(),
      sourceConfigured: hasSourceConfig(),
      targetConfigured: hasStorage(),
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
