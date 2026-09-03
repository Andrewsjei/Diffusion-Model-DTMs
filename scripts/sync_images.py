#!/usr/bin/env python3
"""
Registers the study's images with Supabase and copies them into the
folder GitHub Pages actually serves — flattened and content-hashed, so
the served URL never reveals which pool (real / checkpointN) an image
came from. See study/README.md, "Adding or removing images."

Usage:
    python3 scripts/sync_images.py

Requires no third-party packages (stdlib only). Reads scripts/.env for
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — copy scripts/.env.example
to scripts/.env and fill those in first. scripts/.env is gitignored;
the service_role key must never be committed or shipped to the browser.

Scans every folder under study/source-images/ automatically -- there is
no fixed list of pool names. Add a new folder (any name: 'checkpoint5',
'BaseModel1.5', whatever) and this script picks it up on the next run;
which pools are actually served to participants is a separate decision,
made with scripts/set_active_pools.py.

What it does, for each study/source-images/<pool>/* file:
  1. hashes the file's contents (sha256, first 16 hex chars) -> image_id
  2. copies it to study/images/pool/<image_id>.<ext> if not already there
  3. inserts a row in the `images` table for image_ids not already
     registered: {image_id, source_type, storage_path, active: true}
Already-registered image_ids are left completely alone -- in
particular, this never touches `active` on an existing row, so it
can't undo a pool you deliberately deactivated with
set_active_pools.py just because you added one more file to it.

Then, for each pool, any image_id previously registered under that
source_type but no longer present in source-images/ is marked
active: false (soft delete — the row and file stay, so past sessions
that already showed it remain interpretable, but it won't be drawn for
new participants).
"""
import hashlib
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STUDY = ROOT / "study"
SOURCE = STUDY / "source-images"
POOL_DIR = STUDY / "images" / "pool"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


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


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def main():
    env = load_env(Path(__file__).parent / ".env")
    url = env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    # Newer Supabase projects issue a "secret" key instead of the legacy
    # "service_role" key -- accept either name.
    key = (
        env.get("SUPABASE_SECRET_KEY")
        or env.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        sys.exit(
            "Missing SUPABASE_URL / SUPABASE_SECRET_KEY.\n"
            "Copy scripts/.env.example to scripts/.env and fill them in "
            "(Supabase Dashboard -> Project Settings -> API)."
        )

    POOL_DIR.mkdir(parents=True, exist_ok=True)
    SOURCE.mkdir(parents=True, exist_ok=True)

    pools = sorted(p.name for p in SOURCE.iterdir() if p.is_dir())
    if not pools:
        sys.exit(f"No folders found under {SOURCE}/ -- nothing to sync.")

    total_new = 0
    for pool in pools:
        src_dir = SOURCE / pool
        files = [p for p in sorted(src_dir.iterdir()) if p.suffix.lower() in IMAGE_EXTS]

        present_ids = []
        for f in files:
            present_ids.append(hash_file(f))

        # Fetch what's already registered for this pool BEFORE writing
        # anything, so newly-inserted rows never get mistaken for stale.
        existing = rest_request(
            url, key, "GET",
            f"/rest/v1/images?source_type=eq.{pool}&select=image_id",
        ) or []
        existing_ids = {r["image_id"] for r in existing}

        new_rows = []
        for f, image_id in zip(files, present_ids):
            dest = POOL_DIR / f"{image_id}{f.suffix.lower()}"
            if not dest.exists():
                shutil.copyfile(f, dest)
            if image_id in existing_ids:
                continue  # already registered -- active status is left exactly as it is
            new_rows.append({
                "image_id": image_id,
                "source_type": pool,
                "storage_path": f"images/pool/{dest.name}",
                "active": True,
            })

        if new_rows:
            rest_request(
                url, key, "POST", "/rest/v1/images",
                body=new_rows,
                extra_headers={"Prefer": "return=minimal"},
            )
            total_new += len(new_rows)
            print(f"{pool}: {len(new_rows)} new image(s) registered "
                  f"({len(present_ids) - len(new_rows)} already were)")
        elif files:
            print(f"{pool}: {len(present_ids)} image(s), all already registered")
        else:
            print(f"{pool}: no images found in study/source-images/{pool}/")

        # Soft-delete anything previously registered under this pool that
        # is no longer present in source-images/.
        stale = [i for i in existing_ids if i not in present_ids]
        if stale:
            ids_filter = ",".join(stale)
            rest_request(
                url, key, "PATCH",
                f"/rest/v1/images?image_id=in.({ids_filter})",
                body={"active": False},
            )
            print(f"{pool}: deactivated {len(stale)} image(s) no longer in source-images/")

    print(f"\nDone. {total_new} new image(s) registered across {len(pools)} pool(s): {', '.join(pools)}")
    print("Run scripts/set_active_pools.py to choose which non-real pools are actually shown to participants.")


if __name__ == "__main__":
    main()
