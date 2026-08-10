import {
  applyAdminCookie,
  createAdminToken,
  hasAdminConfig,
  verifyAdminPassword,
} from "../../../../lib/auth";
import { json, parseBody } from "../../../../lib/api";

type LoginAttempt = {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
};

const loginAttempts = new Map<string, LoginAttempt>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 10 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

function clientKey(request: Request) {
  const forwarded =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return forwarded.slice(0, 128);
}

function blockedUntil(key: string) {
  const attempt = loginAttempts.get(key);
  if (!attempt) {
    return 0;
  }
  const now = Date.now();
  if (now - attempt.firstFailureAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return 0;
  }
  return attempt.blockedUntil > now ? attempt.blockedUntil : 0;
}

function recordFailure(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  const attempt =
    current && now - current.firstFailureAt <= LOGIN_WINDOW_MS
      ? current
      : { failures: 0, firstFailureAt: now, blockedUntil: 0 };
  attempt.failures += 1;
  if (attempt.failures >= MAX_LOGIN_FAILURES) {
    attempt.blockedUntil = now + LOGIN_BLOCK_MS;
  }
  loginAttempts.set(key, attempt);
  return attempt;
}

export async function POST(request: Request) {
  if (!hasAdminConfig()) {
    return json({ error: "管理员登录尚未配置" }, { status: 503 });
  }
  const key = clientKey(request);
  const retryAt = blockedUntil(key);
  if (retryAt) {
    const response = json(
      { error: "登录尝试过多，请稍后再试" },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(Math.ceil((retryAt - Date.now()) / 1000)));
    return response;
  }
  const body = await parseBody<{ password?: string }>(request);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !(await verifyAdminPassword(password))) {
    recordFailure(key);
    return json({ error: "密码错误" }, { status: 401 });
  }
  loginAttempts.delete(key);
  const response = json({ success: true });
  applyAdminCookie(response, await createAdminToken());
  return response;
}
