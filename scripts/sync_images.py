#!/usr/bin/env python3
"""
Registers the study's images with Supabase and copies them into the
folder GitHub Pages actually serves -- flattened and content-hashed, so
the served URL never reveals which pool (real / checkpointN) an image
came from. See study/README.md, "Adding or removing images" and
"Running a new round".

USAGE (run from the repo root)
    python3 scripts/sync_images.py v2              # sync ONLY round v2  <- what you want for a new round
    python3 scripts/sync_images.py v2 --dry-run    # look, but change nothing (safe to try first)
    python3 scripts/sync_images.py                 # sync every round, v1 included (the old behaviour)

Requires no third-party packages (stdlib only). Reads scripts/.env for
SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) --
copy scripts/.env.example to scripts/.env and fill those in first.
scripts/.env is gitignored; the secret key must never be committed or
shipped to the browser.

FOLDER LAYOUT = ROUNDS
    study/source-images/real/, checkpoint1/, BaseModel1.5/, ...
        -> the ORIGINAL round, called "v1" (unchanged behaviour).
    study/source-images/v2/real/, v2/ckptA/, v2/ckptB/, ...
        -> a NEW round called "v2". Each sub-folder is one pool. v3, v4, ...
           work the same way.
Inside a round, the pool called exactly "real" holds the real images;
every other sub-folder is an AI pool. Pool names are free (letters,
digits, _ . -), but "real" must be spelled exactly "real".

What it does, for each study/source-images/[<round>/]<pool>/* file:
  1. hashes the file's contents (sha256, first 16 hex chars) -> image_id
  2. copies it to study/images/pool/<image_id>.<ext> if not already there
  3. inserts a row in the `images` table for image_ids not already
     registered: {image_id, source_type: <pool>, experiment_version:
     <round>, storage_path, active: true}
Already-registered image_ids are left completely alone -- this never
touches `active` on an existing row.

Then, for each pool, any image previously registered under that same
round + pool but no longer present in its folder is marked active: false
(soft delete -- the row and file stay, so past sessions that already
showed it remain interpretable, but it won't be drawn for new
participants). A pool folder that contains NO images at all is never
treated as "everything was removed" -- the script warns and skips it.

SAFETY CHECKS BEFORE ANYTHING IS WRITTEN
  * An image_id is the content hash and the table's primary key, so a
    file that is byte-identical to an image already registered in a
    DIFFERENT round/pool cannot be added. The script lists such files and
    stops before changing anything. (Replace or remove the duplicate file.)
  * After syncing a round other than v1, it prints a readiness report: is
    the AI pool count valid (1, 2, 4 or 8), and are there enough images
    (24 real, and 24 / pool-count per AI pool, at the very least).
"""
import hashlib
import json
import os
import re
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

# A top-level folder under source-images/ named v2, v3, ... is a whole new
# round (image set); its sub-folders are that round's pools.
VERSION_DIR = re.compile(r"^v\d+$")
# Same rule as the CHECK constraint on images.source_type in schema.sql.
POOL_NAME_OK = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")

# Study design (must match supabase/functions/_shared/config.ts): every
# participant sees 24 real + 24 AI images, and the 8 AI slots per 16-trial
# block must split evenly across the AI pools -> 1, 2, 4 or 8 pools.
VALID_AI_POOL_COUNTS = {1, 2, 4, 8}
REAL_NEEDED = 24
AI_NEEDED_TOTAL = 24


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


def fetch_all(url: str, key: str, path: str, page: int = 1000) -> list:
    """GET every row, paging with limit/offset. Supabase silently caps one
    response at 1000 rows, so a plain GET could truncate a big pool.
    `path` must contain an &order=... so paging is stable."""
    rows, offset = [], 0
    sep = "&" if "?" in path else "?"
    while True:
        chunk = rest_request(url, key, "GET", f"{path}{sep}limit={page}&offset={offset}") or []
        rows.extend(chunk)
        if len(chunk) < page:
            return rows
        offset += page


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def discover_pools() -> list:
    """Return [(round, pool_name, folder), ...] for everything under source-images/."""
    found = []
    for d in sorted(p for p in SOURCE.iterdir() if p.is_dir()):
        if VERSION_DIR.match(d.name):
            # New layout: source-images/v2/<pool>/  ->  round "v2".
            stray = [f.name for f in d.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTS]
            if stray:
                sys.exit(
                    f"Image files directly inside {d}/ would be ignored: {', '.join(stray[:5])}...\n"
                    f"Put them in a pool sub-folder, e.g. {d.name}/real/ or {d.name}/checkpoint1/."
                )
            for sub in sorted(p for p in d.iterdir() if p.is_dir()):
                found.append((d.name, sub.name, sub))
        else:
            # Old layout: source-images/<pool>/  ->  round "v1".
            found.append(("v1", d.name, d))
    for version, pool, folder in found:
        if not POOL_NAME_OK.match(pool):
            sys.exit(
                f"Folder name '{pool}' ({folder}) isn't allowed: use only letters, digits, "
                f"_ . - and at most 64 characters (it becomes images.source_type)."
            )
    return found


