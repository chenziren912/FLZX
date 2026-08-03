import { sha256Hex } from "./s3";
import {
  DATA_PREFIX,
  getStorage,
  hasStorage,
  listAllKeys,
  readJson,
  writeJson,
  MEDIA_PREFIX,
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

const POSTS_PREFIX = DATA_PREFIX + "/posts/";
const REPLIES_PREFIX = DATA_PREFIX + "/replies/";
const ANNOUNCEMENTS_PREFIX = DATA_PREFIX + "/announcements/";

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
  const keyword = search.trim().toLowerCase();
  return records
    .filter((post) => {
      if (!keyword) {
        return true;
      }
      return (
        post.author.toLowerCase().includes(keyword) ||
        post.content.toLowerCase().includes(keyword)
      );
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

export async function addInteraction(
  postId: string,
  visitorId: string,
  action: "like" | "report",
) {
  const store = getStorage();
  const key =
    DATA_PREFIX +
    "/interactions/" +
    postId +
    "/" +
    action +
    "_" +
    (await sha256Hex(visitorId)) +
    ".json";
  if (await store.headObject(key)) {
    return false;
  }
  await writeJson(store, key, { postId, visitorId, action, createdAt: new Date().toISOString() });
  return true;
}

export function isMediaKey(key: string) {
  return key.startsWith(MEDIA_PREFIX + "/");
}
