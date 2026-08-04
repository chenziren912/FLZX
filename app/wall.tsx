"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";

type Media = {
  key: string;
  name: string;
  type: string;
  size: number;
  url?: string;
};

type Post = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  media: Media[];
  likes: number;
  reports: number;
};

type Reply = {
  id: string;
  postId: string;
  author: string;
  content: string;
  createdAt: string;
};

type ApiError = Error & { maintenance?: boolean };

type UploadProgressState =
  | "pending"
  | "requesting"
  | "uploading"
  | "verifying"
  | "complete"
  | "error";

type UploadProgressItem = {
  loaded: number;
  total: number;
  percent: number;
  state: UploadProgressState;
  error?: string;
};

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    maintenance?: boolean;
  };
  if (!response.ok) {
    const error = new Error(body.error || "请求失败") as ApiError;
    error.maintenance = body.maintenance;
    throw error;
  }
  return body;
}

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function visitorId() {
  const key = "flzx-visitor-id";
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const value = crypto.randomUUID();
  window.localStorage.setItem(key, value);
  return value;
}

function mediaIcon(type: string) {
  return type.startsWith("video/") ? "▣" : "▧";
}

function createUploadProgressItem(file: File): UploadProgressItem {
  return {
    loaded: 0,
    total: file.size,
    percent: 0,
    state: "pending",
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function overallUploadPercent(items: UploadProgressItem[]) {
  if (items.length === 0) {
    return 0;
  }
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const loaded = items.reduce(
    (sum, item) => sum + Math.min(item.loaded, item.total),
    0,
  );
  return total > 0 ? Math.round((loaded / total) * 100) : 0;
}

function uploadStateLabel(state: UploadProgressState) {
  switch (state) {
    case "requesting":
      return "准备中";
    case "uploading":
      return "上传中";
    case "verifying":
      return "校验中";
    case "complete":
      return "已完成";
    case "error":
      return "上传失败";
    default:
      return "待上传";
  }
}

function uploadFileWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (loaded: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(event.loaded, file.size));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size);
        resolve();
        return;
      }
      reject(
        new Error(
          request.status
            ? `媒体上传失败（${request.status}）`
            : "媒体上传失败",
        ),
      );
    });
    request.addEventListener("error", () => reject(new Error("媒体上传网络错误")));
    request.addEventListener("abort", () => reject(new Error("媒体上传已取消")));
    request.send(file);
  });
}

