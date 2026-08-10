import { getChatGPTUser } from "../../chatgpt-auth";
import {
  accountPublicProfile,
  checkPostCooldown,
  getAccessBlock,
  grantExperience,
  recordPostCooldown,
  resolveRequestIdentity,
} from "../../../lib/accounts";
import { apiError, guardMaintenance, parseBody } from "../../../lib/api";
import {
  deviceJson,
  enforceSendLimit,
  sendGateResponse,
  withDeviceCookie,
} from "../../../lib/device-rate";
import { sha256Hex } from "../../../lib/s3";
import {
  getStorage,
  hasStorage,
  isAllowedMediaType,
  isMediaKey,
  mediaMaxBytes,
} from "../../../lib/storage";
import {
  listPostsPage,
  PostRecord,
  savePost,
  toPublicPost,
} from "../../../lib/wall-data";

type CreatePostBody = {
  author?: string;
  content?: string;
  format?: "plain" | "markdown";
  captchaChallengeId?: string;
  captchaAnswer?: string;
  media?: Array<{
    key?: string;
    name?: string;
    type?: string;
    size?: number;
  }>;
};

function randomId() {
  return crypto.randomUUID();
}

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

export async function GET(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(request, blocked);
  }
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const cursor = url.searchParams.get("cursor") ?? "";
  const requestedLimit = Number(url.searchParams.get("limit") ?? 12);
  try {
    const identity = await resolveRequestIdentity(request, await getChatGPTUser());
    const accessBlock = await getAccessBlock(identity, "read");
    if (accessBlock) {
      return blockedResponse(request, accessBlock);
    }
    const page = await listPostsPage(search, cursor, requestedLimit);
    return deviceJson(request, {
      posts: page.posts.map((post) => toPublicPost(post, { summary: true })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      storageConfigured: hasStorage(),
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
  }
}

export async function POST(request: Request) {
  const maintenance = await guardMaintenance();
  if (maintenance) {
    return withDeviceCookie(request, maintenance);
  }
  if (!hasStorage()) {
    return deviceJson(request, { error: "服务器存储尚未配置" }, { status: 503 });
  }

  const body = await parseBody<CreatePostBody>(request);
  const chatgptUser = await getChatGPTUser();
  const identity = await resolveRequestIdentity(request, chatgptUser, {
    createAccount: true,
  });
  const accessBlock = await getAccessBlock(identity, "write");
  if (accessBlock) {
    return blockedResponse(request, accessBlock);
  }

  const author = identity.account
    ? identity.account.displayName
    : typeof body?.author === "string"
      ? body.author.trim() || "匿名同学"
      : "匿名同学";
  if (body?.format !== undefined && body.format !== "plain" && body.format !== "markdown") {
    return deviceJson(request, { error: "内容格式无效" }, { status: 400 });
  }
  const format = body?.format === "markdown" ? "markdown" : "plain";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const contentLimit = format === "markdown" ? 5000 : 200;
  if (body?.media !== undefined && !Array.isArray(body.media)) {
    return deviceJson(request, { error: "媒体文件信息无效" }, { status: 400 });
  }
  const media = Array.isArray(body?.media) ? body.media : [];
  if (!content || content.length > contentLimit) {
    return deviceJson(
      request,
      { error: `内容不能为空且不能超过 ${contentLimit} 字` },
      { status: 400 },
    );
  }
  if (author.length > 20) {
    return deviceJson(request, { error: "昵称不能超过 20 个字" }, { status: 400 });
  }
  if (media.length > 6) {
    return deviceJson(request, { error: "最多上传 6 个媒体文件" }, { status: 400 });
  }
  if (
    media.some(
      (item) =>
        !item ||
        typeof item.key !== "string" ||
        !item.key ||
        !isMediaKey(item.key) ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name.trim().length > 180 ||
        typeof item.type !== "string" ||
        !isAllowedMediaType(item.type) ||
        !Number.isFinite(item.size) ||
        Number(item.size) <= 0 ||
        Number(item.size) > mediaMaxBytes(),
    )
  ) {
    return deviceJson(request, { error: "媒体文件信息无效" }, { status: 400 });
  }

  const id = randomId();
  const deleteToken = randomId() + randomId();
  const post: PostRecord = {
    id,
    author,
    content,
    createdAt: new Date().toISOString(),
    deleteTokenHash: await sha256Hex(deleteToken),
    accountId: identity.account?.id,
    sourceIpHash: identity.ipHash ?? undefined,
    media: media.map((item) => ({
      key: item.key as string,
      name: item.name as string,
      type: item.type as string,
      size: Number(item.size),
    })),
    likes: 0,
    reports: 0,
    format,
  };

  try {
    const store = getStorage();
    for (const item of post.media) {
      const object = await store.headObject(item.key);
      if (!object) {
        return deviceJson(request, { error: "媒体文件尚未上传完成" }, { status: 400 });
      }
      if (
        object.contentLength <= 0 ||
        object.contentLength > mediaMaxBytes() ||
        !isAllowedMediaType(object.contentType) ||
        object.contentType !== item.type
      ) {
        return deviceJson(request, { error: "媒体文件类型或大小校验失败" }, { status: 400 });
      }
      item.size = object.contentLength;
      item.type = object.contentType;
    }

    // Anonymous devices get a fixed one-post-per-minute rule. Signed-in
    // members use the transparent experience tiers from accounts.ts.
    const cooldown = await checkPostCooldown(request, identity.account);
    if (!cooldown.allowed) {
      return deviceJson(
        request,
        {
          error: `发帖间隔未到，请 ${cooldown.retryAfterSeconds} 秒后再试`,
          cooldown: true,
          retryAfterSeconds: cooldown.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(cooldown.retryAfterSeconds) },
        },
      );
    }
    const gate = await enforceSendLimit(request, body ?? {});
    if (!gate.allowed) {
      return sendGateResponse(request, gate);
    }
    await recordPostCooldown(cooldown);
    await savePost(post);
    const account = await grantExperience(identity.account?.id, "post");
    return deviceJson(request, {
      success: true,
      post: toPublicPost(post),
      deleteToken,
      account: account ? accountPublicProfile(account) : null,
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
  }
}
