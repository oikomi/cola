import {
  adminFeishuOpenIds,
  allowedTenantKeys,
  requireFeishuConfig,
} from "./config";
import type { AuthRole } from "./permissions";

const FEISHU_AUTH_BASE_URL = "https://open.feishu.cn/open-apis";

type FeishuApiResponse<T> = {
  code?: number;
  msg?: string;
  data?: T;
} & Partial<T>;

type AppAccessTokenData = {
  app_access_token?: string;
  expire?: number;
};

type UserAccessTokenData = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type FeishuUserInfoData = {
  avatar_url?: string;
  avatar_thumb?: string;
  email?: string;
  en_name?: string;
  name?: string;
  open_id?: string;
  tenant_key?: string;
  union_id?: string;
};

export type FeishuIdentity = {
  avatarUrl: string | null;
  email: string | null;
  name: string | null;
  openId: string;
  role: AuthRole;
  tenantKey: string;
  unionId: string | null;
};

function feishuAuthError(message: string, code?: number) {
  return new Error(code === undefined ? message : `${message} (${code})`);
}

async function postFeishu<T>(
  path: string,
  body: unknown,
  headers: HeadersInit = {},
) {
  const response = await fetch(`${FEISHU_AUTH_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = (await response.json()) as FeishuApiResponse<T>;

  if (!response.ok || payload.code !== 0) {
    throw feishuAuthError(payload.msg ?? "飞书认证接口请求失败。", payload.code);
  }

  return (payload.data ?? payload) as T;
}

async function getFeishu<T>(path: string, headers: HeadersInit = {}) {
  const response = await fetch(`${FEISHU_AUTH_BASE_URL}${path}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const payload = (await response.json()) as FeishuApiResponse<T>;

  if (!response.ok || payload.code !== 0 || !payload.data) {
    throw feishuAuthError(payload.msg ?? "飞书认证接口请求失败。", payload.code);
  }

  return payload.data;
}

export function buildFeishuAuthorizeUrl(state: string) {
  const config = requireFeishuConfig();
  const url = new URL(`${FEISHU_AUTH_BASE_URL}/authen/v1/index`);
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url;
}

async function getAppAccessToken() {
  const config = requireFeishuConfig();
  const data = await postFeishu<AppAccessTokenData>(
    "/auth/v3/app_access_token/internal",
    {
      app_id: config.appId,
      app_secret: config.appSecret,
    },
  );

  if (!data.app_access_token) {
    throw new Error("飞书没有返回 app_access_token。");
  }

  return data.app_access_token;
}

async function getUserAccessToken(code: string) {
  const appAccessToken = await getAppAccessToken();
  const data = await postFeishu<UserAccessTokenData>(
    "/authen/v1/access_token",
    {
      grant_type: "authorization_code",
      code,
    },
    {
      Authorization: `Bearer ${appAccessToken}`,
    },
  );

  if (!data.access_token) {
    throw new Error("飞书没有返回 user_access_token。");
  }

  return data.access_token;
}

async function getUserInfo(userAccessToken: string) {
  return getFeishu<FeishuUserInfoData>("/authen/v1/user_info", {
    Authorization: `Bearer ${userAccessToken}`,
  });
}

export async function getFeishuIdentityFromCode(code: string) {
  const userAccessToken = await getUserAccessToken(code);
  const info = await getUserInfo(userAccessToken);

  if (!info.open_id) {
    throw new Error("飞书用户信息缺少 open_id。");
  }

  if (!info.tenant_key) {
    throw new Error("飞书用户信息缺少 tenant_key。");
  }

  const tenantAllowList = allowedTenantKeys();
  if (tenantAllowList.size > 0 && !tenantAllowList.has(info.tenant_key)) {
    throw new Error("当前飞书租户未被允许登录 Cola。");
  }

  return {
    avatarUrl: info.avatar_url ?? info.avatar_thumb ?? null,
    email: info.email ?? null,
    name: info.name ?? info.en_name ?? null,
    openId: info.open_id,
    role: adminFeishuOpenIds().has(info.open_id) ? "admin" : "viewer",
    tenantKey: info.tenant_key,
    unionId: info.union_id ?? null,
  } satisfies FeishuIdentity;
}
