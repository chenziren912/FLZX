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
};

type ReportedPost = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  reports: number;
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

  async function refreshAdminData() {
    try {
      const [statusData, reportData] = await Promise.all([
        request<StatusResponse>("/api/admin/migration/status"),
        request<{
          reports: ReportRecord[];
          reportedPosts: ReportedPost[];
        }>("/api/admin/reports"),
      ]);
      setStatus(statusData);
      setSourceType(statusData.state.sourceType ?? statusData.sourceType);
      setReports(reportData.reports);
      setReportedPosts(reportData.reportedPosts);
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

  async function logout() {
    setBusy(true);
    try {
      await request("/api/admin/logout", { method: "POST" });
      setLoggedIn(false);
      setReports([]);
      setReportedPosts([]);
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

          <Link className="admin-back" href="/">
            返回主页
          </Link>
        </section>
      </div>
    </main>
  );
}
