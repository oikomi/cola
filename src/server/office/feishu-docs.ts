const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn/open-apis";
const MAX_DOCUMENT_REFERENCES = 4;
const MAX_DOCUMENT_CONTENT_LENGTH = 18000;
const MAX_TOTAL_CONTENT_LENGTH = 36000;

type FeishuApiResponse<T> = {
  code?: number;
  msg?: string;
  data?: T;
} & Partial<T>;

export type FeishuDocumentType = "docx" | "doc" | "wiki";

export type FeishuDocumentReference = {
  type: FeishuDocumentType;
  token: string;
  url: string;
};

export type FeishuDocumentContext = {
  content: string;
  documentToken: string;
  sourceUrl: string;
  title: string | null;
  type: Exclude<FeishuDocumentType, "wiki">;
};

export type FeishuDocumentLoadResult = {
  documents: FeishuDocumentContext[];
  warnings: string[];
};

type TenantAccessTokenData = {
  tenant_access_token?: string;
};

type WikiNodeData = {
  node?: {
    obj_token?: string;
    obj_type?: string;
    title?: string;
  };
};

type RawContentData = {
  content?: string;
};

type MarkdownContentData = {
  content?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactErrorMessage(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

function trimEnv(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function truncateContent(content: string, maxLength: number) {
  const normalized = content.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}\n\n[内容已截断，原文超过 ${maxLength} 字符。]`;
}

function stripTrailingUrlPunctuation(value: string) {
  return value.replace(/[),.;:!?，。；：！？、）】》]+$/u, "");
}

function isSupportedFeishuHost(hostname: string) {
  return (
    hostname === "feishu.cn" ||
    hostname.endsWith(".feishu.cn") ||
    hostname === "larksuite.com" ||
    hostname.endsWith(".larksuite.com") ||
    hostname === "larkoffice.com" ||
    hostname.endsWith(".larkoffice.com")
  );
}

function parseFeishuDocumentUrl(rawUrl: string): FeishuDocumentReference | null {
  let url: URL;
  try {
    url = new URL(stripTrailingUrlPunctuation(rawUrl));
  } catch {
    return null;
  }

  if (!isSupportedFeishuHost(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const typeSegmentIndex = segments.findIndex((segment) =>
    ["docx", "docs", "doc", "wiki"].includes(segment),
  );
  if (typeSegmentIndex < 0) return null;

  const token = segments[typeSegmentIndex + 1];
  if (!token) return null;

  const segment = segments[typeSegmentIndex];
  const type: FeishuDocumentType =
    segment === "docs" || segment === "doc"
      ? "doc"
      : segment === "wiki"
        ? "wiki"
        : "docx";

  return {
    type,
    token,
    url: url.toString(),
  };
}

export function extractFeishuDocumentReferences(
  text: string | null | undefined,
) {
  if (!text) return [];

  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  const references: FeishuDocumentReference[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const reference = parseFeishuDocumentUrl(match);
    if (!reference) continue;

    const key = `${reference.type}:${reference.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(reference);

    if (references.length >= MAX_DOCUMENT_REFERENCES) break;
  }

  return references;
}

export function readFeishuDocumentReferences(
  payload: unknown,
  fallbackText?: string | null,
) {
  const payloadReferences = (() => {
    if (!isRecord(payload)) return [];

    const feishu = payload.feishu;
    if (!isRecord(feishu)) return [];

    const documents = feishu.documents;
    if (!Array.isArray(documents)) return [];

    return documents
      .map((document): FeishuDocumentReference | null => {
        if (!isRecord(document)) return null;

        const { type, token, url } = document;
        if (
          (type !== "docx" && type !== "doc" && type !== "wiki") ||
          typeof token !== "string" ||
          typeof url !== "string"
        ) {
          return null;
        }

        return { type, token, url };
      })
      .filter((document): document is FeishuDocumentReference =>
        Boolean(document),
      );
  })();

  return payloadReferences.length > 0
    ? payloadReferences
    : extractFeishuDocumentReferences(fallbackText);
}

async function getTenantAccessToken() {
  const appId = trimEnv(process.env.FEISHU_APP_ID);
  const appSecret = trimEnv(process.env.FEISHU_APP_SECRET);

  if (!appId || !appSecret) {
    throw new Error("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET。");
  }

  const response = await fetch(
    `${FEISHU_OPEN_API_BASE_URL}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    },
  );

  const payload = (await response
    .json()
    .catch(() => ({}))) as FeishuApiResponse<TenantAccessTokenData>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(
      payload.msg ?? `tenant_access_token 获取失败：HTTP ${response.status}`,
    );
  }

  const token = payload.data?.tenant_access_token ?? payload.tenant_access_token;
  if (!token) throw new Error("飞书没有返回 tenant_access_token。");
  return token;
}

async function getFeishu<T>(path: string, tenantAccessToken: string) {
  const response = await fetch(`${FEISHU_OPEN_API_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as FeishuApiResponse<T>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg ?? `飞书接口请求失败：HTTP ${response.status}`);
  }

  return (payload.data ?? payload) as T;
}

async function resolveWikiReference(
  reference: FeishuDocumentReference,
  tenantAccessToken: string,
) {
  const query = new URLSearchParams({
    token: reference.token,
  });
  const data = await getFeishu<WikiNodeData>(
    `/wiki/v2/spaces/get_node?${query.toString()}`,
    tenantAccessToken,
  );
  const node = data.node;
  const objToken = node?.obj_token?.trim();
  const objType = node?.obj_type?.trim();

  if (!objToken || (objType !== "docx" && objType !== "doc")) {
    throw new Error(
      `Wiki 节点不是可读取的飞书文档类型：${objType ?? "unknown"}`,
    );
  }

  return {
    documentToken: objToken,
    title: node?.title?.trim() ?? null,
    type: objType,
  } satisfies Pick<FeishuDocumentContext, "documentToken" | "title" | "type">;
}

async function readRawContent(
  token: string,
  tenantAccessToken: string,
) {
  const path = `/docx/v1/documents/${encodeURIComponent(token)}/raw_content`;
  const data = await getFeishu<RawContentData>(path, tenantAccessToken);
  return data.content?.trim() ?? "";
}

async function readMarkdownContent(
  type: Exclude<FeishuDocumentType, "wiki">,
  token: string,
  tenantAccessToken: string,
) {
  const query = new URLSearchParams({
    doc_token: token,
    doc_type: type,
    content_type: "markdown",
  });
  const data = await getFeishu<MarkdownContentData>(
    `/docs/v1/content?${query.toString()}`,
    tenantAccessToken,
  );
  return data.content?.trim() ?? "";
}

export async function loadFeishuDocumentContext(
  references: FeishuDocumentReference[],
): Promise<FeishuDocumentLoadResult> {
  if (references.length === 0) return { documents: [], warnings: [] };

  const documents: FeishuDocumentContext[] = [];
  const warnings: string[] = [];
  let remainingContentLength = MAX_TOTAL_CONTENT_LENGTH;

  let tenantAccessToken: string;
  try {
    tenantAccessToken = await getTenantAccessToken();
  } catch (error) {
    return {
      documents,
      warnings: [
        `飞书文档读取未配置：${compactErrorMessage(error instanceof Error ? error.message : "未知错误")}`,
      ],
    };
  }

  for (const reference of references.slice(0, MAX_DOCUMENT_REFERENCES)) {
    try {
      const resolved =
        reference.type === "wiki"
          ? await resolveWikiReference(reference, tenantAccessToken)
          : {
              documentToken: reference.token,
              title: null,
              type: reference.type,
            };

      if (remainingContentLength <= 0) {
        warnings.push("飞书文档正文总长度超过限制，后续文档未注入任务上下文。");
        break;
      }

      const rawContent =
        resolved.type === "docx"
          ? await readRawContent(resolved.documentToken, tenantAccessToken)
          : await readMarkdownContent(
              resolved.type,
              resolved.documentToken,
              tenantAccessToken,
            );
      const content = truncateContent(
        rawContent || "[文档正文为空]",
        Math.min(MAX_DOCUMENT_CONTENT_LENGTH, remainingContentLength),
      );
      remainingContentLength -= content.length;

      documents.push({
        content,
        documentToken: resolved.documentToken,
        sourceUrl: reference.url,
        title: resolved.title,
        type: resolved.type,
      });
    } catch (error) {
      warnings.push(
        `${reference.url} 读取失败：${compactErrorMessage(
          error instanceof Error ? error.message : "未知错误",
        )}`,
      );
    }
  }

  return { documents, warnings };
}
