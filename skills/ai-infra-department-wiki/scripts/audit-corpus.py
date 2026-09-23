#!/usr/bin/env python3
"""Corpus gate for a department knowledge repository.

`team-wiki validate` checks the record contract. This gate checks the two things a bulk import
silently breaks, and which no schema can see:

  1. evidence binding  - every evidence record's `source_sha256` still matches the frozen artifact
                         its `locator` points at, and the locator resolves.
  2. excerpt coverage  - every number a case quotes appears in that case's own frozen excerpt, so a
                         reader who cannot reach the upstream source can still check the claim.
  3. redaction         - records *and* artifacts carry no address, port, host id, or home path.
                         (`validate` scans records only; artifacts are where imports leak.)
  4. prose/relations   - a pattern that names supporting cases in prose points its relations at the
                         same records.

Usage:  python3 scripts/audit-corpus.py <repo> [--strict]

Exit code 0 = no failures. Warnings (numbers missing from an excerpt) do not fail unless --strict.
Stdlib only; no third-party imports, by design.
"""
import hashlib
import pathlib
import re
import sys

FM = re.compile(r"^---\n(.*?)\n---\n", re.S)
NUM = re.compile(r"\d+(?:\.\d+)?")
RULES = [
    ("private ipv4", re.compile(r"\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+\.\d+\b")),
    ("public ipv4", re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")),
    ("host tag", re.compile(r"S900K3[-\w]*")),
    ("home path", re.compile(r"/(?:home|Users)/[A-Za-z0-9_.-]+")),
    ("credential", re.compile(r"(?:ghp_|github_pat_|sk-[A-Za-z0-9]{16,})")),
]
# A wildcard bind is not the address of a machine; a dotted string that continues past four
# groups (7.5.0.6.220) is a firmware version. Both are documented allowances, not rule removal.
ALLOW_ADDR = {"0.0.0.0", "255.255.255.255"}


def parse(path):
    text = path.read_text(encoding="utf-8")
    m = FM.match(text)
    fm, body = (m.group(1), text[m.end():]) if m else ("", text)

    def field(key):
        mm = re.search(r"^%s:\s*(.*)$" % key, fm, re.M)
        return mm.group(1).strip().strip('"') if mm else ""

    return fm, body, field


def main(argv):
    repo = pathlib.Path(argv[1] if len(argv) > 1 else ".")
    strict = "--strict" in argv
    records_dir = repo / "records"
    records = [parse(p) for p in sorted(records_dir.rglob("*.md"))]
    by_id = {f("id"): (fm, body, f) for fm, body, f in records}

    fails, warns = [], []

    for fm, body, f in records:
        rid, rtype = f("id"), f("type")
        if rtype == "evidence":
            loc = f("locator").split("#")[0].strip()
            target = repo / loc
            if not loc or not target.is_file():
                fails.append("%s: locator does not resolve: %r" % (rid, loc))
            else:
                actual = hashlib.sha256(target.read_bytes()).hexdigest()
                if actual != f("source_sha256"):
                    fails.append("%s: source_sha256 mismatch for %s" % (rid, loc))
        if rtype == "case":
            evids = re.findall(r"EVD-\d{4}-\d{4}", fm)
            if not evids:
                fails.append("%s: case has no evidence binding" % rid)
            blob = ""
            for e in evids:
                if e not in by_id:
                    fails.append("%s: references missing evidence %s" % (rid, e))
                    continue
                ef = by_id[e][2]
                p = repo / ef("locator").split("#")[0].strip()
                if p.is_file():
                    blob += p.read_text(encoding="utf-8")
            if blob:
                missing = [n for n in sorted(set(NUM.findall(body)))
                           if (len(n) >= 3 or "." in n) and n not in blob]
                if missing:
                    warns.append("%s: %d quoted number(s) not in its own excerpt: %s"
                                 % (rid, len(missing), ", ".join(missing[:10])))
        if rtype == "pattern":
            rel = set(re.findall(r"target:\s*(CASE-\d{4}-\d{4})", fm))
            prose = set(re.findall(r"CASE-\d{4}-\d{4}", body))
            if rel and prose and rel != prose:
                warns.append("%s: relations %s but prose names %s" % (rid, sorted(rel), sorted(prose)))

    for p in list(records_dir.rglob("*.md")) + [q for q in (repo / "artifacts").rglob("*") if q.is_file()]:
        text = p.read_text(encoding="utf-8", errors="replace")
        for name, rx in RULES:
            for hit in set(rx.findall(text)):
                if name == "public ipv4" and (hit in ALLOW_ADDR or re.search(re.escape(hit) + r"\.\d", text)):
                    continue
                fails.append("%s: %s hit %r" % (p.relative_to(repo), name, hit))

    print("records=%d  fails=%d  warnings=%d" % (len(records), len(fails), len(warns)))
    for f_ in fails:
        print("  FAIL", f_)
    for w in warns:
        print("  warn", w)
    return 1 if fails or (strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
