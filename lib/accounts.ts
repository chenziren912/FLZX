import type { ChatGPTUser } from "../app/chatgpt-auth";
import { getDeviceId } from "./device-rate";
import { sha256Hex } from "./s3";
import {
  DATA_PREFIX,
  getStorage,
  hasStorage,
  listAllKeys,
  readJson,
  writeJson,
} from "./storage";

export type RestrictionKind = "ban" | "mute";

export type Restriction = {
  kind: RestrictionKind;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
};

export type AccountRecord = {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  xp: number;
  postCount: number;
  replyCount: number;
  lastPostAt?: string;
  restriction?: Restriction | null;
};

export type AccountMessage = {
  id: string;
  accountId: string;
  title: string;
  content: string;
  createdAt: string;
  readAt?: string;
};

export type IpRestrictionRecord = {
  ipHash: string;
  updatedAt: string;
  restriction: Restriction | null;
};

export type RequestIdentity = {
  account: AccountRecord | null;
  ipHash: string | null;
};

export type AccessScope = "read" | "write" | "react";

export type AccessBlock = {
  status: 403 | 423;
  message: string;
  retryAfterSeconds?: number;
};

export type PostingRule = {
  level: number;
  cooldownSeconds: number;
  nextLevelXp: number | null;
};

export type PostCooldownGate = PostingRule & {
  allowed: boolean;
  retryAfterSeconds: number;
  subjectHash: string;
};

const ACCOUNTS_PREFIX = DATA_PREFIX + "/accounts/";
const ACCOUNT_MESSAGES_PREFIX = DATA_PREFIX + "/account-messages/";
const IP_RESTRICTIONS_PREFIX = DATA_PREFIX + "/moderation/ip/";
const POST_EVENTS_PREFIX = DATA_PREFIX + "/post-events/";

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{64}$/i;
const IP_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const POST_EVENT_RETENTION_MS = 5 * 60 * 1000;

const LEVELS = [
  { level: 1, minimumXp: 0, cooldownSeconds: 45 },
  { level: 2, minimumXp: 80, cooldownSeconds: 25 },
  { level: 3, minimumXp: 240, cooldownSeconds: 12 },
  { level: 4, minimumXp: 600, cooldownSeconds: 5 },
] as const;

function normalizeDisplayName(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return (compact || "已登录同学").slice(0, 20);
}

function accountKey(accountId: string) {
  return ACCOUNTS_PREFIX + accountId + ".json";
}

function messagePrefix(accountId: string) {
  return ACCOUNT_MESSAGES_PREFIX + accountId + "/";
}

function messageKey(accountId: string, createdAt: string, id: string) {
  return (
    messagePrefix(accountId) +
    createdAt.replace(/\D/g, "") +
    "_" +
    id +
    ".json"
  );
}

function ipRestrictionKey(ipHash: string) {
  return IP_RESTRICTIONS_PREFIX + ipHash + ".json";
}

function postEventPrefix(subjectHash: string) {
  return POST_EVENTS_PREFIX + subjectHash + "/";
}

function postEventTimestamp(key: string) {
  const match = key.match(/\/(\d{13})_[^/]+\.json$/);
  return match ? Number(match[1]) : 0;
}

