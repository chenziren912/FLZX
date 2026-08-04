import { apiError, guardMaintenance, json } from "../../../../lib/api";
import { getStorage, hasStorage, isMediaKey } from "../../../../lib/storage";

export async function GET(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!isMediaKey(key)) {
    return json({ error: "媒体地址无效" }, { status: 400 });
  }
  try {
    return json({
      url: await getStorage().presign("GET", key, 900),
      expiresIn: 900,
    });
  } catch (error) {
    return apiError(error, 503);
  }
}
