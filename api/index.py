# api/index.py
from __future__ import annotations
import os, json, random, uuid, time
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from flask import Flask, request, jsonify

app = Flask(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Vercel KV (Upstash Redis) REST helpers
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
# Tournament model + KTS tie-breakers
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
    return self.wins_excl_bye() + len(self.losses) + len(self.ties)

  def match_points(self) -> int:
    # Win=3, Tie=0, Loss=0; BYE counts as Win for points
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
    aa = p.match_points()
    bbb = max(0, min(999, int(round(opp_win_pct(p), 3) * 1000)))
    acc, nopp = 0.0, 0
    for opp in p.wins + p.losses + p.ties:
      if opp == "BYE":
        continue
      acc += opp_win_pct(opp); nopp += 1
    ccc = max(0, min(999, int(round((acc / nopp) if nopp else 0.0, 3) * 1000)))
    ddd = min(999, sum(r * r for r in p.lost_rounds))
    kts = f"{aa}{str(bbb).zfill(3)}{str(ccc).zfill(3)}{str(ddd).zfill(3)}"

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

# ── Swiss helpers ─────────────────────────────────────────────────────────────

def _standings_maps(t: dict):
  nodes = rebuild_graph(t)
  st = compute_standings(t)
  pts_by_id = {r["player_id"]: r["pts"] for r in st}
  kts_by_id = {r["player_id"]: int(r["kts"]) for r in st}
  id2name = {p["id"]: p["name"] for p in t["players"]}
  return nodes, pts_by_id, kts_by_id, id2name

def _choose_bye_id(t: dict, pts_by_id: dict, kts_by_id: dict, nodes: dict) -> str:
  everyone = [p["id"] for p in t["players"]]
  name_of = {p["id"]: p["name"] for p in t["players"]}
  everyone.sort(key=lambda pid: (
    pts_by_id.get(pid, 0),
    nodes[pid].num_byes(),
    kts_by_id.get(pid, 0),
    name_of[pid]
  ))
  return everyone[0]

def _build_brackets(ids: list[str], pts_by_id: dict, kts_by_id: dict, id2name: dict) -> list[list[str]]:
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
  n = len(order)
  used = [False] * n
  pairs: list[tuple[str, str]] = []
  prior_lookup = {(a, b) if a < b else (b, a) for (a, b) in prior_pairs}

  def bt(start_idx: int) -> bool:
    i = start_idx
    while i < n and used[i]:
      i += 1
    if i >= n:
      return True
    used[i] = True
    for j in range(i + 1, n):
      if used[j]:
        continue
      a, b = order[i], order[j]
      key = (a, b) if a < b else (b, a)
      if key in prior_lookup:
        continue
      used[j] = True
      pairs.append((a, b))
      if bt(i + 1):
        return True
      pairs.pop()
      used[j] = False
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
  pairs: list[tuple[str, str]] = []
  carry_down: list[str] = []

  for bucket in brackets:
    work = (carry_down + bucket) if carry_down else list(bucket)
    if len(work) == 0:
      carry_down = []
      continue
    if len(work) % 2 == 1:
      carry_down = [work.pop()]
    else:
      carry_down = []

    while True:
      res = _pair_within_bracket(work, prior_pairs)
      if res is not None:
        pairs.extend(res)
        break
      if not work:
        break
      carry_down = [work.pop()] + carry_down
      if len(work) % 2 == 1:
        if work:
          carry_down = [work.pop()] + carry_down
  return pairs

def pair_next(t: dict) -> tuple[int, list[dict]]:
  """
  Compute pairings for the next round.

  - Round 1: fully random pairings (including random BYE if odd number of players).
  - Later rounds: Swiss pairings based on standings and KTS, avoiding repeat matchups.
  """
  nodes, pts_by_id, kts_by_id, id2name = _standings_maps(t)
  prior = prior_pairs_set(t)
  curr_round = current_round_number(t)

  # List of all player IDs
  all_ids = [p["id"] for p in t["players"]]

  # ── ROUND 1: PURE RANDOM PAIRINGS ────────────────────────────────────────
  if curr_round == 0:
    random.shuffle(all_ids)

    bye_id: Optional[str] = None
    if len(all_ids) % 2 == 1:
      # Random bye among players (no standings yet)
      bye_id = random.choice(all_ids)
      all_ids = [pid for pid in all_ids if pid != bye_id]

    matches: list[dict] = []
    table = 1
    for i in range(0, len(all_ids), 2):
      a = all_ids[i]
      b = all_ids[i + 1]
      matches.append({
        "id": new_id("m"),
        "t": table,
        "a": a,
        "b": b,
        "r": "PENDING",
      })
      table += 1

    if bye_id:
      matches.append({
        "id": new_id("m"),
        "t": table,
        "a": bye_id,
        "b": None,
        "r": "BYE",
      })

    # First round number is 1
    return 1, matches

  # ── LATER ROUNDS: NORMAL SWISS LOGIC ─────────────────────────────────────
  bye_id: Optional[str] = None
  if len(all_ids) % 2 == 1:
    bye_id = _choose_bye_id(t, pts_by_id, kts_by_id, nodes)
    all_ids = [pid for pid in all_ids if pid != bye_id]

  brackets = _build_brackets(all_ids, pts_by_id, kts_by_id, id2name)
  id_pairs = _pair_brackets(brackets, prior)

  rnd_no = curr_round + 1
  matches: list[dict] = []
  table = 1
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

    initial_info = {
      "id": tid,
      "name": name,
      "total_rounds": total_rounds,
      "round": 0,
      "players": tdoc["players"],
    }
    return jsonify({"tournament_id": tid, "info": initial_info})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>")
def get_tournament(tid):
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    return jsonify({
      "id": tid,
      "name": t["name"],
      "total_rounds": t["total_rounds"],
      "round": current_round_number(t),
      "players": t.get("players", []),
    })
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/edit-result")
def api_edit_result(tid):
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

    if res == "BYE":
      found["b"] = None
      found["r"] = "BYE"
    else:
      if found.get("b") in (None, "BYE"):
        return jsonify({"ok": False, "message": "Cannot set result on BYE match without an opponent."}), 400
      found["r"] = res

    kv_set_json(tid_key(tid), t)

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

@app.post("/api/tournaments/<tid>/edit-pairings")
def api_edit_pairings(tid):
  """
  Admin: overwrite the current round's pairings (structure) before results.
  Body: { "pairs": [ { "table": int, "a_id": "<player-id>", "b_id": "<player-id>|null" }, ... ] }
    - If both a_id and b_id are empty → row ignored.
    - If a_id present, b_id empty → BYE for A.
  """
  try:
    data = request.get_json(force=True) or {}
    pairs = data.get("pairs")
    if not isinstance(pairs, list):
      return jsonify({"error": "pairs list required"}), 400

    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    if not t.get("rounds"):
      return jsonify({"error": "no rounds to edit"}), 400

    last = t["rounds"][-1]
    # Don't allow editing if results already recorded (other than BYEs)
    if any(m.get("r") not in ("PENDING", "BYE") for m in last.get("matches", [])):
      return jsonify({"error": "Round already has finalized results; restart round before editing pairings."}), 400

    valid_ids = {p["id"] for p in t.get("players", []) if "id" in p}
    new_matches = []
    used_ids: set[str] = set()
    table_counter = 1

    for item in pairs:
      if not isinstance(item, dict):
        continue
      a_id = item.get("a_id") or item.get("a")
      b_id = item.get("b_id") or item.get("b")
      if not a_id and not b_id:
        continue
      if not a_id:
        return jsonify({"error": "Each non-empty table must have Player A."}), 400
      if a_id not in valid_ids:
        return jsonify({"error": f"Unknown player id for A: {a_id}"}), 400
      if b_id and b_id not in valid_ids:
        return jsonify({"error": f"Unknown player id for B: {b_id}"}), 400
      if b_id and a_id == b_id:
        return jsonify({"error": "A player cannot be paired against themselves."}), 400
      if a_id in used_ids or (b_id and b_id in used_ids):
        return jsonify({"error": "Each player can only appear in one pairing."}), 400

      used_ids.add(a_id)
      if b_id:
        used_ids.add(b_id)

      table_num = int(item.get("table") or table_counter)
      table_counter += 1

      if b_id:
        new_matches.append({"id": new_id("m"), "t": table_num, "a": a_id, "b": b_id, "r": "PENDING"})
      else:
        new_matches.append({"id": new_id("m"), "t": table_num, "a": a_id, "b": None, "r": "BYE"})

    if not new_matches:
      return jsonify({"error": "No valid pairings provided."}), 400

    new_matches.sort(key=lambda m: m["t"])
    for i, m in enumerate(new_matches, start=1):
      m["t"] = i

    last["matches"] = new_matches
    kv_set_json(tid_key(tid), t)

    return jsonify({"pairs": pairs_for_ui(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/restart-round")
def api_restart_round(tid):
  """
  Recompute pairings for the current round (same round number), before results.
  Uses Swiss algorithm (or random for Round 1) based on standings PRIOR to this round.
  """
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    if not t.get("rounds"):
      return jsonify({"error": "no rounds to restart"}), 400

    rounds = t["rounds"]
    last = rounds[-1]

    if any(m.get("r") not in ("PENDING", "BYE") for m in last.get("matches", [])):
      return jsonify({"error": "Round already has finalized results; cannot restart."}), 400

    # Build a temporary document excluding the current round to recompute pairings
    base = dict(t)
    base["rounds"] = rounds[:-1]

    new_round_no, matches = pair_next(base)
    # Keep the same round index number as last
    last["n"] = last.get("n", new_round_no)
    last["matches"] = matches
    kv_set_json(tid_key(tid), t)

    return jsonify({"ok": True, "round": last["n"], "pairs": pairs_for_ui(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500
