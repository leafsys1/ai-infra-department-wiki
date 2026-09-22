"""All evidence in these tests is synthetic and temporary."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

CLI = Path(__file__).resolve().parents[2] / "skills/inference-delivery-qa/scripts/qa.py"


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="synthetic-qa-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "evidence"
        self.root.mkdir()
        self.manifest = self.base / "manifest.json"
        self.out = self.base / "report"

    def cli(self, *args):
        return subprocess.run([sys.executable, str(CLI), *map(str, args)],
                              capture_output=True, text=True)

    def valid_manifest(self):
        (self.root / "synthetic.txt").write_text("SYNTHETIC evidence, not a benchmark")
        return {"schema_version": 1, "project": "SYNTHETIC ONLY",
                "claims": [{"id": "C1", "text": "synthetic claim", "evidence": ["E1"]}],
                "evidence": [{"id": "E1", "path": "synthetic.txt"}],
                "gates": [{"id": "G" + str(i), "status": "PASS",
                           "reason": "synthetic self-report", "evidence": ["E1"]}
                          for i in range(9)]}

    def audit(self, data):
        self.manifest.write_text(json.dumps(data), encoding="utf-8")
        proc = self.cli("audit", "--root", self.root, "--input", self.manifest,
                        "--out", self.out)
        self.assertTrue((self.out / "result.json").exists(), proc.stderr)
        return proc, json.loads((self.out / "result.json").read_text())

    def test_success_is_not_approval(self):
        data = self.valid_manifest()
        data.update(customer_approved=True, authenticity=True)
        proc, result = self.audit(data)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(result["release"], "PENDING_INDEPENDENT_REVIEW")
        self.assertEqual(result["authenticity"], "NOT_ESTABLISHED")
        self.assertEqual(result["mechanical_status"], "PASS")
        self.assertEqual(result["data_consistency"], "NOT_EVALUATED")
        self.assertEqual(result["submitted_gates"], data["gates"])
        self.assertEqual(result["findings"], [])
        self.assertEqual({p.name for p in self.out.iterdir()}, {
            "report.md", "result.json", "evidence-index.json", "findings.csv",
            "checksums.sha256"})
        index = json.loads((self.out / "evidence-index.json").read_text())
        self.assertEqual(index[0]["sha256"], hashlib.sha256(
            (self.root / "synthetic.txt").read_bytes()).hexdigest())
        for line in (self.out / "checksums.sha256").read_text().splitlines():
            digest, name = line.split("  ", 1)
            self.assertEqual(digest, hashlib.sha256((self.out / name).read_bytes()).hexdigest())
        report = (self.out / "report.md").read_text()
        self.assertIn("自报", report)
        self.assertIn("不代表", report)

    def test_unsafe_or_unusable_evidence_is_reported(self):
        cases = [("absent.txt", "MISSING_FILE"), ("empty.txt", "EMPTY_FILE"),
                 ("../outside.txt", "PATH_ESCAPE"), ("escape.txt", "PATH_ESCAPE"),
                 (".env", "SENSITIVE_PATH"), ("credentials.json", "SENSITIVE_PATH"),
                 ("keys/private.pem", "SENSITIVE_PATH"),
                 ("alias.txt", "SENSITIVE_PATH"), ("synthetic.txt", "HASH_MISMATCH")]
        (self.base / "outside.txt").write_text("SYNTHETIC OUTSIDE")
        (self.root / "empty.txt").touch()
        (self.root / ".env").write_text("SYNTHETIC SECRET MUST NOT BE READ")
        (self.root / "escape.txt").symlink_to(self.base / "outside.txt")
        (self.root / "alias.txt").symlink_to(self.root / ".env")
        for i, (path, code) in enumerate(cases):
            with self.subTest(path=path):
                self.out = self.base / ("case-" + str(i))
                data = self.valid_manifest()
                data["evidence"][0].update(path=path, sha256="0" * 64)
                proc, result = self.audit(data)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertEqual(result["release"], "HOLD")
                self.assertIn(code, {f["code"] for f in result["findings"]})
                self.assertIn("PASS_WITHOUT_EVIDENCE", {f["code"] for f in result["findings"]})
                entry = json.loads((self.out / "evidence-index.json").read_text())[0]
                if code in {"SENSITIVE_PATH", "PATH_ESCAPE"}:
                    self.assertIsNone(entry["sha256"])
                self.assertNotIn("SYNTHETIC SECRET", (self.out / "report.md").read_text())

    def test_manifest_validation_never_silently_passes(self):
        cases = [({}, "MALFORMED_INPUT"), ([], "MALFORMED_INPUT")]
        for field, value, code in [
            ("schema_version", True, "MALFORMED_INPUT"), ("project", "", "MALFORMED_INPUT"),
            ("claims", [], "MISSING_CLAIMS"), ("gates", [], "MISSING_GATE"),
            ("evidence", [None], "MALFORMED_INPUT"),
            ("claims", [{"id": "C1", "text": "x", "evidence": ["unknown"]}], "UNKNOWN_EVIDENCE"),
            ("claims", [{"id": "C1", "text": "x", "evidence": []}], "CLAIM_UNVERIFIED"),
            ("gates", [{"id": "G0", "status": "NA", "reason": "", "evidence": []}], "NA_WITHOUT_REASON"),
            ("gates", [{"id": "G0", "status": "BLOCKED", "reason": "x", "evidence": []}], "GATE_UNVERIFIED"),
            ("gates", [{"id": "G0", "status": "FAIL", "reason": "x", "evidence": []}], "GATE_FAIL"),
            ("evidence", [{"id": "E1", "path": "synthetic.txt", "sha256": 3}], "MALFORMED_INPUT"),
        ]:
            data = self.valid_manifest()
            data[field] = value
            cases.append((data, code))
        for field in ("evidence", "claims", "gates"):
            data = self.valid_manifest()
            data[field].append(data[field][0].copy())
            cases.append((data, "DUPLICATE_ID"))
        for i, (data, code) in enumerate(cases):
            with self.subTest(case=i, code=code):
                self.out = self.base / ("invalid-" + str(i))
                proc, result = self.audit(data)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertEqual(result["release"], "HOLD")
                self.assertIn(code, {f["code"] for f in result["findings"]})

    def test_unparseable_or_missing_manifest_still_writes_reports(self):
        for i, text in enumerate(("{", '{"schema_version":NaN}', '{"schema_version":1,"schema_version":1}', None)):
            self.out = self.base / ("parse-" + str(i))
            if text is None:
                self.manifest.unlink()
            else:
                self.manifest.write_text(text)
            proc = self.cli("audit", "--root", self.root, "--input", self.manifest,
                            "--out", self.out)
            self.assertEqual(proc.returncode, 2, proc.stderr)
            self.assertEqual(len(list(self.out.iterdir())), 5)
            result = json.loads((self.out / "result.json").read_text())
            self.assertEqual(result["release"], "HOLD")

    def dataset_manifest(self, rows=None):
        data = self.valid_manifest()
        data["evidence"].append({"id": "CSV", "path": "synthetic.csv"})
        rows = rows if rows is not None else [
            ["r1", "ok", 10, 30, 3, 10], ["r2", "ok", 20, 60, 3, 20],
            ["r3", "error", 0, 0, 0, 0]]
        with (self.root / "synthetic.csv").open("w", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["rid", "state", "first", "total", "tokens", "per"])
            writer.writerows(rows)
        data["datasets"] = [{"id": "D1", "evidence_id": "CSV", "expected_rows": len(rows),
            "sentinel_values": [], "columns": dict(zip(
                ["request_id", "status", "ttft_ms", "e2e_ms", "output_tokens", "tpot_ms"],
                ["rid", "state", "first", "total", "tokens", "per"])),
            "success_values": ["ok"], "tpot_denominator": "output_tokens_minus_one",
            "tolerance_ms": 0.001}]
        return data

    def test_csv_counts_failures_and_statistics_explicitly(self):
        proc, result = self.audit(self.dataset_manifest())
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(result["data_consistency"], "PASS")
        dataset = result["datasets"][0]
        self.assertEqual((dataset["total_rows"], dataset["success_count"],
                          dataset["failure_count"], dataset["valid_success_count"]), (3, 2, 1, 2))
        self.assertEqual(len(dataset["rows"]), 3)
        self.assertFalse(dataset["rows"][2]["success"])
        self.assertEqual(dataset["statistics"]["ttft_ms"],
                         {"count": 2, "mean": 15.0, "p50": 15.0, "p95": 19.5, "p99": 19.9})
        self.assertIn("linear", dataset["statistics_method"])
        self.assertIn("成功", (self.out / "report.md").read_text())
        self.assertIn("失败", (self.out / "report.md").read_text())

    def test_csv_invalid_rows_are_retained_and_excluded(self):
        bad = [
            (["bad", "ok", "NaN", 30, 3, 10], "INVALID_METRIC"),
            (["bad", "ok", "Inf", 30, 3, 10], "INVALID_METRIC"),
            (["bad", "ok", -1, 30, 3, 10], "INVALID_METRIC"),
            (["bad", "ok", 10, 30, "3.5", 10], "INVALID_METRIC"),
            (["bad", "ok", 30, 10, 3, 10], "E2E_BEFORE_TTFT"),
            (["bad", "ok", 10, 30, 3, 2], "TPOT_MISMATCH"),
            (["bad", "ok", 10, 30, 1, 0], "TPOT_UNDEFINED"),
            (["r1", "ok", 10, 30, 3, 10], "DUPLICATE_REQUEST_ID"),
            (["bad", "error", "NaN", "", "", ""], "INVALID_METRIC"),
        ]
        for i, (row, code) in enumerate(bad):
            with self.subTest(code=code, row=row):
                self.out = self.base / ("row-" + str(i))
                data = self.dataset_manifest([["r1", "ok", 10, 30, 3, 10], row])
                proc, result = self.audit(data)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertEqual(result["data_consistency"], "FINDINGS")
                self.assertIn(code, {f["code"] for f in result["findings"]})
                ds = result["datasets"][0]
                self.assertEqual(ds["total_rows"], 2)
                self.assertFalse(ds["rows"][1]["valid"])
                self.assertLess(ds["valid_success_count"], 2)

    def test_dataset_contract_count_sentinels_and_missing_evidence(self):
        cases = [("expected_rows", 4, "EXPECTED_ROWS_MISMATCH"),
                 ("sentinel_values", [10], "SENTINEL_VALUE"),
                 ("evidence_id", "absent", "UNKNOWN_EVIDENCE"),
                 ("columns", {}, "MALFORMED_INPUT"),
                 ("success_values", [], "MALFORMED_INPUT"),
                 ("tpot_denominator", "guessed", "MALFORMED_INPUT"),
                 ("tolerance_ms", -1, "MALFORMED_INPUT"),
                 ("expected_rows", True, "MALFORMED_INPUT")]
        for i, (field, value, code) in enumerate(cases):
            with self.subTest(field=field):
                self.out = self.base / ("ds-" + str(i))
                data = self.dataset_manifest()
                data["datasets"][0][field] = value
                proc, result = self.audit(data)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertEqual(result["data_consistency"], "FINDINGS")
                self.assertIn(code, {f["code"] for f in result["findings"]})
        self.out = self.base / "omitted-failure"
        data = self.dataset_manifest([["r1", "ok", 10, 30, 3, 10]])
        data["datasets"][0]["expected_rows"] = 2
        proc, result = self.audit(data)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("EXPECTED_ROWS_MISMATCH", {f["code"] for f in result["findings"]})
        self.out = self.base / "missing-csv"
        data = self.dataset_manifest()
        (self.root / "synthetic.csv").unlink()
        proc, result = self.audit(data)
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(result["data_consistency"], "FINDINGS")

    def test_single_token_tpot_is_not_applicable(self):
        data = self.dataset_manifest([["r1", "ok", 10, 10, 1, ""]])
        proc, result = self.audit(data)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        ds = result["datasets"][0]
        self.assertEqual(ds["valid_success_count"], 1)
        self.assertEqual(ds["statistics"]["ttft_ms"]["count"], 1)
        self.assertEqual(ds["statistics"]["tpot_ms"]["count"], 0)
        self.assertEqual(ds["rows"][0]["tpot_status"], "NA")
        self.out = self.base / "denominator-n"
        data = self.dataset_manifest([["r1", "ok", 10, 30, 2, 10]])
        data["datasets"][0]["tpot_denominator"] = "output_tokens"
        proc, result = self.audit(data)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_reports_are_safe_and_cross_referenced(self):
        data = self.valid_manifest()
        data["gates"][0]["untrusted_extra"] = "DO-NOT-LEAK-SYNTHETIC-SECRET"
        data["gates"][0]["reason"] = ""
        data["claims"][0].update(id='=HYPERLINK("x")\n@SUM(1)', evidence=[])
        proc, result = self.audit(data)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("GATE_WITHOUT_REASON", {f["code"] for f in result["findings"]})
        index = json.loads((self.out / "evidence-index.json").read_text())
        self.assertEqual(result["evidence"], index)
        self.assertNotIn("untrusted_extra", result["submitted_gates"][0])
        self.assertNotIn("DO-NOT-LEAK-SYNTHETIC-SECRET", (self.out / "result.json").read_text())
        self.assertEqual(result["manifest_sha256"], hashlib.sha256(self.manifest.read_bytes()).hexdigest())
        with (self.out / "findings.csv").open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(len(rows), len(result["findings"]))
        for row in rows:
            for value in row.values():
                self.assertNotIn("\n", value)
                self.assertNotIn("\r", value)
                self.assertNotIn("\t", value)
                self.assertFalse(value.lstrip().startswith(("=", "+", "-", "@")))
        report = (self.out / "report.md").read_text()
        self.assertIn("授权且独立于作者的人员审核", report)
        self.assertNotIn('=HYPERLINK("x")', report)
        for line in (self.out / "checksums.sha256").read_text().splitlines():
            digest, name = line.split("  ", 1)
            self.assertEqual(digest, hashlib.sha256((self.out / name).read_bytes()).hexdigest())

    def test_malformed_csv_still_emits_complete_reports(self):
        for i, text in enumerate((
            "wrong,header\na,b\n",
            "rid,state,first,total,tokens,per\nr1,ok,10\n",
            "rid,state,first,total,tokens,per\nr1,ok,10,30,3,10,extra\n",
            "rid,state,first,total,tokens,per,per\nr1,ok,10,30,3,10,10\n",
            'rid,state,first,total,tokens,per\n"unterminated',
            "rid,state,first,total,tokens,per\n,ok,10,30,3,10\n",
        )):
            with self.subTest(case=i):
                self.out = self.base / ("csv-malformed-" + str(i))
                data = self.dataset_manifest()
                (self.root / "synthetic.csv").write_text(text)
                proc, result = self.audit(data)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertEqual(result["data_consistency"], "FINDINGS")
                self.assertEqual(len(list(self.out.iterdir())), 5)

    def test_failed_requests_allow_absent_metrics_and_optional_sentinels(self):
        data = self.dataset_manifest([["r1", "error", "", "", "", ""]])
        del data["datasets"][0]["sentinel_values"]
        proc, result = self.audit(data)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        ds = result["datasets"][0]
        self.assertEqual(ds["failure_count"], 1)
        self.assertEqual(ds["valid_success_count"], 0)
        self.assertEqual(ds["statistics"]["ttft_ms"]["count"], 0)

    def test_tool_error_writes_hold_report_when_feasible(self):
        spec = importlib.util.spec_from_file_location("qa_under_test", CLI)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with mock.patch.object(module, "run_audit", side_effect=OSError("synthetic IO error")):
            with mock.patch("sys.stderr"):
                rc = module.main(["audit", "--root", str(self.root), "--input", str(self.manifest),
                                  "--out", str(self.out)])
        self.assertEqual(rc, 1)
        result = json.loads((self.out / "result.json").read_text())
        self.assertEqual(result["release"], "HOLD")
        self.assertEqual(result["mechanical_status"], "TOOL_ERROR")
        self.assertEqual(len(list(self.out.iterdir())), 5)

    def test_output_protection(self):
        self.out.mkdir()
        marker = self.out / "keep"
        marker.write_text("synthetic existing content")
        proc = self.cli("init", "--out", self.out)
        self.assertEqual(proc.returncode, 1)
        self.assertEqual(list(self.out.iterdir()), [marker])
        for out in (self.root, self.root / "nested", self.base):
            proc = self.cli("audit", "--root", self.root, "--input", self.manifest,
                            "--out", out)
            self.assertEqual(proc.returncode, 1, proc.stderr)
        self.assertFalse((self.root / "nested").exists())

    def test_init_is_blank(self):
        proc = self.cli("init", "--out", self.out)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads((self.out / "audit-input.json").read_text())
        self.assertEqual(data, {"schema_version": 1, "project": "", "claims": [],
                                "evidence": [], "gates": [], "datasets": []})


if __name__ == "__main__":
    unittest.main()