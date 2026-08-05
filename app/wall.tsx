"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import MarkdownPreview from "./markdown-preview";
import {
  createVideoEmbed,
  type VideoEmbedProvider,
} from "./video-embed";

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
  format?: "plain" | "markdown";
  hasMore?: boolean;
};

type Reply = {
  id: string;
  postId: string;
  author: string;
  content: string;
  createdAt: string;
};

type ApiError = Error & {
  maintenance?: boolean;
  captchaRequired?: boolean;
  captchaInvalid?: boolean;
  captchaExpired?: boolean;
};

type CaptchaProof = {
  captchaChallengeId?: string;
  captchaAnswer?: string;
};

type CaptchaChallenge = {
  challengeId: string;
  image: string;
  expiresAt: number;
  seconds: number;
};

type ActionFeedback = {
  kind: "loading" | "success" | "error";
  title: string;
  detail: string;
};

type ActionAttempt = "success" | "captcha-error" | "failed";

type CaptchaRetry = (proof: CaptchaProof) => Promise<ActionAttempt>;

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

const PLAIN_CONTENT_LIMIT = 200;
const MARKDOWN_CONTENT_LIMIT = 5000;

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    maintenance?: boolean;
    captchaRequired?: boolean;
    captchaInvalid?: boolean;
    captchaExpired?: boolean;
  };
  if (!response.ok) {
    const error = new Error(body.error || "请求失败") as ApiError;
    error.maintenance = body.maintenance;
    error.captchaRequired = body.captchaRequired;
    error.captchaInvalid = body.captchaInvalid;
    error.captchaExpired = body.captchaExpired;
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
  const [searching, setSearching] = useState(false);
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [contentFormat, setContentFormat] = useState<"plain" | "markdown">(
    "plain",
  );
  const [markdownModeOpen, setMarkdownModeOpen] = useState(false);
  const [videoEmbedOpen, setVideoEmbedOpen] = useState(false);
  const [videoEmbedProvider, setVideoEmbedProvider] =
    useState<VideoEmbedProvider | null>(null);
  const [videoEmbedUrl, setVideoEmbedUrl] = useState("");
  const [videoEmbedError, setVideoEmbedError] = useState("");
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
  const [interactionBusyPostIds, setInteractionBusyPostIds] = useState<
    Record<string, boolean>
  >({});
  const [loadingFullPostIds, setLoadingFullPostIds] = useState<
    Record<string, boolean>
  >({});
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [captchaChallenge, setCaptchaChallenge] =
    useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaSecondsLeft, setCaptchaSecondsLeft] = useState(0);
  const [captchaError, setCaptchaError] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaBusy, setCaptchaBusy] = useState(false);
  const notificationEnabledRef = useRef(false);
  const knownPostIdsRef = useRef<Set<string> | null>(null);
  const markdownInputRef = useRef<HTMLTextAreaElement | null>(null);
  const videoEmbedInputRef = useRef<HTMLInputElement | null>(null);
  const preparedMediaRef = useRef<Media[] | null>(null);
  const captchaRetryRef = useRef<CaptchaRetry | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const interactionBusyPostIdsRef = useRef<Set<string>>(new Set());

  function showActionFeedback(next: ActionFeedback) {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setActionFeedback(next);
    if (next.kind !== "loading") {
      feedbackTimerRef.current = window.setTimeout(() => {
        setActionFeedback(null);
        feedbackTimerRef.current = null;
      }, next.kind === "success" ? 1400 : 2200);
    }
  }

  function showSendFailure(detail: string) {
    showActionFeedback({
      kind: "error",
      title: "发送失败",
      detail: detail || "请稍后再试。",
    });
  }

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!captchaOpen || !captchaChallenge) {
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((captchaChallenge.expiresAt - Date.now()) / 1000),
      );
      setCaptchaSecondsLeft(remaining);
      if (remaining === 0) {
        setCaptchaError("验证码已过期，请刷新图片");
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [captchaChallenge, captchaOpen]);

  async function loadCaptcha() {
    setCaptchaLoading(true);
    setCaptchaError("");
    try {
      const challenge = await readJson<CaptchaChallenge>("/api/captcha", {
        method: "POST",
      });
      setCaptchaChallenge(challenge);
      setCaptchaSecondsLeft(
        Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 1000)),
      );
    } catch (caught) {
      setCaptchaError((caught as Error).message || "验证码加载失败，请稍后重试");
    } finally {
      setCaptchaLoading(false);
    }
  }

  function openCaptcha(retry: CaptchaRetry) {
    captchaRetryRef.current = retry;
    setActionFeedback(null);
    setCaptchaAnswer("");
    setCaptchaChallenge(null);
    setCaptchaSecondsLeft(0);
    setCaptchaError("");
    setCaptchaOpen(true);
    void loadCaptcha();
  }

  function cancelCaptcha() {
    captchaRetryRef.current = null;
    setCaptchaOpen(false);
    setCaptchaChallenge(null);
    setCaptchaAnswer("");
    setCaptchaError("");
  }

  async function submitCaptcha() {
    const retry = captchaRetryRef.current;
    if (!retry || !captchaChallenge || captchaSecondsLeft <= 0) {
      setCaptchaError("验证码已过期，请刷新图片");
      return;
    }
    if (captchaAnswer.length !== 6) {
      setCaptchaError("请输入 6 位字母验证码");
      return;
    }
    setCaptchaBusy(true);
    setCaptchaError("");
    try {
      const result = await retry({
        captchaChallengeId: captchaChallenge.challengeId,
        captchaAnswer,
      });
      // Only a confirmed successful API response may close this dialog.
      // Incorrect, expired, and ordinary failed requests all stay visible so
      // they can never be mistaken for a successful submission.
      if (result === "success") {
        cancelCaptcha();
      } else if (result === "failed") {
        setCaptchaError((current) => current || "发送未完成，请检查后重试。");
      }
    } catch {
      setCaptchaError("验证后的发送失败，请重新尝试。");
    } finally {
      setCaptchaBusy(false);
    }
  }

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
    if (!markdownModeOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (videoEmbedOpen) {
          closeVideoEmbedDialog();
          return;
        }
        setMarkdownModeOpen(false);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [markdownModeOpen, videoEmbedOpen]);

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
    preparedMediaRef.current = null;
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

  async function submitPost(
    proof: CaptchaProof = {},
    fromCaptcha = false,
  ): Promise<ActionAttempt> {
    setBusy(true);
    setError("");
    setStatus("正在发布…");
    if (!fromCaptcha) {
      showActionFeedback({
        kind: "loading",
        title: "正在发送",
        detail: "正在把内容发布到校园墙。",
      });
    }
    const filesToUpload = files;
    if (!preparedMediaRef.current) {
      setUploadProgress(filesToUpload.map(createUploadProgressItem));
    }
    try {
      const media =
        preparedMediaRef.current ?? (await uploadFiles(filesToUpload));
      preparedMediaRef.current = media;
      setStatus("正在发布…");
      const result = await readJson<{ post: Post; deleteToken: string }>(
        "/api/posts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author,
            content,
            format: contentFormat,
            media,
            ...proof,
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
      preparedMediaRef.current = null;
      setContent("");
      setAuthor("");
      setContentFormat("plain");
      setFiles([]);
      setUploadProgress([]);
      showActionFeedback({
        kind: "success",
        title: "发送成功",
        detail: "内容已经发布到校园墙。",
      });
      await loadPosts(activeSearch);
      return "success";
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.captchaRequired) {
        if (fromCaptcha) {
          setCaptchaError(requestError.message || "验证码错误，请重新输入");
          return "captcha-error";
        }
        openCaptcha((nextProof) => submitPost(nextProof, true));
        return "failed";
      }
      if (
        requestError.maintenance ||
        requestError.message === "服务器正在重启更新"
      ) {
        setMaintenance(true);
      }
      showSendFailure(requestError.message);
      return "failed";
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || busy) {
      return;
    }
    await submitPost();
  }

  async function interact(
    postId: string,
    action: "like" | "report",
    reason = "",
    proof: CaptchaProof = {},
    fromCaptcha = false,
  ): Promise<ActionAttempt> {
    if (interactionBusyPostIdsRef.current.has(postId)) {
      return "failed";
    }
    interactionBusyPostIdsRef.current.add(postId);
    setInteractionBusyPostIds((current) => ({
      ...current,
      [postId]: true,
    }));
    if (!fromCaptcha) {
      showActionFeedback({
        kind: "loading",
        title: action === "like" ? "正在点赞" : "正在发送",
        detail:
          action === "like"
            ? "正在记录你的点赞，请稍候。"
            : "正在提交举报，请稍候。",
      });
    }
    try {
      const result = await readJson<{ post: Post; action: "added" | "unchanged" }>(
        "/api/posts/" + postId + "/interact",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason,
            ...proof,
          }),
        },
      );
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...post, ...result.post } : post,
        ),
      );
      if (action === "like") {
        showActionFeedback({
          kind: "success",
          title: result.action === "added" ? "点赞成功" : "已经点过赞了",
          detail:
            result.action === "added"
              ? "感谢你的支持。"
              : "同一设备只能点赞一次。",
        });
      } else {
        setStatus(
          result.action === "added"
            ? "举报已提交，管理员会尽快审查。"
            : "你已经举报过这条内容。",
        );
        showActionFeedback({
          kind: "success",
          title: "发送成功",
          detail:
            result.action === "added"
              ? "举报已提交，管理员会尽快审查。"
              : "你已经举报过这条内容。",
        });
      }
      return "success";
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.captchaRequired) {
        if (fromCaptcha) {
          setCaptchaError(requestError.message || "验证码错误，请重新输入");
          return "captcha-error";
        }
        openCaptcha((nextProof) =>
          interact(postId, action, reason, nextProof, true),
        );
        return "failed";
      }
      if (action === "report") {
        showSendFailure(requestError.message);
      } else {
        showSendFailure(requestError.message);
      }
      return "failed";
    } finally {
      interactionBusyPostIdsRef.current.delete(postId);
      setInteractionBusyPostIds((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
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
    const result = await interact(reportingPostId, "report", reportReason.trim());
    if (result === "success") {
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

  async function loadFullPost(postId: string) {
    if (loadingFullPostIds[postId]) {
      return;
    }
    setLoadingFullPostIds((current) => ({ ...current, [postId]: true }));
    try {
      const result = await readJson<{ post: Post }>("/api/posts/" + postId);
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...result.post, hasMore: false } : post,
        ),
      );
    } catch (caught) {
      setError((caught as Error).message || "全文加载失败，请稍后重试。");
    } finally {
      setLoadingFullPostIds((current) => ({ ...current, [postId]: false }));
    }
  }

  async function submitReply(
    postId: string,
    proof: CaptchaProof = {},
    fromCaptcha = false,
  ): Promise<ActionAttempt> {
    const content = (replyDrafts[postId] ?? "").trim();
    if (!content || replyBusyPostId) {
      return "failed";
    }
    setReplyBusyPostId(postId);
    if (!fromCaptcha) {
      showActionFeedback({
        kind: "loading",
        title: "正在发送",
        detail: "正在提交评论，请稍候。",
      });
    }
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
            ...proof,
          }),
        },
      );
      setRepliesByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] ?? []), result.reply],
      }));
      setReplyDrafts((current) => ({ ...current, [postId]: "" }));
      setExpandedReplyPostIds((current) => ({ ...current, [postId]: true }));
      showActionFeedback({
        kind: "success",
        title: "发送成功",
        detail: "评论已发布。",
      });
      return "success";
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.captchaRequired) {
        if (fromCaptcha) {
          setCaptchaError(requestError.message || "验证码错误，请重新输入");
          return "captcha-error";
        }
        openCaptcha((nextProof) => submitReply(postId, nextProof, true));
        return "failed";
      }
      setReplyErrors((current) => ({
        ...current,
        [postId]: (caught as Error).message,
      }));
      showSendFailure(requestError.message);
      return "failed";
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

  async function searchPosts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searching) {
      return;
    }
    const keyword = search.trim();
    setSearching(true);
    setError("");
    setActiveSearch(keyword);
    const loadingStartedAt = performance.now();
    try {
      await loadPosts(keyword);
    } finally {
      const minimumVisibleTime = 420;
      const remainingTime = Math.max(
        0,
        minimumVisibleTime - (performance.now() - loadingStartedAt),
      );
      if (remainingTime > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingTime));
      }
      setSearching(false);
    }
  }

  function openMarkdownEditor() {
    if (busy) {
      return;
    }
    setContentFormat("markdown");
    setMarkdownModeOpen(true);
  }

  function openVideoEmbedDialog() {
    if (busy) {
      return;
    }
    setVideoEmbedProvider(null);
    setVideoEmbedUrl("");
    setVideoEmbedError("");
    setVideoEmbedOpen(true);
  }

  function closeVideoEmbedDialog() {
    setVideoEmbedOpen(false);
    setVideoEmbedProvider(null);
    setVideoEmbedUrl("");
    setVideoEmbedError("");
  }

  function closeMarkdownEditor() {
    closeVideoEmbedDialog();
    setMarkdownModeOpen(false);
  }

  function chooseVideoEmbedProvider(provider: VideoEmbedProvider) {
    setVideoEmbedProvider(provider);
    setVideoEmbedUrl("");
    setVideoEmbedError("");
    window.requestAnimationFrame(() => videoEmbedInputRef.current?.focus());
  }

  function insertMarkdown(before: string, after = "", placeholder = "文本") {
    const input = markdownInputRef.current;
    if (!input) {
      return;
    }
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = content.slice(start, end) || placeholder;
    const nextContent =
      content.slice(0, start) + before + selected + after + content.slice(end);
    setContent(nextContent.slice(0, MARKDOWN_CONTENT_LIMIT));
    window.requestAnimationFrame(() => {
      input.focus();
      const selectionStart = Math.min(
        start + before.length,
        MARKDOWN_CONTENT_LIMIT,
      );
      const selectionEnd = Math.min(
        selectionStart + selected.length,
        nextContent.length,
        MARKDOWN_CONTENT_LIMIT,
      );
      input.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function insertVideoEmbed() {
    const provider = videoEmbedProvider;
    const input = markdownInputRef.current;
    if (!provider || !input) {
      setVideoEmbedError("请先选择平台，再输入视频链接。");
      return;
    }
    const result = createVideoEmbed(provider, videoEmbedUrl);
    if ("error" in result) {
      setVideoEmbedError(result.error);
      return;
    }

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const available =
      MARKDOWN_CONTENT_LIMIT - (content.length - Math.max(0, end - start));
    if (result.markdown.length > available) {
      setVideoEmbedError(
        `当前光标位置只剩 ${Math.max(0, available)} 字空间，无法完整插入视频。`,
      );
      return;
    }

    const nextContent =
      content.slice(0, start) + result.markdown + content.slice(end);
    setContent(nextContent);
    closeVideoEmbedDialog();
    window.requestAnimationFrame(() => {
      input.focus();
      const cursor = start + result.markdown.length;
      input.setSelectionRange(cursor, cursor);
    });
  }

  function handleMarkdownKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key === "Tab") {
      event.preventDefault();
      insertMarkdown("    ", "", "");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      insertMarkdown("**", "**", "加粗文本");
    }
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
                  disabled={searching}
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={searching}
              >
                {searching ? "检索中…" : "搜索"}
              </button>
            </form>
          </section>

          <section className="glass-card composer-card">
            <div className="card-heading">
              <h2>发表你的想法</h2>
              <div className="card-heading-actions">
                <span>
                  {contentFormat === "markdown"
                    ? `Markdown 最多 ${MARKDOWN_CONTENT_LIMIT} 字`
                    : `纯文本最多 ${PLAIN_CONTENT_LIMIT} 字`}
                </span>
                <button
                  className={
                    "markdown-mode-button" +
                    (contentFormat === "markdown" ? " active" : "")
                  }
                  type="button"
                  onClick={openMarkdownEditor}
                  disabled={busy}
                >
                  {contentFormat === "markdown"
                    ? "Markdown 已启用"
                    : "Markdown模式"}
                </button>
              </div>
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
                placeholder={
                  contentFormat === "markdown"
                    ? "Markdown 模式已启用，可点击右上角进入全屏编辑…"
                    : "今天有什么新鲜事？"
                }
                maxLength={
                  contentFormat === "markdown"
                    ? MARKDOWN_CONTENT_LIMIT
                    : PLAIN_CONTENT_LIMIT
                }
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
                          preparedMediaRef.current = null;
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
                  <span className="counter">
                    {content.length}/
                    {contentFormat === "markdown"
                      ? MARKDOWN_CONTENT_LIMIT
                      : PLAIN_CONTENT_LIMIT}
                  </span>
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
                  {post.format === "markdown" ? (
                    <MarkdownPreview
                      source={post.content}
                      className="post-content markdown-post-content"
                    />
                  ) : (
                    <div className="post-content">{post.content}</div>
                  )}
                  {post.format === "markdown" && post.hasMore && (
                    <button
                      className="markdown-more-button"
                      type="button"
                      onClick={() => void loadFullPost(post.id)}
                      disabled={Boolean(loadingFullPostIds[post.id])}
                    >
                      {loadingFullPostIds[post.id]
                        ? "正在加载全文…"
                        : "查看全文"}
                    </button>
                  )}
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
                      disabled={Boolean(interactionBusyPostIds[post.id])}
                      onClick={() => void interact(post.id, "like")}
                    >
                      {interactionBusyPostIds[post.id]
                        ? "正在点赞…"
                        : `♡ ${post.likes}`}
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
      {searching && (
        <div className="search-loading-backdrop" role="status" aria-live="assertive">
          <section className="glass-card search-loading-card" aria-label="正在检索">
            <div className="search-loading-icon">⌕</div>
            <h2>正在检索</h2>
            <p>正在从校园墙中查找相关内容，请稍候</p>
            <div className="search-loading-track" aria-hidden="true">
              <span />
            </div>
          </section>
        </div>
      )}
      {captchaOpen && (
        <div
          className="dialog-backdrop captcha-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !captchaBusy) {
              cancelCaptcha();
            }
          }}
        >
          <section
            className="glass-card dialog-card captcha-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="captcha-dialog-title"
          >
            <div className="captcha-card-topline">
              <div>
                <span className="captcha-kicker">SECURITY CHECK</span>
                <h2 id="captcha-dialog-title">请完成验证</h2>
              </div>
              <span className="captcha-countdown" aria-live="polite">
                {captchaSecondsLeft > 0 ? `${captchaSecondsLeft}s` : "已过期"}
              </span>
            </div>
            <p className="captcha-description">
              当前设备发送较频繁，请输入图片中的 6 位字母。验证码 30 秒内有效。
            </p>
            <div className="captcha-image-shell">
              {captchaLoading ? (
                <span className="captcha-image-spinner" aria-label="正在生成验证码" />
              ) : captchaChallenge ? (
                // The SVG is generated server-side and contains no executable markup.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={captchaChallenge.image} alt="验证码图片" />
              ) : (
                <span className="captcha-image-placeholder">验证码加载失败</span>
              )}
            </div>
            <button
              className="captcha-refresh"
              type="button"
              onClick={() => void loadCaptcha()}
              disabled={captchaLoading || captchaBusy}
            >
              看不清，换一张
            </button>
            <input
              className="captcha-input"
              value={captchaAnswer}
              onChange={(event) =>
                setCaptchaAnswer(
                  event.target.value.replace(/[^a-z]/gi, "").slice(0, 6),
                )
              }
              placeholder="输入图片中的验证码"
              aria-label="输入验证码"
              autoComplete="off"
              autoCapitalize="off"
              maxLength={6}
              disabled={captchaLoading || captchaBusy || captchaSecondsLeft <= 0}
              autoFocus
            />
            {captchaError && (
              <p className="captcha-error" role="alert">
                {captchaError}
              </p>
            )}
            <div className="dialog-actions captcha-actions">
              <button
                className="soft-button"
                type="button"
                onClick={cancelCaptcha}
                disabled={captchaBusy}
              >
                取消
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void submitCaptcha()}
                disabled={
                  captchaLoading ||
                  captchaBusy ||
                  captchaSecondsLeft <= 0 ||
                  captchaAnswer.length !== 6
                }
              >
                {captchaBusy ? "验证中…" : "提交验证"}
              </button>
            </div>
          </section>
        </div>
      )}
      {actionFeedback && (
        <div
          className="action-feedback-backdrop"
          role={actionFeedback.kind === "loading" ? "status" : "alertdialog"}
          aria-live="assertive"
        >
          <section
            className={"glass-card action-feedback-card " + actionFeedback.kind}
            role="document"
            aria-label={actionFeedback.title}
          >
            <div className="feedback-symbol" aria-hidden="true">
              {actionFeedback.kind === "loading" ? (
                <span className="feedback-spinner" />
              ) : actionFeedback.kind === "success" ? (
                <span className="feedback-check" />
              ) : (
                <span className="feedback-cross" />
              )}
            </div>
            <h2>{actionFeedback.title}</h2>
            <p>{actionFeedback.detail}</p>
            {actionFeedback.kind !== "loading" && (
              <button
                className="primary-button"
                type="button"
                onClick={() => setActionFeedback(null)}
              >
                知道了
              </button>
            )}
          </section>
        </div>
      )}
      {markdownModeOpen && (
        <div className="markdown-editor-overlay">
          <section
            className="markdown-editor-shell"
            role="dialog"
            aria-modal="true"
            aria-labelledby="markdown-editor-title"
          >
            <header className="markdown-editor-header">
              <div>
                <span className="markdown-editor-kicker">COMPOSE / MARKDOWN</span>
                <h2 id="markdown-editor-title">Markdown 发帖</h2>
                <p>左侧自由书写，右侧实时预览你的校园墙内容。</p>
              </div>
              <div className="markdown-editor-header-actions">
                <span className="markdown-character-count">
                  {content.length}/{MARKDOWN_CONTENT_LIMIT}
                </span>
                <button
                  className="soft-button"
                  type="button"
                  onClick={closeMarkdownEditor}
                >
                  返回发帖
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={closeMarkdownEditor}
                >
                  完成编辑
                </button>
              </div>
            </header>
            <div className="markdown-toolbar" aria-label="Markdown 快捷格式">
              <span className="markdown-toolbar-label">快捷插入</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("# ", "", "标题")}
              >
                H1
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("## ", "", "小标题")}
              >
                H2
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("**", "**", "加粗文本")}
              >
                B
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("*", "*", "斜体文本")}
              >
                I
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("> ", "", "引用内容")}
              >
                引用
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("- ", "", "列表项")}
              >
                列表
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("`", "`", "代码")}
              >
                代码
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdown("```\n", "\n```", "代码块")}
              >
                代码块
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  insertMarkdown("[", "](https://example.com)", "链接文字")
                }
              >
                链接
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openVideoEmbedDialog}
                aria-label="嵌入网络视频"
              >
                嵌入网络视频
              </button>
            </div>
            <div className="markdown-editor-workspace">
              <section className="markdown-editor-pane">
                <div className="markdown-pane-header">
                  <span>编辑器</span>
                  <small>Markdown</small>
                </div>
                <textarea
                  ref={markdownInputRef}
                  className="markdown-editor-input"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  onKeyDown={handleMarkdownKeyDown}
                  placeholder={'# 写下你的想法\n\n视频请使用 Bilibili / YouTube / Vimeo 的 HTTPS 播放地址…'}
                  maxLength={MARKDOWN_CONTENT_LIMIT}
                  autoFocus
                  spellCheck="false"
                />
              </section>
              <section className="markdown-preview-pane">
                <div className="markdown-pane-header">
                  <span>实时预览</span>
                  <small>安全渲染</small>
                </div>
                <div className="markdown-preview-scroll">
                  <MarkdownPreview
                    source={content}
                    emptyText="开始输入 Markdown，右侧会立即显示预览。"
                  />
                </div>
              </section>
            </div>
            <footer className="markdown-editor-footer">
              <span>
                支持标题、列表、引用、代码块、链接、表格和安全视频嵌入（Bilibili / YouTube / Vimeo）
              </span>
              <span>按 Esc 返回发帖</span>
            </footer>
          </section>
          {videoEmbedOpen && (
            <div
              className="video-embed-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeVideoEmbedDialog();
                }
              }}
            >
              <section
                className="video-embed-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="video-embed-dialog-title"
              >
                <div className="video-embed-dialog-topline">
                  <div className="video-embed-dialog-icon" aria-hidden="true">
                    ▶
                  </div>
                  <button
                    className="video-embed-close"
                    type="button"
                    onClick={closeVideoEmbedDialog}
                    aria-label="关闭视频嵌入窗口"
                  >
                    ×
                  </button>
                </div>
                <span className="video-embed-kicker">NETWORK VIDEO</span>
                <h2 id="video-embed-dialog-title">嵌入网络视频</h2>
                <p className="video-embed-description">
                  选择视频平台，粘贴链接后会自动生成安全的播放器代码。
                </p>
                <div className="video-embed-provider-grid">
                  <button
                    className={
                      "video-embed-provider" +
                      (videoEmbedProvider === "bilibili" ? " selected" : "")
                    }
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseVideoEmbedProvider("bilibili")}
                    aria-pressed={videoEmbedProvider === "bilibili"}
                  >
                    <span className="video-embed-provider-logo bilibili-logo">
                      哔
                    </span>
                    <span className="video-embed-provider-copy">
                      <strong>哔哩哔哩</strong>
                      <small>Bilibili</small>
                    </span>
                    <span className="video-embed-provider-radio" aria-hidden="true" />
                  </button>
                  <button
                    className={
                      "video-embed-provider" +
                      (videoEmbedProvider === "youtube" ? " selected" : "")
                    }
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseVideoEmbedProvider("youtube")}
                    aria-pressed={videoEmbedProvider === "youtube"}
                  >
                    <span className="video-embed-provider-logo youtube-logo">
                      ▶
                    </span>
                    <span className="video-embed-provider-copy">
                      <strong>YouTube</strong>
                      <small>YouTube</small>
                    </span>
                    <span className="video-embed-provider-radio" aria-hidden="true" />
                  </button>
                </div>
                {videoEmbedProvider && (
                  <form
                    className="video-embed-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      insertVideoEmbed();
                    }}
                  >
                    <label htmlFor="video-embed-url">视频链接</label>
                    <input
                      ref={videoEmbedInputRef}
                      id="video-embed-url"
                      type="url"
                      value={videoEmbedUrl}
                      onChange={(event) => {
                        setVideoEmbedUrl(event.target.value);
                        if (videoEmbedError) {
                          setVideoEmbedError("");
                        }
                      }}
                      placeholder={
                        videoEmbedProvider === "youtube"
                          ? "https://youtu.be/... 或 youtube.com/watch?v=..."
                          : "https://www.bilibili.com/video/BV..."
                      }
                      autoComplete="off"
                      spellCheck="false"
                    />
                    <p className="video-embed-help">
                      {videoEmbedProvider === "youtube"
                        ? "支持 YouTube 视频页、Shorts、短链接和 /embed/ 链接。"
                        : "支持哔哩哔哩视频页或 player.html 播放链接。"}
                    </p>
                    {videoEmbedError && (
                      <p className="video-embed-error" role="alert">
                        {videoEmbedError}
                      </p>
                    )}
                    <div className="video-embed-actions">
                      <button
                        className="soft-button"
                        type="button"
                        onClick={closeVideoEmbedDialog}
                      >
                        取消
                      </button>
                      <button
                        className="primary-button"
                        type="submit"
                        disabled={!videoEmbedUrl.trim()}
                      >
                        自动插入
                      </button>
                    </div>
                  </form>
                )}
                {!videoEmbedProvider && (
                  <div className="video-embed-dialog-hint">
                    先选择一个平台
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
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
