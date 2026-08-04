import { apiError, json, requireAdmin } from "../../../../lib/api";
import { listPosts, toPublicPost } from "../../../../lib/wall-data";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  try {
    return json({ posts: (await listPosts()).map(toPublicPost) });
  } catch (error) {
    return apiError(error);
  }
}
