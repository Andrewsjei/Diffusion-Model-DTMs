#!/usr/bin/env python3
"""
Chooses which non-real image pool(s) are actually shown to participants,
without touching any data. 'real' is always active. Every image row for
a pool NOT listed here is set active: false -- the rows, files, and any
past responses that reference them are untouched, so switching pools
never deletes results, it only stops that pool being drawn for new
participants. Running this again with a different set of names brings
old pools back.

Usage:
    python3 scripts/set_active_pools.py BaseModel1.5 BaseModel3.5
    python3 scripts/set_active_pools.py checkpoint1 checkpoint2 checkpoint3 checkpoint4

Names must already be registered (run scripts/sync_images.py first if
a folder is new). Requires scripts/.env -- see scripts/.env.example.

Constraint on how many pools you pick: each participant sees 24 real +
24 AI images total, split into 3 balanced blocks of 16 trials (8 real +
8 AI each), and each block splits its 8 AI slots evenly across whatever
pools are active. That only comes out even when the number of active
pools divides 8 -- so 1, 2, 4, or 8 pools. Anything else (3, 5, 6, 7...)
leaves a fractional slot and start-session will refuse to build a
sequence until you fix it.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

VALID_POOL_COUNTS = {1, 2, 4, 8}


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def rest_request(url: str, key: str, method: str, path: str, body=None, extra_headers=None):
    req = urllib.request.Request(
        url.rstrip("/") + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            **(extra_headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            return json.loads(data) if data else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {detail}") from None


def main():
    wanted = sys.argv[1:]
    if not wanted:
        sys.exit(__doc__)

    if "real" in wanted:
        sys.exit("Don't list 'real' -- it's always active. Pass only the AI pool name(s).")

    if len(set(wanted)) != len(wanted):
        sys.exit(f"Duplicate names in: {wanted}")

    if len(wanted) not in VALID_POOL_COUNTS:
        sys.exit(
            f"{len(wanted)} pool(s) given ({', '.join(wanted)}) -- the 8 AI slots per "
            f"block can't split evenly across that many. Use 1, 2, 4, or 8 pools."
        )

    env = load_env(Path(__file__).parent / ".env")
    url = env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = (
        env.get("SUPABASE_SECRET_KEY")
        or env.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        sys.exit(
            "Missing SUPABASE_URL / SUPABASE_SECRET_KEY.\n"
            "Copy scripts/.env.example to scripts/.env and fill them in."
        )

    rows = rest_request(url, key, "GET", "/rest/v1/images?select=source_type&order=source_type") or []
    known = sorted({r["source_type"] for r in rows if r["source_type"] != "real"})

    missing = [w for w in wanted if w not in known]
    if missing:
        sys.exit(
            f"Not registered yet: {', '.join(missing)}.\n"
            f"Known non-real pools: {', '.join(known) or '(none)'}\n"
            f"If the folder is new, run scripts/sync_images.py first."
        )

    # 'real' always active.
    rest_request(url, key, "PATCH", "/rest/v1/images?source_type=eq.real",
                 body={"active": True}, extra_headers={"Prefer": "return=minimal"})

    for pool in known:
        should_be_active = pool in wanted
        rest_request(
            url, key, "PATCH", f"/rest/v1/images?source_type=eq.{pool}",
            body={"active": should_be_active},
            extra_headers={"Prefer": "return=minimal"},
        )
        print(f"{pool}: {'active' if should_be_active else 'inactive'}")

    print(f"\nActive AI pools now: {', '.join(wanted)} ({len(wanted)} of 8 slots -> "
          f"{8 // len(wanted)} per pool per block, {24 // len(wanted)} per pool total).")
    print("No rows were deleted -- past results for deactivated pools are untouched.")


if __name__ == "__main__":
    main()