export default function Wall() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const [dark, setDark] = useState(false);
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState(
    "正在申请消息权限，请同意",
  );
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [reportingPostId, setReportingPostId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [repliesByPost, setRepliesByPost] = useState<Record<string, Reply[]>>({});
  const [expandedReplyPostIds, setExpandedReplyPostIds] = useState<
    Record<string, boolean>
  >({});
  const [replyAuthors, setReplyAuthors] = useState<Record<string, string>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  const [replyBusyPostId, setReplyBusyPostId] = useState<string | null>(null);
  const notificationEnabledRef = useRef(false);
  const knownPostIdsRef = useRef<Set<string> | null>(null);

  const loadPosts = useCallback(async (keyword = "") => {
    try {
      const data = await readJson<{ posts: Post[] }>(
        "/api/posts?search=" + encodeURIComponent(keyword),
      );
      const withMediaUrls = await Promise.all(
        data.posts.map(async (post) => ({
          ...post,
          media: await Promise.all(
            post.media.map(async (media) => {
              try {
                const result = await readJson<{ url: string }>(
                  "/api/media/url?key=" + encodeURIComponent(media.key),
                );
                return { ...media, url: result.url };
              } catch {
                return media;
              }
            }),
          ),
        })),
      );
      if (!keyword) {
        const nextIds = new Set(withMediaUrls.map((post) => post.id));
        const previousIds = knownPostIdsRef.current;
        if (
          previousIds &&
          notificationEnabledRef.current &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          const freshPosts = withMediaUrls.filter(
            (post) => !previousIds.has(post.id),
          );
          if (freshPosts.length > 0) {
            try {
              const first = freshPosts[0];
              new Notification("校园娱乐墙有新动态", {
                body:
                  freshPosts.length === 1
                    ? `${first.author}：${first.content.slice(0, 80)}`
                    : `又有 ${freshPosts.length} 条新动态，快来看看。`,
                tag: "flzx-new-posts",
              });
            } catch {
              // Notification can still fail when a browser revokes permission.
            }
          }
        }
        knownPostIdsRef.current = nextIds;
      }
      setPosts(withMediaUrls);
      setMaintenance(false);
    } catch (caught) {
      const requestError = caught as ApiError;
      if (
        requestError.maintenance ||
        requestError.message === "服务器正在重启更新"
      ) {
        setMaintenance(true);
      } else {
        setError(requestError.message);
      }
    }
  }, []);

  useEffect(() => {
    const theme = window.localStorage.getItem("flzx-theme");
    const isDark =
      theme === "dark" ||
      (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark-mode", isDark);
    // The state update is deferred to avoid a render during effect setup while
    // still keeping the server-rendered markup hydration-safe.
    window.setTimeout(() => setDark(isDark), 0);
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      return;
    }
    const granted = Notification.permission === "granted";
    notificationEnabledRef.current = granted;
    window.setTimeout(() => setNotificationEnabled(granted), 0);
    if (
      Notification.permission === "default" &&
      window.localStorage.getItem("flzx-notification-granted") !== "1" &&
      window.localStorage.getItem("flzx-notification-prompt-dismissed") !== "1"
    ) {
      const timer = window.setTimeout(() => setNotificationPromptOpen(true), 900);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    notificationEnabledRef.current = notificationEnabled;
  }, [notificationEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPosts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPosts]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!activeSearch && document.visibilityState === "visible") {
        void loadPosts();
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeSearch, loadPosts]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark-mode", next);
    window.localStorage.setItem("flzx-theme", next ? "dark" : "light");
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    if (busy) {
      event.target.value = "";
      return;
    }
    const selected = Array.from(event.target.files ?? []);
    const nextFiles = [...files, ...selected].slice(0, 6);
    setFiles(nextFiles);
    setUploadProgress(nextFiles.map(createUploadProgressItem));
    event.target.value = "";
  }

  function updateUploadProgress(
    index: number,
    update: Partial<UploadProgressItem>,
  ) {
    setUploadProgress((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...update } : item,
      ),
    );
  }

  async function uploadFiles(filesToUpload: File[]) {
    const uploaded: Media[] = [];
    for (const [index, file] of filesToUpload.entries()) {
      updateUploadProgress(index, {
        loaded: 0,
        total: file.size,
        percent: 0,
        state: "requesting",
        error: undefined,
      });
      setStatus(
        `准备上传 ${index + 1}/${filesToUpload.length}：${file.name}`,
      );
      try {
        const ticket = await readJson<{ uploadUrl: string; key: string }>(
          "/api/media/upload-url",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: file.name,
              type: file.type,
              size: file.size,
            }),
          },
        );
        updateUploadProgress(index, { state: "uploading" });
        setStatus(`上传中 ${index + 1}/${filesToUpload.length}：${file.name}`);
        await uploadFileWithProgress(ticket.uploadUrl, file, (loaded) => {
          const percent =
            file.size > 0 ? Math.round((loaded / file.size) * 100) : 0;
          updateUploadProgress(index, { loaded, percent, state: "uploading" });
        });
        updateUploadProgress(index, {
          loaded: file.size,
          percent: 100,
          state: "verifying",
        });
        setStatus(`校验中 ${index + 1}/${filesToUpload.length}：${file.name}`);
        const result = await readJson<{ media: Media }>(
          "/api/media/complete",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: ticket.key,
              name: file.name,
              type: file.type,
            }),
          },
        );
        updateUploadProgress(index, {
          loaded: file.size,
          percent: 100,
          state: "complete",
        });
        uploaded.push(result.media);
      } catch (caught) {
        const message = (caught as Error).message || "媒体上传失败";
        updateUploadProgress(index, { state: "error", error: message });
        throw caught;
      }
    }
    return uploaded;
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || busy) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("正在发布…");
    const filesToUpload = files;
    setUploadProgress(filesToUpload.map(createUploadProgressItem));
    try {
      const media = await uploadFiles(filesToUpload);
      setStatus("正在发布…");
      const result = await readJson<{ post: Post; deleteToken: string }>(
        "/api/posts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author,
            content,
            media,
          }),
        },
      );
      if (!activeSearch && knownPostIdsRef.current) {
        knownPostIdsRef.current.add(result.post.id);
      }
      const tokens = JSON.parse(
        window.localStorage.getItem("flzx-delete-tokens") ?? "{}",
      ) as Record<string, string>;
      tokens[result.post.id] = result.deleteToken;
      window.localStorage.setItem("flzx-delete-tokens", JSON.stringify(tokens));
      setContent("");
      setAuthor("");
      setFiles([]);
      setUploadProgress([]);
      setStatus("");
      await loadPosts(activeSearch);
    } catch (caught) {
      const requestError = caught as ApiError;
      if (
        requestError.maintenance ||
        requestError.message === "服务器正在重启更新"
      ) {
        setMaintenance(true);
      } else {
        setError(requestError.message);
      }
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function interact(
    postId: string,
    action: "like" | "report",
    reason = "",
  ) {
    try {
      const result = await readJson<{ post: Post; action: "added" | "unchanged" }>(
        "/api/posts/" + postId + "/interact",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason, visitorId: visitorId() }),
        },
      );
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...post, ...result.post } : post,
        ),
      );
      if (action === "report") {
        setStatus(
          result.action === "added"
            ? "举报已提交，管理员会尽快审查。"
            : "你已经举报过这条内容。",
        );
      }
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      return false;
    }
  }

  function openNotificationPrompt() {
    setNotificationMessage("正在申请消息权限，请同意");
    setNotificationPromptOpen(true);
  }

  function dismissNotificationPrompt() {
    window.localStorage.setItem("flzx-notification-prompt-dismissed", "1");
    setNotificationPromptOpen(false);
  }

  async function requestNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationMessage("当前浏览器不支持消息通知。");
      return;
    }
    if (Notification.permission === "granted") {
      window.localStorage.setItem("flzx-notification-granted", "1");
      notificationEnabledRef.current = true;
      setNotificationEnabled(true);
      setNotificationPromptOpen(false);
      return;
    }
    if (Notification.permission === "denied") {
      setNotificationMessage("浏览器已拒绝通知，请在站点设置中重新允许。");
      window.localStorage.setItem("flzx-notification-prompt-dismissed", "1");
      return;
    }
    setNotificationMessage("正在申请消息权限，请同意");
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        window.localStorage.setItem("flzx-notification-granted", "1");
        window.localStorage.removeItem("flzx-notification-prompt-dismissed");
        notificationEnabledRef.current = true;
        setNotificationEnabled(true);
        setNotificationPromptOpen(false);
        setStatus("消息通知已开启；页面打开时会提醒新的动态。 ");
      } else if (permission === "denied") {
        window.localStorage.setItem("flzx-notification-prompt-dismissed", "1");
        setNotificationMessage("浏览器已拒绝通知，请在站点设置中重新允许。");
      } else {
        setNotificationMessage("尚未完成授权，可以稍后再次开启。");
      }
    } catch {
      setNotificationMessage("消息权限申请失败，可以稍后重试。");
    }
  }

  async function submitReport() {
    if (!reportingPostId) {
      return;
    }
    const success = await interact(reportingPostId, "report", reportReason.trim());
    if (success) {
      setReportingPostId(null);
      setReportReason("");
    }
  }

  async function loadReplies(postId: string) {
    setReplyErrors((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    try {
      const result = await readJson<{ replies: Reply[] }>(
        "/api/posts/" + postId + "/reply",
      );
      setRepliesByPost((current) => ({ ...current, [postId]: result.replies }));
      return true;
    } catch (caught) {
      setReplyErrors((current) => ({
        ...current,
        [postId]: (caught as Error).message,
      }));
      return false;
    }
  }

  async function toggleReplies(postId: string) {
    const expanded = Boolean(expandedReplyPostIds[postId]);
    setExpandedReplyPostIds((current) => ({ ...current, [postId]: !expanded }));
    if (!expanded && !Object.prototype.hasOwnProperty.call(repliesByPost, postId)) {
      await loadReplies(postId);
    }
  }

  async function submitReply(postId: string) {
    const content = (replyDrafts[postId] ?? "").trim();
    if (!content || replyBusyPostId) {
      return;
    }
    setReplyBusyPostId(postId);
    setReplyErrors((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    try {
      const result = await readJson<{ reply: Reply }>(
        "/api/posts/" + postId + "/reply",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: replyAuthors[postId] ?? "",
            content,
          }),
        },
      );
      setRepliesByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), result.reply],
      }));
      setReplyDrafts((current) => ({ ...current, [postId]: "" }));
      setExpandedReplyPostIds((current) => ({ ...current, [postId]: true }));
    } catch (caught) {
      setReplyErrors((current) => ({
        ...current,
        [postId]: (caught as Error).message,
      }));
    } finally {
      setReplyBusyPostId(null);
    }
  }

  async function removePost(postId: string) {
    const tokens = JSON.parse(
      window.localStorage.getItem("flzx-delete-tokens") ?? "{}",
    ) as Record<string, string>;
    if (!tokens[postId] || !window.confirm("确定要删除你发布的这条言论吗？")) {
      return;
    }
    try {
      await readJson("/api/posts/" + postId, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteToken: tokens[postId] }),
      });
      delete tokens[postId];
      window.localStorage.setItem("flzx-delete-tokens", JSON.stringify(tokens));
      await loadPosts(activeSearch);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  function searchPosts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveSearch(search.trim());
    void loadPosts(search.trim());
  }

  const totalUploadPercent = overallUploadPercent(uploadProgress);

  return (
    <main className="wall-page">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <div className="ambient-orb ambient-orb-three" />
      {maintenance && (
        <div className="maintenance-banner" role="status">
          服务器正在重启更新
        </div>
      )}
      <div className="page-inner">
        <header className="topbar">
          <Link className="brand-lockup" href="/">
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/tieyi-logo.png" alt="西安铁一中校标" />
            </span>
            <span className="brand-copy">
              <strong>西安铁一中</strong>
              <span>校园娱乐墙</span>
            </span>
          </Link>
          <div className="topbar-actions">
            <button
              className={"icon-button notification-button" + (notificationEnabled ? " enabled" : "")}
              type="button"
              onClick={openNotificationPrompt}
              title={notificationEnabled ? "消息通知已开启" : "开启消息通知"}
              aria-label={notificationEnabled ? "消息通知已开启" : "开启消息通知"}
              aria-pressed={notificationEnabled}
            >
              {notificationEnabled ? "●" : "♧"}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={toggleTheme}
              title="切换深色模式"
              aria-label="切换深色模式"
            >
              {dark ? "☼" : "◐"}
            </button>
          </div>
        </header>

        <section className="hero-grid">
          <section className="glass-card hero-card">
            <div className="hero-content">
              <div className="hero-brand">
                <span className="hero-seal">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/tieyi-logo.png" alt="西安铁一中校标" />
                </span>
                <div className="hero-brand-copy">
                  <span className="hero-overline">XI&apos;AN TIEYI HIGH SCHOOL</span>
                  <div className="hero-label">校园娱乐墙</div>
                </div>
              </div>
              <h1 className="hero-heading">西安铁一中</h1>
              <p className="hero-subtitle">畅所欲言，分享点滴。</p>
              <p className="hero-note">
                <span>网站解释权归 Yuyi 所有</span>
                <span className="contact-line">
                  联系：17791202919 <i aria-hidden="true">·</i> QQ：2721608539{" "}
                  <i aria-hidden="true">·</i> WX：Ybx121128
                </span>
              </p>
            </div>
            <form className="search-form" onSubmit={searchPosts}>
              <label className="field-shell">
                <span className="field-icon">⌕</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索关键字或昵称..."
                  aria-label="搜索关键字或昵称"
                />
              </label>
              <button className="primary-button" type="submit">
                搜索
              </button>
            </form>
          </section>

          <section className="glass-card composer-card">
            <div className="card-heading">
              <h2>发表你的想法</h2>
              <span>最多 200 字</span>
            </div>
            <form className="compose-form" onSubmit={publish}>
              <input
                className="form-input"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="你的昵称 (默认匿名同学)"
                maxLength={20}
              />
              <textarea
                className="form-textarea"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="今天有什么新鲜事？"
                maxLength={200}
                required
              />
              {uploadProgress.length > 0 && (
                <div className="upload-summary" aria-live="polite">
                  <div className="upload-summary-head">
                    <span>文件上传进度</span>
                    <strong>{totalUploadPercent}%</strong>
                  </div>
                  <div
                    className="upload-progress-track upload-progress-track-total"
                    role="progressbar"
                    aria-label="全部文件上传进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={totalUploadPercent}
                  >
                    <span style={{ width: `${totalUploadPercent}%` }} />
                  </div>
                </div>
              )}
              <div className="file-list">
                {files.map((file, index) => (
                  <div className="file-item" key={file.name + file.size + index}>
                    <div className="file-chip">
                      <b>{mediaIcon(file.type)}</b>
                      <span>{file.name}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setFiles((current) =>
                            current.filter((_, fileIndex) => fileIndex !== index),
                          );
                          setUploadProgress((current) =>
                            current.filter((_, fileIndex) => fileIndex !== index),
                          );
                        }}
                        aria-label={"移除 " + file.name}
                      >
                        ×
                      </button>
                    </div>
                    {uploadProgress[index] && (
                      <div className="upload-progress-item">
                        <div className="upload-progress-meta">
                          <span>
                            {uploadStateLabel(uploadProgress[index].state)} · {formatBytes(uploadProgress[index].loaded)} / {formatBytes(uploadProgress[index].total)}
                          </span>
                          <strong>{uploadProgress[index].percent}%</strong>
                        </div>
                        <div
                          className={
                            "upload-progress-track" +
                            (uploadProgress[index].state === "error"
                              ? " failed"
                              : uploadProgress[index].state === "complete"
                                ? " completed"
                                : "")
                          }
                          role="progressbar"
                          aria-label={file.name + " 上传进度"}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={uploadProgress[index].percent}
                        >
                          <span
                            style={{
                              width: `${uploadProgress[index].percent}%`,
                            }}
                          />
                        </div>
                        {uploadProgress[index].error && (
                          <small className="upload-progress-error">
                            {uploadProgress[index].error}
                          </small>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="composer-bottom">
                <div className="composer-tools">
                  <label className={"attach-button" + (busy ? " disabled" : "")}>
                    <span>＋</span>
                    图片 / 视频
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      hidden
                      disabled={busy}
                      onChange={handleFiles}
                    />
                  </label>
                  <span className="counter">{content.length}/200</span>
                </div>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy || !content.trim()}
                >
                  {busy ? "发布中..." : "发布上墙 🚀"}
                </button>
              </div>
              <div className={"status-line" + (error ? " error" : "")}>
                {error || status}
              </div>
            </form>
          </section>
        </section>

        <section className="stream-section">
          <div className="section-heading">
            <h2>最新动态</h2>
            <span>{activeSearch ? "搜索结果" : "实时更新"}</span>
          </div>
          <div className="post-list">
            {posts.length === 0 ? (
              <div className="empty-card">
                {activeSearch ? "没有找到相关内容。" : "还没有人发言，快来抢沙发！"}
              </div>
            ) : (
              posts.map((post) => (
                <article className="post-card" key={post.id}>
                  <div className="post-meta">
                    <span className="avatar">
                      {post.author.slice(0, 1) || "匿"}
                    </span>
                    <div className="post-author">
                      <strong>{post.author}</strong>
                      <span>{formatTime(post.createdAt)}</span>
                    </div>
                  </div>
                  <div className="post-content">{post.content}</div>
                  {post.media.length > 0 && (
                    <div className="media-grid">
                      {post.media.map((media) =>
                        media.type.startsWith("video/") ? (
                          <video
                            key={media.key}
                            controls
                            preload="metadata"
                            src={media.url}
                            title={media.name}
                          />
                        ) : (
                          // Presigned COS URLs are rendered directly so large media is not proxied.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={media.key} src={media.url} alt={media.name} />
                        ),
                      )}
                    </div>
                  )}
                  <div className="post-actions">
                    <button
                      className="post-action"
                      type="button"
                      onClick={() => void interact(post.id, "like")}
                    >
                      ♡ {post.likes}
                    </button>
                    <button
                      className="post-action"
                      type="button"
                      onClick={() => void toggleReplies(post.id)}
                      aria-expanded={Boolean(expandedReplyPostIds[post.id])}
                    >
                      {expandedReplyPostIds[post.id]
                        ? "收起评论"
                        : `评论${
                            repliesByPost[post.id]
                              ? ` ${repliesByPost[post.id].length}`
                              : ""
                          }`}
                    </button>
                    <button
                      className="post-action danger"
                      type="button"
                      onClick={() => {
                        setReportReason("");
                        setReportingPostId(post.id);
                      }}
                    >
                      举报
                    </button>
                    <button
                      className="post-action danger"
                      type="button"
                      onClick={() => void removePost(post.id)}
                    >
                      删除
                    </button>
                  </div>
                  {expandedReplyPostIds[post.id] && (
                    <section className="reply-panel" aria-label="评论区">
                      <div className="reply-panel-head">
                        <strong>
                          评论 {repliesByPost[post.id]?.length ?? 0}
                        </strong>
                        <span>友善交流，畅所欲言</span>
                      </div>
                      {replyErrors[post.id] && (
                        <p className="reply-error" role="alert">
                          {replyErrors[post.id]}
                        </p>
                      )}
                      {repliesByPost[post.id] === undefined ? (
                        <p className="reply-hint" role="status">
                          正在加载评论…
                        </p>
                      ) : repliesByPost[post.id].length === 0 ? (
                        <p className="reply-hint">还没有评论，来抢个沙发吧。</p>
                      ) : (
                        <div className="reply-list">
                          {repliesByPost[post.id].map((reply) => (
                            <div className="reply-item" key={reply.id}>
                              <span className="reply-avatar">
                                {reply.author.slice(0, 1) || "匿"}
                              </span>
                              <div className="reply-body">
                                <div className="reply-meta">
                                  <strong>{reply.author}</strong>
                                  <span>{formatTime(reply.createdAt)}</span>
                                </div>
                                <p>{reply.content}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <form
                        className="reply-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitReply(post.id);
                        }}
                      >
                        <input
                          className="reply-author-input"
                          value={replyAuthors[post.id] ?? ""}
                          onChange={(event) =>
                            setReplyAuthors((current) => ({
                              ...current,
                              [post.id]: event.target.value,
                            }))
                          }
                          placeholder="昵称（默认匿名同学）"
                          maxLength={20}
                          disabled={replyBusyPostId === post.id}
                        />
                        <div className="reply-compose-row">
                          <textarea
                            className="reply-input"
                            value={replyDrafts[post.id] ?? ""}
                            onChange={(event) =>
                              setReplyDrafts((current) => ({
                                ...current,
                                [post.id]: event.target.value,
                              }))
                            }
                            placeholder="写下你的评论…"
                            maxLength={200}
                            rows={2}
                            disabled={replyBusyPostId === post.id}
                          />
                          <button
                            className="reply-submit"
                            type="submit"
                            disabled={
                              replyBusyPostId === post.id ||
                              !(replyDrafts[post.id] ?? "").trim()
                            }
                          >
                            {replyBusyPostId === post.id ? "发送中…" : "评论"}
                          </button>
                        </div>
                      </form>
                    </section>
                  )}
                </article>
              ))
            )}
          </div>
        </section>

      </div>
      {notificationPromptOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              dismissNotificationPrompt();
            }
          }}
        >
          <section
            className="glass-card dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-dialog-title"
          >
            <div className="dialog-icon">♧</div>
            <h2 id="notification-dialog-title">开启消息通知</h2>
            <p>{notificationMessage}</p>
            <div className="dialog-actions">
              <button
                className="soft-button"
                type="button"
                onClick={dismissNotificationPrompt}
              >
                稍后再说
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void requestNotifications()}
              >
                同意并开启
              </button>
            </div>
          </section>
        </div>
      )}
      {reportingPostId && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setReportingPostId(null);
            }
          }}
        >
          <section
            className="glass-card dialog-card report-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-dialog-title"
          >
            <div className="dialog-icon danger-icon">!</div>
            <h2 id="report-dialog-title">举报这条内容</h2>
            <p>请填写举报原因，便于管理员快速处理（最多 160 字）。</p>
            <textarea
              className="dialog-textarea"
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value)}
              maxLength={160}
              placeholder="例如：广告、骚扰、与校园墙无关……"
              autoFocus
            />
            <div className="dialog-actions">
              <button
                className="soft-button"
                type="button"
                onClick={() => setReportingPostId(null)}
              >
                取消
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void submitReport()}
              >
                提交举报
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
