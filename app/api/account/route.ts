import {
  accountPublicProfile,
  getOrCreateAccount,
  getPostingRule,
  listAccountMessages,
  markAccountMessageRead,
  unreadMessageCount,
} from "../../../lib/accounts";
import { apiError, guardMaintenance, json, parseBody } from "../../../lib/api";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "../../chatgpt-auth";
import { hasStorage } from "../../../lib/storage";

function unauthenticatedResponse() {
  return {
    authenticated: false,
    signInPath: chatGPTSignInPath("/"),
    anonymousPostingRule: getPostingRule(null),
  };
}

export async function GET() {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  const user = await getChatGPTUser();
  if (!user) {
    return json(unauthenticatedResponse(), {
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!hasStorage()) {
    return json({ error: "服务器存储尚未配置" }, { status: 503 });
  }
  try {
    const account = await getOrCreateAccount(user);
    const messages = await listAccountMessages(account.id, 60);
    return json(
      {
        authenticated: true,
        profile: accountPublicProfile(account),
        messages,
        unreadMessages: unreadMessageCount(messages),
        signOutPath: chatGPTSignOutPath("/"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error, 503);
  }
}

export async function PATCH(request: Request) {
  const blocked = await guardMaintenance();
  if (blocked) {
    return blocked;
  }
  const user = await getChatGPTUser();
  if (!user) {
    return json({ error: "请先登录账户" }, { status: 401 });
  }
  const body = await parseBody<{ messageId?: string }>(request);
  if (!body?.messageId || !/^[a-z0-9-]{36}$/i.test(body.messageId)) {
    return json({ error: "站内信编号无效" }, { status: 400 });
  }
  try {
    const account = await getOrCreateAccount(user);
    const message = await markAccountMessageRead(account.id, body.messageId);
    if (!message) {
      return json({ error: "站内信不存在" }, { status: 404 });
    }
    return json({ success: true, message });
  } catch (error) {
    return apiError(error, 503);
  }
}
