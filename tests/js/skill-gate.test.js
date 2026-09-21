"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");

const { compareGateRuns, exactBinomialP } = require("../../scripts/lib/skill-gate");

describe("skill evolution gate", () => {
  it("accepts only a strictly better candidate on identical held-out tasks", () => {
    const baseline = [
      { task_id: "a", passed: true },
      { task_id: "b", passed: false },
      { task_id: "c", passed: false },
    ];
    const candidate = [
      { task_id: "a", passed: true },
      { task_id: "b", passed: true },
      { task_id: "c", passed: false },
    ];

    const report = compareGateRuns(baseline, candidate);

    assert.equal(report.accepted, true);
    assert.equal(report.baseline_score, 1 / 3);
    assert.equal(report.candidate_score, 2 / 3);
    assert.deepEqual(report.discordant_pairs, {
      baseline_pass_candidate_fail: 0,
      candidate_pass_baseline_fail: 1,
    });
  });

  it("rejects neutral and harmful candidates while retaining paired outcomes", () => {
    const baseline = [
      { task_id: "a", passed: true },
      { task_id: "b", passed: false },
    ];

    const neutral = compareGateRuns(baseline, [
      { task_id: "a", passed: true },
      { task_id: "b", passed: false },
    ]);
    const harmful = compareGateRuns(baseline, [
      { task_id: "a", passed: false },
      { task_id: "b", passed: false },
    ]);

    assert.equal(neutral.accepted, false);
    assert.equal(neutral.verdict, "rejected_no_strict_improvement");
    assert.equal(harmful.accepted, false);
    assert.equal(harmful.verdict, "rejected_regression");
    assert.equal(harmful.tasks[0].outcome, "baseline");
  });

  it("refuses incomparable task sets and duplicate task ids", () => {
    assert.throws(
      () => compareGateRuns([{ task_id: "a", passed: true }], [{ task_id: "b", passed: true }]),
      /identical held-out task ids/,
    );
    assert.throws(
      () => compareGateRuns(
        [{ task_id: "a", passed: true }, { task_id: "a", passed: false }],
        [{ task_id: "a", passed: true }],
      ),
      /duplicate task id/,
    );
  });

  it("computes the exact two-sided binomial p-value without dependencies", () => {
    assert.equal(exactBinomialP(0, 0), 1);
    assert.equal(exactBinomialP(8, 0), 0.0078125);
    assert.equal(exactBinomialP(4, 4), 1);
  });

  it("writes gate history outside local generated artifacts", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-wiki-gate-"));
    const baseline = path.join(repo, "baseline.json");
    const candidate = path.join(repo, "candidate.json");
    fs.writeFileSync(baseline, JSON.stringify([{ task_id: "a", passed: false }]));
    fs.writeFileSync(candidate, JSON.stringify([{ task_id: "a", passed: true }]));
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");

    const result = spawnSync(process.execPath, [cli, "gate", repo, baseline, candidate, "SKP-0001"], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(repo, "skill-impact/SKP-0001.json")), true);
    assert.equal(fs.existsSync(path.join(repo, "generated/skill-impact/SKP-0001.json")), false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("rejects proposal ids that can escape the impact directory", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-wiki-gate-path-"));
    const baseline = path.join(repo, "baseline.json");
    const candidate = path.join(repo, "candidate.json");
    fs.writeFileSync(baseline, JSON.stringify([{ task_id: "a", passed: false }]));
    fs.writeFileSync(candidate, JSON.stringify([{ task_id: "a", passed: true }]));
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");

    const result = spawnSync(process.execPath, [cli, "gate", repo, baseline, candidate, "SKP-../../outside"], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid proposal id/);
    assert.equal(fs.existsSync(path.join(repo, "outside.json")), false);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