function isActiveRestriction(restriction: Restriction | null | undefined) {
  if (!restriction) {
    return false;
  }
  if (!restriction.expiresAt) {
    return true;
  }
  const expiry = Date.parse(restriction.expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

function restrictionRetryAfterSeconds(restriction: Restriction) {
  if (!restriction.expiresAt) {
    return undefined;
  }
  const expiry = Date.parse(restriction.expiresAt);
  if (!Number.isFinite(expiry)) {
    return undefined;
  }
  return Math.max(1, Math.ceil((expiry - Date.now()) / 1000));
}

function cleanAccount(record: AccountRecord): AccountRecord {
  return {
    ...record,
    displayName: normalizeDisplayName(record.displayName),
    xp: Math.max(0, Math.floor(Number(record.xp) || 0)),
    postCount: Math.max(0, Math.floor(Number(record.postCount) || 0)),
    replyCount: Math.max(0, Math.floor(Number(record.replyCount) || 0)),
    restriction: record.restriction ?? null,
  };
}

export function isAccountId(value: string) {
  return ACCOUNT_ID_PATTERN.test(value);
}

export function isIpHash(value: string) {
  return IP_HASH_PATTERN.test(value);
}

export async function accountIdForUser(user: ChatGPTUser) {
  return sha256Hex("chatgpt-account:" + user.userId);
}

export async function getAccount(accountId: string) {
  if (!hasStorage() || !isAccountId(accountId)) {
    return null;
  }
  const record = await readJson<AccountRecord>(getStorage(), accountKey(accountId));
  return record ? cleanAccount(record) : null;
}

export async function getOrCreateAccount(user: ChatGPTUser) {
  const accountId = await accountIdForUser(user);
  const current = await getAccount(accountId);
  const displayName = normalizeDisplayName(user.displayName);
  if (current) {
    if (current.displayName !== displayName) {
      const updated = {
        ...current,
        displayName,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(getStorage(), accountKey(accountId), updated);
      return updated;
    }
    return current;
  }
  const now = new Date().toISOString();
  const account: AccountRecord = {
    id: accountId,
    displayName,
    createdAt: now,
    updatedAt: now,
    xp: 0,
    postCount: 0,
    replyCount: 0,
    restriction: null,
  };
  await writeJson(getStorage(), accountKey(accountId), account);
  return account;
}

export async function getAccountForUser(user: ChatGPTUser) {
  return getAccount(await accountIdForUser(user));
}

export function getPostingRule(account: AccountRecord | null): PostingRule {
  if (!account) {
    return { level: 0, cooldownSeconds: 60, nextLevelXp: null };
  }
  const current = [...LEVELS]
    .reverse()
    .find((level) => account.xp >= level.minimumXp) ?? LEVELS[0];
  const next = LEVELS.find((level) => level.minimumXp > account.xp) ?? null;
  return {
    level: current.level,
    cooldownSeconds: current.cooldownSeconds,
    nextLevelXp: next?.minimumXp ?? null,
  };
}

export function accountPublicProfile(account: AccountRecord) {
  return {
    id: account.id,
    displayName: account.displayName,
    createdAt: account.createdAt,
    xp: account.xp,
    postCount: account.postCount,
    replyCount: account.replyCount,
    postingRule: getPostingRule(account),
    restriction: isActiveRestriction(account.restriction)
      ? account.restriction
      : null,
  };
}

export async function listAccounts() {
  if (!hasStorage()) {
    return [];
  }
  const store = getStorage();
  const keys = await listAllKeys(store, ACCOUNTS_PREFIX, 3000);
  const accounts = (
    await Promise.all(keys.map((key) => readJson<AccountRecord>(store, key)))
  )
    .filter((record): record is AccountRecord => Boolean(record))
    .map((record) => {
      const account = cleanAccount(record);
      return {
        ...account,
        restriction: isActiveRestriction(account.restriction)
          ? account.restriction
          : null,
      };
    });
  return accounts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function setAccountRestriction(
  accountId: string,
  restriction: Restriction | null,
) {
  const account = await getAccount(accountId);
  if (!account) {
    return null;
  }
  const updated: AccountRecord = {
    ...account,
    restriction,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(getStorage(), accountKey(accountId), updated);
  return updated;
}

export async function grantExperience(
  accountId: string | undefined,
  kind: "post" | "reply",
) {
  if (!accountId) {
    return null;
  }
  const account = await getAccount(accountId);
  if (!account) {
    return null;
  }
  const now = new Date().toISOString();
  const updated: AccountRecord = {
    ...account,
    xp: account.xp + (kind === "post" ? 20 : 6),
    postCount: account.postCount + (kind === "post" ? 1 : 0),
    replyCount: account.replyCount + (kind === "reply" ? 1 : 0),
    lastPostAt: kind === "post" ? now : account.lastPostAt,
    updatedAt: now,
  };
  await writeJson(getStorage(), accountKey(accountId), updated);
  return updated;
}

export async function listAccountMessages(accountId: string, maxItems = 60) {
  if (!hasStorage() || !isAccountId(accountId)) {
    return [];
  }
  const store = getStorage();
  const keys = await listAllKeys(store, messagePrefix(accountId), maxItems);
  const messages = (
    await Promise.all(keys.map((key) => readJson<AccountMessage>(store, key)))
  ).filter((message): message is AccountMessage => Boolean(message));
  return messages.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function sendAccountMessage(
  accountId: string,
  title: string,
  content: string,
) {
  if (!isAccountId(accountId) || !(await getAccount(accountId))) {
    return null;
  }
  const message: AccountMessage = {
    id: crypto.randomUUID(),
    accountId,
    title: title.trim().slice(0, 80),
    content: content.trim().slice(0, 1000),
    createdAt: new Date().toISOString(),
  };
  await writeJson(
    getStorage(),
    messageKey(accountId, message.createdAt, message.id),
    message,
  );
  return message;
}

export async function markAccountMessageRead(accountId: string, messageId: string) {
  if (!isAccountId(accountId) || !/^[a-z0-9-]{36}$/i.test(messageId)) {
    return null;
  }
  const store = getStorage();
  const key = (await listAllKeys(store, messagePrefix(accountId), 300)).find((item) =>
    item.endsWith("_" + messageId + ".json"),
  );
  if (!key) {
    return null;
  }
  const message = await readJson<AccountMessage>(store, key);
  if (!message) {
    return null;
  }
  const updated = message.readAt ? message : { ...message, readAt: new Date().toISOString() };
  if (!message.readAt) {
    await writeJson(store, key, updated);
  }
  return updated;
}

export function unreadMessageCount(messages: AccountMessage[]) {
  return messages.filter((message) => !message.readAt).length;
}

function normalizeClientIp(value: string | null) {
  if (!value) {
    return null;
  }
  const first = value.split(",")[0]?.trim().replace(/^\[|\]$/g, "") ?? "";
  // We deliberately keep only syntactically conservative IPv4/IPv6 forms.
  // The raw address is never stored or returned to an administrator.
  return /^[0-9a-f:.]{3,64}$/i.test(first) ? first.toLowerCase() : null;
}

export async function getRequestIpHash(request: Request) {
  const ip =
    normalizeClientIp(request.headers.get("cf-connecting-ip")) ??
    normalizeClientIp(request.headers.get("x-forwarded-for")) ??
    normalizeClientIp(request.headers.get("x-real-ip"));
  return ip ? sha256Hex("campus-wall-ip:" + ip) : null;
}

export async function resolveRequestIdentity(
  request: Request,
  user: ChatGPTUser | null,
  options: { createAccount?: boolean } = {},
): Promise<RequestIdentity> {
  const [ipHash, account] = await Promise.all([
    getRequestIpHash(request),
    user
      ? options.createAccount
        ? getOrCreateAccount(user)
        : getAccountForUser(user)
      : Promise.resolve(null),
  ]);
  return { account, ipHash };
}

export async function getIpRestriction(ipHash: string | null) {
  if (!ipHash || !hasStorage() || !isIpHash(ipHash)) {
    return null;
  }
  return readJson<IpRestrictionRecord>(getStorage(), ipRestrictionKey(ipHash));
}

export async function listIpRestrictions() {
  if (!hasStorage()) {
    return [];
  }
  const store = getStorage();
  const keys = await listAllKeys(store, IP_RESTRICTIONS_PREFIX, 3000);
  const records = (
    await Promise.all(keys.map((key) => readJson<IpRestrictionRecord>(store, key)))
  ).filter((record): record is IpRestrictionRecord => Boolean(record));
  return records
    .filter((record) => isActiveRestriction(record.restriction))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function setIpRestriction(
  ipHash: string,
  restriction: Restriction | null,
) {
  if (!isIpHash(ipHash)) {
    return null;
  }
  const record: IpRestrictionRecord = {
    ipHash,
    updatedAt: new Date().toISOString(),
    restriction,
  };
  await writeJson(getStorage(), ipRestrictionKey(ipHash), record);
  return record;
}

export async function getAccessBlock(
  identity: RequestIdentity,
  scope: AccessScope,
): Promise<AccessBlock | null> {
  const [accountRestriction, ipRecord] = await Promise.all([
    identity.account?.restriction ?? null,
    getIpRestriction(identity.ipHash),
  ]);
  const restrictions = [accountRestriction, ipRecord?.restriction ?? null].filter(
    (restriction): restriction is Restriction => isActiveRestriction(restriction),
  );
  const ban = restrictions.find((restriction) => restriction.kind === "ban");
  if (ban) {
    return {
      status: 403,
      message: "当前账号或网络已被封禁，暂时无法使用校园墙。",
      retryAfterSeconds: restrictionRetryAfterSeconds(ban),
    };
  }
  if (scope === "write") {
    const mute = restrictions.find((restriction) => restriction.kind === "mute");
    if (mute) {
      return {
        status: 423,
        message: "当前账号或网络已被禁言，暂时不能发送内容。",
        retryAfterSeconds: restrictionRetryAfterSeconds(mute),
      };
    }
  }
  return null;
}

export async function checkPostCooldown(
  request: Request,
  account: AccountRecord | null,
): Promise<PostCooldownGate> {
  const rule = getPostingRule(account);
  const subject = account ? "account:" + account.id : "device:" + getDeviceId(request);
  const subjectHash = await sha256Hex(subject);
  if (!hasStorage()) {
    return { ...rule, allowed: true, retryAfterSeconds: 0, subjectHash };
  }
  const now = Date.now();
  const store = getStorage();
  const keys = await listAllKeys(store, postEventPrefix(subjectHash), 200);
  const latest = keys.reduce(
    (current, key) => Math.max(current, postEventTimestamp(key)),
    0,
  );
  const elapsed = now - latest;
  const cooldownMs = rule.cooldownSeconds * 1000;
  if (latest > 0 && elapsed < cooldownMs) {
    return {
      ...rule,
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000)),
      subjectHash,
    };
  }
  return { ...rule, allowed: true, retryAfterSeconds: 0, subjectHash };
}

export async function recordPostCooldown(gate: PostCooldownGate) {
  if (!hasStorage()) {
    return;
  }
  const store = getStorage();
  const prefix = postEventPrefix(gate.subjectHash);
  const now = Date.now();
  const keys = await listAllKeys(store, prefix, 200);
  const expired = keys.filter(
    (key) => postEventTimestamp(key) <= now - POST_EVENT_RETENTION_MS,
  );
  if (expired.length) {
    await Promise.all(expired.slice(0, 100).map((key) => store.deleteObject(key)));
  }
  await writeJson(
    store,
    prefix + now + "_" + crypto.randomUUID() + ".json",
    { createdAt: new Date().toISOString() },
  );
}
