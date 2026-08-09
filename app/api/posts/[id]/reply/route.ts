import { getChatGPTUser } from "../../../../chatgpt-auth";
import {
  accountPublicProfile,
  getAccessBlock,
  grantExperience,
  resolveRequestIdentity,
} from "../../../../../lib/accounts";
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
  toPublicReply,
} from "../../../../../lib/wall-data";

function blockedResponse(
  request: Request,
  block: { status: 403 | 423; message: string; retryAfterSeconds?: number },
) {
  return deviceJson(
    request,
    { error: block.message, blocked: true },
    {
      status: block.status,
      headers: block.retryAfterSeconds
        ? { "Retry-After": String(block.retryAfterSeconds) }
        : undefined,
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(request, blocked);
  }
  if (!hasStorage()) {
    return deviceJson(request, { replies: [], storageConfigured: false });
  }
  const { id } = await params;
  try {
    const identity = await resolveRequestIdentity(request, await getChatGPTUser());
    const accessBlock = await getAccessBlock(identity, "read");
    if (accessBlock) {
      return blockedResponse(request, accessBlock);
    }
    if (!(await getPost(id))) {
      return deviceJson(request, { error: "帖子不存在" }, { status: 404 });
    }
    const replies = await listReplies(id);
    return deviceJson(request, {
      replies: replies.map(toPublicReply),
      storageConfigured: true,
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
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
    const chatgptUser = await getChatGPTUser();
    const identity = await resolveRequestIdentity(request, chatgptUser, {
      createAccount: true,
    });
    const accessBlock = await getAccessBlock(identity, "write");
    if (accessBlock) {
      return blockedResponse(request, accessBlock);
    }
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
      author: identity.account
        ? identity.account.displayName
        : body?.author?.trim().slice(0, 20) || "匿名同学",
      content,
      createdAt: new Date().toISOString(),
      accountId: identity.account?.id,
      sourceIpHash: identity.ipHash ?? undefined,
    };
    await saveReply(reply);
    const account = await grantExperience(identity.account?.id, "reply");
    return deviceJson(request, {
      success: true,
      reply: toPublicReply(reply),
      account: account ? accountPublicProfile(account) : null,
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
  }
}
