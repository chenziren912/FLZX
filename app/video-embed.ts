export type VideoEmbedProvider = "bilibili" | "youtube";

export type VideoEmbedResult = {
  provider: VideoEmbedProvider;
  src: string;
  markdown: string;
};

type VideoEmbedError = {
  error: string;
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "www.youtube-nocookie.com",
]);

const BILIBILI_HOSTS = new Set(["bilibili.com", "www.bilibili.com"]);

function parseHttpsUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : "https://" + trimmed;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isYouTubeId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{6,20}$/.test(value));
}

function extractYouTubeId(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (!YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/watch") {
    return url.searchParams.get("v");
  }
  if (["embed", "shorts", "live"].includes(segments[0] ?? "")) {
    return segments[1] ?? null;
  }
  return null;
}

function extractBilibiliId(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host === "player.bilibili.com") {
    if (url.pathname !== "/player.html") {
      return null;
    }
    const bvid = url.searchParams.get("bvid");
    if (bvid && /^BV[0-9A-Za-z]{8,20}$/.test(bvid)) {
      return { kind: "bvid" as const, value: bvid };
    }
    const aid = url.searchParams.get("aid");
    if (aid && /^\d{1,20}$/.test(aid)) {
      return { kind: "aid" as const, value: aid };
    }
    return null;
  }
  if (!BILIBILI_HOSTS.has(host)) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "video") {
    return null;
  }
  const identifier = segments[1] ?? "";
  if (/^BV[0-9A-Za-z]{8,20}$/.test(identifier)) {
    return { kind: "bvid" as const, value: identifier };
  }
  if (/^av\d{1,20}$/i.test(identifier)) {
    return { kind: "aid" as const, value: identifier.slice(2) };
  }
  return null;
}

function createIframeMarkdown(
  provider: VideoEmbedProvider,
  src: string,
) {
  const title = provider === "youtube" ? "YouTube 视频" : "哔哩哔哩视频";
  const allow =
    provider === "youtube"
      ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      : "autoplay; fullscreen; picture-in-picture";
  return `<iframe src="${src}" title="${title}" width="100%" height="400" loading="lazy" allow="${allow}" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

export function createVideoEmbed(
  provider: VideoEmbedProvider,
  value: string,
): VideoEmbedResult | VideoEmbedError {
  const url = parseHttpsUrl(value);
  if (!url) {
    return { error: "请输入有效的 HTTPS 视频链接。" };
  }

  if (provider === "youtube") {
    const videoId = extractYouTubeId(url);
    if (!isYouTubeId(videoId)) {
      return {
        error: "请输入 YouTube 视频页、Shorts、短链接或 /embed/ 播放链接。",
      };
    }
    const src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0`;
    return { provider, src, markdown: createIframeMarkdown(provider, src) };
  }

  const video = extractBilibiliId(url);
  if (!video) {
    return {
      error: "请输入哔哩哔哩视频页链接，例如 /video/BV...。",
    };
  }
  const query =
    video.kind === "bvid"
      ? `bvid=${encodeURIComponent(video.value)}`
      : `aid=${encodeURIComponent(video.value)}`;
  const src = `https://player.bilibili.com/player.html?${query}`;
  return { provider, src, markdown: createIframeMarkdown(provider, src) };
}
