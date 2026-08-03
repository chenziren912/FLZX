import { apiError, guardMaintenance, json, parseBody } from "../../../../../lib/api";
import { getPost, addInteraction, savePost } from "../../../../../lib/wall-data";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  const { id } = await params;
  const body = await parseBody<{
    action?: "like" | "report";
    visitorId?: string;
  }>(request);
  if (
    (body?.action !== "like" && body?.action !== "report") ||
    !body.visitorId ||
    body.visitorId.length > 120
  ) {
    return json({ error: "操作参数无效" }, { status: 400 });
  }
  try {
    const post = await getPost(id);
    if (!post) {
      return json({ error: "帖子不存在" }, { status: 404 });
    }
    const added = await addInteraction(id, body.visitorId, body.action);
    if (added) {
      if (body.action === "like") {
        post.likes += 1;
      } else {
        post.reports += 1;
      }
      await savePost(post);
    }
    return json({
      success: true,
      action: added ? "added" : "unchanged",
      post,
    });
  } catch (error) {
    return apiError(error);
  }
}
