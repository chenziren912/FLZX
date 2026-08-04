import { apiError, guardMaintenance, json, parseBody } from "../../../../../lib/api";
import { addInteraction, addReport, getPost, savePost, toPublicPost } from "../../../../../lib/wall-data";

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
    reason?: string;
  }>(request);
  const visitorId = typeof body?.visitorId === "string" ? body.visitorId.trim() : "";
  if (
    (body?.action !== "like" && body?.action !== "report") ||
    !visitorId ||
    visitorId.length > 120 ||
    (body?.reason !== undefined && typeof body.reason !== "string")
  ) {
    return json({ error: "操作参数无效" }, { status: 400 });
  }
  try {
    const post = await getPost(id);
    if (!post) {
      return json({ error: "帖子不存在" }, { status: 404 });
    }
    const added =
      body.action === "report"
        ? Boolean(await addReport(id, visitorId, body.reason?.trim() ?? ""))
        : await addInteraction(id, visitorId, body.action);
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
      post: toPublicPost(post),
    });
  } catch (error) {
    return apiError(error);
  }
}
