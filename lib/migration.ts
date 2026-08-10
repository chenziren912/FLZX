import {
  getStorage,
  hasStorage,
  MIGRATION_KEY,
  readJson,
} from "./storage";

export type MigrationSourceType = "legacy_api" | "s3";

export type MigrationState = {
  status: "idle" | "running" | "ready_to_finalize" | "finished" | "stopped";
  sourceType?: MigrationSourceType;
  startedAt?: string;
  finishedAt?: string;
  sourcePrefix?: string;
  targetPrefix?: string;
  sourceCursor?: string | null;
  sourcePage?: number;
  announcementsImported?: boolean;
  lastKey?: string;
  copied: number;
  skipped: number;
  failed: number;
  errors: string[];
  maintenance: boolean;
};

export const emptyMigration: MigrationState = {
  status: "idle",
  copied: 0,
  skipped: 0,
  failed: 0,
  errors: [],
  maintenance: false,
};

const LEGACY_API_DEFAULT = "https://tyz.l.cd";

function hasS3SourceConfig() {
  return Boolean(
    process.env.MIGRATION_SOURCE_ENDPOINT &&
      process.env.MIGRATION_SOURCE_BUCKET &&
      process.env.MIGRATION_SOURCE_ACCESS_KEY_ID &&
      process.env.MIGRATION_SOURCE_SECRET_ACCESS_KEY,
  );
}

export function migrationSourceType(): MigrationSourceType {
  if (process.env.MIGRATION_SOURCE_TYPE === "s3") {
    return "s3";
  }
  if (process.env.MIGRATION_SOURCE_TYPE === "legacy_api") {
    return "legacy_api";
  }
  return hasS3SourceConfig() ? "s3" : "legacy_api";
}

export function migrationApiBase() {
  return (process.env.MIGRATION_SOURCE_API_BASE ?? LEGACY_API_DEFAULT).replace(
    /\/+$/,
    "",
  );
}

export function hasSourceConfig(sourceType = migrationSourceType()) {
  return sourceType === "legacy_api" ? Boolean(migrationApiBase()) : hasS3SourceConfig();
}

export async function readMigrationState() {
  if (!hasStorage()) {
    return emptyMigration;
  }
  return (
    (await readJson<MigrationState>(getStorage(), MIGRATION_KEY)) ??
    emptyMigration
  );
}
