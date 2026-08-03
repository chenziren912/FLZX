import { readJson } from "./storage";
import {
  hasStorage,
  MAINTENANCE_KEY,
  getStorage,
  primaryStorageError,
} from "./storage";
import { requestIsAdmin } from "./auth";

export const MAINTENANCE_MESSAGE = "服务器正在重启更新";

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(error: unknown, status = 500) {
  console.error(error);
  return json(
    { error: primaryStorageError(error) },
    { status },
  );
}

export async function requireAdmin(request: Request) {
  if (!(await requestIsAdmin(request))) {
    return json({ error: "未授权" }, { status: 401 });
  }
  return null;
}

export async function guardMaintenance() {
  if (!hasStorage()) {
    return null;
  }
  try {
    const state = await readJson<{ enabled?: boolean }>(
      getStorage(),
      MAINTENANCE_KEY,
    );
    if (state?.enabled) {
      return json(
        {
          error: MAINTENANCE_MESSAGE,
          maintenance: true,
        },
        {
          status: 503,
          headers: {
            "Retry-After": "60",
          },
        },
      );
    }
    return null;
  } catch (error) {
    return apiError(error, 503);
  }
}

export async function parseBody<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
