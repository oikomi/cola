import assert from "node:assert/strict";
import test from "node:test";

import {
  parseEstablishedTcpConnections,
  parseKasmVncActiveConnections,
} from "./workspace-occupancy.ts";

void test("KasmVNC log parser tracks active accepted connections", () => {
  const parsed = parseKasmVncActiveConnections(`
2026-05-20 16:16:10 [PRIO] Connections: accepted: @172.20.184.64_1::websocket
2026-05-20 16:16:12 [PRIO] Connections: accepted: @172.20.184.64_2::websocket
2026-05-20 16:17:00 [PRIO] Connections: closed: @172.20.184.64_1::websocket (Clean disconnection)
`);

  assert.deepEqual(parsed.activeConnectionIds, ["@172.20.184.64_2::websocket"]);
  assert.equal(parsed.activeConnectionCount, 1);
});

void test("KasmVNC log parser treats closed accepted connection as idle", () => {
  const parsed = parseKasmVncActiveConnections(`
2026-05-20 16:16:10 [PRIO] Connections: accepted: @172.20.184.64_1::websocket
2026-05-20 16:17:00 [PRIO] Connections: closed: @172.20.184.64_1::websocket (Clean disconnection)
`);

  assert.deepEqual(parsed.activeConnectionIds, []);
  assert.equal(parsed.activeConnectionCount, 0);
});

void test("TCP parser returns established KasmVNC clients only", () => {
  const parsed = parseEstablishedTcpConnections(
    `
LISTEN    0      5            0.0.0.0:6080        0.0.0.0:*
TIME-WAIT 0      0      172.20.190.31:6080  172.20.184.64:55722
ESTAB     0      0      172.20.190.31:6080  172.20.184.64:26675
ESTAB     0      0      172.20.190.31:5901  172.20.184.64:26676
`,
    6080,
  );

  assert.deepEqual(parsed, [
    {
      state: "ESTAB",
      localAddress: "172.20.190.31:6080",
      peerAddress: "172.20.184.64:26675",
    },
  ]);
});
