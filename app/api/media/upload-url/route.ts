import { apiError, guardMaintenance, json, parseBody } from "../../../../lib/api";
import { getAccessBlock, resolveRequestIdentity } from "../../../../lib/accounts";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { createMediaUploadToken } from "../../../../lib/media-upload";
import {
  hasStorage,
  isAllowedMediaType,
  mediaMaxBytes,
  MEDIA_PREFIX,
  safeFileExtension,
} from "../../../../lib/storage";

export async function POST(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  const identity = await resolveRequestIdentity(request, await getChatGPTUser(), {
    createAccount: true,
  });
  const accessBlock = await getAccessBlock(identity, "write");
  if (accessBlock) {
    return json(
      { error: accessBlock.message, blocked: true },
      {
        status: accessBlock.status,
        headers: accessBlock.retryAfterSeconds
          ? { "Retry-After": String(accessBlock.retryAfterSeconds) }
          : undefined,
      },
    );
  }
  const body = await parseBody<{
    name?: string;
    type?: string;
    size?: number;
  }>(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = typeof body?.type === "string" ? body.type.trim() : "";
  const size = Number(body?.size);
  if (
    !name ||
    name.length > 180 ||
    !isAllowedMediaType(type) ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > mediaMaxBytes()
  ) {
    return json(
      {
        error:
          "文件类型或大小不符合要求，当前最多 " +
          Math.round(mediaMaxBytes() / 1024 / 1024) +
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
    const token = await createMediaUploadToken(key, type);
    const uploadUrl =
      "/api/media/upload?key=" +
      encodeURIComponent(key) +
      "&token=" +
      encodeURIComponent(token);
    return json({ uploadUrl, key, expiresIn: 900 });
  } catch (error) {
    return apiError(error, 503);
  }
}
