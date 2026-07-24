import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCT_AREAS, productAreaForPath } from "./product-areas.ts";

void test("compute analytics is the default and first product area", () => {
  assert.deepEqual(PRODUCT_AREAS[0], {
    key: "compute",
    href: "/",
    title: "算力分析",
    description: "分析 GPU 分配、使用者归属与运行容器的实时负载。",
  });
  assert.equal(productAreaForPath("/"), "compute");
  assert.equal(productAreaForPath("/compute"), "compute");
});

void test("virtual Office keeps its own page and related routes", () => {
  const office = PRODUCT_AREAS.find((area) => area.key === "office");

  assert.equal(office?.href, "/office");
  assert.equal(productAreaForPath("/office"), "office");
  assert.equal(productAreaForPath("/control"), "office");
  assert.equal(productAreaForPath("/openclaw/agent-1"), "office");
  assert.equal(productAreaForPath("/hermes/agent-1"), "office");
});
