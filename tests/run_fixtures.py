#!/usr/bin/env python3
"""Run check.py over fixtures/ and compare against expected.json.

Attack fixtures must produce a high or medium finding of the expected kind;
clean fixtures must come back "clean". --compare also runs a static,
inline-style-only check (parse the source, look at comments, inline
display:none / visibility:hidden, the hidden attribute, alt text and invisible
Unicode) to show which techniques need a real render.
"""
import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import check  # noqa: E402

FIX = ROOT / "fixtures"


class _Naive(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = False

    def handle_comment(self, data):
        if data.strip():
            self.found = True

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        style = (a.get("style") or "").replace(" ", "").lower()
        if "display:none" in style or "visibility:hidden" in style or "hidden" in a or a.get("alt"):
            self.found = True


def naive_catches(html: str) -> bool:
    p = _Naive()
    p.feed(html)
    invisible = re.search("[\U000E0000-\U000E007F​-‏⁠-⁤]", html)
    return p.found or bool(invisible)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--only")
    a = ap.parse_args()
    expected = json.loads((FIX / "expected.json").read_text())
    failures, rows = 0, []
    for name, exp in expected.items():
        if a.only and a.only not in name:
            continue
        r = check.check(str(FIX / name), offline=True)
        sev = r["summary"]
        flagged = [f for f in r["findings"] if f["severity"] in ("high", "medium")]
        if exp["expect"] == "hidden":
            ok = any(f["kind"] == exp["kind"] for f in flagged)
        else:
            ok = sev["verdict"] == "clean"
        failures += not ok
        naive = naive_catches((FIX / name).read_text()) if a.compare else None
        rows.append((name, exp.get("kind", "clean"), sev["verdict"], ok, naive))
        mark = "PASS" if ok else "FAIL"
        extra = f"  static-check={'caught' if naive else 'missed'}" if a.compare else ""
        print(f"{mark}  {name:32} expect={exp.get('kind', 'clean'):24} got={sev['verdict']}"
              f" (h{sev['high']}/m{sev['medium']}/l{sev['low']}){extra}")
        if not ok:
            for f in r["findings"]:
                print(f"        {f['severity']:6} {f['kind']:26} {f['where'][:40]}  {f['text'][:60]}")
    attacks = [r for r in rows if r[1] != "clean"]
    cleans = [r for r in rows if r[1] == "clean"]
    print(f"\nattacks caught: {sum(r[3] for r in attacks)}/{len(attacks)}   "
          f"clean pages clean: {sum(r[3] for r in cleans)}/{len(cleans)}")
    if a.compare:
        print(f"static inline-style check: attacks caught {sum(bool(r[4]) for r in attacks)}/{len(attacks)}, "
              f"clean pages flagged {sum(bool(r[4]) for r in cleans)}/{len(cleans)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
