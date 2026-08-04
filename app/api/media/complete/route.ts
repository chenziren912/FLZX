import { apiError, guardMaintenance, json, parseBody } from "../../../../lib/api";
import {
  getStorage,
  hasStorage,
  isAllowedMediaType,
  isMediaKey,
  mediaMaxBytes,
} from "../../../../lib/storage";

export async function POST(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  const body = await parseBody<{
    key?: string;
    name?: string;
    type?: string;
  }>(request);
  if (
    typeof body?.key !== "string" ||
    !isMediaKey(body.key) ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 180 ||
    typeof body.type !== "string" ||
    !isAllowedMediaType(body.type)
  ) {
    return json({ error: "媒体信息无效" }, { status: 400 });
  }
  try {
    const object = await getStorage().headObject(body.key);
    if (!object) {
      return json({ error: "没有找到已上传的文件" }, { status: 404 });
    }
    if (
      object.contentLength <= 0 ||
      object.contentLength > mediaMaxBytes() ||
      object.contentType !== body.type
    ) {
      await getStorage().deleteObject(body.key);
      return json({ error: "文件类型或大小校验失败" }, { status: 400 });
    }
    return json({
      media: {
        key: body.key,
        name: body.name.trim().slice(0, 180),
        type: body.type,
        size: object.contentLength,
      },
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
