# api/index.py
from __future__ import annotations
import os, json, random, uuid, time
from dataclasses import dataclass, field
from typing import List, Optional, Dict

from flask import Flask, request, jsonify

app = Flask(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Edge Config env (lazy-validated) + helpers
# ──────────────────────────────────────────────────────────────────────────────

EDGE_CONFIG_CONN = os.environ.get("EDGE_CONFIG")            # https://edge-config.vercel.com/<id>?token=<read_token>
VERCEL_ACCESS_TOKEN = os.environ.get("VERCEL_ACCESS_TOKEN") # required for writes
VERCEL_TEAM_ID = os.environ.get("VERCEL_TEAM_ID")           # optional (team-scoped EC)

EC_ID: Optional[str] = None
EC_READ_TOKEN: Optional[str] = None

def _parse_edge_config(conn: str) -> tuple[str, str]:
    from urllib.parse import urlparse, parse_qs
    u = urlparse(conn)
    ec_id = u.path.strip("/").split("/")[0]
    token = parse_qs(u.query).get("token", [None])[0]
    if not (ec_id and token):
        raise RuntimeError("EDGE_CONFIG is malformed; expected https://edge-config.vercel.com/<id>?token=<read_token>")
    return ec_id, token

def _ensure_edge_ids():
    global EC_ID, EC_READ_TOKEN
    if EC_ID and EC_READ_TOKEN:
        return
    if not EDGE_CONFIG_CONN:
        raise RuntimeError("EDGE_CONFIG env var is missing.")
    EC_ID, EC_READ_TOKEN = _parse_edge_config(EDGE_CONFIG_CONN)

def ec_read_item(key: str):
    _ensure_edge_ids()
    import requests
    url = f"https://edge-config.vercel.com/{EC_ID}/item/{key}"
    r = requests.get(url, headers={"Authorization": f"Bearer {EC_READ_TOKEN}"}, timeout=10)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json().get("value")

def ec_patch_items(items: list[dict]) -> None:
    _ensure_edge_ids()
    if not VERCEL_ACCESS_TOKEN:
        raise RuntimeError("VERCEL_ACCESS_TOKEN env var is missing (Edge Config writes require it).")
    import requests
    url = f"https://api.vercel.com/v1/edge-config/{EC_ID}/items"
    if VERCEL_TEAM_ID:
        url += f"?teamId={VERCEL_TEAM_ID}"
    r = requests.patch(
        url,
        headers={"Authorization": f"Bearer {VERCEL_ACCESS_TOKEN}", "Content-Type": "application/json"},
        data=json.dumps({"items": items}),
        timeout=15,
    )
    # Surface the exact error body (403, 401, etc.)
    if r.status_code >= 400:
        # Try to include API error JSON if present
        try:
            body = r.json()
        except Exception:
            body = r.text
        raise RuntimeError(f"Edge Config write failed ({r.status_code}): {body}")

# ──────────────────────────────────────────────────────────────────────────────
# Compact tournament doc (Edge Config size friendly)
# ──────────────────────────────────────────────────────────────────────────────

def tid_key(tid: str) -> str: return f"t_{tid}"
def new_id(prefix: str) -> str: return f"{prefix}_{uuid.uuid4().hex[:10]}"

@dataclass
class Node:
    id: str
    name: str
    wins: List[object] = field(default_factory=list)    # Node or "BYE"
    losses: List[object] = field(default_factory=list)  # Node
    ties: List[object] = field(default_factory=list)
    lost_rounds: List[int] = field(default_factory=list)
    def num_byes(self) -> int: return sum(1 for w in self.wins if w == "BYE")
    def wins_excl_bye(self) -> int: return sum(1 for w in self.wins if w != "BYE")
    def matches_played_excl_bye(self) -> int: return self.wins_excl_bye() + len(self.losses) + len(self.ties)
    def match_points(self) -> int: return 3 * len(self.wins)  # Win=3, Tie=0, Loss=0
    def match_win_pct(self) -> float:
        d = self.matches_played_excl_bye()
        return (self.wins_excl_bye()/d) if d else 0.0

def rebuild_graph(t: dict) -> Dict[str, Node]:
    players = {p["id"]: Node(id=p["id"], name=p["name"]) for p in t["players"]}
    for rnd in t.get("rounds", []):
        n = rnd["n"]
        for m in rnd["matches"]:
            a = players[m["a"]]
            b = players[m["b"]] if m.get("b") else None
            r = m["r"]
            if r == "PENDING": continue
            if r == "BYE":
                a.wins.append("BYE"); continue
            if not b: continue
            if r == "A":
                a.wins.append(b); b.losses.append(a); b.lost_rounds.append(n)
            elif r == "B":
                b.wins.append(a); a.losses.append(b); a.lost_rounds.append(n)
            elif r == "TIE":
                a.losses.append(b); b.losses.append(a)
                a.lost_rounds.append(n); b.lost_rounds.append(n)
    return players

def opp_win_pct(p: Node) -> float:
    tot, num = 0.0, 0
    for opp in p.wins + p.losses:
        if opp == "BYE": continue
        tot += opp.match_win_pct(); num += 1
    return tot/num if num else 0.0

def compute_standings(t: dict):
    nodes = rebuild_graph(t)
    rows = []
    for p in nodes.values():
        aa = p.match_points()
        bbb = max(0, min(999, int(round(opp_win_pct(p), 3) * 1000)))
        acc, nopp = 0.0, 0
        for opp in p.wins + p.losses:
            if opp == "BYE": continue
            acc += opp_win_pct(opp); nopp += 1
        ccc = max(0, min(999, int(round((acc/nopp) if nopp else 0.0, 3) * 1000)))
        ddd = min(999, sum(r*r for r in p.lost_rounds))
        kts = f"{aa}{str(bbb).zfill(3)}{str(ccc).zfill(3)}{str(ddd).zfill(3)}"
        denom = p.matches_played_excl_bye()
        mw = (p.wins_excl_bye()/denom*100.0) if denom else 0.0
        omw = opp_win_pct(p)*100.0
        oomw = (acc/nopp*100.0) if nopp else 0.0
        rows.append({"player_id": p.id, "player": p.name, "pts": aa,
                     "mw": round(mw,1), "omw": round(omw,1), "oomw": round(oomw,1),
                     "ddd": str(ddd).zfill(3), "kts": kts})
    rows.sort(key=lambda r: -int(r["kts"]))
    for i, r in enumerate(rows, start=1): r["rank"] = i
    return rows

def current_round_number(t: dict) -> int:
    return max([r["n"] for r in t.get("rounds", [])], default=0)

def prior_pairs_set(t: dict) -> set[tuple[str,str]]:
    pairs = set()
    for rnd in t.get("rounds", []):
        for m in rnd["matches"]:
            if m.get("b"):
                a, b = m["a"], m["b"]
                pairs.add((a,b) if a<b else (b,a))
    return pairs

def pair_next(t: dict) -> tuple[int, list[dict]]:
    standings = compute_standings(t)
    pts_by_id = {r["player_id"]: r["pts"] for r in standings}
    pool = [{"id": p["id"], "name": p["name"], "pts": pts_by_id.get(p["id"], 0)} for p in t["players"]]
    pool.sort(key=lambda x: (-x["pts"], x["name"]))
    prior = prior_pairs_set(t)
    bye = None
    if len(pool) % 2 == 1:
        bye = pool[-1]; pool = pool[:-1]
    def weight(arr): return sum(abs(arr[i]["pts"] - arr[i+1]["pts"]) for i in range(0, len(arr)-1, 2))
    def penalty(arr):
        pen = weight(arr)
        for i in range(0, len(arr), 2):
            if i+1 < len(arr):
                a, b = arr[i]["id"], arr[i+1]["id"]
                if (a,b) if a<b else (b,a) in prior: pen += 1000
        return pen
    best = list(pool); min_pen = penalty(pool); improved = True
    while improved:
        improved = False
        for _ in range(max(1, len(pool))*100):
            random.shuffle(pool)
            sc = penalty(pool)
            if sc < min_pen:
                min_pen = sc; best = list(pool); improved = True; break
    rnd_no = current_round_number(t) + 1
    matches, table = [], 1
    for i in range(0, len(best), 2):
        a = best[i]["id"]; b = best[i+1]["id"]
        matches.append({"id": new_id("m"), "t": table, "a": a, "b": b, "r": "PENDING"}); table += 1
    if bye:
        matches.append({"id": new_id("m"), "t": table, "a": bye["id"], "b": None, "r": "BYE"})
    return rnd_no, matches

# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    """Read/write probe (does a tiny upsert+read)."""
    try:
        _ensure_edge_ids()
        key = "health_probe"
        payload = {"ts": time.time()}
        ec_patch_items([{"operation": "upsert", "key": key, "value": payload}])
        val = ec_read_item(key)
        return jsonify({"ok": True, "edge_config_id": EC_ID, "read_back": val})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/api/debug/env")
def debug_env():
    """Safe env presence check (does not leak tokens)."""
    try:
        present = {
            "EDGE_CONFIG_present": bool(EDGE_CONFIG_CONN),
            "VERCEL_ACCESS_TOKEN_present": bool(VERCEL_ACCESS_TOKEN),
            "VERCEL_TEAM_ID_present": bool(VERCEL_TEAM_ID),
        }
        # if EDGE_CONFIG present, show derived id prefix (non-secret)
        if EDGE_CONFIG_CONN:
            try:
                ec_id, _ = _parse_edge_config(EDGE_CONFIG_CONN)
                present["edge_config_id_prefix"] = ec_id[:8] + "…"
            except Exception as e:
                present["edge_config_parse_error"] = str(e)
        return jsonify(present)
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
        ec_patch_items([{"operation": "upsert", "key": tid_key(tid), "value": tdoc}])

        # NEW: return initial info so the UI can enable the Pair button immediately
        initial_info = {"id": tid, "name": name, "total_rounds": total_rounds, "round": 0}
        return jsonify({"tournament_id": tid, "info": initial_info})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/tournaments/<tid>")
def get_tournament(tid):
    try:
        t = ec_read_item(tid_key(tid))
        if not t: return jsonify({"error":"not found"}), 404
        return jsonify({"id": tid, "name": t["name"], "total_rounds": t["total_rounds"], "round": current_round_number(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>/standings")
def api_standings(tid):
    try:
        t = ec_read_item(tid_key(tid))
        if not t: return jsonify({"error":"not found"}), 404
        return jsonify({"standings": compute_standings(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/pair-next")
def api_pair_next(tid):
    try:
        t = ec_read_item(tid_key(tid))
        if not t: return jsonify({"error":"not found"}), 404
        curr = current_round_number(t)
        if curr >= int(t["total_rounds"]):
            return jsonify({"ok": False, "message": "All rounds completed.", "round": curr})
        rnd_no, matches = pair_next(t)
        t["rounds"].append({"n": rnd_no, "matches": matches})
        ec_patch_items([{"operation": "upsert", "key": tid_key(tid), "value": t}])
        id2name = {p["id"]: p["name"] for p in t["players"]}
        pairs = [{"table": m["t"], "a": id2name[m["a"]], "b": (id2name.get(m["b"]) if m.get("b") else "BYE"), "match_id": m["id"]} for m in matches]
        return jsonify({"ok": True, "round": rnd_no, "pairs": pairs})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/finalize-round")
def api_finalize_round(tid):
    try:
        data = request.get_json(force=True)
        results = data.get("results") or []
        if not isinstance(results, list) or not results:
            return jsonify({"error": "results array required"}), 400
        t = ec_read_item(tid_key(tid))
        if not t: return jsonify({"error":"not found"}), 404
        if not t.get("rounds"): return jsonify({"error":"no rounds to finalize"}), 400
        last = t["rounds"][-1]
        by_id = {m["id"]: m for m in last["matches"]}
        for r in results:
            mid = r.get("match_id"); out = r.get("outcome")
            if mid in by_id and out in ("A","B","TIE"): by_id[mid]["r"] = out
        ec_patch_items([{"operation": "upsert", "key": tid_key(tid), "value": t}])
        return jsonify({"ok": True, "standings": compute_standings(t)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
