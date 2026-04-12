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

def kv_keys(pattern: str) -> list[str]:
  import requests
  url = f"{_kv_url()}/keys/{pattern}"
  r = requests.get(url, headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
  r.raise_for_status()
  data = r.json()
  return data.get("result", [])

TOURNAMENT_INDEX_KEY = "tournament_index"

# ── Archetype cache (fetched from ygoprodeck, cached in-memory per cold start) ─
_archetype_cache: Optional[List[str]] = None
_archetype_cache_ts: float = 0

def _fetch_archetypes() -> List[str]:
  global _archetype_cache, _archetype_cache_ts
  if _archetype_cache and (time.time() - _archetype_cache_ts < 86400):
    return _archetype_cache
  import requests
  try:
    r = requests.get("https://db.ygoprodeck.com/api/v7/archetypes.php", timeout=10)
    r.raise_for_status()
    data = r.json()
    _archetype_cache = [e["archetype_name"] for e in data]
    _archetype_cache_ts = time.time()
  except Exception:
    if _archetype_cache:
      return _archetype_cache
    _archetype_cache = []
    _archetype_cache_ts = time.time()
  return _archetype_cache

def _detect_archetypes(deck_name: str) -> List[str]:
  """Match a deck name against known archetypes (case-insensitive substring)."""
  if not deck_name:
    return []
  archetypes = _fetch_archetypes()
  name_lower = deck_name.lower()
  found = []
  for arch in archetypes:
    if arch.lower() in name_lower:
      found.append(arch)
  # Remove sub-archetypes that are substrings of longer matched archetypes
  # e.g. if both "A.I." and "A.I. Contact" match, keep both (they're distinct)
  # But avoid duplicates
  return sorted(set(found), key=lambda a: a.lower())

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
  lost_rounds: List[int] = field(default_factory=list)

  def num_byes(self) -> int:
    return sum(1 for w in self.wins if w == "BYE")

  def wins_excl_bye(self) -> int:
    return sum(1 for w in self.wins if w != "BYE")

  def matches_played_excl_bye(self) -> int:
    return self.wins_excl_bye() + len(self.losses)

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
  dropped = set(t.get("dropped", []))
  deck_map = {pl["id"]: pl.get("deck", "") for pl in t.get("players", [])}
  rows = []
  for p in nodes.values():
    aa = p.match_points()
    bbb = max(0, int(round(opp_win_pct(p), 3) * 1000))
    acc, nopp = 0.0, 0
    for opp in p.wins + p.losses:
      if opp == "BYE":
        continue
      acc += opp_win_pct(opp); nopp += 1
    ccc = max(0, int(round((acc / nopp) if nopp else 0.0, 3) * 1000))
    ddd = sum(r * r for r in p.lost_rounds)
    kts = f"{str(aa).zfill(2)}{str(bbb).zfill(4)}{str(ccc).zfill(4)}{str(ddd).zfill(4)}"

    d = p.matches_played_excl_bye()
    mw = (p.wins_excl_bye() / d * 100.0) if d else 0.0
    omw = opp_win_pct(p) * 100.0
    oomw = (acc / nopp * 100.0) if nopp else 0.0

    rows.append({
      "player_id": p.id, "player": p.name, "pts": aa,
      "mw": round(mw, 1), "omw": round(omw, 1), "oomw": round(oomw, 1),
      "ddd": str(ddd).zfill(4), "kts": kts,
      "dropped": p.id in dropped,
      "deck": deck_map.get(p.id, ""),
    })
  rows.sort(key=lambda r: -int(r["kts"]))
  for i, r in enumerate(rows, start=1):
    r["rank"] = i
  return rows

def player_match_history(t: dict, player_id: str) -> list[dict]:
  id2name = {p["id"]: p["name"] for p in t["players"]}
  history = []
  for rnd in t.get("rounds", []):
    for m in rnd["matches"]:
      if m["a"] != player_id and m.get("b") != player_id:
        continue
      r = m["r"]
      if r == "PENDING":
        result = "Pending"
      elif r == "BYE":
        result = "BYE (Win)"
      elif r == "TIE":
        result = "Double Loss"
      elif r == "A":
        result = "Win" if m["a"] == player_id else "Loss"
      elif r == "B":
        result = "Win" if m.get("b") == player_id else "Loss"
      else:
        result = r
      opponent_id = m.get("b") if m["a"] == player_id else m["a"]
      history.append({
        "round": rnd["n"],
        "opponent": id2name.get(opponent_id, "BYE") if opponent_id else "BYE",
        "result": result,
        "match_id": m["id"]
      })
  return history

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

def _pair_within_bracket(order: list[str], prior_pairs: set[tuple[str, str]], allow_rematches: bool = False) -> Optional[list[tuple[str, str]]]:
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
      if not allow_rematches:
        key = (a, b) if a < b else (b, a)
        if key in prior_lookup:
          continue
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

  # If carry_down still has unpaired players after all brackets, we must allow
  # rematches as a last resort (e.g. 4 players, 4+ rounds — rematches are inevitable)
  if carry_down:
    all_remaining = carry_down
    res = _pair_within_bracket(all_remaining, prior_pairs, allow_rematches=True)
    if res:
      pairs.extend(res)

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

  dropped = set(t.get("dropped", []))
  # List of active (non-dropped) player IDs
  all_ids = [p["id"] for p in t["players"] if p["id"] not in dropped]

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
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tdoc = {
      "name": name,
      "total_rounds": total_rounds,
      "players": [{"id": new_id("p"), "name": n} for n in players],
      "rounds": [],
      "created_at": created_at,
    }
    kv_set_json(tid_key(tid), tdoc)

    # Update tournament index
    idx = kv_get_json(TOURNAMENT_INDEX_KEY) or []
    idx.append({"id": tid, "name": name, "created_at": created_at, "player_count": len(players)})
    kv_set_json(TOURNAMENT_INDEX_KEY, idx)

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
      "dropped": t.get("dropped", []),
    })
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/edit-result")
def api_edit_result(tid):
  try:
    body = request.get_json(silent=True) or {}
    mid = body.get("match_id")
    res = body.get("result")
    if not mid or res not in {"A", "B", "TIE", "PENDING", "BYE"}:
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

