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

type ApiError = Error & { maintenance?: boolean };

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

export default function Wall() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
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
    const selected = Array.from(event.target.files ?? []);
    setFiles((current) => [...current, ...selected].slice(0, 6));
    event.target.value = "";
  }

  async function uploadFiles() {
    const uploaded: Media[] = [];
    for (const file of files) {
      setStatus("正在上传 " + file.name + "…");
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
      const upload = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) {
        throw new Error("媒体上传失败");
      }
      const result = await readJson<{ media: Media }>("/api/media/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: ticket.key,
          name: file.name,
          type: file.type,
        }),
      });
      uploaded.push(result.media);
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
    try {
      const media = await uploadFiles();
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
              <div className="file-list">
                {files.map((file, index) => (
                  <div className="file-chip" key={file.name + file.size + index}>
                    <b>{mediaIcon(file.type)}</b>
                    <span>{file.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, fileIndex) => fileIndex !== index),
                        )
                      }
                      aria-label={"移除 " + file.name}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="composer-bottom">
                <div className="composer-tools">
                  <label className="attach-button">
                    <span>＋</span>
                    图片 / 视频
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      hidden
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
