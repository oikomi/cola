import assert from "node:assert/strict";
import test from "node:test";

import type { V1Service } from "@kubernetes/client-node";

import { collectUsedNodePorts, resolveAvailableNodePort } from "./node-port.ts";

function serviceWithNodePort(nodePort: number): V1Service {
  return {
    spec: {
      ports: [
        {
          port: 8888,
          targetPort: 8888,
          nodePort,
        },
      ],
    },
  };
}

void test("NodePort allocation skips ports used by any service", () => {
  const services = [
    serviceWithNodePort(31480),
    serviceWithNodePort(31481),
    serviceWithNodePort(32080),
  ];

  assert.deepEqual(
    collectUsedNodePorts(services),
    new Set([31480, 31481, 32080]),
  );
  assert.equal(
    resolveAvailableNodePort({
      services,
      start: 31480,
      end: 31483,
      errorMessage: "no node port",
    }),
    31482,
  );
});

void test("NodePort allocation fails when the configured range is exhausted", () => {
  assert.throws(
    () =>
      resolveAvailableNodePort({
        services: [serviceWithNodePort(31480), serviceWithNodePort(31481)],
        start: 31480,
        end: 31481,
        errorMessage: "no node port",
      }),
    /no node port/,
  );
});
