"""
Restore tournaments from an RDB dump into Upstash Redis.

Usage:
  python scripts/restore_rdb.py <rdb_file> --url <KV_REST_API_URL> --token <KV_REST_API_TOKEN>

Example:
  python scripts/restore_rdb.py dump.rdb --url https://xxx.upstash.io --token AXxx...

This script:
  1. Parses the RDB file and extracts tournament documents
  2. Checks which tournaments already exist in your KV
  3. Imports only the missing ones
  4. Rebuilds the tournament index
"""
import argparse
import json
import re
import sys
import requests


def parse_rdb(filepath: str) -> dict[str, dict]:
    """Extract tournament docs from an RDB file by scanning for JSON blobs."""
    with open(filepath, "rb") as f:
        raw = f.read()

    if not raw[:5] == b"REDIS":
        print("ERROR: Not a valid RDB file")
        sys.exit(1)

    text = raw.decode("utf-8", errors="replace")
    key_pattern = re.compile(r"t_([a-f0-9]{10})")
    results = {}

    for m in key_pattern.finditer(text):
        pos, tid = m.start(), m.group(1)
        search_start = pos + len(m.group(0))
        json_start = text.find('{"name":', search_start, search_start + 200)
        if json_start == -1:
            continue

        depth = 0
        end = json_start
        for i in range(json_start, min(json_start + 500000, len(text))):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            if depth == 0:
                end = i + 1
                break

        try:
            obj = json.loads(text[json_start:end])
            if "players" in obj and tid not in results:
                results[tid] = obj
        except (json.JSONDecodeError, ValueError):
            pass

    return results


def kv_request(method: str, path: str, url: str, token: str, data=None):
    full_url = f"{url.rstrip('/')}/{path}"
    headers = {"Authorization": f"Bearer {token}"}
    if method == "GET":
        r = requests.get(full_url, headers=headers, timeout=10)
    else:
        r = requests.post(full_url, data=data, headers=headers, timeout=10)
    r.raise_for_status()
    return r.json()


def main():
    parser = argparse.ArgumentParser(description="Restore RDB tournaments to Upstash")
    parser.add_argument("rdb_file", help="Path to the .rdb file")
    parser.add_argument("--url", required=True, help="KV_REST_API_URL")
    parser.add_argument("--token", required=True, help="KV_REST_API_TOKEN")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be imported without writing")
    args = parser.parse_args()

    print(f"Parsing {args.rdb_file}...")
    tournaments = parse_rdb(args.rdb_file)
    print(f"Found {len(tournaments)} tournaments in RDB\n")

    # Get existing keys
    print("Checking existing keys in KV...")
    resp = kv_request("GET", "keys/t_*", args.url, args.token)
    existing_keys = set(resp.get("result", []))
    print(f"Found {len(existing_keys)} existing t_* keys\n")

    imported = 0
    skipped = 0
    errors = []

    for tid, tdoc in sorted(tournaments.items()):
        key = f"t_{tid}"
        name = tdoc.get("name", "?")
        players = len(tdoc.get("players", []))
        rounds = len(tdoc.get("rounds", []))

        if key in existing_keys:
            print(f"  SKIP  {key}: \"{name}\" ({players}p, {rounds}r) - already exists")
            skipped += 1
            continue

        if args.dry_run:
            print(f"  WOULD IMPORT  {key}: \"{name}\" ({players}p, {rounds}r)")
            imported += 1
            continue

        try:
            body = json.dumps(tdoc, separators=(",", ":"))
            kv_request("POST", f"set/{key}", args.url, args.token, data=body)
            print(f"  OK    {key}: \"{name}\" ({players}p, {rounds}r)")
            imported += 1
        except Exception as e:
            print(f"  FAIL  {key}: {e}")
            errors.append(f"{tid}: {e}")

    print(f"\nDone: {imported} imported, {skipped} skipped, {len(errors)} errors")

    if not args.dry_run and imported > 0:
        print("Rebuilding tournament index...")
        # Read all t_* keys and build index
        resp = kv_request("GET", "keys/t_*", args.url, args.token)
        all_keys = resp.get("result", [])
        idx = []
        for key in all_keys:
            if key in ("tournament_index", "health_probe"):
                continue
            r = kv_request("GET", f"get/{key}", args.url, args.token)
            val = r.get("result")
            if not val:
                continue
            try:
                t = json.loads(val) if isinstance(val, str) else val
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(t, dict) or "players" not in t:
                continue
            tid = key[2:]
            idx.append({
                "id": tid,
                "name": t.get("name", "Unknown"),
                "created_at": t.get("created_at", ""),
                "player_count": len(t.get("players", [])),
            })
        idx.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        body = json.dumps(idx, separators=(",", ":"))
        kv_request("POST", "set/tournament_index", args.url, args.token, data=body)
        print(f"Index rebuilt with {len(idx)} tournaments")


if __name__ == "__main__":
    main()
