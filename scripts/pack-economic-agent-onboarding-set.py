#!/usr/bin/env python3
"""Build the Economic Agent Onboarding Set zip from the markdown sources."""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "packs" / "economic-agent-onboarding-set"
DEST = ROOT / "public" / "packs" / "economic-agent-onboarding-set.zip"
ARC_ROOT = Path("economic-agent-onboarding-set")


def main() -> None:
    files = sorted(p for p in SRC.rglob("*") if p.is_file())
    if not files:
        raise SystemExit(f"no pack sources in {SRC}")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(DEST, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, arcname=str(ARC_ROOT / path.relative_to(SRC)))
    print(f"wrote {DEST} ({len(files)} files)")


if __name__ == "__main__":
    main()
