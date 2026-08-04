import { json } from "./api";
import { sha256Hex } from "./s3";
import {
  DATA_PREFIX,
  getStorage,
  hasStorage,
  listAllKeys,
  readJson,
  writeJson,
} from "./storage";

export const DEVICE_COOKIE_NAME = "flzx_device";
// The first five submissions in a rolling minute are allowed. The sixth
// submission (and each later one in that minute) must complete a captcha.
export const SEND_LIMIT = 5;
export const SEND_WINDOW_MS = 60 * 1000;
export const CAPTCHA_TTL_MS = 30 * 1000;

const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const EVENT_PREFIX = DATA_PREFIX + "/send-events/";
const CAPTCHA_PREFIX = DATA_PREFIX + "/captcha/";
const CAPTCHA_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const requestDeviceIds = new WeakMap<Request, string>();

export type CaptchaProof = {
  captchaChallengeId?: unknown;
  captchaAnswer?: unknown;
};

type CaptchaRecord = {
  answerHash: string;
  createdAt: string;
  expiresAt: number;
  attempts: number;
};

type CaptchaCheck = {
  ok: boolean;
  invalid?: boolean;
  expired?: boolean;
};

export type SendGate = {
  allowed: boolean;
  deviceId: string;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
  captchaInvalid?: boolean;
  captchaExpired?: boolean;
};

function readCookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="))
    ?.slice(name.length + 1);
}

