import { applyAdminCookie, createAdminToken, hasAdminConfig } from "../../../../lib/auth";
import { json, parseBody } from "../../../../lib/api";

export async function POST(request: Request) {
  if (!hasAdminConfig()) {
    return json({ error: "管理员登录尚未配置" }, { status: 503 });
  }
  const body = await parseBody<{ password?: string }>(request);
  if (!body?.password || body.password !== process.env.ADMIN_PASSWORD) {
    return json({ error: "密码错误" }, { status: 401 });
  }
  const response = json({ success: true });
  applyAdminCookie(response, await createAdminToken());
  return response;
}
