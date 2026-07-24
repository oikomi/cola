const FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn/open-apis";
const MAX_DOCUMENT_REFERENCES = 4;
const MAX_DOCUMENT_CONTENT_LENGTH = 18000;
const MAX_TOTAL_CONTENT_LENGTH = 36000;
const MAX_REPORT_MARKDOWN_LENGTH = 16000;

type FeishuApiResponse<T> = {
  code?: number;
  msg?: string;
  data?: T;
  error?: {
    log_id?: string;
  };
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

type CreateDocumentData = {
  document?: {
    document_id?: string;
    title?: string;
  };
};

type ConvertDocumentData = {
  blocks?: Array<Record<string, unknown> & { block_type?: number }>;
  first_level_block_ids?: string[];
};

export type CreatedFeishuDocument = {
  documentId: string;
  title: string;
  url: string;
  warnings: string[];
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

export function hasFeishuDocumentCredentials() {
  return Boolean(
    trimEnv(process.env.FEISHU_APP_ID) &&
    trimEnv(process.env.FEISHU_APP_SECRET),
  );
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

function parseFeishuDocumentUrl(
  rawUrl: string,
): FeishuDocumentReference | null {
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

async function getTenantAccessToken(fetchImpl: typeof fetch = fetch) {
  const appId = trimEnv(process.env.FEISHU_APP_ID);
  const appSecret = trimEnv(process.env.FEISHU_APP_SECRET);

  if (!appId || !appSecret) {
    throw new Error("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET。");
  }

  const response = await fetchImpl(
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

  const token =
    payload.data?.tenant_access_token ?? payload.tenant_access_token;
  if (!token) throw new Error("飞书没有返回 tenant_access_token。");
  return token;
}

async function getFeishu<T>(
  path: string,
  tenantAccessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(`${FEISHU_OPEN_API_BASE_URL}${path}`, {
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

async function postFeishu<T>(
  path: string,
  body: unknown,
  tenantAccessToken: string,
  fetchImpl: typeof fetch,
  operation = "飞书接口请求",
) {
  const response = await fetchImpl(`${FEISHU_OPEN_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as FeishuApiResponse<T>;
  if (!response.ok || payload.code !== 0) {
    const code = typeof payload.code === "number" ? payload.code : null;
    const requestId =
      response.headers.get("x-request-id") ?? payload.error?.log_id ?? null;
    const details = [
      code !== null ? `code=${code}` : null,
      requestId ? `request_id=${requestId}` : null,
    ].filter((value): value is string => Boolean(value));
    throw new Error(
      `${operation}失败：${payload.msg ?? `HTTP ${response.status}`}${
        details.length > 0 ? `（${details.join("，")}）` : ""
      }`,
    );
  }

  return (payload.data ?? payload) as T;
}

function uniqueNonEmptyStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()))).filter(
    Boolean,
  );
}

function markdownTableCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;

  const escapedPipe = "\u0000";
  return trimmed
    .slice(1, -1)
    .replaceAll("\\|", escapedPipe)
    .split("|")
    .map((cell) => cell.replaceAll(escapedPipe, "|").trim());
}

function isMarkdownTableSeparator(cells: string[] | null) {
  return Boolean(
    cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell)),
  );
}

function convertMarkdownTables(markdown: string) {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let tablesConverted = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const headers = markdownTableCells(lines[index] ?? "");
    const separator = markdownTableCells(lines[index + 1] ?? "");
    if (
      !headers ||
      !isMarkdownTableSeparator(separator) ||
      separator?.length !== headers.length
    ) {
      output.push(lines[index] ?? "");
      continue;
    }

    const rows: string[][] = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length) {
      const row = markdownTableCells(lines[rowIndex] ?? "");
      if (row?.length !== headers.length) break;
      rows.push(row);
      rowIndex += 1;
    }

    for (const row of rows) {
      const fields = row
        .map((value, cellIndex) =>
          value
            ? `${headers[cellIndex] ?? `字段 ${cellIndex + 1}`}：${value}`
            : "",
        )
        .filter(Boolean);
      if (fields.length > 0) output.push(`- ${fields.join("；")}`);
    }
    tablesConverted += 1;
    index = rowIndex - 1;
  }

  return {
    markdown: output
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    tablesConverted,
  };
}

export function prepareFeishuReportMarkdown(
  input: string,
  maxLength = MAX_REPORT_MARKDOWN_LENGTH,
) {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  const converted = convertMarkdownTables(normalized);
  if (converted.markdown.length <= maxLength) {
    return { ...converted, truncated: false };
  }

  const notice =
    "> 报告已按飞书文档写入上限精简；完整统计证据仍保留在原任务中。";
  const contentBudget = Math.max(0, maxLength - notice.length - 2);
  const candidate = converted.markdown.slice(0, contentBudget);
  const paragraphBoundary = candidate.lastIndexOf("\n\n");
  const lineBoundary = candidate.lastIndexOf("\n");
  const preferredBoundary =
    paragraphBoundary >= Math.floor(contentBudget * 0.65)
      ? paragraphBoundary
      : lineBoundary;
  const clipped = candidate
    .slice(0, preferredBoundary > 0 ? preferredBoundary : contentBudget)
    .trimEnd();

  return {
    markdown: `${clipped}\n\n${notice}`,
    tablesConverted: converted.tablesConverted,
    truncated: true,
  };
}

export async function createFeishuDocumentFromMarkdown(
  input: {
    markdown: string;
    title: string;
    viewerOpenIds?: string[];
  },
  options: { fetchImpl?: typeof fetch } = {},
): Promise<CreatedFeishuDocument> {
  const markdown = input.markdown.trim();
  if (!markdown) throw new Error("Hermes 没有返回可写入飞书文档的周报正文。");
  const preparedMarkdown = prepareFeishuReportMarkdown(markdown);

  const title = input.title.trim().slice(0, 160) || "团队工作周报";
  const fetchImpl = options.fetchImpl ?? fetch;
  const tenantAccessToken = await getTenantAccessToken(fetchImpl);
  const folderToken = trimEnv(
    process.env.COLA_HERMES_FEISHU_REPORT_FOLDER_TOKEN,
  );
  const created = await postFeishu<CreateDocumentData>(
    "/docx/v1/documents",
    {
      title,
      ...(folderToken ? { folder_token: folderToken } : {}),
    },
    tenantAccessToken,
    fetchImpl,
    "创建飞书周报文档",
  );
  const documentId = created.document?.document_id?.trim();
  if (!documentId)
    throw new Error("飞书创建文档成功，但没有返回 document_id。");

  const converted = await postFeishu<ConvertDocumentData>(
    "/docx/v1/documents/blocks/convert",
    {
      content_type: "markdown",
      content: preparedMarkdown.markdown,
    },
    tenantAccessToken,
    fetchImpl,
    "转换周报 Markdown",
  );
  const firstLevelBlockIds = converted.first_level_block_ids ?? [];
  const blocks = (converted.blocks ?? []).filter(
    (block) => typeof block.block_type === "number",
  );
  if (firstLevelBlockIds.length === 0 || blocks.length === 0) {
    throw new Error("飞书没有把周报 Markdown 转换为可写入的文档块。");
  }

  await postFeishu(
    `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/descendant?document_revision_id=-1`,
    {
      children_id: firstLevelBlockIds,
      descendants: blocks,
    },
    tenantAccessToken,
    fetchImpl,
    "写入飞书周报文档块",
  );

  const warnings: string[] = [];
  if (preparedMarkdown.tablesConverted > 0) {
    warnings.push(
      `为兼容飞书文档，已将 ${preparedMarkdown.tablesConverted} 个 Markdown 表格转换为列表。`,
    );
  }
  if (preparedMarkdown.truncated) {
    warnings.push(
      `周报正文超过 ${MAX_REPORT_MARKDOWN_LENGTH} 字符，已按完整 Markdown 边界精简后写入。`,
    );
  }
  const viewerOpenIds = uniqueNonEmptyStrings(input.viewerOpenIds ?? []);
  if (viewerOpenIds.length > 0) {
    try {
      await postFeishu(
        `/drive/v1/permissions/${encodeURIComponent(documentId)}/members/batch_create?type=docx&need_notification=false`,
        {
          members: viewerOpenIds.map((openId) => ({
            member_type: "openid",
            member_id: openId,
            perm: "view",
          })),
        },
        tenantAccessToken,
        fetchImpl,
        "添加飞书文档查看权限",
      );
    } catch (error) {
      warnings.push(
        `文档已生成，但通知人权限添加失败：${compactErrorMessage(
          error instanceof Error ? error.message : "未知错误",
        )}`,
      );
    }
  }

  return {
    documentId,
    title: created.document?.title?.trim() ?? title,
    url: `https://feishu.cn/docx/${encodeURIComponent(documentId)}`,
    warnings,
  };
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

async function readRawContent(token: string, tenantAccessToken: string) {
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