def scan_local(pools: list) -> list:
    """Hash every image file. Returns one entry per unique file. Exits with a
    clear message if the same file content appears in two different pools."""
    entries = []
    seen = {}      # image_id -> (round, pool, file)
    problems = []
    for version, pool, folder in pools:
        files = [p for p in sorted(folder.iterdir()) if p.suffix.lower() in IMAGE_EXTS]
        for f in files:
            image_id = hash_file(f)
            if image_id in seen:
                v0, p0, f0 = seen[image_id]
                if (v0, p0) == (version, pool):
                    # Same picture saved twice inside one pool: harmless, keep one copy.
                    print(f"  note: {f.name} has the same content as {f0.name} in {version}/{pool} -- using it once")
                else:
                    problems.append(
                        f"{version}/{pool}/{f.name} is byte-identical to {v0}/{p0}/{f0.name}"
                    )
                continue
            seen[image_id] = (version, pool, f)
            entries.append({"version": version, "pool": pool, "file": f, "image_id": image_id})
    if problems:
        sys.exit(
            "The same image content is in two different pools, which can't be registered "
            "(image_id is the content hash and the primary key):\n  " + "\n  ".join(problems)
        )
    return entries


def find_db_clashes(url: str, key: str, entries: list) -> list:
    """Local files whose content is already registered under a DIFFERENT
    round/pool. Checked for everything BEFORE any write, so a clash never
    leaves the sync half-done."""
    by_id = {e["image_id"]: e for e in entries}
    ids = list(by_id)
    clashes = []
    for i in range(0, len(ids), 100):  # chunks keep the request URL short
        part = ids[i:i + 100]
        rows = rest_request(
            url, key, "GET",
            f"/rest/v1/images?image_id=in.({','.join(part)})&select=image_id,source_type,experiment_version",
        ) or []
        for r in rows:
            e = by_id[r["image_id"]]
            if (r["experiment_version"], r["source_type"]) != (e["version"], e["pool"]):
                clashes.append(
                    f"{e['version']}/{e['pool']}/{e['file'].name} is byte-identical to an image already "
                    f"registered as {r['experiment_version']}/{r['source_type']}"
                )
    return clashes


def readiness_report(entries: list, versions: set) -> None:
    """For every round except v1, say whether the study can actually run on it."""
    for version in sorted(versions - {"v1"}):
        counts = {}
        for e in entries:
            if e["version"] == version:
                counts[e["pool"]] = counts.get(e["pool"], 0) + 1
        real = counts.get("real", 0)
        ai = {p: n for p, n in counts.items() if p != "real"}
        print(f"\nReadiness of round {version}:")
        print(f"  real: {real} image(s)    AI pools: {len(ai)} -> "
              + (", ".join(f"{p}={n}" for p, n in sorted(ai.items())) or "none"))
        ok = True
        if real < REAL_NEEDED:
            print(f"  !! needs at least {REAL_NEEDED} real images (each participant sees {REAL_NEEDED}); has {real}")
            ok = False
        if len(ai) not in VALID_AI_POOL_COUNTS:
            print(f"  !! {len(ai)} AI pool(s): the 8 AI slots per block only split evenly over 1, 2, 4 or 8 pools")
            ok = False
        else:
            need = AI_NEEDED_TOTAL // len(ai)
            for p, n in sorted(ai.items()):
                if n < need:
                    print(f"  !! pool '{p}' needs at least {need} image(s) (each participant sees {need} per pool); has {n}")
                    ok = False
        if ok:
            print("  OK: enough images and a valid pool count. More images than the minimum is better --")
            print("      the minimum means every participant would see the very same images.")