@app.post("/api/tournaments/<tid>/drop-player")
def api_drop_player(tid):
  try:
    body = request.get_json(force=True) or {}
    pid = body.get("player_id")
    if not pid:
      return jsonify({"error": "player_id required"}), 400

    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404

    valid_ids = {p["id"] for p in t.get("players", [])}
    if pid not in valid_ids:
      return jsonify({"error": "Unknown player_id"}), 400

    dropped = t.get("dropped", [])
    if pid in dropped:
      return jsonify({"ok": True, "message": "Player already dropped."})

    dropped.append(pid)
    t["dropped"] = dropped
    kv_set_json(tid_key(tid), t)

    name = next((p["name"] for p in t["players"] if p["id"] == pid), pid)
    return jsonify({"ok": True, "message": f"{name} has been dropped.", "standings": compute_standings(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/undrop-player")
def api_undrop_player(tid):
  try:
    body = request.get_json(force=True) or {}
    pid = body.get("player_id")
    if not pid:
      return jsonify({"error": "player_id required"}), 400

    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404

    dropped = t.get("dropped", [])
    if pid not in dropped:
      return jsonify({"ok": True, "message": "Player is not dropped."})

    dropped.remove(pid)
    t["dropped"] = dropped
    kv_set_json(tid_key(tid), t)

    name = next((p["name"] for p in t["players"] if p["id"] == pid), pid)
    return jsonify({"ok": True, "message": f"{name} has been reinstated.", "standings": compute_standings(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/undo-finalize")
def api_undo_finalize(tid):
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    if not t.get("rounds"):
      return jsonify({"error": "No rounds to undo."}), 400

    last = t["rounds"][-1]
    # Check that the round IS finalized (has non-PENDING/BYE results)
    has_results = any(m.get("r") not in ("PENDING", "BYE") for m in last.get("matches", []))
    if not has_results:
      return jsonify({"error": "Current round is not finalized yet."}), 400

    # Reset all non-BYE matches back to PENDING
    for m in last["matches"]:
      if m.get("r") not in ("BYE",):
        m["r"] = "PENDING"

    kv_set_json(tid_key(tid), t)
    return jsonify({"ok": True, "round": last["n"], "pairs": pairs_for_ui(t), "standings": compute_standings(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>/player-history/<pid>")
def api_player_history(tid, pid):
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    valid_ids = {p["id"] for p in t.get("players", [])}
    if pid not in valid_ids:
      return jsonify({"error": "Unknown player_id"}), 400
    name = next((p["name"] for p in t["players"] if p["id"] == pid), pid)
    return jsonify({"player": name, "history": player_match_history(t, pid)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Tournament history ───────────────────────────────────────────────────────

def _rebuild_tournament_index() -> list[dict]:
  """Scan all t_* keys in KV and rebuild the tournament index."""
  keys = kv_keys("t_*")
  idx = []
  for key in keys:
    if key in ("tournament_index", "health_probe"):
      continue
    tid = key[2:]  # strip "t_" prefix
    t = kv_get_json(key)
    if not t or not isinstance(t, dict) or "players" not in t:
      continue
    idx.append({
      "id": tid,
      "name": t.get("name", "Unknown"),
      "created_at": t.get("created_at", ""),
      "player_count": len(t.get("players", [])),
    })
  idx.sort(key=lambda x: x.get("created_at", ""), reverse=True)
  kv_set_json(TOURNAMENT_INDEX_KEY, idx)
  return idx

@app.get("/api/tournament-history")
def api_tournament_history():
  try:
    idx = _rebuild_tournament_index()
    return jsonify({"tournaments": idx})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.delete("/api/tournaments/<tid>")
def api_delete_tournament(tid):
  try:
    import requests as req
    # Delete the tournament doc
    url = f"{_kv_url()}/del/{tid_key(tid)}"
    req.post(url, headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)

    # Remove from index
    idx = kv_get_json(TOURNAMENT_INDEX_KEY) or []
    idx = [e for e in idx if e.get("id") != tid]
    kv_set_json(TOURNAMENT_INDEX_KEY, idx)

    return jsonify({"ok": True})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Archetype list endpoint ──────────────────────────────────────────────────

@app.get("/api/archetypes")
def api_archetypes():
  try:
    q = (request.args.get("q") or "").strip().lower()
    archetypes = _fetch_archetypes()
    if q:
      archetypes = [a for a in archetypes if q in a.lower()]
    return jsonify({"archetypes": archetypes[:50]})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.get("/api/detect-archetypes")
def api_detect_archetypes():
  try:
    deck = (request.args.get("deck") or "").strip()
    detected = _detect_archetypes(deck)
    return jsonify({"archetypes": detected})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Deck archetype tagging ───────────────────────────────────────────────────

@app.post("/api/tournaments/<tid>/set-deck")
def api_set_deck(tid):
  try:
    body = request.get_json(force=True) or {}
    pid = body.get("player_id")
    deck = (body.get("deck") or "").strip()
    archetypes = body.get("archetypes")  # optional override
    if not pid:
      return jsonify({"error": "player_id required"}), 400

    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404

    # Auto-detect archetypes if not explicitly provided
    if archetypes is None:
      archetypes = _detect_archetypes(deck) if deck else []

    found = False
    for p in t["players"]:
      if p["id"] == pid:
        p["deck"] = deck
        p["archetypes"] = archetypes
        found = True
        break
    if not found:
      return jsonify({"error": "Unknown player_id"}), 400

    kv_set_json(tid_key(tid), t)
    return jsonify({"ok": True, "archetypes": archetypes})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Metagame breakdown ───────────────────────────────────────────────────────

@app.get("/api/tournaments/<tid>/metagame")
def api_metagame(tid):
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404

    nodes = rebuild_graph(t)
    arch_stats: Dict[str, dict] = {}
    total_entries = 0

    for p in t["players"]:
      archetypes = p.get("archetypes") or []
      deck = p.get("deck") or ""
      # Fallback: if no archetypes list, use full deck name
      if not archetypes:
        archetypes = [deck] if deck else ["Unknown"]
      node = nodes.get(p["id"])
      pw = node.wins_excl_bye() if node else 0
      pl = len(node.losses) if node else 0
      for arch in archetypes:
        if arch not in arch_stats:
          arch_stats[arch] = {"count": 0, "wins": 0, "losses": 0}
        arch_stats[arch]["count"] += 1
        arch_stats[arch]["wins"] += pw
        arch_stats[arch]["losses"] += pl
        total_entries += 1

    result = []
    for arch, stats in sorted(arch_stats.items(), key=lambda x: -x[1]["count"]):
      total_matches = stats["wins"] + stats["losses"]
      result.append({
        "archetype": arch,
        "count": stats["count"],
        "share": round(stats["count"] / total_entries * 100, 1) if total_entries else 0,
        "wins": stats["wins"],
        "losses": stats["losses"],
        "win_rate": round(stats["wins"] / total_matches * 100, 1) if total_matches else 0,
      })

    return jsonify({"metagame": result, "total_players": len(t["players"])})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Cross-tournament player stats ────────────────────────────────────────────

@app.get("/api/player-stats")
def api_player_stats():
  try:
    player_name = request.args.get("name", "").strip()
    if not player_name:
      return jsonify({"error": "name query param required"}), 400

    idx = kv_get_json(TOURNAMENT_INDEX_KEY) or []
    stats = {
      "name": player_name,
      "tournaments": 0,
      "total_wins": 0,
      "total_losses": 0,
      "total_byes": 0,
      "avg_omw": 0.0,
      "tournament_results": [],
    }
    omw_sum = 0.0
    omw_count = 0

    for entry in idx:
      t = kv_get_json(tid_key(entry["id"]))
      if not t:
        continue
      pid = None
      for p in t.get("players", []):
        if p["name"].lower() == player_name.lower():
          pid = p["id"]
          break
      if not pid:
        continue

      nodes = rebuild_graph(t)
      node = nodes.get(pid)
      if not node:
        continue

      stats["tournaments"] += 1
      w = node.wins_excl_bye()
      l = len(node.losses)
      b = node.num_byes()
      stats["total_wins"] += w
      stats["total_losses"] += l
      stats["total_byes"] += b

      omw = opp_win_pct(node) * 100.0
      omw_sum += omw
      omw_count += 1

      st = compute_standings(t)
      rank = next((r["rank"] for r in st if r["player_id"] == pid), None)

      stats["tournament_results"].append({
        "tournament_id": entry["id"],
        "tournament_name": entry.get("name", "?"),
        "date": entry.get("created_at", ""),
        "wins": w,
        "losses": l,
        "rank": rank,
        "total_players": len(t.get("players", [])),
      })

    total_matches = stats["total_wins"] + stats["total_losses"]
    stats["win_rate"] = round(stats["total_wins"] / total_matches * 100, 1) if total_matches else 0
    stats["avg_omw"] = round(omw_sum / omw_count, 1) if omw_count else 0
    stats["tournament_results"].sort(key=lambda x: x.get("date", ""), reverse=True)

    return jsonify(stats)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Admin auth ───────────────────────────────────────────────────────────────

@app.post("/api/admin/auth")
def api_admin_auth():
  try:
    body = request.get_json(force=True) or {}
    password = body.get("password", "")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_pw:
      return jsonify({"ok": False, "message": "ADMIN_PASSWORD not configured on server."}), 500
    if password == admin_pw:
      return jsonify({"ok": True})
    return jsonify({"ok": False, "message": "Incorrect password."}), 401
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── All-player leaderboard ───────────────────────────────────────────────────

@app.get("/api/all-player-stats")
def api_all_player_stats():
  try:
    idx = _rebuild_tournament_index()
    # Aggregate stats per unique player name (case-insensitive)
    player_map: Dict[str, dict] = {}

    for entry in idx:
      t = kv_get_json(tid_key(entry["id"]))
      if not t:
        continue
      nodes = rebuild_graph(t)

      for p in t.get("players", []):
        node = nodes.get(p["id"])
        if not node:
          continue
        name_key = p["name"].strip().lower()
        display_name = p["name"].strip()
        if name_key not in player_map:
          player_map[name_key] = {
            "name": display_name,
            "tournaments": 0,
            "wins": 0,
            "losses": 0,
            "byes": 0,
            "omw_sum": 0.0,
            "omw_count": 0,
          }
        s = player_map[name_key]
        s["tournaments"] += 1
        s["wins"] += node.wins_excl_bye()
        s["losses"] += len(node.losses)
        s["byes"] += node.num_byes()
        omw = opp_win_pct(node) * 100.0
        s["omw_sum"] += omw
        s["omw_count"] += 1

    result = []
    for s in player_map.values():
      total = s["wins"] + s["losses"]
      result.append({
        "name": s["name"],
        "tournaments": s["tournaments"],
        "wins": s["wins"],
        "losses": s["losses"],
        "win_rate": round(s["wins"] / total * 100, 1) if total else 0,
        "avg_omw": round(s["omw_sum"] / s["omw_count"], 1) if s["omw_count"] else 0,
      })

    result.sort(key=lambda x: (-x["wins"], -x["win_rate"], x["name"]))
    return jsonify({"players": result})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Global metagame across all tournaments ───────────────────────────────────

@app.get("/api/global-metagame")
def api_global_metagame():
  try:
    idx = _rebuild_tournament_index()
    arch_stats: Dict[str, dict] = {}
    total_entries = 0

    for entry in idx:
      t = kv_get_json(tid_key(entry["id"]))
      if not t:
        continue
      nodes = rebuild_graph(t)
      for p in t.get("players", []):
        archetypes = p.get("archetypes") or []
        deck = p.get("deck") or ""
        if not archetypes and not deck:
          continue
        if not archetypes:
          archetypes = [deck]
        node = nodes.get(p["id"])
        pw = node.wins_excl_bye() if node else 0
        pl = len(node.losses) if node else 0
        for arch in archetypes:
          if arch not in arch_stats:
            arch_stats[arch] = {"count": 0, "wins": 0, "losses": 0}
          arch_stats[arch]["count"] += 1
          arch_stats[arch]["wins"] += pw
          arch_stats[arch]["losses"] += pl
          total_entries += 1

    result = []
    for arch, stats in sorted(arch_stats.items(), key=lambda x: -x[1]["count"]):
      total_matches = stats["wins"] + stats["losses"]
      result.append({
        "archetype": arch,
        "count": stats["count"],
        "share": round(stats["count"] / total_entries * 100, 1) if total_entries else 0,
        "wins": stats["wins"],
        "losses": stats["losses"],
        "win_rate": round(stats["wins"] / total_matches * 100, 1) if total_matches else 0,
      })

    return jsonify({"metagame": result, "total_entries": total_entries})
  except Exception as e:
    return jsonify({"error": str(e)}), 500
