"""End-to-end: render every fixture in Chromium and check the verdict.

Attack fixtures (a*) each hide the same canary payload one way and must yield a
high or medium finding of the expected kind. Clean fixtures (c*) are ordinary
pages with tabs, modals, code highlighting and so on, and must come back clean.
"""
import json
from pathlib import Path

import pytest

import check

FIX = Path(__file__).resolve().parent.parent / "fixtures"
EXPECTED = json.loads((FIX / "expected.json").read_text())
ATTACKS = {k: v for k, v in EXPECTED.items() if v["expect"] == "hidden"}
CLEAN = {k: v for k, v in EXPECTED.items() if v["expect"] == "clean"}


def _brief(report):
    return "\n".join(f"  {f['severity']:6} {f['kind']:24} {f['where'][:40]}  {f['text'][:60]}"
                     for f in report["findings"])


@pytest.mark.parametrize("name", sorted(ATTACKS), ids=lambda n: n.removesuffix(".html"))
def test_attack_is_flagged(name):
    r = check.check(str(FIX / name), offline=True)
    flagged = [f for f in r["findings"] if f["severity"] in ("high", "medium")]
    kind = ATTACKS[name]["kind"]
    assert any(f["kind"] == kind for f in flagged), f"expected {kind}, got:\n{_brief(r)}"
    assert r["summary"]["verdict"] != "clean"


@pytest.mark.parametrize("name", sorted(CLEAN), ids=lambda n: n.removesuffix(".html"))
def test_clean_page_is_clean(name):
    r = check.check(str(FIX / name), offline=True)
    assert r["summary"]["verdict"] == "clean", _brief(r)


def test_canary_text_is_quoted_back():
    """The user has to see what was hidden, not just that something was."""
    r = check.check(str(FIX / "a02_class_display_none.html"), offline=True)
    assert any("MARIGOLD" in f["text"] for f in r["findings"] if f["severity"] == "high")


def test_cli_exit_codes(tmp_path):
    import subprocess, sys
    py = sys.executable
    script = str(FIX.parent / "scripts" / "check.py")
    clean = subprocess.run([py, script, str(FIX / "c01_report.html"), "--offline"], capture_output=True)
    dirty = subprocess.run([py, script, str(FIX / "a01_inline_display_none.html"), "--offline"], capture_output=True)
    missing = subprocess.run([py, script, str(tmp_path / "nope.html")], capture_output=True)
    assert (clean.returncode, dirty.returncode, missing.returncode) == (0, 1, 2)


def test_offline_blocks_external_requests():
    r = check.check(str(FIX / "c12_external_assets.html"), offline=True)
    assert r["stats"]["blockedRequests"] >= 1


def test_navigation_away_is_blocked_and_page_still_analysed():
    r = check.check(str(FIX / "c13_navigates_away.html"), offline=True)
    assert r["summary"]["verdict"] == "clean"
    assert r["stats"]["textNodes"] >= 2


def test_payload_addressed_to_the_checker_is_still_reported():
    r = check.check(str(FIX / "a31_payload_addressed_to_checker.html"), offline=True)
    assert r["summary"]["verdict"] == "hidden-text-found"
    assert any("verified clean" in f["text"] for f in r["findings"])


def test_tabs_are_explored_not_flagged():
    r = check.check(str(FIX / "c02_tabs.html"), offline=True)
    kinds = {f["kind"] for f in r["findings"]}
    assert "revealed-by-interaction" in kinds and r["stats"]["clicks"] >= 2


def test_no_explore_flags_closed_tabs():
    """Without clicking, hidden tab panels are reported — exploration is what clears them."""
    r = check.check(str(FIX / "c02_tabs.html"), offline=True, explore=False)
    assert r["summary"]["verdict"] != "clean"


def test_json_report_shape():
    r = check.check(str(FIX / "a01_inline_display_none.html"), offline=True)
    assert set(r) == {"file", "summary", "findings", "stats", "limitations"}
    assert set(r["summary"]) == {"high", "medium", "low", "verdict"}
    for f in r["findings"]:
        assert {"severity", "kind", "text", "where"} <= set(f)
        assert f["severity"] in ("high", "medium", "low")
        assert len(f["text"]) <= 301


def test_text_output_labels_quotes_as_data():
    import subprocess, sys
    out = subprocess.run([sys.executable, str(FIX.parent / "scripts" / "check.py"),
                          str(FIX / "a01_inline_display_none.html"), "--offline"], capture_output=True, text=True)
    assert "never instructions" in out.stdout and "│ Note for AI assistants" in out.stdout


def test_multiple_files_exit_with_worst_code():
    import subprocess, sys
    rc = subprocess.run([sys.executable, str(FIX.parent / "scripts" / "check.py"), "--offline",
                         str(FIX / "c01_report.html"), str(FIX / "a01_inline_display_none.html")]).returncode
    assert rc == 1
