import { apiError, guardMaintenance, json, parseBody, requireAdmin } from "../../../lib/api";
import { getAccessBlock, resolveRequestIdentity } from "../../../lib/accounts";
import { getChatGPTUser } from "../../chatgpt-auth";
import { hasStorage } from "../../../lib/storage";
import {
  AnnouncementRecord,
  deleteAnnouncement,
  listAnnouncements,
  saveAnnouncement,
} from "../../../lib/wall-data";

export async function GET(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  try {
    const identity = await resolveRequestIdentity(request, await getChatGPTUser());
    const accessBlock = await getAccessBlock(identity, "read");
    if (accessBlock) {
      return json(
        { error: accessBlock.message, blocked: true },
        {
          status: accessBlock.status,
          headers: accessBlock.retryAfterSeconds
            ? { "Retry-After": String(accessBlock.retryAfterSeconds) }
            : undefined,
        },
      );
    }
    return json(
      { announcements: await listAnnouncements() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  const body = await parseBody<{ title?: string; content?: string }>(request);
  const title = typeof body?.title === "string" ? body.title.trim() : "校园公告";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!title || title.length > 80 || !content || content.length > 500) {
    return json({ error: "公告标题或内容不符合要求" }, { status: 400 });
  }
  const announcement: AnnouncementRecord = {
    id: crypto.randomUUID(),
    title,
    content,
    createdAt: new Date().toISOString(),
  };
  try {
    await saveAnnouncement(announcement);
    return json({ success: true, announcement });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  const body = await parseBody<{ id?: string }>(request);
  if (!body?.id || !/^[a-z0-9-]{36}$/i.test(body.id)) {
    return json({ error: "公告编号无效" }, { status: 400 });
  }
  try {
    const deleted = await deleteAnnouncement(body.id);
    if (!deleted) {
      return json({ error: "公告不存在" }, { status: 404 });
    }
    return json({ success: true, id: body.id });
  } catch (error) {
    return apiError(error);
  }
}
