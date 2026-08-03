import { apiError, guardMaintenance, json, parseBody } from "../../../../lib/api";
import { safeFileExtension, getStorage, hasStorage, MEDIA_PREFIX } from "../../../../lib/storage";

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const maxBytes = Number(process.env.MEDIA_MAX_BYTES ?? 512 * 1024 * 1024);

export async function POST(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  const body = await parseBody<{
    name?: string;
    type?: string;
    size?: number;
  }>(request);
  const name = body?.name?.trim() ?? "";
  const type = body?.type?.trim() ?? "";
  const size = Number(body?.size);
  if (
    !name ||
    name.length > 180 ||
    !allowedTypes.has(type) ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > maxBytes
  ) {
    return json(
      {
        error:
          "文件类型或大小不符合要求，当前最多 " +
          Math.round(maxBytes / 1024 / 1024) +
          " MB",
      },
      { status: 400 },
    );
  }
  const key =
    MEDIA_PREFIX +
    "/" +
    new Date().getUTCFullYear() +
    "/" +
    crypto.randomUUID() +
    safeFileExtension(name);
  try {
    const uploadUrl = await getStorage().presign("PUT", key, 900);
    return json({
      uploadUrl,
      key,
      expiresIn: 900,
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
