import type { DockerRunnerEngine } from "@/server/office/catalog";

export function workspaceSegmentForEngine(
  engine: DockerRunnerEngine | null | undefined,
) {
  return engine === "hermes-agent" ? "hermes" : "openclaw";
}

export function agentWorkspaceHref(
  agentId: string,
  engine: DockerRunnerEngine | null | undefined,
) {
  return `/${workspaceSegmentForEngine(engine)}/${agentId}`;
}

type ResolveNativeWorkspaceHrefInput = {
  agentId: string;
  deviceId?: string | null;
  engine: DockerRunnerEngine | null | undefined;
  openclawTemplate?: string | null;
  hermesTemplate?: string | null;
  origin?: string;
};

type ResolveBrowserNativeWorkspaceHrefInput =
  ResolveNativeWorkspaceHrefInput & {
    nativeUrl?: string | null;
  };

type MergeNativeWorkspaceUrlInput = {
  nativeUrl: string;
  templateUrl: string;
};

function applyTemplate(
  template: string,
  replacements: Record<string, string>,
) {
  return Object.entries(replacements).reduce((resolved, [key, value]) => {
    return resolved.replaceAll(`{${key}}`, value);
  }, template);
}

export function resolveNativeWorkspaceHref({
  agentId,
  deviceId,
  engine,
  openclawTemplate,
  hermesTemplate,
  origin,
}: ResolveNativeWorkspaceHrefInput) {
  const template =
    engine === "hermes-agent" ? hermesTemplate : openclawTemplate;

  if (!template) return null;

  const replacements = {
    agentId,
    deviceId: deviceId ?? "",
    engine: engine ?? "openclaw",
  };
  const resolvedTemplate = applyTemplate(template, replacements);
  const url = new URL(resolvedTemplate, origin ?? "http://localhost");

  if (!template.includes("{agentId}")) {
    url.searchParams.set("agentId", agentId);
  }

  if (deviceId && !template.includes("{deviceId}")) {
    url.searchParams.set("deviceId", deviceId);
  }

  if (!template.includes("{engine}")) {
    url.searchParams.set("engine", engine ?? "openclaw");
  }

  return url.toString();
}

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function mergeNativeWorkspaceUrl({
  nativeUrl,
  templateUrl,
}: MergeNativeWorkspaceUrlInput) {
  const native = new URL(nativeUrl);
  const template = new URL(templateUrl);

  const nativeGatewayUrl = native.searchParams.get("gatewayUrl");
  const templateGatewayUrl = template.searchParams.get("gatewayUrl");

  if (!templateGatewayUrl && nativeGatewayUrl) {
    try {
      const gateway = new URL(nativeGatewayUrl);
      gateway.protocol = template.protocol === "https:" ? "wss:" : "ws:";
      gateway.hostname = template.hostname;
      gateway.port = template.port;
      template.searchParams.set("gatewayUrl", gateway.toString());
    } catch {
      template.searchParams.set("gatewayUrl", nativeGatewayUrl);
    }
  }

  if (native.hash) {
    template.hash = native.hash;
  }

  return template.toString();
}

export function resolveBrowserNativeWorkspaceHref({
  agentId,
  deviceId,
  engine,
  nativeUrl,
  openclawTemplate,
  hermesTemplate,
  origin,
}: ResolveBrowserNativeWorkspaceHrefInput) {
  const templateUrl = resolveNativeWorkspaceHref({
    agentId,
    deviceId,
    engine,
    openclawTemplate,
    hermesTemplate,
    origin,
  });

  if (templateUrl && nativeUrl) {
    return mergeNativeWorkspaceUrl({
      nativeUrl,
      templateUrl,
    });
  }

  if (templateUrl) return templateUrl;
  if (!nativeUrl) return null;

  const resolved = new URL(nativeUrl, origin ?? "http://localhost");

  if (!origin) {
    return resolved.toString();
  }

  const currentOrigin = new URL(origin);
  if (isLoopbackHost(resolved.hostname) && !isLoopbackHost(currentOrigin.hostname)) {
    resolved.hostname = currentOrigin.hostname;
  }

  const gatewayUrl = resolved.searchParams.get("gatewayUrl");
  if (gatewayUrl) {
    try {
      const wsUrl = new URL(gatewayUrl);
      if (isLoopbackHost(wsUrl.hostname) && !isLoopbackHost(currentOrigin.hostname)) {
        wsUrl.hostname = currentOrigin.hostname;
        resolved.searchParams.set("gatewayUrl", wsUrl.toString());
      }
    } catch {
      // Ignore malformed gatewayUrl values.
    }
  }

  return resolved.toString();
}
