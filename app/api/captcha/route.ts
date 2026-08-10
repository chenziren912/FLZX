import { apiError, guardMaintenance } from "../../../lib/api";
import { getAccessBlock, resolveRequestIdentity } from "../../../lib/accounts";
import {
  deviceJson,
  issueCaptcha,
  withDeviceCookie,
} from "../../../lib/device-rate";
import { hasStorage } from "../../../lib/storage";

export async function POST(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return withDeviceCookie(request, blocked);
  }
  if (!hasStorage()) {
    return deviceJson(request, { error: "验证码服务尚未配置" }, { status: 503 });
  }
  try {
    const identity = await resolveRequestIdentity(request, null);
    const accessBlock = await getAccessBlock(identity, "write");
    if (accessBlock) {
      return deviceJson(
        request,
        { error: accessBlock.message, blocked: true },
        {
          status: accessBlock.status,
          headers: accessBlock.retryAfterSeconds
            ? { "Retry-After": String(accessBlock.retryAfterSeconds) }
            : undefined,
        },
      );
    }
    // The challenge is stored server-side; only the rendered noise image and
    // an opaque id are returned to the browser.
    return deviceJson(request, await issueCaptcha(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return withDeviceCookie(request, apiError(error, 503));
  }
}
