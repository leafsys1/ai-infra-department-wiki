"use strict";

/**
 * Held-out Skill gate, aligned with the WikiSkill paper's `R_val > R_best` rule but with an honest
 * statement of the experiment's resolution.
 *
 * The paper's rule accepts any strict improvement. Applied literally to a small held-out set it
 * accepts a candidate on a single flipped task, and reports `p = 1` while doing so — the arithmetic
 * is right, the conclusion is not. A gate that cannot distinguish "better" from "noisy" must say
 * so, so this module reports the smallest effect the task set could have detected, how many
 * discordant pairs significance would have required, and refuses to accept below that floor
 * instead of calling it a win.
 *
 *   accepted: no critical regression AND strict improvement AND delta >= min_effect
 *             AND discordant >= max(min_discordant, required) AND p <= alpha
 */

const VERDICTS = Object.freeze({
  CRITICAL: "rejected_critical_regression",
  REGRESSION: "rejected_regression",
  NEUTRAL: "rejected_no_strict_improvement",
  UNDER_POWERED: "rejected_not_enough_resolution",
  ACCEPTED: "accepted_strict_improvement",
});

const DEFAULT_ALPHA = 0.05;

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

/**
 * Smallest number of one-sided discordant pairs whose exact two-sided sign test reaches `alpha`.
 * `p = 2 * 0.5^n` for an all-one-way split, so the answer is ceil(log2(2 / alpha)) — six pairs at
 * alpha = 0.05. This is the honest gate: below it, the run cannot support a conclusion.
 */
function requiredDiscordantForSignificance(alpha) {
  const target = 2 / alpha;
  return Math.ceil(Math.log2(target));
}

function normalizeOptions(options = {}) {
  const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : DEFAULT_ALPHA;
  if (!(alpha > 0) || alpha >= 1) throw new Error(`alpha must be between 0 and 1, got ${options.alpha}`);
  const minEffect = Number.isFinite(options.minEffect) ? Number(options.minEffect) : 0;
  if (minEffect < 0 || minEffect > 1) throw new Error(`minEffect must be between 0 and 1, got ${options.minEffect}`);
  return {
    alpha,
    minEffect,
    minDiscordant: Number.isInteger(options.minDiscordant) ? options.minDiscordant : null,
    criticalTasks: new Set(Array.isArray(options.criticalTasks) ? options.criticalTasks : []),
  };
}

function compareGateRuns(baselineOutcomes, candidateOutcomes, options = {}) {
  const settings = normalizeOptions(options);
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
  const criticalRegressions = [];
  for (const taskId of baselineIds) {
    const baselinePassed = baseline.get(taskId);
    const candidatePassed = candidate.get(taskId);
    if (baselinePassed) baselinePasses += 1;
    if (candidatePassed) candidatePasses += 1;
    let outcome = "tie";
    if (baselinePassed && !candidatePassed) {
      outcome = "baseline";
      baselineOnly += 1;
      if (settings.criticalTasks.has(taskId)) criticalRegressions.push(taskId);
    } else if (candidatePassed && !baselinePassed) {
      outcome = "candidate";
      candidateOnly += 1;
    }
    tasks.push({ task_id: taskId, baseline_passed: baselinePassed, candidate_passed: candidatePassed, outcome });
  }

  const taskCount = tasks.length;
  const baselineScore = baselinePasses / taskCount;
  const candidateScore = candidatePasses / taskCount;
  const delta = candidateScore - baselineScore;
  const discordant = baselineOnly + candidateOnly;
  const p = exactBinomialP(baselineOnly, candidateOnly);
  const statisticalFloor = requiredDiscordantForSignificance(settings.alpha);
  const requiredDiscordant = Math.max(settings.minDiscordant === null ? 0 : settings.minDiscordant, statisticalFloor);
  const resolutionEnough = discordant >= requiredDiscordant && p <= settings.alpha;

  let verdict;
  if (criticalRegressions.length > 0) verdict = VERDICTS.CRITICAL;
  else if (candidateScore < baselineScore) verdict = VERDICTS.REGRESSION;
  else if (candidateScore === baselineScore) verdict = VERDICTS.NEUTRAL;
  else if (delta < settings.minEffect || !resolutionEnough) verdict = VERDICTS.UNDER_POWERED;
  else verdict = VERDICTS.ACCEPTED;

  return {
    schema_version: 1,
    accepted: verdict === VERDICTS.ACCEPTED,
    verdict,
    baseline_score: baselineScore,
    candidate_score: candidateScore,
    delta,
    tasks_evaluated: taskCount,
    discordant_pairs: {
      baseline_pass_candidate_fail: baselineOnly,
      candidate_pass_baseline_fail: candidateOnly,
    },
    paired_exact_binomial_p: p,
    critical_regressions: criticalRegressions,
    resolution: {
      alpha: settings.alpha,
      discordant_pairs: discordant,
      required_discordant_pairs: requiredDiscordant,
      statistical_floor: statisticalFloor,
      enough: resolutionEnough,
      // Smallest score delta this task set could ever have shown to be significant, and the
      // smallest one it was asked to detect. Below either, a null result is uninformative.
      minimum_detectable_effect: Number((requiredDiscordant / taskCount).toFixed(6)),
      minimum_effect_of_interest: settings.minEffect,
    },
    options: { alpha: settings.alpha, min_effect: settings.minEffect, min_discordant: settings.minDiscordant, critical_tasks: [...settings.criticalTasks].sort() },
    tasks,
  };
}

module.exports = {
  DEFAULT_ALPHA,
  VERDICTS,
  compareGateRuns,
  exactBinomialP,
  requiredDiscordantForSignificance,
};