function isDeviceId(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

export function getDeviceId(request: Request) {
  const remembered = requestDeviceIds.get(request);
  if (remembered) {
    return remembered;
  }
  const cookie = readCookie(request, DEVICE_COOKIE_NAME);
  const deviceId = isDeviceId(cookie) ? cookie : crypto.randomUUID();
  requestDeviceIds.set(request, deviceId);
  return deviceId;
}

export function withDeviceCookie(request: Request, response: Response) {
  const cookie = readCookie(request, DEVICE_COOKIE_NAME);
  if (isDeviceId(cookie)) {
    return response;
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    DEVICE_COOKIE_NAME +
      "=" +
      getDeviceId(request) +
      "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
      DEVICE_COOKIE_MAX_AGE +
      secure,
  );
  return response;
}

export function deviceJson(
  request: Request,
  data: unknown,
  init: ResponseInit = {},
) {
  return withDeviceCookie(request, json(data, init));
}

function randomInt(maximum: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % maximum;
}

function randomCaptchaAnswer() {
  return Array.from({ length: 6 }, () =>
    CAPTCHA_ALPHABET.charAt(randomInt(CAPTCHA_ALPHABET.length)),
  ).join("");
}

function captchaSvg(answer: string) {
  const width = 286;
  const height = 104;
  const lines = Array.from({ length: 14 }, () => {
    const x1 = randomInt(width);
    const y1 = randomInt(height);
    const x2 = randomInt(width);
    const y2 = randomInt(height);
    const color = ["#4f7cff", "#ec6a8b", "#7c65d8", "#4db68f"][
      randomInt(4)
    ];
    return `<path d="M${x1} ${y1} C${randomInt(width)} ${randomInt(height)} ${randomInt(width)} ${randomInt(height)} ${x2} ${y2}" stroke="${color}" stroke-width="${1 + randomInt(2)}" opacity=".38" fill="none"/>`;
  }).join("");
  const dots = Array.from({ length: 44 }, () => {
    const color = ["#6f86c9", "#df7898", "#8d75bf", "#5ba98b"][randomInt(4)];
    return `<circle cx="${randomInt(width)}" cy="${randomInt(height)}" r="${1 + randomInt(3)}" fill="${color}" opacity=".38"/>`;
  }).join("");
  const letters = answer.split("").map((letter, index) => {
    const x = 31 + index * 45 + randomInt(11);
    const y = 68 + randomInt(14);
    const rotate = -16 + randomInt(33);
    const color = ["#233d72", "#bf4d72", "#4c4393", "#277d63"][
      index % 4
    ];
    return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" fill="${color}" font-family="Arial, sans-serif" font-size="42" font-weight="800">${letter}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="20" fill="#f8fafc"/>${lines}${dots}${letters}<path d="M18 86 C80 67 179 98 270 72" stroke="#1f2937" stroke-width="2" opacity=".2" fill="none"/></svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

async function constantTimeEqual(left: string, right: string) {
  const [leftBytes, rightBytes] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftView = new Uint8Array(leftBytes);
  const rightView = new Uint8Array(rightBytes);
  let difference = 0;
  for (let index = 0; index < leftView.length; index += 1) {
    difference |= leftView[index] ^ rightView[index];
  }
  return difference === 0;
}

function captchaKey(deviceHash: string, challengeId: string) {
  return CAPTCHA_PREFIX + deviceHash + "/" + challengeId + ".json";
}

function eventPrefix(deviceHash: string) {
  return EVENT_PREFIX + deviceHash + "/";
}

function eventTimestamp(key: string) {
  const match = key.match(/\/(\d{13})_[^/]+\.json$/);
  return match ? Number(match[1]) : 0;
}

async function consumeCaptcha(
  deviceHash: string,
  deviceId: string,
  challengeId: string,
  answer: string,
): Promise<CaptchaCheck> {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) {
    return { ok: false, invalid: true };
  }
  const store = getStorage();
  const key = captchaKey(deviceHash, challengeId);
  const record = await readJson<CaptchaRecord>(store, key);
  if (!record) {
    return { ok: false, invalid: true, expired: true };
  }
  if (record.expiresAt <= Date.now()) {
    await store.deleteObject(key);
    return { ok: false, invalid: true, expired: true };
  }
  const normalized = answer.trim().toLowerCase();
  const expectedHash = await sha256Hex(deviceId + "|" + normalized);
  if (!(await constantTimeEqual(expectedHash, record.answerHash))) {
    if (record.attempts >= 4) {
      await store.deleteObject(key);
    } else {
      await writeJson(store, key, { ...record, attempts: record.attempts + 1 });
    }
    return { ok: false, invalid: true };
  }
  await store.deleteObject(key);
  return { ok: true };
}

export async function issueCaptcha(request: Request) {
  const deviceId = getDeviceId(request);
  const deviceHash = await sha256Hex(deviceId);
  const answer = randomCaptchaAnswer();
  const challengeId = crypto.randomUUID();
  const expiresAt = Date.now() + CAPTCHA_TTL_MS;
  await writeJson(getStorage(), captchaKey(deviceHash, challengeId), {
    answerHash: await sha256Hex(deviceId + "|" + answer.toLowerCase()),
    createdAt: new Date().toISOString(),
    expiresAt,
    attempts: 0,
  } satisfies CaptchaRecord);
  return {
    challengeId,
    image: captchaSvg(answer),
    expiresAt,
    seconds: Math.ceil(CAPTCHA_TTL_MS / 1000),
  };
}

export async function enforceSendLimit(
  request: Request,
  proof: CaptchaProof = {},
): Promise<SendGate> {
  const deviceId = getDeviceId(request);
  if (!hasStorage()) {
    return {
      allowed: true,
      deviceId,
      count: 0,
      remaining: SEND_LIMIT,
      retryAfterSeconds: 0,
    };
  }
  const store = getStorage();
  const deviceHash = await sha256Hex(deviceId);
  const now = Date.now();
  const keys = await listAllKeys(store, eventPrefix(deviceHash), 1000);
  const active = keys
    .map((key) => ({ key, timestamp: eventTimestamp(key) }))
    .filter((item) => item.timestamp > now - SEND_WINDOW_MS);
  const expired = keys.filter((key) => eventTimestamp(key) <= now - SEND_WINDOW_MS);
  if (expired.length > 0) {
    await Promise.all(expired.slice(0, 100).map((key) => store.deleteObject(key)));
  }
  const oldest = active.reduce(
    (value, item) => Math.min(value, item.timestamp),
    now,
  );
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((oldest + SEND_WINDOW_MS - now) / 1000),
  );
  if (active.length >= SEND_LIMIT) {
    const challengeId =
      typeof proof.captchaChallengeId === "string"
        ? proof.captchaChallengeId.trim()
        : "";
    const answer =
      typeof proof.captchaAnswer === "string" ? proof.captchaAnswer : "";
    if (!challengeId || !answer) {
      return {
        allowed: false,
        deviceId,
        count: active.length,
        remaining: 0,
        retryAfterSeconds,
      };
    }
    const captcha = await consumeCaptcha(
      deviceHash,
      deviceId,
      challengeId,
      answer,
    );
    if (!captcha.ok) {
      return {
        allowed: false,
        deviceId,
        count: active.length,
        remaining: 0,
        retryAfterSeconds,
        captchaInvalid: captcha.invalid,
        captchaExpired: captcha.expired,
      };
    }
  }
  await writeJson(store, eventPrefix(deviceHash) + Date.now() + "_" + crypto.randomUUID() + ".json", {
    deviceHash,
    createdAt: new Date().toISOString(),
  });
  return {
    allowed: true,
    deviceId,
    count: active.length + 1,
    remaining: Math.max(0, SEND_LIMIT - active.length - 1),
    retryAfterSeconds,
  };
}

export function sendGateResponse(request: Request, gate: SendGate) {
  const invalidMessage = gate.captchaExpired
    ? "验证码已过期，请刷新图片"
    : "验证码错误，请重新输入";
  return deviceJson(
    request,
    {
      error: gate.captchaInvalid ? invalidMessage : "发送过于频繁，请完成验证码后再发送",
      captchaRequired: true,
      captchaInvalid: Boolean(gate.captchaInvalid),
      captchaExpired: Boolean(gate.captchaExpired),
      retryAfterSeconds: gate.retryAfterSeconds,
    },
    {
      status: gate.captchaInvalid ? 422 : 429,
      headers: { "Retry-After": String(gate.retryAfterSeconds) },
    },
  );
}
