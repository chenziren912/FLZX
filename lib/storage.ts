import { S3CompatibleStore, S3RequestError } from "./s3";

export const DEFAULT_COS_ENDPOINT = "https://s3.hi168.com";
export const DEFAULT_COS_BUCKET = "hi168-hn5v4cadp72-j4lk05u0-s";
export const DATA_PREFIX = "flzx";
export const MEDIA_PREFIX = DATA_PREFIX + "/media";
export const MAINTENANCE_KEY = DATA_PREFIX + "/system/maintenance.json";
export const MIGRATION_KEY = DATA_PREFIX + "/system/migration.json";

export const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const DEFAULT_MEDIA_MAX_BYTES = 512 * 1024 * 1024;

export type StorageKind = "primary" | "migration";

function configFromEnv(kind: StorageKind) {
  if (kind === "primary") {
    return {
      endpoint:
        process.env.COS_ENDPOINT ??
        process.env.OSS_ENDPOINT ??
        DEFAULT_COS_ENDPOINT,
      bucket:
        process.env.COS_BUCKET ?? process.env.OSS_BUCKET ?? DEFAULT_COS_BUCKET,
      region:
        process.env.COS_REGION ??
        process.env.OSS_REGION ??
        "us-east-1",
      accessKeyId:
        process.env.COS_ACCESS_KEY_ID ??
        process.env.OSS_ACCESS_KEY_ID ??
        "",
      secretAccessKey:
        process.env.COS_SECRET_ACCESS_KEY ??
        process.env.OSS_SECRET_ACCESS_KEY ??
        "",
    };
  }

  return {
    endpoint: process.env.MIGRATION_SOURCE_ENDPOINT ?? "",
    bucket: process.env.MIGRATION_SOURCE_BUCKET ?? "",
    region: process.env.MIGRATION_SOURCE_REGION ?? "us-east-1",
    accessKeyId: process.env.MIGRATION_SOURCE_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.MIGRATION_SOURCE_SECRET_ACCESS_KEY ?? "",
  };
}

export function hasStorage(kind: StorageKind = "primary") {
  const config = configFromEnv(kind);
  return Boolean(
    config.endpoint &&
      config.bucket &&
      config.accessKeyId &&
      config.secretAccessKey,
  );
}

export function getStorage(kind: StorageKind = "primary") {
  const config = configFromEnv(kind);
  if (!hasStorage(kind)) {
    throw new Error(
      kind === "primary"
        ? "主 COS 尚未配置访问密钥"
        : "迁移源尚未配置完整",
    );
  }
  return new S3CompatibleStore(config);
}

export async function readJson<T>(
  store: S3CompatibleStore,
  key: string,
): Promise<T | null> {
  try {
    const object = await store.getObject(key);
    const text = new TextDecoder().decode(object.body);
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof S3RequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function writeJson(
  store: S3CompatibleStore,
  key: string,
  value: unknown,
) {
  await store.putObject(key, JSON.stringify(value), "application/json; charset=utf-8");
}

export async function listAllKeys(
  store: S3CompatibleStore,
  prefix: string,
  maxItems = 5000,
) {
  const keys: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await store.listObjects(prefix, cursor, 1000);
    keys.push(...page.keys);
    cursor = page.nextCursor;
    if (keys.length >= maxItems || page.complete) {
      break;
    }
  } while (cursor);
  return keys.slice(0, maxItems);
}

export function safeFileExtension(name: string) {
  const match = name.toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match ? match[0] : "";
}

export function mediaMaxBytes() {
  const configured = Number(process.env.MEDIA_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MEDIA_MAX_BYTES;
}

export function isAllowedMediaType(type: string) {
  return ALLOWED_MEDIA_TYPES.has(type);
}

export function primaryStorageError(error: unknown) {
  if (error instanceof Error) {
    return error.message.replace(
      /(?:secret|access[_ -]?key|authorization)[^,]*/gi,
      "敏感配置",
    );
  }
  return "存储服务暂时不可用";
}

export function isMediaKey(key: string) {
  return /^flzx\/media\/\d{4}\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,8})?$/i.test(key);
}
