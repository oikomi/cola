import {
  KubernetesObjectApi,
  PatchStrategy,
  type CoreV1Api,
  type KubeConfig,
  type KubernetesObject,
  type V1DeleteOptions,
} from "@kubernetes/client-node";

export type KubernetesResourceRef = {
  apiVersion: string;
  kind: string;
  namespace: string;
  name: string;
};

export type KubernetesForceDeleteApi = Pick<
  KubernetesObjectApi,
  "delete" | "patch" | "read"
>;

type ForceDeleteOptions = {
  confirmAttempts?: number;
  confirmIntervalMs?: number;
};

const DEFAULT_CONFIRM_ATTEMPTS = 24;
const DEFAULT_CONFIRM_INTERVAL_MS = 75;

const immediateDeleteOptions = {
  apiVersion: "v1",
  kind: "DeleteOptions",
  gracePeriodSeconds: 0,
  propagationPolicy: "Background",
} satisfies V1DeleteOptions;

function errorStatus(error: unknown) {
  const candidate = error as {
    statusCode?: number;
    code?: number;
    body?: { code?: number };
    response?: { status?: number; statusCode?: number };
  };

  return (
    candidate.statusCode ??
    candidate.code ??
    candidate.body?.code ??
    candidate.response?.statusCode ??
    candidate.response?.status ??
    null
  );
}

function isNotFoundError(error: unknown) {
  return errorStatus(error) === 404;
}

function resourceObject(ref: KubernetesResourceRef): KubernetesObject & {
  metadata: { name: string; namespace: string };
} {
  return {
    apiVersion: ref.apiVersion,
    kind: ref.kind,
    metadata: {
      name: ref.name,
      namespace: ref.namespace,
    },
  };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function requestImmediateDeletion(
  api: KubernetesForceDeleteApi,
  ref: KubernetesResourceRef,
) {
  try {
    await api.delete(
      resourceObject(ref),
      undefined,
      undefined,
      0,
      undefined,
      "Background",
      immediateDeleteOptions,
    );
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function readResource(
  api: KubernetesForceDeleteApi,
  ref: KubernetesResourceRef,
) {
  try {
    return await api.read<KubernetesObject>(resourceObject(ref));
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function clearFinalizers(
  api: KubernetesForceDeleteApi,
  ref: KubernetesResourceRef,
) {
  await api.patch(
    {
      ...resourceObject(ref),
      metadata: {
        name: ref.name,
        namespace: ref.namespace,
        finalizers: [],
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    PatchStrategy.MergePatch,
  );
}

export function createKubernetesForceDeleteApi(kubeConfig: KubeConfig) {
  return KubernetesObjectApi.makeApiClient(kubeConfig);
}

export async function forceDeleteKubernetesResource(
  api: KubernetesForceDeleteApi,
  ref: KubernetesResourceRef,
  options: ForceDeleteOptions = {},
) {
  const existed = await requestImmediateDeletion(api, ref);
  if (!existed) {
    return { existed: false, finalizersCleared: false };
  }

  const attempts = Math.max(
    1,
    options.confirmAttempts ?? DEFAULT_CONFIRM_ATTEMPTS,
  );
  const intervalMs = Math.max(
    0,
    options.confirmIntervalMs ?? DEFAULT_CONFIRM_INTERVAL_MS,
  );
  let finalizersCleared = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const resource = await readResource(api, ref);
    if (!resource) return { existed: true, finalizersCleared };

    if ((resource.metadata?.finalizers?.length ?? 0) > 0) {
      await clearFinalizers(api, ref);
      finalizersCleared = true;
      await requestImmediateDeletion(api, ref);
    } else if (!resource.metadata?.deletionTimestamp) {
      await requestImmediateDeletion(api, ref);
    }

    if (intervalMs > 0) await wait(intervalMs);
  }

  if (!(await readResource(api, ref))) {
    return { existed: true, finalizersCleared };
  }

  throw new Error(
    `${ref.kind} ${ref.namespace}/${ref.name} 强制删除后仍然存在，请检查控制器是否正在重建该资源。`,
  );
}

export async function forceDeleteNamespacedPods(options: {
  coreApi: Pick<CoreV1Api, "listNamespacedPod">;
  deleteApi: KubernetesForceDeleteApi;
  namespace: string;
  labelSelectors: string[];
}) {
  const podNames = new Set<string>();
  const labelSelectors = [
    ...new Set(
      options.labelSelectors.map((selector) => selector.trim()).filter(Boolean),
    ),
  ];

  for (const labelSelector of labelSelectors) {
    try {
      const pods = await options.coreApi.listNamespacedPod({
        namespace: options.namespace,
        labelSelector,
      });
      for (const pod of pods.items ?? []) {
        const name = pod.metadata?.name;
        if (name) podNames.add(name);
      }
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }

  await Promise.all(
    [...podNames].map((name) =>
      forceDeleteKubernetesResource(options.deleteApi, {
        apiVersion: "v1",
        kind: "Pod",
        namespace: options.namespace,
        name,
      }),
    ),
  );

  return [...podNames];
}
