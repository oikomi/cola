import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIsaacLabSshCommand,
  buildIsaacLabSshCommandForJob,
  resolveIsaacLabSshGatewayPublicHost,
  resolveIsaacLabSshGatewayPublicPort,
} from "./lab-ssh-gateway-config.ts";

void test("buildIsaacLabSshCommand uses a regular ssh command on port 22", () => {
  assert.equal(
    buildIsaacLabSshCommand({
      jobName: "train-a",
      host: "172.16.60.198",
      port: 22,
    }),
    "ssh train-a@172.16.60.198",
  );
});

void test("buildIsaacLabSshCommand includes port and brackets IPv6 hosts", () => {
  assert.equal(
    buildIsaacLabSshCommand({
      jobName: "train-a",
      host: "fd00::10",
      port: 32222,
    }),
    "ssh -p 32222 train-a@[fd00::10]",
  );
});

void test("Isaac Lab SSH public host prefers explicit env over base URL and controller IP", () => {
  assert.equal(
    resolveIsaacLabSshGatewayPublicHost({
      env: {
        COLA_ISAAC_LAB_SSH_PUBLIC_HOST: "ssh.isaac.example.com",
        AUTH_PUBLIC_BASE_URL: "https://cola.example.com",
      },
      controllerIp: "172.16.60.198",
    }),
    "ssh.isaac.example.com",
  );
});

void test("Isaac Lab SSH public host falls back to AUTH_PUBLIC_BASE_URL hostname", () => {
  assert.equal(
    resolveIsaacLabSshGatewayPublicHost({
      env: {
        AUTH_PUBLIC_BASE_URL: "http://172.16.60.198:50038",
      },
      controllerIp: "172.16.60.199",
    }),
    "172.16.60.198",
  );
});

void test("Isaac Lab SSH public port defaults to gateway port", () => {
  assert.equal(
    resolveIsaacLabSshGatewayPublicPort({
      COLA_ISAAC_LAB_SSH_GATEWAY_PORT: "32222",
    }),
    32222,
  );
});

void test("Isaac Lab SSH command is only shown after the Job has a running Pod", () => {
  assert.equal(
    buildIsaacLabSshCommandForJob({
      jobName: "train-a",
      status: "pending",
      podName: null,
      controllerIp: "172.16.60.198",
      env: {},
    }),
    null,
  );

  assert.equal(
    buildIsaacLabSshCommandForJob({
      jobName: "train-a",
      status: "running",
      podName: "isaac-lab-train-a-abcde",
      controllerIp: "172.16.60.198",
      env: {},
    }),
    "ssh -p 2222 train-a@172.16.60.198",
  );
});
