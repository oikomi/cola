import assert from "node:assert/strict";
import test from "node:test";

import { ISAAC_STATION_WEBRTC_PORT } from "./streaming-url.ts";

void test("Isaac Station uses the Isaac Sim streaming browser client port", () => {
  assert.equal(ISAAC_STATION_WEBRTC_PORT, 8011);
});
