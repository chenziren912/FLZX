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
  listPosts,
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

export async function GET(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(request, blocked);
  }
  const search = new URL(request.url).searchParams.get("search") ?? "";
  try {
    const posts = await listPosts(search);
    return deviceJson(request, {
      posts: posts.map((post) => toPublicPost(post, { summary: true })),
      totalPages: 1,
      currentPage: 1,
      storageConfigured: hasStorage(),
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
  }
}

export async function POST(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(request, blocked);
  }
  if (!hasStorage()) {
    return deviceJson(request, { error: "服务器存储尚未配置" }, { status: 503 });
  }
  const body = await parseBody<CreatePostBody>(request);
  const author =
    typeof body?.author === "string" ? body.author.trim() || "匿名同学" : "匿名同学";
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
    const gate = await enforceSendLimit(request, body ?? {});
    if (!gate.allowed) {
      return sendGateResponse(request, gate);
    }
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
    await savePost(post);
    return deviceJson(request, {
      success: true,
      post: toPublicPost(post),
      deleteToken,
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error));
  }
}
