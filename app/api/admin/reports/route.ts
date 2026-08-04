import { apiError, json, requireAdmin } from "../../../../lib/api";
import {
  listPosts,
  listReports,
  ReportStatus,
  toPublicPost,
  toSafeReport,
  updateReportStatus,
} from "../../../../lib/wall-data";

const statuses = new Set<ReportStatus>(["open", "resolved", "dismissed"]);

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  try {
    const [reports, posts] = await Promise.all([listReports(), listPosts()]);
    return json({
      reports: reports.map(toSafeReport),
      reportedPosts: posts
        .filter((post) => post.reports > 0)
        .map(toPublicPost),
    });
  } catch (error) {
    return apiError(error, 503);
  }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    status?: unknown;
  } | null;
  if (
    typeof body?.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,120}$/.test(body.id) ||
    typeof body.status !== "string" ||
    !statuses.has(body.status as ReportStatus)
  ) {
    return json({ error: "举报处理参数无效" }, { status: 400 });
  }
  try {
    const report = await updateReportStatus(
      body.id,
      body.status as ReportStatus,
    );
    if (!report) {
      return json({ error: "举报记录不存在" }, { status: 404 });
    }
    return json({ success: true, report: toSafeReport(report) });
  } catch (error) {
    return apiError(error, 503);
  }
}
