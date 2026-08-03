import { clearAdminCookie } from "../../../../lib/auth";
import { json, requireAdmin } from "../../../../lib/api";

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  const response = json({ success: true });
  clearAdminCookie(response);
  return response;
}
