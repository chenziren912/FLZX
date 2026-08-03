import { apiError, guardMaintenance, json, parseBody } from "../../../../lib/api";
import { sha256Hex } from "../../../../lib/s3";
import { deletePost, getPost, listReplies } from "../../../../lib/wall-data";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  const { id } = await params;
  try {
    const post = await getPost(id);
    if (!post) {
      return json({ error: "帖子不存在" }, { status: 404 });
    }
    return json({ post, replies: await listReplies(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  const { id } = await params;
  const body = await parseBody<{ deleteToken?: string }>(request);
  if (!body?.deleteToken) {
    return json({ error: "缺少删除凭证" }, { status: 400 });
  }
  try {
    const post = await getPost(id);
    if (!post || post.deleteTokenHash !== (await sha256Hex(body.deleteToken))) {
      return json({ error: "删除凭证无效" }, { status: 403 });
    }
    await deletePost(id);
    return json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
