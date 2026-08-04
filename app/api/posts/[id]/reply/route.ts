import { apiError, guardMaintenance, parseBody } from "../../../../../lib/api";
import {
  deviceJson,
  enforceSendLimit,
  sendGateResponse,
  withDeviceCookie,
} from "../../../../../lib/device-rate";
import { hasStorage } from "../../../../../lib/storage";
import {
  getPost,
  listReplies,
  ReplyRecord,
  saveReply,
} from "../../../../../lib/wall-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(_request, blocked);
  }
  if (!hasStorage()) {
    return deviceJson(_request, { replies: [], storageConfigured: false });
  }
  const { id } = await params;
  try {
    if (!(await getPost(id))) {
      return deviceJson(_request, { error: "帖子不存在" }, { status: 404 });
    }
    const replies = await listReplies(id);
    return deviceJson(_request, { replies, storageConfigured: true });
  } catch (error) {
    return withDeviceCookie(_request, apiError(error));
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(request, blocked);
  }
  if (!hasStorage()) {
    return deviceJson(request, { error: "服务器存储尚未配置" }, { status: 503 });
  }
  const { id } = await params;
  const body = await parseBody<{
    author?: string;
    content?: string;
    captchaChallengeId?: string;
    captchaAnswer?: string;
  }>(request);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 200) {
    return deviceJson(request, { error: "回复不能为空且不能超过 200 字" }, { status: 400 });
  }
  if (body?.author !== undefined && typeof body.author !== "string") {
    return deviceJson(request, { error: "昵称格式无效" }, { status: 400 });
  }
  try {
    if (!(await getPost(id))) {
      return deviceJson(request, { error: "帖子不存在" }, { status: 404 });
    }
    const gate = await enforceSendLimit(request, body ?? {});
    if (!gate.allowed) {
      return sendGateResponse(request, gate);
    }
    const reply: ReplyRecord = {
      id: crypto.randomUUID(),
      postId: id,
      author: body?.author?.trim().slice(0, 20) || "匿名同学",
      content,
      createdAt: new Date().toISOString(),
    };
    await saveReply(reply);
    return deviceJson(request, { success: true, reply });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
  }
}
