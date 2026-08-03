import { apiError, guardMaintenance, json, parseBody, requireAdmin } from "../../../lib/api";
import { hasStorage } from "../../../lib/storage";
import {
  AnnouncementRecord,
  listAnnouncements,
  saveAnnouncement,
} from "../../../lib/wall-data";

export async function GET() {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  try {
    return json({ announcements: await listAnnouncements() });
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
  const body = await parseBody<{ content?: string }>(request);
  const content = body?.content?.trim() ?? "";
  if (!content || content.length > 500) {
    return json({ error: "公告不能为空且不能超过 500 字" }, { status: 400 });
  }
  const announcement: AnnouncementRecord = {
    id: crypto.randomUUID(),
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
