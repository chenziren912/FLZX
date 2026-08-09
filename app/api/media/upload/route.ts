import { apiError, guardMaintenance, json } from "../../../../lib/api";
import { getAccessBlock, resolveRequestIdentity } from "../../../../lib/accounts";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { verifyMediaUploadToken } from "../../../../lib/media-upload";
import {
  getStorage,
  hasStorage,
  isAllowedMediaType,
  isMediaKey,
  mediaMaxBytes,
} from "../../../../lib/storage";

export async function PUT(request: Request) {
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
  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    !isMediaKey(key) ||
    !isAllowedMediaType(type) ||
    !(await verifyMediaUploadToken(token, key, type))
  ) {
    return json({ error: "媒体上传参数无效" }, { status: 400 });
  }
  if (contentLength > mediaMaxBytes()) {
    return json(
      {
        error:
          "文件类型或大小不符合要求，当前最多 " +
          Math.round(mediaMaxBytes() / 1024 / 1024) +
          " MB",
      },
      { status: 413 },
    );
  }
  if (!request.body) {
    return json({ error: "上传内容为空" }, { status: 400 });
  }
  try {
    const uploadUrl = await getStorage().presign("PUT", key, 900, {
      "content-type": type,
    });
    const uploadRequest: RequestInit & { duplex?: "half" } = {
      method: "PUT",
      headers: { "content-type": type },
      body: request.body,
      duplex: "half",
    };
    const response = await fetch(uploadUrl, uploadRequest);
    if (!response.ok) {
      return json({ error: "媒体上传失败" }, { status: 502 });
    }
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
