# api/index.py
from __future__ import annotations
import os, json, random, uuid, time
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from flask import Flask, request, jsonify

app = Flask(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Vercel KV (Upstash Redis) REST helpers
#   Required env (Project → Settings → Environment Variables):
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
    if tok.lower().startswith("bearer "):  # users sometimes paste with 'Bearer ' prefix
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

# ──────────────────────────────────────────────────────────────────────────────
# Read-after-write tiny retry (KV is usually consistent; keep a small backoff)
# ──────────────────────────────────────────────────────────────────────────────

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
    ties: List[object] = field(default_factory=list)
    lost_rounds: List[int] = field(default_factory=list)

    def num_byes(self) -> int:
        return sum(1 for w in self.wins if w == "BYE")

    def wins_excl_bye(self) -> int:
        return sum(1 for w in self.wins if w != "BYE")

    def matches_played_excl_bye(self) -> int:
        return self.wins_excl_bye() + len(self.losses) + len(self.ties)

    def match_points(self) -> int:
        # KTS points used here: Win=3, Tie=0, Loss=0; BYE counts as a Win for points
        return 3 * len(self.wins)

    def match_win_pct(self) -> float:
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
                # Treat TIE as a 'lost round' for DDD per your policy
                a.losses.append(b); b.losses.append(a)
                a.lost_rounds.append(n); b.lost_rounds.append(n)
    return players

def opp_win_pct(p: Node) -> float:
    tot, num = 0.0, 0
    for opp in p.wins + p.losses:
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
        # BBB: opponents' MW%
        bbb = max(0, min(999, int(round(opp_win_pct(p), 3) * 1000)))
        # CCC: opponents' opponents' MW%
        acc, nopp = 0.0, 0
        for opp in p.wins + p.losses:
            if opp == "BYE":
                continue
            acc += opp_win_pct(opp); nopp += 1
        ccc = max(0, min(999, int(round((acc / nopp) if nopp else 0.0, 3) * 1000)))
        # DDD: sum of squares of lost round numbers
        ddd = min(999, sum(r * r for r in p.lost_rounds))
        kts = f"{aa}{str(bbb).zfill(3)}{str(ccc).zfill(3)}{str(ddd).zfill(3)}"

        # Extra columns for display
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

def prior_pairs_set(t: dict) -> set[tuple[str, str]]:
    pairs = set()
    for rnd in t.get("rounds", []):
        for m in rnd["matches"]:
            if m.get("b"):
                a, b = m["a"], m["b"]
                pairs.add((a, b) if a < b else (b, a))
    return pairs

def pair_next(t: dict) -> tuple[int, list[dict]]:
    # Build pool with current points
    standings = compute_standings(t)
    pts_by_id = {r["player_id"]: r["pts"] for r in standings}
    pool = [{"id": p["id"], "name": p["name"], "pts": pts_by_id.get(p["id"], 0)} for p in t["players"]]
    pool.sort(key=lambda x: (-x["pts"], x["name"]))

    prior = prior_pairs_set(t)

    # BYE -> lowest points if odd
    bye = None
    if len(pool) % 2 == 1:
        bye = pool[-1]
        pool = pool[:-1]

    def weight(arr):  # minimize point gap across pairs
        return sum(abs(arr[i]["pts"] - arr[i + 1]["pts"]) for i in range(0, len(arr) - 1, 2))

    def penalty(arr):
        pen = weight(arr)
        for i in range(0, len(arr), 2):
            if i + 1 < len(arr):
                a, b = arr[i]["id"], arr[i + 1]["id"]
                if (a, b) if a < b else (b, a) in prior:
                    pen += 1000  # strong penalty for rematch
        return pen

    best = list(pool)
    min_pen = penalty(pool)
    improved = True
    while improved:
        improved = False
        for _ in range(max(1, len(pool)) * 100):
            random.shuffle(pool)
            sc = penalty(pool)
            if sc < min_pen:
                min_pen = sc
                best = list(pool)
                improved = True
                break

    rnd_no = current_round_number(t) + 1
    matches = []
    table = 1
    for i in range(0, len(best), 2):
        a = best[i]["id"]; b = best[i + 1]["id"]
        matches.append({"id": new_id("m"), "t": table, "a": a, "b": b, "r": "PENDING"})
        table += 1
    if bye:
        matches.append({"id": new_id("m"), "t": table, "a": bye["id"], "b": None, "r": "BYE"})

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

@app.get("/api/tournaments/<tid>/standings")
def api_standings(tid):
    try:
        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404
        return jsonify({"standings": compute_standings(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/pair-next")
def api_pair_next(tid):
    try:
        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404

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
    BYE matches are auto-recorded as "BYE" at pairing time.
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
