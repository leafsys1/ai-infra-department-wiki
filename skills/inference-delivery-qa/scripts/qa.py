#!/usr/bin/env python3
"""Offline evidence consistency checks; never a project approval engine."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import sys

METRICS = ("ttft_ms", "e2e_ms", "output_tokens", "tpot_ms")
STATISTICS_METHOD = "successful valid rows only; arithmetic mean; linear interpolation h=(n-1)*p (type 7)"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2,
                               allow_nan=False) + "\n", encoding="utf-8")


def inside(path, parent):
    return path == parent or parent in path.parents


def prepare_output(out, root=None, manifest=None):
    target = out.resolve()
    if root is not None:
        source = root.resolve()
        if inside(target, source) or inside(source, target):
            raise ValueError("output overlaps evidence root")
    if manifest is not None and inside(manifest.resolve(), target):
        raise ValueError("output overlaps manifest")
    if out.is_symlink() or (out.exists() and
                            (not out.is_dir() or any(out.iterdir()))):
        raise ValueError("output must be a new or empty directory")
    out.mkdir(parents=True, exist_ok=True)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def csv_safe(value):
    value = str(value).replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def markdown_safe(value):
    value = str(value).replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
    value = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"([\\`*{}\[\]()#+.!|_-])", r"\\\1", value)


def emit(out, result, index):
    write_json(out / "result.json", result)
    write_json(out / "evidence-index.json", index)
    with (out / "findings.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["code", "location", "message"])
        writer.writeheader()
        writer.writerows({k: csv_safe(v) for k, v in f.items()} for f in result["findings"])
    lines = ["# 证据机械审计报告", "", "发布状态：" + result["release"],
             "真实性：NOT_ESTABLISHED。哈希仅证明本次文件自洽，不能证明来源真实。",
             "G0–G8 是提交方自报，不代表已核验技术正确性或客户验收。",
             "退出码 0 仅表示机械检查通过，不代表项目获批。需要授权且独立于作者的人员审核，智能体第二上下文不构成组织独立性。",
             "", "## 检查结果", "机械状态：" + result["mechanical_status"],
             "数据一致性：" + result["data_consistency"], "", "## 发现"]
    lines.extend("- {code}：{location} — {message}".format(
        **{key: markdown_safe(value) for key, value in f.items()})
                 for f in result["findings"])
    lines += ["", "## 数据统计", "失败请求保留并计数；失败本身不等于造假。",
              "统计仅使用成功且有效的行；算术均值；分位数采用线性插值 h=(n-1)*p（type 7）。"]
    for dataset in result["datasets"]:
        lines += ["", "### " + markdown_safe(dataset["id"]),
                  "总行数 {total_rows}；成功 {success_count}；失败 {failure_count}；有效成功 {valid_success_count}。".format(**dataset),
                  "", "| 指标 | 样本数 | mean | p50 | p95 | p99 |",
                  "|---|---:|---:|---:|---:|---:|"]
        for metric, values in dataset["statistics"].items():
            lines.append("| " + metric + " | " + " | ".join(
                str(values[k]) for k in ("count", "mean", "p50", "p95", "p99")) + " |")
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    names = ["report.md", "result.json", "evidence-index.json", "findings.csv"]
    (out / "checksums.sha256").write_text("".join(
        sha256(out / name) + "  " + name + "\n" for name in names), encoding="utf-8")


def sensitive(path):
    for part in path.parts:
        name = part.lower()
        if (name.startswith(".env") or name in {".ssh", ".aws", ".gnupg", "keys"}
                or any(word in name for word in ("credential", "secret", "password", "private_key"))
                or name.startswith(("id_rsa", "id_ed25519", "id_dsa", "id_ecdsa"))
                or name.endswith((".key", ".pem", ".p12", ".pfx", ".keystore"))):
            return True
    return False


def nonblank(value):
    return isinstance(value, str) and bool(value.strip())


def finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def valid_dataset(item):
    columns = item.get("columns")
    successes = item.get("success_values")
    sentinels = item.get("sentinel_values", [])
    return (nonblank(item.get("evidence_id")) and type(item.get("expected_rows")) is int
            and item["expected_rows"] >= 0 and isinstance(columns, dict)
            and set(columns) == set(METRICS) | {"request_id", "status"}
            and all(nonblank(v) for v in columns.values())
            and len(set(columns.values())) == len(columns)
            and isinstance(successes, list) and bool(successes) and all(nonblank(v) for v in successes)
            and isinstance(sentinels, list) and all(finite_number(v) for v in sentinels)
            and item.get("tpot_denominator") in ("output_tokens", "output_tokens_minus_one")
            and finite_number(item.get("tolerance_ms")) and item["tolerance_ms"] >= 0)


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("nonfinite JSON number")


def statistics(values):
    values = sorted(values)
    n = len(values)
    result = {"count": n, "mean": math.fsum(v / n for v in values) if n else None}
    for name, p in (("p50", .5), ("p95", .95), ("p99", .99)):
        if not n:
            result[name] = None
            continue
        h = (n - 1) * p
        low, high = math.floor(h), math.ceil(h)
        result[name] = values[low] + (values[high] - values[low]) * (h - low)
    return result


class Audit:
    def __init__(self, root):
        self.root = root.resolve()
        self.findings = []
        self.index = []
        self.usable = {}
        self.manifest_sha256 = None

    def add(self, code, location, message):
        self.findings.append({"code": code, "location": location, "message": message})

    def load(self, manifest):
        try:
            if sensitive(manifest) or sensitive(manifest.resolve()):
                self.add("SENSITIVE_PATH", "input", "敏感清单路径已拒绝读取。")
                return {}
            self.manifest_sha256 = sha256(manifest)
            data = json.loads(manifest.read_text(encoding="utf-8"),
                              object_pairs_hook=strict_object, parse_constant=reject_constant)
            if not isinstance(data, dict):
                raise ValueError("object required")
            return data
        except (OSError, UnicodeError, ValueError, RuntimeError):
            self.add("MALFORMED_INPUT", "input", "清单缺失、不可读或不是严格 JSON 对象。")
            return {}

    def validate(self, data):
        if type(data.get("schema_version")) is not int or data.get("schema_version") != 1:
            self.add("MALFORMED_INPUT", "schema_version", "schema_version 必须为整数 1。")
        if not nonblank(data.get("project")):
            self.add("MALFORMED_INPUT", "project", "project 必须为非空字符串。")
        clean = {}
        for group in ("evidence", "claims", "gates", "datasets"):
            items = data.get(group, [] if group == "datasets" else None)
            clean[group] = []
            if not isinstance(items, list):
                self.add("MALFORMED_INPUT", group, "必须为列表。")
                continue
            seen = set()
            for n, item in enumerate(items):
                loc = group + ":" + str(n)
                if not isinstance(item, dict) or not nonblank(item.get("id")):
                    self.add("MALFORMED_INPUT", loc, "条目必须为对象且有非空 id。")
                    continue
                if item["id"] in seen:
                    self.add("DUPLICATE_ID", loc, "同类条目的 id 重复。")
                    continue
                seen.add(item["id"])
                valid = True
                if group == "datasets":
                    valid = valid_dataset(item)
                if group == "evidence":
                    valid = nonblank(item.get("path")) and "\x00" not in item["path"]
                    if "sha256" in item:
                        valid = valid and isinstance(item["sha256"], str) and bool(
                            re.fullmatch(r"[0-9a-fA-F]{64}", item["sha256"]))
                if group in {"claims", "gates"}:
                    refs = item.get("evidence")
                    valid = isinstance(refs, list) and all(nonblank(e) for e in refs)
                    if group == "claims":
                        valid = valid and nonblank(item.get("text"))
                    else:
                        valid = valid and item["id"] in {"G" + str(i) for i in range(9)}
                        valid = valid and item.get("status") in (
                            "PASS", "FAIL", "BLOCKED", "UNVERIFIED", "NA")
                        valid = valid and isinstance(item.get("reason"), str)
                if not valid:
                    self.add("MALFORMED_INPUT", loc, "条目字段类型、值或必填字段无效。")
                    continue
                if group == "evidence":
                    allowed = {"id": item["id"], "path": item["path"]}
                    if "sha256" in item:
                        allowed["sha256"] = item["sha256"]
                elif group == "claims":
                    allowed = {key: item[key] for key in ("id", "text", "evidence")}
                elif group == "gates":
                    allowed = {key: item[key] for key in ("id", "status", "reason", "evidence")}
                else:
                    allowed = {key: item[key] for key in (
                        "id", "evidence_id", "expected_rows", "columns", "success_values",
                        "tpot_denominator", "tolerance_ms")}
                    allowed["columns"] = {key: item["columns"][key] for key in (
                        "request_id", "status", "ttft_ms", "e2e_ms", "output_tokens", "tpot_ms")}
                    if "sentinel_values" in item:
                        allowed["sentinel_values"] = item["sentinel_values"]
                clean[group].append(allowed)
        return clean

    def references(self, clean):
        known = {e["id"] for e in clean["evidence"]}
        if not clean["claims"]:
            self.add("MISSING_CLAIMS", "claims", "未提供可核验主张，状态未验证。")
        for number in range(9):
            gate_id = "G" + str(number)
            if not any(g["id"] == gate_id for g in clean["gates"]):
                self.add("MISSING_GATE", gate_id, "缺少门禁，状态未验证。")
        for group in ("claims", "gates"):
            for item in clean[group]:
                loc = group + ":" + item["id"]
                refs = item["evidence"]
                if any(e not in known for e in refs):
                    self.add("UNKNOWN_EVIDENCE", loc, "引用了未定义的证据 id。")
                usable = bool(refs) and all(e in self.usable for e in refs)
                if group == "claims" and not usable:
                    self.add("CLAIM_UNVERIFIED", loc, "主张缺少完整可用证据，未验证。")
                if group == "gates":
                    status = item["status"]
                    if status == "PASS" and not usable:
                        self.add("PASS_WITHOUT_EVIDENCE", loc, "PASS 自报缺少完整可用非空证据。")
                    if status == "NA" and not item["reason"].strip():
                        self.add("NA_WITHOUT_REASON", loc, "NA 缺少不适用理由。")
                    elif not item["reason"].strip():
                        self.add("GATE_WITHOUT_REASON", loc, "门禁缺少非空理由。")
                    if status in {"UNVERIFIED", "BLOCKED", "FAIL"}:
                        self.add("GATE_FAIL" if status == "FAIL" else "GATE_UNVERIFIED",
                                 loc, "提交方门禁状态为 " + status + "。")

    def csv_rows(self, spec):
        loc = "datasets:" + spec["id"]
        try:
            with self.usable[spec["evidence_id"]].open("r", encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream, strict=True)
                header = reader.fieldnames or []
                if len(header) != len(set(header)) or not set(spec["columns"].values()) <= set(header):
                    self.add("CSV_HEADER", loc, "CSV 表头重复或缺少显式映射列。")
                    return
                for raw in reader:
                    yield reader.line_num, raw
        except (OSError, UnicodeError, csv.Error):
            self.add("CSV_READ_ERROR", loc, "CSV 无法完整解析；已解析行保留，统计可能不完整。")

    def dataset(self, spec):
        rows = []
        seen = {}
        if spec["evidence_id"] not in self.usable:
            known = any(e["id"] == spec["evidence_id"] for e in self.index)
            self.add("DATASET_UNAVAILABLE" if known else "UNKNOWN_EVIDENCE",
                     "datasets:" + spec["id"], "数据集引用未定义或不可用的证据。")
            return None
        for line, raw in self.csv_rows(spec):
                mapped = {name: raw.get(column) or "" for name, column in spec["columns"].items()}
                row = {"line": line, "request_id": mapped["request_id"], "status": mapped["status"],
                       "success": mapped["status"] in spec["success_values"], "valid": True}
                loc = "datasets:" + spec["id"] + ":row:" + str(line)
                def invalid(code, message):
                    row["valid"] = False
                    self.add(code, loc, message)
                if None in raw or any(v is None for v in raw.values()):
                    invalid("CSV_ROW_SHAPE", "CSV 行的列数与表头不一致。")
                if not nonblank(row["request_id"]) or not nonblank(row["status"]):
                    invalid("CSV_ID_STATUS", "请求 id 和状态必须为非空字符串。")
                for metric in METRICS:
                    if not row["success"] and not mapped[metric].strip():
                        row[metric] = None
                        continue
                    if (metric == "tpot_ms" and spec["tpot_denominator"] == "output_tokens_minus_one"
                            and row.get("output_tokens") == 1 and not mapped[metric].strip()):
                        row[metric] = None
                        row["tpot_status"] = "NA"
                        continue
                    try:
                        value = mapped[metric]
                        if metric == "output_tokens":
                            if not re.fullmatch(r"[0-9]+", value.strip()):
                                raise ValueError("integer required")
                            value = int(value)
                        else:
                            value = float(value)
                        if not math.isfinite(value) or value < 0:
                            raise ValueError("finite nonnegative required")
                        row[metric] = value
                        if value in spec.get("sentinel_values", []):
                            invalid("SENTINEL_VALUE", metric + " 匹配显式配置的哨兵值，需核查来源。")
                    except (ValueError, TypeError, OverflowError):
                        row[metric] = None
                        invalid("INVALID_METRIC", metric + " 必须为有限非负值，token 数必须为整数。")
                if all(row[m] is not None for m in METRICS[:3]):
                    if row["e2e_ms"] < row["ttft_ms"]:
                        invalid("E2E_BEFORE_TTFT", "E2E 小于 TTFT。")
                    denominator = row["output_tokens"] - (spec["tpot_denominator"] == "output_tokens_minus_one")
                    if denominator > 0 and row["tpot_ms"] is not None:
                        expected = (row["e2e_ms"] - row["ttft_ms"]) / denominator
                        if abs(row["tpot_ms"] - expected) > spec["tolerance_ms"]:
                            invalid("TPOT_MISMATCH", "TPOT 不符合显式分母和容差。")
                    elif denominator <= 0 and row["success"] and row.get("tpot_status") != "NA":
                        invalid("TPOT_UNDEFINED", "成功请求的 TPOT 分母非正，无法计算。")
                if row["request_id"] in seen:
                    seen[row["request_id"]]["valid"] = False
                    invalid("DUPLICATE_REQUEST_ID", "数据集内 request_id 重复；所有重复行不参与统计。")
                seen[row["request_id"]] = row
                rows.append(row)
        if len(rows) != spec["expected_rows"]:
            self.add("EXPECTED_ROWS_MISMATCH", "datasets:" + spec["id"],
                     "实际行数与 expected_rows 不符；请核查失败请求是否遗漏。")
        good = [r for r in rows if r["success"] and r["valid"]]
        return {"id": spec["id"], "total_rows": len(rows),
                "success_count": sum(r["success"] for r in rows),
                "failure_count": sum(not r["success"] for r in rows),
                "valid_success_count": len(good), "rows": rows,
                "statistics_method": STATISTICS_METHOD,
                "statistics": {m: statistics([r[m] for r in good if r[m] is not None]) for m in METRICS}}

    def evidence(self, items):
        for item in items:
            entry = {"id": item["id"], "path": item["path"], "sha256": None,
                     "size_bytes": None, "usable": False}
            self.index.append(entry)
            loc = "evidence:" + item["id"]
            raw = Path(item["path"])
            if raw.is_absolute() or ".." in raw.parts:
                self.add("PATH_ESCAPE", loc, "证据必须使用根目录内的相对路径。")
                continue
            if sensitive(raw):
                self.add("SENSITIVE_PATH", loc, "敏感路径已拒绝读取。")
                continue
            try:
                path = (self.root / raw).resolve()
                if not inside(path, self.root):
                    self.add("PATH_ESCAPE", loc, "符号链接目标逃逸根目录，已拒绝读取。")
                    continue
                if sensitive(path):
                    self.add("SENSITIVE_PATH", loc, "解析后的敏感路径已拒绝读取。")
                    continue
                if not path.is_file():
                    self.add("MISSING_FILE", loc, "文件缺失或不是普通文件。")
                    continue
                entry["size_bytes"] = path.stat().st_size
                if not entry["size_bytes"]:
                    self.add("EMPTY_FILE", loc, "证据文件为空。")
                    continue
                entry["sha256"] = sha256(path)
                if "sha256" in item and item["sha256"].lower() != entry["sha256"]:
                    self.add("HASH_MISMATCH", loc, "实际 SHA-256 与提交的期望值不符。")
                    continue
                entry["usable"] = True
                self.usable[item["id"]] = path
            except (OSError, ValueError, RuntimeError):
                self.add("EVIDENCE_READ_ERROR", loc, "无法安全读取证据。")


def run_audit(root, manifest, out):
    audit = Audit(root)
    data = audit.load(manifest)
    clean = audit.validate(data)
    audit.evidence(clean["evidence"])
    audit.references(clean)
    datasets = [result for spec in clean["datasets"] if (result := audit.dataset(spec)) is not None]
    data_status = "FINDINGS" if any(f["location"].startswith("datasets") for f in audit.findings) else (
        "PASS" if datasets else "NOT_EVALUATED")
    failed = bool(audit.findings)
    result = {"schema_version": 1, "project": data.get("project") if isinstance(data.get("project"), str) else "",
              "release": "HOLD" if failed else "PENDING_INDEPENDENT_REVIEW",
              "authenticity": "NOT_ESTABLISHED",
              "manifest_sha256": audit.manifest_sha256, "evidence": audit.index,
              "mechanical_status": "FINDINGS" if failed else "PASS",
              "data_consistency": data_status,
              "submitted_gates": clean["gates"], "findings": audit.findings, "datasets": datasets}
    emit(out, result, audit.index)
    return 2 if failed else 0


def emit_tool_error(out):
    finding = {"code": "TOOL_ERROR", "location": "tool",
               "message": "工具内部错误；机械检查未完成，不得据此放行。"}
    result = {"schema_version": 1, "project": "", "release": "HOLD",
              "authenticity": "NOT_ESTABLISHED", "manifest_sha256": None,
              "evidence": [], "mechanical_status": "TOOL_ERROR",
              "data_consistency": "NOT_EVALUATED", "submitted_gates": [],
              "findings": [finding], "datasets": []}
    emit(out, result, [])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("--out", required=True, type=Path)
    audit = commands.add_parser("audit")
    for flag in ("root", "input", "out"):
        audit.add_argument("--" + flag, required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        prepare_output(args.out, getattr(args, "root", None),
                       getattr(args, "input", None))
    except (OSError, ValueError, RuntimeError) as exc:
        print("Tool error: " + str(exc), file=sys.stderr)
        return 1
    try:
        if args.command == "audit":
            return run_audit(args.root, args.input, args.out)
        write_json(args.out / "audit-input.json", {
            "schema_version": 1, "project": "", "claims": [], "evidence": [],
            "gates": [], "datasets": []})
        return 0
    except (OSError, UnicodeError, ValueError, RuntimeError) as exc:
        print("Tool error: " + type(exc).__name__, file=sys.stderr)
        try:
            emit_tool_error(args.out)
        except (OSError, UnicodeError, ValueError, RuntimeError):
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())