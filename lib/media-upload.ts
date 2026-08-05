const TOKEN_TTL_MS = 15 * 60 * 1000;

function tokenSecret() {
  return (
    process.env.COS_SECRET_ACCESS_KEY ??
    process.env.OSS_SECRET_ACCESS_KEY ??
    process.env.ADMIN_SESSION_SECRET ??
    ""
  );
}

function toBase64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((item) => {
    binary += String.fromCharCode(item);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importTokenKey(usage: KeyUsage[]) {
  const secret = tokenSecret();
  if (!secret) {
    throw new Error("媒体上传签名密钥尚未配置");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function createMediaUploadToken(key: string, type: string) {
  const payload = JSON.stringify({
    key,
    type,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  const signingKey = await importTokenKey(["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      signingKey,
      new TextEncoder().encode(payload),
    ),
  );
  return (
    toBase64Url(new TextEncoder().encode(payload)) +
    "." +
    toBase64Url(signature)
  );
}

export async function verifyMediaUploadToken(
  token: string,
  key: string,
  type: string,
) {
  try {
    const [encodedPayload, encodedSignature] = token.split(".");
    if (!encodedPayload || !encodedSignature) {
      return false;
    }
    const payloadBytes = fromBase64Url(encodedPayload);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      key?: unknown;
      type?: unknown;
      expiresAt?: unknown;
    };
    if (
      payload.key !== key ||
      payload.type !== type ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Date.now()
    ) {
      return false;
    }
    const signingKey = await importTokenKey(["verify"]);
    return crypto.subtle.verify(
      "HMAC",
      signingKey,
      fromBase64Url(encodedSignature),
      payloadBytes,
    );
  } catch {
    return false;
  }
}
