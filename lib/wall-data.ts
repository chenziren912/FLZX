import { sha256Hex } from "./s3";
import {
  DATA_PREFIX,
  getStorage,
  hasStorage,
  listAllKeys,
  readJson,
  writeJson,
  isMediaKey,
} from "./storage";

export type MediaRecord = {
  key: string;
  name: string;
  type: string;
  size: number;
  url?: string;
};

export type PostRecord = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  deleteTokenHash: string;
  // These fields are deliberately private. Public API serializers below omit
  // them, while the administrator can use their opaque hashes for moderation.
  accountId?: string;
  sourceIpHash?: string;
  media: MediaRecord[];
  likes: number;
  reports: number;
  format?: "plain" | "markdown";
};

export type ReplyRecord = {
  id: string;
  postId: string;
  author: string;
  content: string;
  createdAt: string;
  accountId?: string;
  sourceIpHash?: string;
};

export type AnnouncementRecord = {
  id: string;
  title?: string;
  content: string;
  createdAt: string;
  expiresAt?: string | null;
};

export type ReportStatus = "open" | "resolved" | "dismissed";

export type ReportRecord = {
  id: string;
  postId: string;
  reason: string;
  createdAt: string;
  status: ReportStatus;
  visitorHash: string;
  accountId?: string;
  sourceIpHash?: string;
};

export type SafeReport = Omit<ReportRecord, "visitorHash">;

const POSTS_PREFIX = DATA_PREFIX + "/posts/";
const REPLIES_PREFIX = DATA_PREFIX + "/replies/";
const ANNOUNCEMENTS_PREFIX = DATA_PREFIX + "/announcements/";
const REPORTS_PREFIX = DATA_PREFIX + "/reports/";
const MARKDOWN_PREVIEW_LENGTH = 520;

export function postKey(createdAt: string, id: string) {
  return POSTS_PREFIX + createdAt.replace(/\D/g, "") + "_" + id + ".json";
}

export function replyKey(createdAt: string, postId: string, id: string) {
  return (
    REPLIES_PREFIX +
    postId +
    "/" +
    createdAt.replace(/\D/g, "") +
    "_" +
    id +
    ".json"
  );
}

export function announcementKey(createdAt: string, id: string) {
  return ANNOUNCEMENTS_PREFIX + createdAt.replace(/\D/g, "") + "_" + id + ".json";
}

export function reportKey(createdAt: string, id: string) {
  return REPORTS_PREFIX + createdAt.replace(/\D/g, "") + "_" + id + ".json";
}

async function findKeyById(prefix: string, id: string) {
  if (!hasStorage()) {
    return null;
  }
  const keys = await listAllKeys(getStorage(), prefix);
  return keys.find((key) => key.endsWith("_" + id + ".json")) ?? null;
}

