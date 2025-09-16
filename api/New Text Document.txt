# Flask API using Vercel Edge Config for storage
from __future__ import annotations
import os, json, random, uuid
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from urllib.parse import urlparse, parse_qs

import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# --- Edge Config config -------------------------------------------------------
# Create an Edge Config in the Vercel dashboard. When you do, Vercel creates
# an EDGE_CONFIG connection string env var like:
#   https://edge-config.vercel.com/<EDGE_CONFIG_ID>?token=<READ_TOKEN>
#
# For WRITES we must use the Vercel REST API with a Vercel Access Token.
#   https://api.vercel.com/v1/edge-config/<EDGE_CONFIG_ID>/items
# Docs: Managing with REST API; SDK is read-only.  :contentReference[oaicite:1]{index=1}

EDGE_CONFIG_CONN = os.environ.get("EDGE_CONFIG")  # connection string (read)
VERCEL_ACCESS_TOKEN = os.environ.get("VERCEL_ACCESS_TOKEN")  # for writes
VERCEL_TEAM_ID = os.environ.get("VERCEL_TEAM_ID")  # optional (?teamId=)

if not EDGE_CONFIG_CONN:
    raise RuntimeError("Set EDGE_CONFIG connection string in env.")
if not VERCEL_ACCESS_TOKEN:
    raise RuntimeError("Set VERCEL_ACCESS_TOKEN in env to allow writes to Edge Config.")

def _parse_edge_config(conn: str) -> tuple[str, str]:
    u = urlparse(conn)
    # expected: https://edge-config.vercel.com/<id>?token=<token>
    ec_id = u.path.strip("/").split("/")[0]
    token = parse_qs(u.query).get("token", [None])[0]
    if not (ec_id and token):
        raise RuntimeError("EDGE_CONFIG is malformed; needs id and token.")
    return ec_id, token

EC_ID, EC_READ_TOKEN = _parse_edge_config(EDGE_CONFIG_CONN)

def ec_read_item(key: str) -> Optional[dict]:
    # Edge reads via the edge-config endpoint (fast path).  :contentReference[oaicite:2]{index=2}
    url = f"https://edge-config.vercel.com/{EC_ID}/item/{key}"
    r = requests.get(url, headers={"Authorization": f"Bearer {EC_READ_TOKEN}"}, timeout=10)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json().get("value")  # {"value": ...}

