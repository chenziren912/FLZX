import { apiError, guardMaintenance, json, parseBody } from "../../../../lib/api";
import { getStorage, hasStorage } from "../../../../lib/storage";

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
    key?: string;
    name?: string;
    type?: string;
  }>(request);
  if (!body?.key?.startsWith("flzx/media/") || !body.name || !body.type) {
    return json({ error: "媒体信息无效" }, { status: 400 });
  }
  try {
    const object = await getStorage().headObject(body.key);
    if (!object) {
      return json({ error: "没有找到已上传的文件" }, { status: 404 });
    }
    if (object.contentLength > maxBytes) {
      await getStorage().deleteObject(body.key);
      return json({ error: "文件超过大小限制" }, { status: 400 });
    }
    return json({
      media: {
        key: body.key,
        name: body.name.slice(0, 180),
        type: body.type,
        size: object.contentLength,
      },
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
