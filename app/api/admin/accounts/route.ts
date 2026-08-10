import {
  getPostingRule,
  isAccountId,
  isIpHash,
  listAccounts,
  listIpRestrictions,
  Restriction,
  RestrictionKind,
  sendAccountMessage,
  setAccountRestriction,
  setIpRestriction,
} from "../../../../lib/accounts";
import { apiError, json, parseBody, requireAdmin } from "../../../../lib/api";

type ManagementAction =
  | "restrictAccount"
  | "clearAccountRestriction"
  | "restrictIp"
  | "clearIpRestriction"
  | "sendMessage";

type ManagementBody = {
  action?: ManagementAction;
  accountId?: string;
  ipHash?: string;
  restriction?: RestrictionKind;
  durationHours?: number;
  reason?: string;
  title?: string;
  content?: string;
};

const ALLOWED_DURATIONS = new Set([0, 24, 24 * 7]);

function makeRestriction(
  kind: RestrictionKind,
  durationHours: number,
  reason: string,
): Restriction {
  return {
    kind,
    reason: reason.trim().slice(0, 160),
    createdAt: new Date().toISOString(),
    expiresAt:
      durationHours === 0
        ? null
        : new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  try {
    const [accounts, ipRestrictions] = await Promise.all([
      listAccounts(),
      listIpRestrictions(),
    ]);
    return json({
      accounts: accounts.map((account) => ({
        ...account,
        postingRule: getPostingRule(account),
      })),
      ipRestrictions,
    });
  } catch (error) {
    return apiError(error, 503);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }
  const body = await parseBody<ManagementBody>(request);
  const action = body?.action;
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const durationHours = Number(body?.durationHours ?? 0);
  if (!action) {
    return json({ error: "管理操作无效" }, { status: 400 });
  }

  try {
    if (action === "sendMessage") {
      const accountId = typeof body?.accountId === "string" ? body.accountId : "";
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const content = typeof body?.content === "string" ? body.content.trim() : "";
      if (!isAccountId(accountId) || !title || title.length > 80 || !content || content.length > 1000) {
        return json({ error: "站内信标题或内容不符合要求" }, { status: 400 });
      }
      const message = await sendAccountMessage(accountId, title, content);
      if (!message) {
        return json({ error: "账户不存在" }, { status: 404 });
      }
      return json({ success: true, message });
    }

    if (action === "restrictAccount") {
      const accountId = typeof body?.accountId === "string" ? body.accountId : "";
      if (
        !isAccountId(accountId) ||
        (body?.restriction !== "ban" && body?.restriction !== "mute") ||
        !ALLOWED_DURATIONS.has(durationHours) ||
        reason.trim().length > 160
      ) {
        return json({ error: "账户限制参数无效" }, { status: 400 });
      }
      const account = await setAccountRestriction(
        accountId,
        makeRestriction(body.restriction, durationHours, reason),
      );
      if (!account) {
        return json({ error: "账户不存在" }, { status: 404 });
      }
      return json({ success: true, account });
    }

    if (action === "clearAccountRestriction") {
      const accountId = typeof body?.accountId === "string" ? body.accountId : "";
      if (!isAccountId(accountId)) {
        return json({ error: "账户编号无效" }, { status: 400 });
      }
      const account = await setAccountRestriction(accountId, null);
      if (!account) {
        return json({ error: "账户不存在" }, { status: 404 });
      }
      return json({ success: true, account });
    }

    if (action === "restrictIp") {
      const ipHash = typeof body?.ipHash === "string" ? body.ipHash : "";
      if (
        !isIpHash(ipHash) ||
        (body?.restriction !== "ban" && body?.restriction !== "mute") ||
        !ALLOWED_DURATIONS.has(durationHours) ||
        reason.trim().length > 160
      ) {
        return json({ error: "网络限制参数无效" }, { status: 400 });
      }
      const record = await setIpRestriction(
        ipHash,
        makeRestriction(body.restriction, durationHours, reason),
      );
      return json({ success: true, record });
    }

    if (action === "clearIpRestriction") {
      const ipHash = typeof body?.ipHash === "string" ? body.ipHash : "";
      if (!isIpHash(ipHash)) {
        return json({ error: "网络标识无效" }, { status: 400 });
      }
      const record = await setIpRestriction(ipHash, null);
      return json({ success: true, record });
    }
    return json({ error: "管理操作无效" }, { status: 400 });
  } catch (error) {
    return apiError(error, 503);
  }
}
