import { getChatGPTUser } from "../../../../chatgpt-auth";
import {
  getAccessBlock,
  resolveRequestIdentity,
} from "../../../../../lib/accounts";
import { apiError, guardMaintenance, parseBody } from "../../../../../lib/api";
import {
  deviceJson,
  enforceSendLimit,
  getDeviceId,
  sendGateResponse,
  withDeviceCookie,
} from "../../../../../lib/device-rate";
import {
  addInteraction,
  addReport,
  getPost,
  savePost,
  toPublicPost,
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(request, blocked);
  }
  const { id } = await params;
  const body = await parseBody<{
    action?: "like" | "report";
    reason?: string;
    captchaChallengeId?: string;
    captchaAnswer?: string;
  }>(request);
  if (
    (body?.action !== "like" && body?.action !== "report") ||
    (body?.reason !== undefined && typeof body.reason !== "string")
  ) {
    return deviceJson(request, { error: "操作参数无效" }, { status: 400 });
  }
  try {
    const chatgptUser = await getChatGPTUser();
    const identity = await resolveRequestIdentity(request, chatgptUser, {
      createAccount: true,
    });
    const accessBlock = await getAccessBlock(
      identity,
      body.action === "like" ? "react" : "write",
    );
    if (accessBlock) {
      return blockedResponse(request, accessBlock);
    }
    // The id lives in an HttpOnly cookie, rather than in localStorage or a
    // request field, so refreshing the page cannot create a new like/report
    // identity for the same browser.
    const deviceId = getDeviceId(request);
    const post = await getPost(id);
    if (!post) {
      return deviceJson(request, { error: "帖子不存在" }, { status: 404 });
    }
    const gate = await enforceSendLimit(request, body ?? {});
    if (!gate.allowed) {
      return sendGateResponse(request, gate);
    }
    const added =
      body.action === "report"
        ? Boolean(
            await addReport(id, deviceId, body.reason?.trim() ?? "", {
              accountId: identity.account?.id,
              sourceIpHash: identity.ipHash ?? undefined,
            }),
          )
        : await addInteraction(id, deviceId, body.action);
    if (added) {
      if (body.action === "like") {
        post.likes += 1;
      } else {
        post.reports += 1;
      }
      await savePost(post);
    }
    return deviceJson(request, {
      success: true,
      action: added ? "added" : "unchanged",
      post: toPublicPost(post),
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
  }
}
