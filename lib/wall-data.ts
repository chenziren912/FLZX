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
};

export type AnnouncementRecord = {
  id: string;
  content: string;
  createdAt: string;
};

export type ReportStatus = "open" | "resolved" | "dismissed";

export type ReportRecord = {
  id: string;
  postId: string;
  reason: string;
  createdAt: string;
  status: ReportStatus;
  visitorHash: string;
};

export type SafeReport = Omit<ReportRecord, "visitorHash">;

const POSTS_PREFIX = DATA_PREFIX + "/posts/";
const REPLIES_PREFIX = DATA_PREFIX + "/replies/";
const ANNOUNCEMENTS_PREFIX = DATA_PREFIX + "/announcements/";
const REPORTS_PREFIX = DATA_PREFIX + "/reports/";

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

export type PublicPost = Omit<PostRecord, "deleteTokenHash">;

export function toPublicPost(post: PostRecord): PublicPost {
  const { deleteTokenHash, ...publicPost } = post;
  void deleteTokenHash;
  return publicPost;
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
  const key = await findKeyById(POSTS_PREFIX, id);
  if (key) {
    await getStorage().deleteObject(key);
  }
  const replyKeys = await listAllKeys(getStorage(), REPLIES_PREFIX + id + "/");
  await Promise.all(replyKeys.map((key) => getStorage().deleteObject(key)));
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
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function saveAnnouncement(announcement: AnnouncementRecord) {
  await writeJson(
    getStorage(),
    announcementKey(announcement.createdAt, announcement.id),
    announcement,
  );
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
  if (await store.headObject(key)) {
    return { added: false, visitorHash };
  }
  await writeJson(store, key, {
    postId,
    action,
    visitorHash,
    createdAt: new Date().toISOString(),
  });
  return { added: true, visitorHash };
}

export async function addInteraction(
  postId: string,
  visitorId: string,
  action: "like" | "report",
) {
  return (await claimInteraction(postId, visitorId, action)).added;
}

export async function addReport(postId: string, visitorId: string, reason: string) {
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
  };
  await writeJson(getStorage(), reportKey(report.createdAt, report.id), report);
  return report;
}

export { isMediaKey };
