import { sha256Hex } from "./s3";
import {
  AnnouncementRecord,
  PostRecord,
  ReplyRecord,
  saveAnnouncement,
  savePost,
  saveReply,
} from "./wall-data";

type LegacyReply = {
  id?: number | string;
  post_id?: number | string;
  author?: string;
  content?: string;
  created_at?: string;
};

type LegacyPost = {
  id?: number | string;
  content?: string;
  author?: string;
  created_at?: string;
  upvotes?: number;
  report_count?: number;
  replies?: LegacyReply[];
};

type LegacyAnnouncement = {
  id?: number | string;
  content?: string;
  created_at?: string;
};

type LegacyPostsResponse = {
  posts?: LegacyPost[];
  totalPages?: number;
  currentPage?: number;
};

function asId(value: number | string | undefined, fallback: string) {
  return value === undefined || value === null ? fallback : String(value);
}

function asDate(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function asCount(value: number | undefined) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("旧墙接口返回 " + response.status);
  }
  return (await response.json()) as T;
}

export async function importLegacyPage(base: string, page: number) {
  const endpoint =
    base + "/api/posts?page=" + String(page) + "&limit=10&search=";
  const payload = await fetchJson<LegacyPostsResponse | LegacyPost[]>(endpoint);
  const posts = Array.isArray(payload) ? payload : payload.posts ?? [];
  let copied = 0;
  let replies = 0;

  for (const legacyPost of posts) {
    const legacyId = asId(legacyPost.id, "page-" + page + "-" + copied);
    const postId = "legacy-" + legacyId;
    const createdAt = asDate(legacyPost.created_at, new Date().toISOString());
    const post: PostRecord = {
      id: postId,
      author: (legacyPost.author?.trim() || "匿名同学").slice(0, 20),
      content: legacyPost.content?.trim() ?? "",
      createdAt,
      deleteTokenHash: await sha256Hex("flzx-legacy-delete-" + legacyId),
      media: [],
      likes: asCount(legacyPost.upvotes),
      reports: asCount(legacyPost.report_count),
    };
    await savePost(post);
    copied += 1;

    for (const legacyReply of legacyPost.replies ?? []) {
      const replyId = asId(legacyReply.id, String(replies));
      const reply: ReplyRecord = {
        id: "legacy-" + legacyId + "-" + replyId,
        postId,
        author: (legacyReply.author?.trim() || "匿名同学").slice(0, 20),
        content: legacyReply.content?.trim() ?? "",
        createdAt: asDate(legacyReply.created_at, createdAt),
      };
      await saveReply(reply);
      replies += 1;
    }
  }

  return {
    copied: copied + replies,
    skipped: 0,
    totalPages: Array.isArray(payload)
      ? 1
      : Math.max(1, Number(payload.totalPages) || 1),
    currentPage: Array.isArray(payload)
      ? page
      : Math.max(1, Number(payload.currentPage) || page),
  };
}

export async function importLegacyAnnouncements(base: string) {
  const payload = await fetchJson<LegacyAnnouncement[]>(
    base + "/api/announcements",
  );
  let copied = 0;
  for (const legacyAnnouncement of payload) {
    const legacyId = asId(legacyAnnouncement.id, String(copied));
    const announcement: AnnouncementRecord = {
      id: "legacy-announcement-" + legacyId,
      content: legacyAnnouncement.content?.trim() ?? "",
      createdAt: asDate(
        legacyAnnouncement.created_at,
        new Date().toISOString(),
      ),
    };
    await saveAnnouncement(announcement);
    copied += 1;
  }
  return copied;
}
