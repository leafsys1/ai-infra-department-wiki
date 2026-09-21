"use strict";

function validateOutcomes(outcomes, label) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) throw new Error(`${label} outcomes must be a non-empty array`);
  const ids = new Set();
  const result = new Map();
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome.task_id !== "string" || !outcome.task_id) throw new Error(`${label} outcome missing task_id`);
    if (ids.has(outcome.task_id)) throw new Error(`${label} has duplicate task id: ${outcome.task_id}`);
    if (typeof outcome.passed !== "boolean") throw new Error(`${label} task ${outcome.task_id} passed must be boolean`);
    ids.add(outcome.task_id);
    result.set(outcome.task_id, outcome.passed);
  }
  return result;
}

function combination(n, k) {
  const choose = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= choose; index += 1) value = (value * (n - choose + index)) / index;
  return value;
}

function exactBinomialP(left, right) {
  const n = left + right;
  if (n === 0) return 1;
  const observed = Math.abs(left - right);
  let probability = 0;
  for (let k = 0; k <= n; k += 1) {
    if (Math.abs(2 * k - n) >= observed) probability += combination(n, k) * (0.5 ** n);
  }
  return Math.min(1, probability);
}

function compareGateRuns(baselineOutcomes, candidateOutcomes) {
  const baseline = validateOutcomes(baselineOutcomes, "baseline");
  const candidate = validateOutcomes(candidateOutcomes, "candidate");
  const baselineIds = [...baseline.keys()].sort();
  const candidateIds = [...candidate.keys()].sort();
  if (JSON.stringify(baselineIds) !== JSON.stringify(candidateIds)) {
    throw new Error("baseline and candidate must use identical held-out task ids");
  }

  let baselinePasses = 0;
  let candidatePasses = 0;
  let baselineOnly = 0;
  let candidateOnly = 0;
  const tasks = [];
  for (const taskId of baselineIds) {
    const baselinePassed = baseline.get(taskId);
    const candidatePassed = candidate.get(taskId);
    if (baselinePassed) baselinePasses += 1;
    if (candidatePassed) candidatePasses += 1;
    let outcome = "tie";
    if (baselinePassed && !candidatePassed) {
      outcome = "baseline";
      baselineOnly += 1;
    } else if (candidatePassed && !baselinePassed) {
      outcome = "candidate";
      candidateOnly += 1;
    }
    tasks.push({ task_id: taskId, baseline_passed: baselinePassed, candidate_passed: candidatePassed, outcome });
  }

  const baselineScore = baselinePasses / tasks.length;
  const candidateScore = candidatePasses / tasks.length;
  const accepted = candidateScore > baselineScore;
  const verdict = accepted
    ? "accepted_strict_improvement"
    : candidateScore < baselineScore
      ? "rejected_regression"
      : "rejected_no_strict_improvement";

  return {
    schema_version: 1,
    accepted,
    verdict,
    baseline_score: baselineScore,
    candidate_score: candidateScore,
    delta: candidateScore - baselineScore,
    discordant_pairs: {
      baseline_pass_candidate_fail: baselineOnly,
      candidate_pass_baseline_fail: candidateOnly,
    },
    paired_exact_binomial_p: exactBinomialP(baselineOnly, candidateOnly),
    tasks,
  };
}

module.exports = { compareGateRuns, exactBinomialP };
