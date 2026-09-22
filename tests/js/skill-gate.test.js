"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");

const {
  VERDICTS,
  compareGateRuns,
  exactBinomialP,
  requiredDiscordantForSignificance,
} = require("../../scripts/lib/skill-gate");

function outcomes(passing) {
  return passing.map((passed, index) => ({ task_id: `t${index + 1}`, passed }));
}

describe("skill evolution gate", () => {
  it("accepts a candidate that improves on enough held-out tasks", () => {
    const baseline = outcomes([true, false, false, false, false, false, false, false, false, false]);
    const candidate = outcomes([true, true, true, true, true, true, true, false, false, false]);

    const report = compareGateRuns(baseline, candidate);

    assert.equal(report.verdict, VERDICTS.ACCEPTED);
    assert.equal(report.accepted, true);
    assert.equal(report.baseline_score, 0.1);
    assert.equal(report.candidate_score, 0.7);
    assert.equal(report.delta, 0.6);
    assert.deepEqual(report.discordant_pairs, { baseline_pass_candidate_fail: 0, candidate_pass_baseline_fail: 6 });
    assert.equal(report.paired_exact_binomial_p, 0.03125);
    assert.equal(report.resolution.enough, true);
    assert.equal(report.resolution.required_discordant_pairs, 6);
  });

  it("refuses to accept a single flipped task and says the run lacked resolution", () => {
    const baseline = outcomes([true, false, false]);
    const candidate = outcomes([true, true, false]);

    const report = compareGateRuns(baseline, candidate);

    assert.equal(report.accepted, false);
    assert.equal(report.verdict, VERDICTS.UNDER_POWERED);
    assert.equal(report.delta, 1 / 3);
    assert.equal(report.resolution.discordant_pairs, 1);
    assert.equal(report.resolution.required_discordant_pairs, 6);
    assert.equal(report.resolution.enough, false);
    assert.equal(report.resolution.minimum_detectable_effect, 2);
    assert.equal(report.paired_exact_binomial_p, 1);
  });

  it("reports a null result that the task set could not have resolved anyway", () => {
    // Four tasks, identical outcomes: nothing to resolve, but the MDE shows why the null is weak.
    const report = compareGateRuns(outcomes([true, false, true, false]), outcomes([true, false, true, false]));

    assert.equal(report.verdict, VERDICTS.NEUTRAL);
    assert.equal(report.delta, 0);
    assert.equal(report.resolution.minimum_detectable_effect, 1.5);
  });

  it("rejects harm and critical-task regressions before looking at the average", () => {
    const harmful = compareGateRuns(outcomes([true, false]), outcomes([false, false]));
    assert.equal(harmful.accepted, false);
    assert.equal(harmful.verdict, VERDICTS.REGRESSION);
    assert.equal(harmful.tasks[0].outcome, "baseline");

    const baseline = outcomes([true, false, false, false, false, false, false, false, false, false]);
    const candidate = outcomes([false, true, true, true, true, true, true, false, false, false]);
    const critical = compareGateRuns(baseline, candidate, { criticalTasks: ["t1"] });

    assert.equal(critical.candidate_score > critical.baseline_score, true);
    assert.equal(critical.verdict, VERDICTS.CRITICAL);
    assert.equal(critical.accepted, false);
    assert.deepEqual(critical.critical_regressions, ["t1"]);
  });

  it("honours a minimum effect of interest on top of significance", () => {
    const baseline = outcomes([true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]);
    const candidate = outcomes([true, true, true, true, true, true, true, false, false, false, false, false, false, false, false, false, false, false, false, false]);

    const defaultFloor = compareGateRuns(baseline, candidate);
    const withEffect = compareGateRuns(baseline, candidate, { minEffect: 0.5 });

    assert.equal(defaultFloor.verdict, VERDICTS.ACCEPTED);
    assert.equal(defaultFloor.delta, 0.3);
    assert.equal(withEffect.verdict, VERDICTS.UNDER_POWERED);
    assert.equal(withEffect.resolution.minimum_effect_of_interest, 0.5);
  });

  it("allows a stricter alpha or an explicit extra discordance bar", () => {
    const baseline = outcomes([true, false, false, false, false, false, false, false, false, false]);
    const candidate = outcomes([true, true, true, true, true, true, true, false, false, false]);

    assert.equal(requiredDiscordantForSignificance(0.05), 6);
    assert.equal(requiredDiscordantForSignificance(0.01), 8);
    assert.equal(compareGateRuns(baseline, candidate, { alpha: 0.01 }).verdict, VERDICTS.UNDER_POWERED);
    assert.equal(compareGateRuns(baseline, candidate, { minDiscordant: 8 }).verdict, VERDICTS.UNDER_POWERED);
    assert.equal(compareGateRuns(baseline, candidate, { minDiscordant: 8 }).resolution.required_discordant_pairs, 8);
  });

  it("refuses incomparable task sets, duplicate task ids and a nonsense alpha", () => {
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
    assert.throws(() => compareGateRuns([{ task_id: "a", passed: true }], [{ task_id: "a", passed: true }], { alpha: 1.5 }), /alpha must be between/);
    assert.throws(() => compareGateRuns([{ task_id: "a", passed: true }], [{ task_id: "a", passed: true }], { minEffect: 2 }), /minEffect must be between/);
  });

  it("computes the exact two-sided binomial p-value without dependencies", () => {
    assert.equal(exactBinomialP(0, 0), 1);
    assert.equal(exactBinomialP(8, 0), 0.0078125);
    assert.equal(exactBinomialP(4, 4), 1);
  });

  it("writes gate history outside local generated artifacts, with the verdict and diagnostics", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-wiki-gate-"));
    const baseline = path.join(repo, "baseline.json");
    const candidate = path.join(repo, "candidate.json");
    const tasks = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    fs.writeFileSync(baseline, JSON.stringify(tasks.map((id) => ({ task_id: id, passed: false }))));
    fs.writeFileSync(candidate, JSON.stringify(tasks.map((id, index) => ({ task_id: id, passed: index < 7 }))));
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");

    const result = spawnSync(process.execPath, [cli, "gate", repo, baseline, candidate, "SKP-0001"], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /accepted=true verdict=accepted_strict_improvement/);
    assert.match(result.stdout, /discordant=7\/6/);
    const report = JSON.parse(fs.readFileSync(path.join(repo, "skill-impact/SKP-0001.json"), "utf8"));
    assert.equal(report.proposal_id, "SKP-0001");
    assert.equal(report.accepted, true);
    assert.equal(report.resolution.discordant_pairs, 7);
    assert.equal(report.tasks.length, 10);
    assert.equal(fs.existsSync(path.join(repo, "generated/skill-impact/SKP-0001.json")), false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("exits 3 and explains itself when a candidate is rejected for lack of resolution", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-wiki-gate-weak-"));
    const baseline = path.join(repo, "baseline.json");
    const candidate = path.join(repo, "candidate.json");
    fs.writeFileSync(baseline, JSON.stringify([{ task_id: "a", passed: false }]));
    fs.writeFileSync(candidate, JSON.stringify([{ task_id: "a", passed: true }]));
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");

    const result = spawnSync(process.execPath, [cli, "gate", repo, baseline, candidate, "SKP-0002"], { encoding: "utf8" });

    assert.equal(result.status, 3);
    assert.match(result.stdout, /accepted=false verdict=rejected_not_enough_resolution/);
    assert.match(result.stdout, /not enough resolution: 1 discordant pair\(s\) observed, 6 needed at alpha=0\.05/);
    assert.match(result.stdout, /cannot tell an improvement from noise below a delta of 6/);
    const report = JSON.parse(fs.readFileSync(path.join(repo, "skill-impact/SKP-0002.json"), "utf8"));
    assert.equal(report.accepted, false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("supports a critical task list from a file", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "team-wiki-gate-critical-"));
    const baseline = path.join(repo, "baseline.json");
    const candidate = path.join(repo, "candidate.json");
    const critical = path.join(repo, "critical.txt");
    fs.writeFileSync(baseline, JSON.stringify([{ task_id: "regression-task", passed: true }, { task_id: "b", passed: false }]));
    fs.writeFileSync(candidate, JSON.stringify([{ task_id: "regression-task", passed: false }, { task_id: "b", passed: true }]));
    fs.writeFileSync(critical, "regression-task\n");
    const cli = path.join(__dirname, "../../scripts/team-wiki.js");

    const result = spawnSync(process.execPath, [cli, "gate", repo, baseline, candidate, "SKP-0003", "--critical", critical], { encoding: "utf8" });

    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stdout, /verdict=rejected_critical_regression/);
    assert.match(result.stdout, /critical regressions: regression-task/);
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