def main():
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    wanted_versions = [a for a in sys.argv[1:] if not a.startswith("--")]
    unknown = [f for f in flags if f != "--dry-run"]
    if unknown:
        sys.exit(f"Unknown option(s): {', '.join(unknown)}. Only --dry-run is supported.")
    dry_run = "--dry-run" in flags
    for v in wanted_versions:
        if not (v == "v1" or VERSION_DIR.match(v)):
            sys.exit(f"'{v}' is not a round name. Use v1, v2, v3, ...")

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

    if not dry_run:
        POOL_DIR.mkdir(parents=True, exist_ok=True)
    SOURCE.mkdir(parents=True, exist_ok=True)

    pools = discover_pools()
    if wanted_versions:
        pools = [p for p in pools if p[0] in wanted_versions]
    if not pools:
        sys.exit(
            f"No pool folders found under {SOURCE}/"
            + (f" for round(s) {', '.join(wanted_versions)}" if wanted_versions else "")
            + ".\nFor a new round, create e.g. study/source-images/v2/real/ and v2/checkpoint1/ and put images in them."
        )
    versions = {p[0] for p in pools}
    print(("DRY RUN -- nothing will be written.\n" if dry_run else "")
          + f"Round(s): {', '.join(sorted(versions))}")

    # Phase 1: hash every local file; Phase 2: check for clashes. Both happen
    # before the first write.
    entries = scan_local(pools)
    clashes = find_db_clashes(url, key, entries)
    if clashes:
        sys.exit(
            "These files can't be registered because the same image content is already in the "
            "database under a different round/pool. Nothing was written.\n  " + "\n  ".join(clashes)
        )

    # Phase 3: copy files + register rows, one pool at a time.
    total_new = 0
    for version, pool, folder in pools:
        label = f"{version}/{pool}"
        mine = [e for e in entries if e["version"] == version and e["pool"] == pool]
        present_ids = [e["image_id"] for e in mine]

        # Fetch what's already registered for THIS round + pool BEFORE writing
        # anything, so newly-inserted rows never get mistaken for stale.
        existing = fetch_all(
            url, key,
            f"/rest/v1/images?source_type=eq.{pool}&experiment_version=eq.{version}"
            f"&select=image_id&order=image_id",
        )
        existing_ids = {r["image_id"] for r in existing}

        new_rows = []
        for e in mine:
            dest = POOL_DIR / f"{e['image_id']}{e['file'].suffix.lower()}"
            if not dry_run and not dest.exists():
                shutil.copyfile(e["file"], dest)
            if e["image_id"] in existing_ids:
                continue  # already registered -- active status is left exactly as it is
            new_rows.append({
                "image_id": e["image_id"],
                "source_type": pool,
                "experiment_version": version,
                "storage_path": f"images/pool/{dest.name}",
                "active": True,
            })

        if new_rows:
            if not dry_run:
                for i in range(0, len(new_rows), 500):
                    rest_request(
                        url, key, "POST", "/rest/v1/images",
                        body=new_rows[i:i + 500],
                        extra_headers={"Prefer": "return=minimal"},
                    )
            total_new += len(new_rows)
            print(f"{label}: {len(new_rows)} new image(s) {'would be ' if dry_run else ''}registered "
                  f"({len(present_ids) - len(new_rows)} already were)")
        elif mine:
            print(f"{label}: {len(present_ids)} image(s), all already registered")
        else:
            print(f"{label}: no images found in {folder.relative_to(ROOT)}/")

        # Soft-delete anything previously registered under this round + pool
        # that is no longer present in its folder -- but never because the
        # folder is simply empty (that's almost always a mistake, not intent).
        stale = [i for i in existing_ids if i not in present_ids]
        if stale and not mine:
            print(f"{label}: folder has no images -- NOT deactivating its {len(stale)} registered image(s). "
                  f"Add images back, or deactivate them deliberately.")
        elif stale:
            if not dry_run:
                for i in range(0, len(stale), 100):
                    part = ",".join(stale[i:i + 100])
                    rest_request(
                        url, key, "PATCH", f"/rest/v1/images?image_id=in.({part})",
                        body={"active": False},
                        extra_headers={"Prefer": "return=minimal"},
                    )
            print(f"{label}: {'would deactivate' if dry_run else 'deactivated'} {len(stale)} image(s) no longer in the folder")

    names = ", ".join(f"{v}/{p}" for v, p, _ in pools)
    print(f"\nDone{' (dry run)' if dry_run else ''}. {total_new} new image(s) across {len(pools)} pool(s): {names}")
    readiness_report(entries, versions)
    if not dry_run and total_new:
        print("\nNext: commit and push the new files in study/images/pool/ and wait for the GitHub Pages")
        print("deploy to finish. New images are not shown to participants until you switch")
        print("EXPERIMENT_VERSION in supabase/functions/_shared/config.ts to that round and redeploy.")


if __name__ == "__main__":
    main()
