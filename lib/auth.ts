import { cookies } from "next/headers";
import { hmacBase64Url } from "./s3";

const COOKIE_NAME = "flzx_admin";
const SESSION_LIFETIME = 60 * 60 * 12;

function secret() {
  return process.env.ADMIN_SESSION_SECRET ?? process.env.ADMIN_PASSWORD ?? "";
}

function encode(value: string) {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decode(value: string) {
  return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
}

async function constantTimeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function hasAdminConfig() {
  return Boolean(process.env.ADMIN_PASSWORD && secret());
}

export async function verifyAdminPassword(candidate: string) {
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected && (await constantTimeEqual(candidate, expected)));
}

export async function createAdminToken() {
  const payload = encode(
    JSON.stringify({
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + SESSION_LIFETIME,
    }),
  );
  const signature = await hmacBase64Url(secret(), payload);
  return payload + "." + signature;
}

export async function isAdminTokenValid(token: string | undefined) {
  if (!token || !secret()) {
    return false;
  }
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }
  const expected = await hmacBase64Url(secret(), payload);
  if (!(await constantTimeEqual(expected, signature))) {
    return false;
  }
  try {
    const data = JSON.parse(decode(payload)) as { role?: string; exp?: number };
    return data.role === "admin" && Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function requestIsAdmin(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const cookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(COOKIE_NAME + "="));
  return isAdminTokenValid(cookie?.slice(COOKIE_NAME.length + 1));
}

export async function serverIsAdmin() {
  const store = await cookies();
  return isAdminTokenValid(store.get(COOKIE_NAME)?.value);
}

export function applyAdminCookie(response: Response, token: string) {
  response.headers.append(
    "Set-Cookie",
    COOKIE_NAME +
      "=" +
      token +
      "; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=" +
      SESSION_LIFETIME,
  );
}

export function clearAdminCookie(response: Response) {
  response.headers.append(
    "Set-Cookie",
    COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0",
  );
}

export { COOKIE_NAME };
