"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type MigrationState = {
  status: "idle" | "running" | "ready_to_finalize" | "finished" | "stopped";
  sourceType?: "legacy_api" | "s3";
  startedAt?: string;
  finishedAt?: string;
  sourcePrefix?: string;
  targetPrefix?: string;
  copied: number;
  skipped: number;
  failed: number;
  errors: string[];
  maintenance: boolean;
};

type StatusResponse = {
  state: MigrationState;
  sourceType: "legacy_api" | "s3";
  sourceConfigured: boolean;
  targetConfigured: boolean;
};

type ReportStatus = "open" | "resolved" | "dismissed";

type ReportRecord = {
  id: string;
  postId: string;
  reason: string;
  createdAt: string;
  status: ReportStatus;
  accountId?: string;
  sourceIpHash?: string;
};

type ReportedPost = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  reports: number;
  media?: Array<{ key: string; name: string; type: string; size: number }>;
  format?: "plain" | "markdown";
  accountId?: string;
  sourceIpHash?: string;
};

type Restriction = {
  kind: "ban" | "mute";
  reason: string;
  createdAt: string;
  expiresAt: string | null;
};

type ManagedAccount = {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  xp: number;
  postCount: number;
  replyCount: number;
  restriction?: Restriction | null;
  postingRule: { level: number; cooldownSeconds: number; nextLevelXp: number | null };
};

type ManagedIpRestriction = {
  ipHash: string;
  updatedAt: string;
  restriction: Restriction | null;
};

type Announcement = {
  id: string;
  title?: string;
  content: string;
  createdAt: string;
};

async function request<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function stateLabel(status: MigrationState["status"]) {
  if (status === "running") {
    return "迁移中";
  }
  if (status === "ready_to_finalize") {
    return "等待恢复服务";
  }
  if (status === "finished") {
    return "已完成";
  }
  if (status === "stopped") {
    return "已停止";
  }
  return "未开始";
}

