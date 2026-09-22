#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const sourceLayoutCli = path.resolve(__dirname, "../skills/ai-infra-department-wiki/scripts/team-wiki.js");
const installedLayoutCli = path.resolve(__dirname, "../../ai-infra-department-wiki/scripts/team-wiki.js");
const bundledCli = require("node:fs").existsSync(sourceLayoutCli) ? sourceLayoutCli : installedLayoutCli;
const result = spawnSync(process.execPath, [bundledCli, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`ERROR: ${result.error.message}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status == null ? 1 : result.status;
}
