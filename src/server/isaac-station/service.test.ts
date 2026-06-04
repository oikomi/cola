import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIsaacStationStreamingUrl,
  ISAAC_STATION_WEBRTC_PORT,
} from "./streaming-url.ts";

void test("Isaac Station uses the documented WebRTC browser client port", () => {
  assert.equal(ISAAC_STATION_WEBRTC_PORT, 8211);
});

void test("buildIsaacStationStreamingUrl targets the GPU node endpoint", () => {
  assert.equal(
    buildIsaacStationStreamingUrl({ nodeIp: "172.16.60.162" }),
    "http://172.16.60.162:8211/streaming/webrtc-client?server=172.16.60.162",
  );
});

void test("buildIsaacStationStreamingUrl returns null before scheduling", () => {
  assert.equal(buildIsaacStationStreamingUrl({ nodeIp: null }), null);
});