function reportStatusLabel(status: ReportStatus) {
  if (status === "resolved") {
    return "已处理";
  }
  if (status === "dismissed") {
    return "已驳回";
  }
  return "待审查";
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

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [sourcePrefix, setSourcePrefix] = useState("");
  const [targetPrefix, setTargetPrefix] = useState("");
  const [sourceType, setSourceType] = useState<"legacy_api" | "s3">(
    "legacy_api",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [reportedPosts, setReportedPosts] = useState<ReportedPost[]>([]);
  const [posts, setPosts] = useState<ReportedPost[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [ipRestrictions, setIpRestrictions] = useState<ManagedIpRestriction[]>([]);
  const [moderationDuration, setModerationDuration] = useState("24");
  const [moderationReason, setModerationReason] = useState("");
  const [messageAccountId, setMessageAccountId] = useState("");
  const [messageTitle, setMessageTitle] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementContent, setAnnouncementContent] = useState("");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  async function refreshAdminData() {
    try {
      const [statusData, reportData, accountData, announcementData] = await Promise.all([
        request<StatusResponse>("/api/admin/migration/status"),
        request<{
          reports: ReportRecord[];
          reportedPosts: ReportedPost[];
          posts: ReportedPost[];
        }>("/api/admin/reports"),
        request<{
          accounts: ManagedAccount[];
          ipRestrictions: ManagedIpRestriction[];
        }>("/api/admin/accounts"),
        request<{ announcements: Announcement[] }>("/api/announcements"),
      ]);
      setStatus(statusData);
      setSourceType(statusData.state.sourceType ?? statusData.sourceType);
      setReports(reportData.reports);
      setReportedPosts(reportData.reportedPosts);
      setPosts(reportData.posts);
      setAccounts(accountData.accounts);
      setIpRestrictions(accountData.ipRestrictions);
      setAnnouncements(announcementData.announcements);
      setLoggedIn(true);
    } catch (caught) {
      const text = (caught as Error).message;
      if (text === "未授权") {
        setLoggedIn(false);
      } else {
        setError(text);
      }
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshAdminData(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      await refreshAdminData();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runAction(
    path: string,
    body: Record<string, unknown> = {},
    successMessage = "",
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (successMessage) {
        setMessage(successMessage);
      }
      await refreshAdminData();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateReport(id: string, nextStatus: ReportStatus) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: nextStatus }),
      });
      setMessage("举报状态已更新。");
      await refreshAdminData();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAdminPost(post: ReportedPost) {
    if (!window.confirm(`确定删除帖子「${post.content.slice(0, 36)}」吗？此操作会同时清理媒体和回复，无法撤销。`)) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/api/admin/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id }),
      });
      setMessage("帖子已删除，关联媒体和回复已清理。");
      await refreshAdminData();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function selectedDurationHours() {
    const hours = Number(moderationDuration);
    return [0, 24, 168].includes(hours) ? hours : 24;
  }

  function restrictionLabel(restriction: Restriction | null | undefined) {
    if (!restriction) {
      return "未限制";
    }
    const duration = restriction.expiresAt
      ? `至 ${formatTime(restriction.expiresAt)}`
      : "永久";
    return `${restriction.kind === "ban" ? "封禁" : "禁言"} · ${duration}`;
  }

  async function restrictAccount(
    accountId: string,
    restriction: "ban" | "mute",
  ) {
    if (!window.confirm(`确定要${restriction === "ban" ? "封禁" : "禁言"}该账户吗？`)) {
      return;
    }
    await runAction(
      "/api/admin/accounts",
      {
        action: "restrictAccount",
        accountId,
        restriction,
        durationHours: selectedDurationHours(),
        reason: moderationReason.trim(),
      },
      `账户已${restriction === "ban" ? "封禁" : "禁言"}。`,
    );
  }

  async function restrictIp(ipHash: string, restriction: "ban" | "mute") {
    if (!window.confirm(`确定要${restriction === "ban" ? "封禁" : "禁言"}该网络吗？`)) {
      return;
    }
    await runAction(
      "/api/admin/accounts",
      {
        action: "restrictIp",
        ipHash,
        restriction,
        durationHours: selectedDurationHours(),
        reason: moderationReason.trim(),
      },
      `网络已${restriction === "ban" ? "封禁" : "禁言"}。`,
    );
  }

  async function sendStationMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!messageAccountId || !messageTitle.trim() || !messageContent.trim()) {
      setError("请选择账户，并填写站内信标题和内容。");
      return;
    }
    await runAction(
      "/api/admin/accounts",
      {
        action: "sendMessage",
        accountId: messageAccountId,
        title: messageTitle.trim(),
        content: messageContent.trim(),
      },
      "站内信已发送。",
    );
    setMessageTitle("");
    setMessageContent("");
  }

  async function publishAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!announcementContent.trim()) {
      setError("请填写公告内容。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: announcementTitle.trim() || "校园公告",
          content: announcementContent.trim(),
        }),
      });
      setAnnouncementTitle("");
      setAnnouncementContent("");
      setMessage("公告已发布，会在用户访问校园墙时显示。");
      await refreshAdminData();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAnnouncement(id: string) {
    if (!window.confirm("确定撤下这条公告吗？")) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/api/announcements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setMessage("公告已撤下。");
      await refreshAdminData();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await request("/api/admin/logout", { method: "POST" });
      setLoggedIn(false);
      setReports([]);
      setReportedPosts([]);
      setPosts([]);
      setAccounts([]);
      setIpRestrictions([]);
      setAnnouncements([]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loggedIn) {
    return (
      <main className="admin-page">
        <div className="ambient-orb ambient-orb-one" />
        <div className="ambient-orb ambient-orb-two" />
        <div className="admin-shell">
          <section className="glass-card admin-card">
            <div className="admin-login-head">
              <div className="admin-lock">⌁</div>
              <h1>管理员登录</h1>
              <p>只有管理员入口在服务器迁移期间保持可用。</p>
            </div>
            <form className="admin-form" onSubmit={login}>
              <input
                className="admin-input"
                type="password"
                placeholder="请输入管理员密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "验证中..." : "安全进入后台"}
              </button>
              {error && <p className="error-note">{error}</p>}
            </form>
            <Link className="admin-back" href="/">
              返回主页
            </Link>
          </section>
        </div>
      </main>
    );
  }

  const migration = status?.state;
  const isRunning = migration?.status === "running";
  const canFinish = migration?.status === "ready_to_finalize";

  return (
    <main className="admin-page">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <div className="admin-shell">
        <section className="glass-card admin-card">
          <div className="management-head">
            <div>
              <h1>服务器管理</h1>
              <p>迁移期间除了 admin 端点，其他端点会提示“服务器正在重启更新”。</p>
            </div>
            <div className="management-head-actions">
              <span className={"status-pill" + (isRunning ? " active" : "")}>
                {stateLabel(migration?.status ?? "idle")}
              </span>
              <button
                className="soft-button"
                type="button"
                onClick={() => void logout()}
                disabled={busy}
              >
                退出登录
              </button>
            </div>
          </div>

          <div className="management-grid">
            <section className="management-panel">
              <h2>迁移数据</h2>
              <p>
                从迁移源按批次复制到主 COS。开始迁移后会自动打开维护模式，完成后再手动恢复服务。
              </p>
              <div className="management-fields">
                <label className="management-field">
                  迁移来源
                  <select
                    value={sourceType}
                    onChange={(event) =>
                      setSourceType(event.target.value as "legacy_api" | "s3")
                    }
                    disabled={isRunning}
                  >
                    <option value="legacy_api">旧墙 API（tyz.l.cd）</option>
                    <option value="s3">旧服务器 S3 / COS</option>
                  </select>
                </label>
                <label className="management-field">
                  迁移源前缀
                  <input
                    value={sourcePrefix}
                    onChange={(event) => setSourcePrefix(event.target.value)}
                    placeholder="留空表示全部"
                  />
                </label>
                <label className="management-field">
                  目标前缀
                  <input
                    value={targetPrefix}
                    onChange={(event) => setTargetPrefix(event.target.value)}
                    placeholder="留空表示保持原路径"
                  />
                </label>
              </div>
              <div className="management-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy || isRunning}
                  onClick={() =>
                    void runAction(
                      "/api/admin/migration/start",
                      { sourcePrefix, targetPrefix, sourceType },
                      "迁移已开始，公开接口已进入维护模式。",
                    )
                  }
                >
                  开始迁移
                </button>
                <button
                  className="soft-button"
                  type="button"
                  disabled={busy || !isRunning}
                  onClick={() =>
                    void runAction(
                      "/api/admin/migration/run",
                      { batchSize: 5 },
                      "本批迁移完成。",
                    )
                  }
                >
                  继续迁移一批
                </button>
                <button
                  className="soft-button"
                  type="button"
                  disabled={busy || !canFinish}
                  onClick={() =>
                    void runAction(
                      "/api/admin/migration/finish",
                      {},
                      "迁移完成，公开接口已恢复。",
                    )
                  }
                >
                  完成并恢复服务
                </button>
                <button
                  className="soft-button"
                  type="button"
                  disabled={busy || !isRunning}
                  onClick={() =>
                    void runAction(
                      "/api/admin/migration/stop",
                      {},
                      "迁移已停止，公开接口已恢复。",
                    )
                  }
                >
                  中止迁移
                </button>
              </div>
              <div className="migration-stats">
                <div className="stat-box">
                  <strong>{migration?.copied ?? 0}</strong>
                  <span>已复制</span>
                </div>
                <div className="stat-box">
                  <strong>{migration?.skipped ?? 0}</strong>
                  <span>已跳过</span>
                </div>
                <div className="stat-box">
                  <strong>{migration?.failed ?? 0}</strong>
                  <span>失败</span>
                </div>
                <div className="stat-box">
                  <strong>{status?.sourceConfigured ? "已配" : "未配"}</strong>
                  <span>迁移源</span>
                </div>
              </div>
              {migration?.errors.length ? (
                <p className="error-note">
                  最近错误：{migration.errors.slice(-3).join("；")}
                </p>
              ) : null}
            </section>

            <section className="management-panel">
              <h2>当前存储</h2>
              <p>
                主存储：{status?.targetConfigured ? "已连接配置" : "尚未配置"}。
                当前来源：{migration?.sourceType === "s3" ? "S3 / COS" : "旧墙 API"}。
                密钥只从 EdgeOne 环境变量读取，不会写入仓库。
              </p>
              {message && <p>{message}</p>}
              {error && <p className="error-note">{error}</p>}
            </section>
          </div>

          <section className="management-panel account-management-panel">
            <div className="panel-heading-inline">
              <div>
                <h2>账户与网络管理</h2>
                <p>账户标识与网络标识均为不可逆哈希；不会在后台显示原始登录信息或 IP。</p>
              </div>
              <span className="report-count">{accounts.length} 个账户</span>
            </div>
            <div className="management-fields moderation-fields">
              <label className="management-field">
                限制时长
                <select
                  value={moderationDuration}
                  onChange={(event) => setModerationDuration(event.target.value)}
                  disabled={busy}
                >
                  <option value="24">24 小时</option>
                  <option value="168">7 天</option>
                  <option value="0">永久</option>
                </select>
              </label>
              <label className="management-field moderation-reason-field">
                处理原因（可选，用户账户中心可见）
                <input
                  value={moderationReason}
                  onChange={(event) => setModerationReason(event.target.value)}
                  maxLength={160}
                  placeholder="例如：多次发布无关内容"
                  disabled={busy}
                />
              </label>
            </div>
            {accounts.length === 0 ? (
              <div className="report-empty">尚无登录账户。用户首次登录、发帖、评论或互动后会出现在这里。</div>
            ) : (
              <div className="account-management-list">
                {accounts.map((account) => (
                  <article className="managed-account-item" key={account.id}>
                    <div className="managed-account-head">
                      <div>
                        <strong>{account.displayName}</strong>
                        <span>
                          Lv.{account.postingRule.level} · {account.xp} 经验 · {account.postCount} 帖 / {account.replyCount} 评论
                        </span>
                      </div>
                      <span className="report-id">#{account.id.slice(0, 12)}</span>
                    </div>
                    <p className={"restriction-state" + (account.restriction ? " restricted" : "")}>
                      {restrictionLabel(account.restriction)}
                      {account.restriction?.reason ? `：${account.restriction.reason}` : ""}
                    </p>
                    <div className="report-actions">
                      <button
                        className="danger-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void restrictAccount(account.id, "ban")}
                      >
                        封禁账户
                      </button>
                      <button
                        className="soft-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void restrictAccount(account.id, "mute")}
                      >
                        禁言账户
                      </button>
                      {account.restriction && (
                        <button
                          className="soft-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runAction(
                              "/api/admin/accounts",
                              { action: "clearAccountRestriction", accountId: account.id },
                              "账户限制已解除。",
                            )
                          }
                        >
                          解除限制
                        </button>
                      )}
                      <button
                        className="soft-button"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setMessageAccountId(account.id);
                          setMessage("已选择「" + account.displayName + "」作为站内信收件人。");
                        }}
                      >
                        发送站内信
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="ip-restrictions-block">
              <div className="panel-heading-inline">
                <div>
                  <h3>已限制网络</h3>
                  <p>在帖子或举报记录中可对对应网络执行封禁、禁言操作。</p>
                </div>
                <span className="report-count">{ipRestrictions.length} 条</span>
              </div>
              {ipRestrictions.length === 0 ? (
                <p className="network-empty">目前没有网络限制。</p>
              ) : (
                <div className="network-restriction-list">
                  {ipRestrictions.map((record) => (
                    <div className="network-restriction-item" key={record.ipHash}>
                      <div>
                        <strong>{restrictionLabel(record.restriction)}</strong>
                        <span className="report-id">网络 #{record.ipHash.slice(0, 14)}</span>
                        {record.restriction?.reason && <small>{record.restriction.reason}</small>}
                      </div>
                      <button
                        className="soft-button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(
                            "/api/admin/accounts",
                            { action: "clearIpRestriction", ipHash: record.ipHash },
                            "网络限制已解除。",
                          )
                        }
                      >
                        解除限制
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="management-panel station-message-panel">
            <div className="panel-heading-inline">
              <div>
                <h2>发送站内消息</h2>
                <p>消息仅在对应用户打开账户中心时读取；不会冒充浏览器推送。</p>
              </div>
            </div>
            <form className="admin-composer-form" onSubmit={sendStationMessage}>
              <label className="management-field">
                收件账户
                <select
                  value={messageAccountId}
                  onChange={(event) => setMessageAccountId(event.target.value)}
                  disabled={busy}
                  required
                >
                  <option value="">请选择账户</option>
                  {accounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {account.displayName} · #{account.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="management-field">
                标题
                <input
                  value={messageTitle}
                  onChange={(event) => setMessageTitle(event.target.value)}
                  maxLength={80}
                  placeholder="例如：关于你的帖子"
                  disabled={busy}
                  required
                />
              </label>
              <label className="management-field admin-wide-field">
                内容
                <textarea
                  value={messageContent}
                  onChange={(event) => setMessageContent(event.target.value)}
                  maxLength={1000}
                  placeholder="请输入要发送给该账户的内容…"
                  disabled={busy}
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={busy || !messageAccountId}>
                发送站内信
              </button>
            </form>
          </section>

          <section className="management-panel announcement-management-panel">
            <div className="panel-heading-inline">
              <div>
                <h2>访问公告</h2>
                <p>公告会在用户访问校园墙时以弹窗显示；用户可选择不再显示、1 天内不再显示或稍后再说。</p>
              </div>
              <span className="report-count">{announcements.length} 条</span>
            </div>
            <form className="admin-composer-form" onSubmit={publishAnnouncement}>
              <label className="management-field">
                标题（可选）
                <input
                  value={announcementTitle}
                  onChange={(event) => setAnnouncementTitle(event.target.value)}
                  maxLength={80}
                  placeholder="默认：校园公告"
                  disabled={busy}
                />
              </label>
              <label className="management-field admin-wide-field">
                公告内容
                <textarea
                  value={announcementContent}
                  onChange={(event) => setAnnouncementContent(event.target.value)}
                  maxLength={500}
                  placeholder="填写用户访问时会看到的公告…"
                  disabled={busy}
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={busy || !announcementContent.trim()}>
                发布公告
              </button>
            </form>
            {announcements.length > 0 && (
              <div className="announcement-admin-list">
                {announcements.map((announcement) => (
                  <article className="report-item" key={announcement.id}>
                    <div className="report-item-head">
                      <div>
                        <strong className="admin-post-author">{announcement.title || "校园公告"}</strong>
                        <span>{formatTime(announcement.createdAt)}</span>
                      </div>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteAnnouncement(announcement.id)}
                      >
                        撤下
                      </button>
                    </div>
                    <p className="report-target">{announcement.content}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="management-panel reports-panel">
            <div className="panel-heading-inline">
              <div>
                <h2>举报投诉</h2>
                <p>用户提交的举报会在这里留痕；处理状态会持久化到主 COS。</p>
              </div>
              <span className="report-count">
                {reports.filter((report) => report.status === "open").length} 条待审查
              </span>
            </div>
            {reports.length === 0 && reportedPosts.length === 0 ? (
              <div className="report-empty">目前没有举报记录。</div>
            ) : (
              <div className="report-list">
                {reports.map((report) => {
                  const post = reportedPosts.find((item) => item.id === report.postId);
                  return (
                    <article className="report-item" key={report.id}>
                      <div className="report-item-head">
                        <div>
                          <strong>{reportStatusLabel(report.status)}</strong>
                          <span>{formatTime(report.createdAt)}</span>
                        </div>
                        <span className="report-id">#{report.postId.slice(0, 8)}</span>
                      </div>
                      <p className="report-reason">
                        {report.reason || "用户未填写具体举报原因"}
                      </p>
                      <p className="report-target">
                        {post
                          ? `${post.author}：${post.content}`
                          : "关联帖子已删除，仍保留这条举报记录。"}
                      </p>
                      <div className="report-actions">
                        {report.status === "open" ? (
                          <>
                            <button
                              className="soft-button"
                              type="button"
                              disabled={busy}
                              onClick={() => void updateReport(report.id, "resolved")}
                            >
                              标记已处理
                            </button>
                            <button
                              className="soft-button"
                              type="button"
                              disabled={busy}
                              onClick={() => void updateReport(report.id, "dismissed")}
                            >
                              标记误报
                            </button>
                          </>
                        ) : (
                          <button
                            className="soft-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void updateReport(report.id, "open")}
                          >
                            重新打开
                          </button>
                        )}
                        {post && (
                          <button
                            className="danger-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void deleteAdminPost(post)}
                          >
                            删除关联帖子
                          </button>
                        )}
                        {report.accountId && (
                          <button
                            className="soft-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void restrictAccount(report.accountId as string, "mute")}
                          >
                            禁言举报账户
                          </button>
                        )}
                        {report.sourceIpHash && (
                          <button
                            className="soft-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void restrictIp(report.sourceIpHash as string, "mute")}
                          >
                            禁言举报网络
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {reportedPosts
                  .filter((post) => !reports.some((report) => report.postId === post.id))
                  .map((post) => (
                    <article className="report-item report-aggregate" key={post.id}>
                      <div className="report-item-head">
                        <div>
                          <strong>历史举报汇总</strong>
                          <span>{post.reports} 次举报</span>
                        </div>
                        <span className="report-id">#{post.id.slice(0, 8)}</span>
                      </div>
                      <p className="report-target">
                        {post.author}：{post.content}
                      </p>
                      <p className="report-hint">
                        这是迁移来的举报计数，旧服务器没有提供逐条投诉内容。
                      </p>
                    </article>
                  ))}
              </div>
            )}
          </section>

          <section className="management-panel posts-panel">
            <div className="panel-heading-inline">
              <div>
                <h2>帖子管理</h2>
                <p>管理员可以删除任意帖子；删除时会同时清理已关联的媒体、回复和互动记录。</p>
              </div>
              <span className="report-count">{posts.length} 篇帖子</span>
            </div>
            {posts.length === 0 ? (
              <div className="report-empty">目前没有帖子。</div>
            ) : (
              <div className="report-list">
                {posts.map((post) => (
                  <article className="report-item admin-post-item" key={post.id}>
                    <div className="report-item-head">
                      <div>
                        <strong className="admin-post-author">{post.author}</strong>
                        <span>
                          {formatTime(post.createdAt)} · {post.format === "markdown" ? "Markdown" : "纯文本"} · {post.media?.length ?? 0} 个媒体
                        </span>
                      </div>
                      <span className="report-id">#{post.id.slice(0, 8)}</span>
                    </div>
                    <p className="admin-post-content">{post.content}</p>
                    {(post.accountId || post.sourceIpHash) && (
                      <p className="admin-post-identifiers">
                        {post.accountId ? `账户 #${post.accountId.slice(0, 12)}` : "匿名设备"}
                        {post.sourceIpHash ? ` · 网络 #${post.sourceIpHash.slice(0, 14)}` : ""}
                      </p>
                    )}
                    <div className="report-actions">
                      {post.accountId && (
                        <>
                          <button
                            className="danger-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void restrictAccount(post.accountId as string, "ban")}
                          >
                            封禁账户
                          </button>
                          <button
                            className="soft-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void restrictAccount(post.accountId as string, "mute")}
                          >
                            禁言账户
                          </button>
                          <button
                            className="soft-button"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setMessageAccountId(post.accountId as string);
                              setMessage("已选择该帖账户作为站内信收件人。");
                            }}
                          >
                            站内信
                          </button>
                        </>
                      )}
                      {post.sourceIpHash && (
                        <>
                          <button
                            className="danger-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void restrictIp(post.sourceIpHash as string, "ban")}
                          >
                            封禁网络
                          </button>
                          <button
                            className="soft-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void restrictIp(post.sourceIpHash as string, "mute")}
                          >
                            禁言网络
                          </button>
                        </>
                      )}
                      <button
                        className="danger-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteAdminPost(post)}
                      >
                        删除帖子
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <Link className="admin-back" href="/">
            返回主页
          </Link>
        </section>
      </div>
    </main>
  );
}
