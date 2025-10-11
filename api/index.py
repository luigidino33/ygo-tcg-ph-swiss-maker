# api/index.py
from __future__ import annotations
import os, json, random, uuid, time
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from flask import Flask, request, jsonify

app = Flask(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Vercel KV (Upstash Redis) REST helpers
#   Env (Project → Settings → Environment Variables):
#     KV_REST_API_URL   (or UPSTASH_REDIS_REST_URL)
#     KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_TOKEN)
# ──────────────────────────────────────────────────────────────────────────────

def _get_env(names: list[str]) -> Optional[str]:
    for n in names:
        v = os.environ.get(n)
        if v and v.strip():
            return v.strip()
    return None

def _kv_url() -> str:
    url = _get_env(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "KV_URL"])
    if not url:
        raise RuntimeError("KV_REST_API_URL / UPSTASH_REDIS_REST_URL is missing.")
    return url.rstrip("/")

def _kv_token() -> str:
    tok = _get_env(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"])
    if not tok:
        raise RuntimeError("KV_REST_API_TOKEN / UPSTASH_REDIS_REST_TOKEN is missing.")
    # In case someone pasted "Bearer <token>"
    if tok.lower().startswith("bearer "):
        tok = tok[7:]
    return tok

def kv_set_json(key: str, value) -> None:
    import requests
    url = f"{_kv_url()}/set/{key}"
    body = json.dumps(value, separators=(",", ":"))
    r = requests.post(url, data=body, headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
    if r.status_code >= 400:
        raise RuntimeError(f"KV write failed ({r.status_code}): {r.text}")

def kv_get_json(key: str):
    import requests
    url = f"{_kv_url()}/get/{key}"
    r = requests.get(url, headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    data = r.json()
    val = data.get("result")
    if val is None:
        return None
    try:
        return json.loads(val)
    except Exception:
        return val

def tid_key(tid: str) -> str:
    return f"t_{tid}"

def read_tdoc_or_retry(tid: str, attempts: int = 6, delay: float = 0.2):
    key = tid_key(tid)
    for _ in range(attempts):
        doc = kv_get_json(key)
        if doc is not None:
            return doc
        time.sleep(delay)
    return None

# ──────────────────────────────────────────────────────────────────────────────
# Tournament model + KTS tie-breakers (AABBBCCCDDD)
# ──────────────────────────────────────────────────────────────────────────────

def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

@dataclass
class Node:
    id: str
    name: str
    wins: List[object] = field(default_factory=list)    # Node or "BYE"
    losses: List[object] = field(default_factory=list)  # Node
    ties: List[object] = field(default_factory=list)    # Node
    lost_rounds: List[int] = field(default_factory=list)

    def num_byes(self) -> int:
        return sum(1 for w in self.wins if w == "BYE")

    def wins_excl_bye(self) -> int:
        return sum(1 for w in self.wins if w != "BYE")

    def matches_played_excl_bye(self) -> int:
        # Ties count as matches played; BYE excluded
        return self.wins_excl_bye() + len(self.losses) + len(self.ties)

    def match_points(self) -> int:
        # KTS points: Win=3, Tie=0, Loss=0; BYE counts as a Win for points
        return 3 * len(self.wins)

    def match_win_pct(self) -> float:
        # BYEs excluded from MW%; ties give 0 wins over 1 match (counted via ties)
        denom = self.matches_played_excl_bye()
        return (self.wins_excl_bye() / denom) if denom else 0.0

def rebuild_graph(t: dict) -> Dict[str, Node]:
    players = {p["id"]: Node(id=p["id"], name=p["name"]) for p in t["players"]}
    for rnd in t.get("rounds", []):
        n = rnd["n"]
        for m in rnd["matches"]:
            a = players[m["a"]]
            b = players[m["b"]] if m.get("b") else None
            r = m["r"]
            if r == "PENDING":
                continue
            if r == "BYE":
                a.wins.append("BYE")
                continue
            if not b:
                continue
            if r == "A":
                a.wins.append(b); b.losses.append(a); b.lost_rounds.append(n)
            elif r == "B":
                b.wins.append(a); a.losses.append(b); a.lost_rounds.append(n)
            elif r == "TIE":
                # A tie is not a loss for DDD.
                a.ties.append(b); b.ties.append(a)
    return players

def opp_win_pct(p: Node) -> float:
    tot, num = 0.0, 0
    for opp in p.wins + p.losses + p.ties:
        if opp == "BYE":
            continue
        tot += opp.match_win_pct()
        num += 1
    return tot / num if num else 0.0

def compute_standings(t: dict):
    nodes = rebuild_graph(t)
    rows = []
    for p in nodes.values():
        # AABBBCCCDDD
        aa = p.match_points()
        # BBB: opponents' MW% (to one-tenth decimal; we encode as ×1000 integer)
        bbb = max(0, min(999, int(round(opp_win_pct(p), 3) * 1000)))
        # CCC: opponents' opponents' MW%
        acc, nopp = 0.0, 0
        for opp in p.wins + p.losses + p.ties:
            if opp == "BYE":
                continue
            acc += opp_win_pct(opp); nopp += 1
        ccc = max(0, min(999, int(round((acc / nopp) if nopp else 0.0, 3) * 1000)))
        # DDD: sum of squares of rounds the duelist lost matches (ties excluded)
        ddd = min(999, sum(r * r for r in p.lost_rounds))
        kts = f"{aa}{str(bbb).zfill(3)}{str(ccc).zfill(3)}{str(ddd).zfill(3)}"

        # Display helpers
        d = p.matches_played_excl_bye()
        mw = (p.wins_excl_bye() / d * 100.0) if d else 0.0
        omw = opp_win_pct(p) * 100.0
        oomw = (acc / nopp * 100.0) if nopp else 0.0

        rows.append({
            "player_id": p.id, "player": p.name, "pts": aa,
            "mw": round(mw, 1), "omw": round(omw, 1), "oomw": round(oomw, 1),
            "ddd": str(ddd).zfill(3), "kts": kts
        })
    rows.sort(key=lambda r: -int(r["kts"]))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows

def current_round_number(t: dict) -> int:
    return max([r["n"] for r in t.get("rounds", [])], default=0)

def latest_round(t: dict):
    return t["rounds"][-1] if t.get("rounds") else None

def round_has_pending(last_round: Optional[dict]) -> bool:
    return bool(last_round and any(m["r"] == "PENDING" for m in last_round["matches"]))

def prior_pairs_set(t: dict) -> set[tuple[str, str]]:
    pairs = set()
    for rnd in t.get("rounds", []):
        for m in rnd["matches"]:
            if m.get("b"):
                a, b = m["a"], m["b"]
                pairs.add((a, b) if a < b else (b, a))
    return pairs

def pairs_for_ui(t: dict) -> list[dict]:
    """Return active pairs (PENDING + BYE) of latest round for refresh-safe UI."""
    last = latest_round(t)
    if not round_has_pending(last):
        return []
    id2name = {p["id"]: p["name"] for p in t["players"]}
    pairs = []
    for m in last["matches"]:
        if m["r"] in ("PENDING", "BYE"):
            pairs.append({
                "table": m["t"],
                "a": id2name[m["a"]],
                "b": (id2name.get(m["b"]) if m.get("b") else "BYE"),
                "match_id": m["id"]
            })
    pairs.sort(key=lambda x: x["table"])
    return pairs

# ── Swiss-by-brackets helpers ────────────────────────────────────────────────

def _standings_maps(t: dict):
    """Return helpers: nodes, pts_by_id, kts_by_id, and id->name."""
    nodes = rebuild_graph(t)
    st = compute_standings(t)
    pts_by_id = {r["player_id"]: r["pts"] for r in st}
    kts_by_id = {r["player_id"]: int(r["kts"]) for r in st}
    id2name = {p["id"]: p["name"] for p in t["players"]}
    return nodes, pts_by_id, kts_by_id, id2name

def _choose_bye_id(t: dict, pts_by_id: dict, kts_by_id: dict, nodes: dict) -> str:
    """
    BYE selection: lowest points first, prefer no prior BYE, then worst KTS, then name.
    """
    everyone = [p["id"] for p in t["players"]]
    # Build name lookup
    name_of = {p["id"]: p["name"] for p in t["players"]}
    everyone.sort(key=lambda pid: (
        pts_by_id.get(pid, 0),            # lower points first
        nodes[pid].num_byes(),            # prefer 0 BYEs
        kts_by_id.get(pid, 0),            # lower KTS first
        name_of[pid]                       # stable
    ))
    return everyone[0]

def _build_brackets(ids: list[str], pts_by_id: dict, kts_by_id: dict, id2name: dict) -> list[list[str]]:
    """Group by points; each bracket sorted by KTS desc, then name asc. Return top→bottom."""
    from collections import defaultdict
    buckets = defaultdict(list)
    for pid in ids:
        buckets[pts_by_id.get(pid, 0)].append(pid)
    brackets = []
    for pts in sorted(buckets.keys(), reverse=True):
        bucket = buckets[pts]
        bucket.sort(key=lambda pid: (-kts_by_id.get(pid, 0), id2name[pid]))
        brackets.append(bucket)
    return brackets

def _pair_within_bracket(order: list[str], prior_pairs: set[tuple[str, str]]) -> Optional[list[tuple[str, str]]]:
    """
    Backtracking: preserve adjacency bias (1v2,3v4,...) while avoiding rematches.
    """
    n = len(order)
    used = [False] * n
    pairs: list[tuple[str, str]] = []

    prior_lookup = {(a, b) if a < b else (b, a) for (a, b) in prior_pairs}

    def bt(start_idx: int) -> bool:
        # find next free i
        i = start_idx
        while i < n and used[i]:
            i += 1
        if i >= n:
            return True
        used[i] = True
        # Prefer partners close to i to approximate 1v2,3v4
        for j in range(i + 1, n):
            if used[j]:
                continue
            a, b = order[i], order[j]
            key = (a, b) if a < b else (b, a)
            if key in prior_lookup:
                continue  # avoid rematch if possible
            used[j] = True
            pairs.append((a, b))
            if bt(i + 1):
                return True
            pairs.pop()
            used[j] = False
        # If no non-rematch partner works, allow rematch as last resort
        for j in range(i + 1, n):
            if used[j]:
                continue
            a, b = order[i], order[j]
            used[j] = True
            pairs.append((a, b))
            if bt(i + 1):
                return True
            pairs.pop()
            used[j] = False
        used[i] = False
        return False

    ok = bt(0)
    return pairs if ok else None

def _pair_brackets(brackets: list[list[str]], prior_pairs: set[tuple[str, str]]) -> list[tuple[str, str]]:
    """
    Pair each bracket top-down. If a bracket is odd, float the lowest to the next bracket.
    If pairing fails due to rematches, float the lowest and retry.
    """
    pairs: list[tuple[str, str]] = []
    carry_down: list[str] = []

    for bucket in brackets:
        work = (carry_down + bucket) if carry_down else list(bucket)

        if len(work) == 0:
            carry_down = []
            continue

        # If odd, float the lowest (last) down
        if len(work) % 2 == 1:
            carry_down = [work.pop()]
        else:
            carry_down = []

        # Try to pair; if impossible, float one more and retry
        while True:
            res = _pair_within_bracket(work, prior_pairs)
            if res is not None:
                pairs.extend(res)
                break
            if not work:
                break
            # float one more lowest to keep feasibility
            carry_down = [work.pop()] + carry_down
            if len(work) % 2 == 1:
                if work:
                    carry_down = [work.pop()] + carry_down

    # If overall players were odd, carry_down may hold one player, but BYE is handled separately.
    return pairs

def pair_next(t: dict) -> tuple[int, list[dict]]:
    """
    Bracketed Swiss pairing:
      - Build score brackets by points
      - Inside each bracket: strongest vs next (1v2, 3v4, ...), avoiding rematches
      - If odd bracket: float lowest to next bracket
      - BYE (if odd overall): lowest points, prefer no previous BYE, worse tiebreaks
    """
    nodes, pts_by_id, kts_by_id, id2name = _standings_maps(t)
    prior = prior_pairs_set(t)

    # pool of all players
    all_ids = [p["id"] for p in t["players"]]

    # BYE first if odd
    bye_id: Optional[str] = None
    if len(all_ids) % 2 == 1:
        bye_id = _choose_bye_id(t, pts_by_id, kts_by_id, nodes)
        all_ids = [pid for pid in all_ids if pid != bye_id]

    brackets = _build_brackets(all_ids, pts_by_id, kts_by_id, id2name)
    id_pairs = _pair_brackets(brackets, prior)

    rnd_no = current_round_number(t) + 1
    matches, table = [], 1
    for a, b in id_pairs:
        matches.append({"id": new_id("m"), "t": table, "a": a, "b": b, "r": "PENDING"})
        table += 1

    if bye_id:
        matches.append({"id": new_id("m"), "t": table, "a": bye_id, "b": None, "r": "BYE"})

    return rnd_no, matches

# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    """Tiny KV write+read probe."""
    try:
        key = "health_probe"
        payload = {"ts": time.time()}
        kv_set_json(key, payload)
        val = kv_get_json(key)
        host = ""
        try:
            host = _kv_url().split("//", 1)[-1][:32] + "…"
        except Exception:
            pass
        return jsonify({"ok": True, "kv_host": host, "read_back": val})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/api/debug/env")
def debug_env():
    """Show presence of KV envs (no secrets)."""
    try:
        d = {
            "KV_REST_API_URL_present": bool(os.environ.get("KV_REST_API_URL")),
            "UPSTASH_REDIS_REST_URL_present": bool(os.environ.get("UPSTASH_REDIS_REST_URL")),
            "KV_REST_API_TOKEN_present": bool(os.environ.get("KV_REST_API_TOKEN")),
            "UPSTASH_REDIS_REST_TOKEN_present": bool(os.environ.get("UPSTASH_REDIS_REST_TOKEN")),
        }
        try:
            d["rest_host_prefix"] = _kv_url().split("//", 1)[-1][:24] + "…"
        except Exception as e:
            d["url_error"] = str(e)
        return jsonify(d)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/api/debug/kv-auth")
def debug_kv_auth():
    """Ping KV using current env; helpful to diagnose 401 WRONGPASS."""
    try:
        import requests
        url = f"{_kv_url()}/ping"
        r = requests.get(url, headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
        return jsonify({"status": r.status_code, "text": r.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments")
def create_tournament():
    try:
        data = request.get_json(force=True)
        name = (data.get("name") or "Tournament").strip()
        total_rounds = int(data.get("total_rounds") or 4)
        players = [p.strip() for p in (data.get("players") or []) if p.strip()]
        if not players:
            return jsonify({"error": "players list is required"}), 400

        tid = uuid.uuid4().hex[:10]
        tdoc = {
            "name": name,
            "total_rounds": total_rounds,
            "players": [{"id": new_id("p"), "name": n} for n in players],
            "rounds": []
        }
        kv_set_json(tid_key(tid), tdoc)

        initial_info = {"id": tid, "name": name, "total_rounds": total_rounds, "round": 0}
        return jsonify({"tournament_id": tid, "info": initial_info})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>")
def get_tournament(tid):
    try:
        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404
        return jsonify({"id": tid, "name": t["name"], "total_rounds": t["total_rounds"], "round": current_round_number(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.post("/api/tournaments/<tid>/edit-result")
def api_edit_result(tid):
    """
    Admin: edit a single match result in any round.
    Body: { "match_id": "<id>", "result": "A"|"B"|"DRAW"|"PENDING"|"BYE" }
      - For BYE matches, 'b' should be None and result "BYE".
      - For non-BYE matches, 'r' is one of: "A", "B", "DRAW", "PENDING".
    Saves and returns {ok: true, round: n, match: {...}}.
    """
    try:
        body = request.get_json(silent=True) or {}
        mid = body.get("match_id")
        res = body.get("result")
        if not mid or res not in {"A", "B", "DRAW", "PENDING", "BYE"}:
            return jsonify({"ok": False, "message": "Provide match_id and valid result."}), 400

        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404

        found = None
        found_round = None
        for rd in t.get("rounds", []):
            for m in rd.get("matches", []):
                if m.get("id") == mid:
                    found = m
                    found_round = rd.get("n")
                    break
            if found:
                break

        if not found:
            return jsonify({"ok": False, "message": "Match not found."}), 404

        # Validate BYE vs non-BYE transitions
        if res == "BYE":
            # Make it a BYE: ensure opponent None and mark as BYE
            found["b"] = None
            found["r"] = "BYE"
        else:
            # Not a BYE — ensure it's a real pairing (if originally BYE, cannot assign a winner without opponent)
            if found.get("b") in (None, "BYE"):
                # leave as BYE if no opponent; admin must restart/re-pair to change structure
                return jsonify({"ok": False, "message": "Cannot set result on BYE match without an opponent."}), 400
            found["r"] = res  # "A" | "B" | "DRAW" | "PENDING"

        # Persist document
        kv_set_json(tid_key(tid), t)

        # Return sanitized match info (names for UI)
        id2name = {p["id"]: p["name"] for p in t.get("players", []) if "id" in p and "name" in p}
        rsp = {
            "id": found.get("id"),
            "t": found.get("t"),
            "a": id2name.get(found.get("a"), found.get("a")),
            "b": ("BYE" if found.get("b") in (None, "BYE") else id2name.get(found.get("b"), found.get("b"))),
            "r": found.get("r"),
        }
        return jsonify({"ok": True, "round": found_round, "match": rsp})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>/standings")
def api_standings(tid):
    try:
        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404
        return jsonify({"standings": compute_standings(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>/active")
def api_active_pairs(tid):
    """Return active pairs (PENDING + BYE) of latest round so refresh preserves the current round."""
    try:
        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404
        return jsonify({"pairs": pairs_for_ui(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/pair-next")
def api_pair_next(tid):
    try:
        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404

        # Block pairing if the latest round is still active (has any PENDING match)
        last = latest_round(t)
        if round_has_pending(last):
            return jsonify({"ok": False, "message": "Finalize the current round before pairing the next."})

        curr = current_round_number(t)
        if curr >= int(t["total_rounds"]):
            return jsonify({"ok": False, "message": "All rounds completed.", "round": curr})

        rnd_no, matches = pair_next(t)
        t["rounds"].append({"n": rnd_no, "matches": matches})
        kv_set_json(tid_key(tid), t)

        id2name = {p["id"]: p["name"] for p in t["players"]}
        pairs = [{
            "table": m["t"],
            "a": id2name[m["a"]],
            "b": (id2name.get(m["b"]) if m.get("b") else "BYE"),
            "match_id": m["id"]
        } for m in matches]
        return jsonify({"ok": True, "round": rnd_no, "pairs": pairs})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/finalize-round")
def api_finalize_round(tid):
    """
    Body: { results: [{match_id, outcome}] }, outcome in ["A","B","TIE"]
    BYE matches are auto-recorded as "BYE" at pairing time (count as win for points; excluded from MW%).
    """
    try:
        data = request.get_json(force=True)
        results = data.get("results") or []
        if not isinstance(results, list) or not results:
            return jsonify({"error": "results array required"}), 400

        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404
        if not t.get("rounds"):
            return jsonify({"error": "no rounds to finalize"}), 400

        last = t["rounds"][-1]
        by_id = {m["id"]: m for m in last["matches"]}

        for r in results:
            mid = r.get("match_id"); out = r.get("outcome")
            if mid in by_id and out in ("A", "B", "TIE"):
                by_id[mid]["r"] = out

        kv_set_json(tid_key(tid), t)
        return jsonify({"ok": True, "standings": compute_standings(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