def ec_patch_items(items: list[dict]) -> None:
    # Writes via REST API; supports create/update/upsert/delete.  :contentReference[oaicite:3]{index=3}
    url = f"https://api.vercel.com/v1/edge-config/{EC_ID}/items"
    if VERCEL_TEAM_ID:
        url += f"?teamId={VERCEL_TEAM_ID}"
    body = {"items": items}
    r = requests.patch(
        url,
        headers={
            "Authorization": f"Bearer {VERCEL_ACCESS_TOKEN}",
            "Content-Type": "application/json",
        },
        data=json.dumps(body),
        timeout=15,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Edge Config write failed: {r.text}")

# --- Minimal tournament model in JSON (compact to fit store size) -------------
# Key per tournament:  t_<tournament_id>
# Value: {
#   "name": str,
#   "total_rounds": int,
#   "players": [{"id": "p_x", "name": "Alice"}, ...],
#   "rounds": [
#      {"n": 1, "matches":[{"id":"m_x","t":1,"a":"p_x","b":"p_y","r":"PENDING"|"A"|"B"|"TIE"|"BYE"}]},
#      ...
#   ]
# }

def tid_key(tid: str) -> str: return f"t_{tid}"

def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

# --- KTS math helpers (in-memory, rebuilt each request) -----------------------
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
        bbb = int(round(opp_win_pct(p), 3) * 1000); bbb = max(0, min(999, bbb))
        acc, nopp = 0.0, 0
        for opp in p.wins + p.losses:
            if opp == "BYE": continue
            acc += opp_win_pct(opp); nopp += 1
        ccc = int(round((acc/nopp) if nopp else 0.0, 3) * 1000); ccc = max(0, min(999, ccc))
        ddd = min(999, sum(r*r for r in p.lost_rounds))
        kts = f"{aa}{str(bbb).zfill(3)}{str(ccc).zfill(3)}{str(ddd).zfill(3)}"
        denom = p.matches_played_excl_bye()
        mw = (p.wins_excl_bye()/denom*100.0) if denom else 0.0
        omw = opp_win_pct(p)*100.0
        oomw = (acc/nopp*100.0) if nopp else 0.0
        rows.append({
            "player_id": p.id, "player": p.name, "pts": aa,
            "mw": round(mw,1), "omw": round(omw,1), "oomw": round(oomw,1),
            "ddd": str(ddd).zfill(3), "kts": kts
        })
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
                pairs.add((a,b) if a < b else (b,a))
    return pairs

# --- API endpoints ------------------------------------------------------------

@app.post("/api/tournaments")
def create_tournament():
    data = request.get_json(force=True)
    name = (data.get("name") or "Tournament").strip()
    total_rounds = int(data.get("total_rounds") or 4)
    players = [p.strip() for p in (data.get("players") or []) if p.strip()]
    if not players:
        return jsonify({"error":"players list is required"}), 400

    tid = uuid.uuid4().hex[:10]
    tdoc = {
        "name": name,
        "total_rounds": total_rounds,
        "players": [{"id": new_id("p"), "name": n} for n in players],
        "rounds": []
    }
    # Store as one upsert (keep values compact to fit limits).  :contentReference[oaicite:4]{index=4}
    ec_patch_items([{"operation":"upsert","key": tid_key(tid), "value": tdoc}])
    return jsonify({"tournament_id": tid})

@app.get("/api/tournaments/<tid>")
def get_tournament(tid):
    t = ec_read_item(tid_key(tid))
    if not t: return jsonify({"error":"not found"}), 404
    return jsonify({
        "id": tid,
        "name": t["name"],
        "total_rounds": t["total_rounds"],
        "round": current_round_number(t)
    })

@app.get("/api/tournaments/<tid>/standings")
def api_standings(tid):
    t = ec_read_item(tid_key(tid))
    if not t: return jsonify({"error":"not found"}), 404
    return jsonify({"standings": compute_standings(t)})

@app.post("/api/tournaments/<tid>/pair-next")
def api_pair_next(tid):
    t = ec_read_item(tid_key(tid))
    if not t: return jsonify({"error":"not found"}), 404
    curr = current_round_number(t)
    if curr >= int(t["total_rounds"]):
        return jsonify({"ok": False, "message": "All rounds completed.", "round": curr})

    # build point map for sorting
    standings = compute_standings(t)
    pts_by_id = {r["player_id"]: r["pts"] for r in standings}
    pool = [{"id": p["id"], "name": p["name"], "pts": pts_by_id.get(p["id"], 0)}
            for p in t["players"]]
    pool.sort(key=lambda x: (-x["pts"], x["name"]))

    prior = prior_pairs_set(t)

    # BYE to lowest points
    bye = None
    if len(pool) % 2 == 1:
        bye = pool[-1]
        pool = pool[:-1]

    def weight(arr): return sum(abs(arr[i]["pts"] - arr[i+1]["pts"]) for i in range(0, len(arr)-1, 2))
    def penalty(arr):
        pen = weight(arr)
        for i in range(0, len(arr), 2):
            if i+1 < len(arr):
                a, b = arr[i]["id"], arr[i+1]["id"]
                pair = (a,b) if a<b else (b,a)
                if pair in prior: pen += 1000
        return pen

    best = list(pool)
    min_pen = penalty(pool)
    improved = True
    while improved:
        improved = False
        for _ in range(max(1, len(pool))*100):
            random.shuffle(pool)
            sc = penalty(pool)
            if sc < min_pen:
                min_pen = sc; best = list(pool); improved = True; break

    rnd_no = curr + 1
    matches = []
    table = 1
    for i in range(0, len(best), 2):
        a = best[i]["id"]; b = best[i+1]["id"]
        matches.append({"id": new_id("m"), "t": table, "a": a, "b": b, "r": "PENDING"})
        table += 1
    if bye:
        matches.append({"id": new_id("m"), "t": table, "a": bye["id"], "b": None, "r": "BYE"})

    # persist new round
    t["rounds"].append({"n": rnd_no, "matches": matches})
    ec_patch_items([{"operation":"upsert","key": tid_key(tid), "value": t}])  # write
    # return pairs with names
    id2name = {p["id"]: p["name"] for p in t["players"]}
    pairs = [{"table": m["t"], "a": id2name[m["a"]], "b": (id2name.get(m["b"]) if m.get("b") else "BYE"),
              "match_id": m["id"]} for m in matches]
    return jsonify({"ok": True, "round": rnd_no, "pairs": pairs})

@app.post("/api/tournaments/<tid>/finalize-round")
def api_finalize_round(tid):
    """
    Body: { results: [{match_id, outcome}] } where outcome in ['A','B','TIE']
    """
    data = request.get_json(force=True)
    results = data.get("results") or []
    if not isinstance(results, list) or not results:
        return jsonify({"error": "results array required"}), 400

    t = ec_read_item(tid_key(tid))
    if not t: return jsonify({"error":"not found"}), 404

    # update last round's matches
    if not t.get("rounds"):
        return jsonify({"error":"no rounds to finalize"}), 400
    last = t["rounds"][-1]
    by_id = {m["id"]: m for m in last["matches"]}
    for r in results:
        mid = r.get("match_id"); out = r.get("outcome")
        if mid in by_id and out in ("A","B","TIE"):
            by_id[mid]["r"] = out

    ec_patch_items([{"operation":"upsert","key": tid_key(tid), "value": t}])  # write
    standings = compute_standings(t)  # compute from just-written doc
    return jsonify({"ok": True, "standings": standings})
