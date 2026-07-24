import assert from "node:assert/strict";
import test from "node:test";

import { PatchStrategy, type KubernetesObject } from "@kubernetes/client-node";

import {
  forceDeleteKubernetesResource,
  forceDeleteNamespacedPods,
  type KubernetesForceDeleteApi,
  type KubernetesResourceRef,
} from "./force-delete.ts";

const deploymentRef = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  namespace: "tasks",
  name: "example",
} satisfies KubernetesResourceRef;

function notFound() {
  return Object.assign(new Error("not found"), { statusCode: 404 });
}

void test("force delete requests zero grace period with background propagation", async () => {
  const deleteCalls: unknown[][] = [];
  const api = {
    delete: async (...args: unknown[]) => {
      deleteCalls.push(args);
      throw notFound();
    },
  } as unknown as KubernetesForceDeleteApi;

  const result = await forceDeleteKubernetesResource(api, deploymentRef);

  assert.deepEqual(result, { existed: false, finalizersCleared: false });
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0]?.[3], 0);
  assert.equal(deleteCalls[0]?.[5], "Background");
  assert.deepEqual(deleteCalls[0]?.[6], {
    apiVersion: "v1",
    kind: "DeleteOptions",
    gracePeriodSeconds: 0,
    propagationPolicy: "Background",
  });
});

void test("force delete clears blocking finalizers and confirms removal", async () => {
  const patchCalls: unknown[][] = [];
  let readCount = 0;
  const api = {
    delete: async () => ({}) as never,
    read: async () => {
      readCount += 1;
      if (readCount > 1) throw notFound();
      return {
        ...deploymentRef,
        metadata: {
          name: deploymentRef.name,
          namespace: deploymentRef.namespace,
          finalizers: ["example.com/cleanup"],
        },
      } satisfies KubernetesObject;
    },
    patch: async (...args: unknown[]) => {
      patchCalls.push(args);
      return {} as never;
    },
  } as unknown as KubernetesForceDeleteApi;

  const result = await forceDeleteKubernetesResource(api, deploymentRef, {
    confirmAttempts: 2,
    confirmIntervalMs: 0,
  });

  assert.deepEqual(result, { existed: true, finalizersCleared: true });
  assert.equal(patchCalls.length, 1);
  assert.deepEqual(patchCalls[0]?.[0], {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "example",
      namespace: "tasks",
      finalizers: [],
    },
  });
  assert.equal(patchCalls[0]?.[5], PatchStrategy.MergePatch);
});

void test("force delete rejects when a controller keeps recreating the resource", async () => {
  const api = {
    delete: async () => ({}) as never,
    read: async () => ({
      ...deploymentRef,
      metadata: {
        name: deploymentRef.name,
        namespace: deploymentRef.namespace,
      },
    }),
  } as unknown as KubernetesForceDeleteApi;

  await assert.rejects(
    () =>
      forceDeleteKubernetesResource(api, deploymentRef, {
        confirmAttempts: 1,
        confirmIntervalMs: 0,
      }),
    /控制器是否正在重建该资源/,
  );
});

void test("pod force deletion deduplicates pods returned by multiple selectors", async () => {
  const deletedNames: string[] = [];
  const deleteApi = {
    delete: async (resource: KubernetesObject) => {
      const name = resource.metadata?.name;
      if (name) deletedNames.push(name);
      throw notFound();
    },
  } as unknown as KubernetesForceDeleteApi;
  const coreApi = {
    listNamespacedPod: async () => ({
      items: [{ metadata: { name: "pod-a" } }, { metadata: { name: "pod-b" } }],
    }),
  } as never;

  const names = await forceDeleteNamespacedPods({
    coreApi,
    deleteApi,
    namespace: "tasks",
    labelSelectors: ["job-name=example", "job-name=example", "app=example"],
  });

  assert.deepEqual(names, ["pod-a", "pod-b"]);
  assert.deepEqual(deletedNames.sort(), ["pod-a", "pod-b"]);
});
