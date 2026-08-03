import { apiError, guardMaintenance, json, parseBody } from "../../../../../lib/api";
import { hasStorage } from "../../../../../lib/storage";
import { getPost, ReplyRecord, saveReply } from "../../../../../lib/wall-data";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  const { id } = await params;
  const body = await parseBody<{ author?: string; content?: string }>(request);
  const content = body?.content?.trim() ?? "";
  if (!content || content.length > 200) {
    return json({ error: "回复不能为空且不能超过 200 字" }, { status: 400 });
  }
  try {
    if (!(await getPost(id))) {
      return json({ error: "帖子不存在" }, { status: 404 });
    }
    const reply: ReplyRecord = {
      id: crypto.randomUUID(),
      postId: id,
      author: body?.author?.trim().slice(0, 20) || "匿名同学",
      content,
      createdAt: new Date().toISOString(),
    };
    await saveReply(reply);
    return json({ success: true, reply });
  } catch (error) {
    return apiError(error);
  }
}
