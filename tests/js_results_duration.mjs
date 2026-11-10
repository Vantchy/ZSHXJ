import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const match = source.match(/function formatCompletionDuration\(record\)\s*\{[\s\S]*?\n\}/);
assert.ok(match, "Production completion-duration formatter must exist");

const context = {};
vm.runInNewContext(`${match[0]}\nglobalThis.formatCompletionDuration = formatCompletionDuration;`, context);
const format = context.formatCompletionDuration;

assert.equal(format({completionDurationSeconds: 0}), "不足 1 秒");
assert.equal(format({completionDurationSeconds: 1}), "1 秒");
assert.equal(format({completionDurationSeconds: 65}), "1 分 5 秒");
assert.equal(format({completionDurationSeconds: 3661}), "1 小时 1 分 1 秒");
assert.equal(format({completionDurationSeconds: null}), "—");
assert.equal(format({completionDurationSeconds: -1}), "—");
assert.equal(format({}), "接口未提供");

const scoreView = source.split("async function showMyScores()", 2)[1].split("async function boot()", 1)[0];
assert.match(scoreView, /"完成用时"/);
assert.match(scoreView, /records\.map\(\(record\)\s*=>\s*\[/);
assert.match(scoreView, /formatCompletionDuration\(record\)/);
console.log("Score duration tests passed: actual formatter and score-table mapping.");
