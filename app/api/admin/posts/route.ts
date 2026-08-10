import { apiError, json, requireAdmin } from "../../../../lib/api";
import {
  deletePost,
  getPost,
  listPosts,
  toAdminPost,
} from "../../../../lib/wall-data";

function validPostId(id: string) {
  return /^[a-zA-Z0-9_-]{1,120}$/.test(id);
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  try {
    return json({ posts: (await listPosts()).map(toAdminPost) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => null)) as {
    postId?: unknown;
  } | null;
  if (typeof body?.postId !== "string" || !validPostId(body.postId)) {
    return json({ error: "帖子编号无效" }, { status: 400 });
  }

  try {
    const post = await getPost(body.postId);
    if (!post) {
      return json({ error: "帖子不存在" }, { status: 404 });
    }
    await deletePost(body.postId);
    return json({ success: true, postId: body.postId });
  } catch (error) {
    return apiError(error, 503);
  }
}
