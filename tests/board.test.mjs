import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const code = readFileSync(new URL("../extension/board.js", import.meta.url), "utf8");
const context = {};
vm.runInNewContext(code, context);
test("reads the visible board without any move history", () => {
  const placement = context.ChessCoachBoard.placementFromClasses([
    "piece wk square-51", "piece bk square-58",
    "piece wp square-52", "piece bp square-57"
  ]);
  assert.equal(placement, "4k3/4p3/8/8/8/8/4P3/4K3");
});
