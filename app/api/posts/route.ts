import { apiError, guardMaintenance, json, parseBody } from "../../../lib/api";
import { sha256Hex } from "../../../lib/s3";
import { getStorage, hasStorage } from "../../../lib/storage";
import { isMediaKey, listPosts, PostRecord, savePost } from "../../../lib/wall-data";

type CreatePostBody = {
  author?: string;
  content?: string;
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
    return blocked;
  }
  const search = new URL(request.url).searchParams.get("search") ?? "";
  try {
    const posts = await listPosts(search);
    return json({
      posts,
      totalPages: 1,
      currentPage: 1,
      storageConfigured: hasStorage(),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  const body = await parseBody<CreatePostBody>(request);
  const content = body?.content?.trim() ?? "";
  const author = body?.author?.trim() || "匿名同学";
  const media = body?.media ?? [];
  if (!content || content.length > 200) {
    return json({ error: "内容不能为空且不能超过 200 字" }, { status: 400 });
  }
  if (author.length > 20) {
    return json({ error: "昵称不能超过 20 个字" }, { status: 400 });
  }
  if (media.length > 6) {
    return json({ error: "最多上传 6 个媒体文件" }, { status: 400 });
  }
  if (
    media.some(
      (item) =>
        !item.key ||
        !isMediaKey(item.key) ||
        !item.name ||
        !item.type ||
        !Number.isFinite(item.size) ||
        Number(item.size) < 0,
    )
  ) {
    return json({ error: "媒体文件信息无效" }, { status: 400 });
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
  };
  try {
    const store = getStorage();
    for (const item of post.media) {
      if (!(await store.headObject(item.key))) {
        return json({ error: "媒体文件尚未上传完成" }, { status: 400 });
      }
    }
    await savePost(post);
    return json({
      success: true,
      post,
      deleteToken,
    });
  } catch (error) {
    return apiError(error);
  }
}