export async function listPosts(search = "") {
  if (!hasStorage()) {
    return [];
  }
  const store = getStorage();
  const keys = await listAllKeys(store, POSTS_PREFIX);
  const records = (
    await Promise.all(keys.map((key) => readJson<PostRecord>(store, key)))
  ).filter((item): item is PostRecord => Boolean(item));
  const keyword = search.trim().slice(0, 80).toLowerCase();
  return records
    .filter((post) => {
      if (!keyword) {
        return true;
      }
      return (
        (post.author ?? "").toLowerCase().includes(keyword) ||
        (post.content ?? "").toLowerCase().includes(keyword)
      );
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function postCursor(post: PostRecord) {
  return post.createdAt + "|" + post.id;
}

export type PostPage = {
  posts: PostRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * COS does not offer a useful secondary index for the wall's text search, so
 * we still filter the records server-side. Returning only a compact page to
 * the browser keeps the visible feed lazy, even for a much larger wall.
 */
export async function listPostsPage(
  search = "",
  cursor = "",
  limit = 12,
): Promise<PostPage> {
  const posts = await listPosts(search);
  const pageSize = Math.min(30, Math.max(6, Math.floor(limit) || 12));
  const startIndex = cursor
    ? Math.max(0, posts.findIndex((post) => postCursor(post) === cursor) + 1)
    : 0;
  const page = posts.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + page.length < posts.length;
  return {
    posts: page,
    nextCursor: hasMore && page.length ? postCursor(page[page.length - 1]) : null,
    hasMore,
  };
}

export type PublicPost = Omit<
  PostRecord,
  "deleteTokenHash" | "accountId" | "sourceIpHash"
> & {
  hasMore?: boolean;
};

export type AdminPost = Omit<PostRecord, "deleteTokenHash">;
export type PublicReply = Omit<ReplyRecord, "accountId" | "sourceIpHash">;

function markdownPreview(content: string) {
  if (content.length <= MARKDOWN_PREVIEW_LENGTH) {
    return content;
  }
  const candidate = content.slice(0, MARKDOWN_PREVIEW_LENGTH);
  const breakAt = Math.max(
    candidate.lastIndexOf("\n\n"),
    candidate.lastIndexOf("\n"),
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("！"),
    candidate.lastIndexOf("？"),
  );
  const end = breakAt >= 180 ? breakAt + 1 : candidate.length;
  const excerpt = content.slice(0, end).trimEnd();
  // Avoid turning the rest of an excerpt into a fenced code block. The full
  // source is still fetched only after the reader requests it.
  const fences = excerpt.match(/```/g)?.length ?? 0;
  return excerpt + (fences % 2 === 1 ? "\n```\n\n…" : "\n\n…");
}

export function toPublicPost(
  post: PostRecord,
  options: { summary?: boolean } = {},
): PublicPost {
  const { deleteTokenHash, accountId, sourceIpHash, ...publicPost } = post;
  void deleteTokenHash;
  void accountId;
  void sourceIpHash;
  if (
    options.summary &&
    publicPost.format === "markdown" &&
    publicPost.content.length > MARKDOWN_PREVIEW_LENGTH
  ) {
    return {
      ...publicPost,
      content: markdownPreview(publicPost.content),
      hasMore: true,
    };
  }
  return publicPost;
}

export function toAdminPost(post: PostRecord): AdminPost {
  const { deleteTokenHash, ...adminPost } = post;
  void deleteTokenHash;
  return adminPost;
}

export function toPublicReply(reply: ReplyRecord): PublicReply {
  const { accountId, sourceIpHash, ...publicReply } = reply;
  void accountId;
  void sourceIpHash;
  return publicReply;
}

export function toSafeReport(report: ReportRecord): SafeReport {
  const { visitorHash, ...safeReport } = report;
  void visitorHash;
  return safeReport;
}

export async function getPost(id: string) {
  if (!hasStorage()) {
    return null;
  }
  const store = getStorage();
  const key = await findKeyById(POSTS_PREFIX, id);
  return key ? readJson<PostRecord>(store, key) : null;
}

export async function savePost(post: PostRecord) {
  await writeJson(getStorage(), postKey(post.createdAt, post.id), post);
}

export async function deletePost(id: string) {
  const store = getStorage();
  const [key, post, replyKeys, interactionKeys] = await Promise.all([
    findKeyById(POSTS_PREFIX, id),
    getPost(id),
    listAllKeys(store, REPLIES_PREFIX + id + "/"),
    listAllKeys(store, DATA_PREFIX + "/interactions/" + id + "/"),
  ]);
  const mediaKeys = (post?.media ?? [])
    .map((media) => media.key)
    .filter(isMediaKey);
  const keys = Array.from(
    new Set([
      ...(key ? [key] : []),
      ...replyKeys,
      ...interactionKeys,
      ...mediaKeys,
    ]),
  );
  await Promise.all(keys.map((objectKey) => store.deleteObject(objectKey)));
}

export async function listReplies(postId: string) {
  if (!hasStorage()) {
    return [];
  }
  const store = getStorage();
  const keys = await listAllKeys(store, REPLIES_PREFIX + postId + "/");
  const records = (
    await Promise.all(keys.map((key) => readJson<ReplyRecord>(store, key)))
  ).filter((item): item is ReplyRecord => Boolean(item));
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function saveReply(reply: ReplyRecord) {
  await writeJson(
    getStorage(),
    replyKey(reply.createdAt, reply.postId, reply.id),
    reply,
  );
}

export async function listAnnouncements() {
  if (!hasStorage()) {
    return [];
  }
  const store = getStorage();
  const keys = await listAllKeys(store, ANNOUNCEMENTS_PREFIX);
  const records = (
    await Promise.all(
      keys.map((key) => readJson<AnnouncementRecord>(store, key)),
    )
  ).filter((item): item is AnnouncementRecord => Boolean(item));
  return records
    .filter((announcement) => {
      if (!announcement.expiresAt) {
        return true;
      }
      const expiry = Date.parse(announcement.expiresAt);
      return !Number.isFinite(expiry) || expiry > Date.now();
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function saveAnnouncement(announcement: AnnouncementRecord) {
  await writeJson(
    getStorage(),
    announcementKey(announcement.createdAt, announcement.id),
    announcement,
  );
}

export async function deleteAnnouncement(id: string) {
  const key = await findKeyById(ANNOUNCEMENTS_PREFIX, id);
  if (!key) {
    return false;
  }
  await getStorage().deleteObject(key);
  return true;
}

export async function listReports(status?: ReportStatus) {
  if (!hasStorage()) {
    return [];
  }
  const store = getStorage();
  const keys = await listAllKeys(store, REPORTS_PREFIX);
  const records = (
    await Promise.all(keys.map((key) => readJson<ReportRecord>(store, key)))
  ).filter((item): item is ReportRecord => Boolean(item));
  return records
    .filter((report) => !status || report.status === status)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function updateReportStatus(id: string, status: ReportStatus) {
  const key = await findKeyById(REPORTS_PREFIX, id);
  if (!key) {
    return null;
  }
  const report = await readJson<ReportRecord>(getStorage(), key);
  if (!report) {
    return null;
  }
  const updated = { ...report, status };
  await writeJson(getStorage(), key, updated);
  return updated;
}

async function claimInteraction(
  postId: string,
  visitorId: string,
  action: "like" | "report",
) {
  const store = getStorage();
  const visitorHash = await sha256Hex(visitorId.trim());
  const key =
    DATA_PREFIX +
    "/interactions/" +
    postId +
    "/" +
    action +
    "_" +
    visitorHash +
    ".json";
  const added = await store.putObjectIfAbsent(
    key,
    JSON.stringify({
      postId,
      action,
      visitorHash,
      createdAt: new Date().toISOString(),
    }),
    "application/json; charset=utf-8",
  );
  return { added, visitorHash };
}

export async function addInteraction(
  postId: string,
  visitorId: string,
  action: "like" | "report",
) {
  return (await claimInteraction(postId, visitorId, action)).added;
}

export async function addReport(
  postId: string,
  visitorId: string,
  reason: string,
  context: { accountId?: string; sourceIpHash?: string } = {},
) {
  const claim = await claimInteraction(postId, visitorId, "report");
  if (!claim.added) {
    return null;
  }
  const report: ReportRecord = {
    id: crypto.randomUUID(),
    postId,
    reason: reason.trim().slice(0, 160),
    createdAt: new Date().toISOString(),
    status: "open",
    visitorHash: claim.visitorHash,
    accountId: context.accountId,
    sourceIpHash: context.sourceIpHash,
  };
  await writeJson(getStorage(), reportKey(report.createdAt, report.id), report);
  return report;
}

export { isMediaKey };
