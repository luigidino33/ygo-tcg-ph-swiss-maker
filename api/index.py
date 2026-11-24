# api/index.py
from __future__ import annotations
import os, sys, re, json, random, uuid, time, hashlib, secrets
from dataclasses import dataclass, field
from typing import List, Optional, Dict
import hmac
from functools import wraps
from flask import Flask, request, jsonify, Response, g

app = Flask(__name__)

def _admin_ok() -> bool:
  admin_pw = os.environ.get("ADMIN_PASSWORD", "")
  given = request.headers.get("X-Admin-Password", "")
  return bool(admin_pw) and hmac.compare_digest(admin_pw.encode(), given.encode())

def admin_required(fn):
  @wraps(fn)
  def wrapper(*args, **kwargs):
    if not _admin_ok():
      return jsonify({"error": "Admin password required."}), 401
    return fn(*args, **kwargs)
  return wrapper

# ── Player accounts ──────────────────────────────────────────────────────────
# Username + password accounts that own a player name. Ownership is global and
# derived from the name, so it also covers tournaments created before the account.

USERNAME_RE = re.compile(r"^[a-z0-9_-]{3,20}$")
SESSION_COOKIE = "ygo_session"
SESSION_TTL = 30 * 86400
LOGIN_MAX_FAILS = 10
LOGIN_LOCK_SECONDS = 15 * 60

def user_key(username: str) -> str:
  return f"user_{username}"

def claim_key(player_name: str) -> str:
  # Hashed: player names can contain characters that aren't safe in KV REST paths.
  return "claim_" + hashlib.sha256(" ".join(player_name.split()).lower().encode()).hexdigest()[:32]

def hash_password(pw: str) -> str:
  salt = os.urandom(16)
  dk = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
  return f"scrypt${salt.hex()}${dk.hex()}"

def check_password(pw: str, stored: str) -> bool:
  try:
    _, salt, digest = stored.split("$")
    dk = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
    return hmac.compare_digest(dk.hex(), digest)
  except Exception:
    return False

_DUMMY_HASH = None

def _burn_password_check(pw: str) -> None:
  # Same work as a real check, so a missing username takes as long as a wrong password.
  global _DUMMY_HASH
  if _DUMMY_HASH is None:
    _DUMMY_HASH = hash_password("dummy-password")
  check_password(pw, _DUMMY_HASH)

def _session_secret() -> bytes:
  explicit = os.environ.get("SESSION_SECRET")
  if explicit:
    return explicit.encode()
  # Derived from the KV token, which is already a server-only secret.
  return hmac.new(_kv_token().encode(), b"ygo-player-session", hashlib.sha256).digest()

def _session_token(username: str, pw_ver: int) -> str:
  payload = f"{username}.{pw_ver}.{int(time.time()) + SESSION_TTL}"
  sig = hmac.new(_session_secret(), payload.encode(), hashlib.sha256).hexdigest()
  return f"{payload}.{sig}"

def current_user() -> Optional[dict]:
  if "current_user" in g:
    return g.current_user
  g.current_user = None
  token = request.cookies.get(SESSION_COOKIE, "")
  parts = token.split(".")
  if len(parts) == 4:
    username, ver, exp, sig = parts
    expected = hmac.new(_session_secret(), f"{username}.{ver}.{exp}".encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig, expected) and exp.isdigit() and int(exp) > time.time():
      doc = kv_get_json(user_key(username))
      # pw_ver changes on password reset, which signs out every existing session.
      if doc and str(doc.get("pw_ver")) == ver:
        g.current_user = doc
  return g.current_user

def public_user(doc: Optional[dict]) -> Optional[dict]:
  return {"username": doc["username"], "player_name": doc["player_name"]} if doc else None

def _is_https() -> bool:
  return request.is_secure or request.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https"

def _with_session(resp, doc: dict):
  resp.set_cookie(SESSION_COOKIE, _session_token(doc["username"], doc["pw_ver"]), max_age=SESSION_TTL,
                  httponly=True, samesite="Lax", secure=_is_https(), path="/")
  return resp

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

def kv_get_raw(key: str) -> Optional[str]:
  import requests
  r = requests.get(f"{_kv_url()}/get/{key}", headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
  if r.status_code == 404:
    return None
  r.raise_for_status()
  return r.json().get("result")

_CAS_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]) return 1 else return 0 end"

def kv_cas_json(key: str, expected_raw: str, value) -> bool:
  # Atomically write value only if the key still holds expected_raw.
  import requests
  body = json.dumps(value, separators=(",", ":"))
  r = requests.post(_kv_url(), json=["EVAL", _CAS_SCRIPT, "1", key, expected_raw, body],
                    headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
  if r.status_code >= 400:
    raise RuntimeError(f"KV CAS failed ({r.status_code}): {r.text}")
  return r.json().get("result") == 1

def _kv_command(*args):
  import requests
  r = requests.post(_kv_url(), json=[str(a) for a in args], headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
  if r.status_code >= 400:
    raise RuntimeError(f"KV command failed ({r.status_code}): {r.text}")
  return r.json().get("result")

_SETNX_SCRIPT = "if redis.call('EXISTS', KEYS[1]) == 0 then redis.call('SET', KEYS[1], ARGV[1]) return 1 else return 0 end"
_INCR_TTL_SCRIPT = "local v = redis.call('INCR', KEYS[1]) if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return v"

def kv_set_nx_json(key: str, value) -> bool:
  return _kv_command("EVAL", _SETNX_SCRIPT, 1, key, json.dumps(value, separators=(",", ":"))) == 1

def kv_incr_ttl(key: str, ttl: int) -> int:
  return int(_kv_command("EVAL", _INCR_TTL_SCRIPT, 1, key, ttl))

def kv_mget_json(keys: List[str]) -> List[object]:
  if not keys:
    return []
  out = []
  for raw in _kv_command("MGET", *keys) or []:
    try:
      out.append(json.loads(raw) if raw is not None else None)
    except Exception:
      out.append(raw)
  return out

def kv_del(key: str) -> None:
  import requests
  requests.post(f"{_kv_url()}/del/{key}", headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)

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

# ── Archetype image cache ───────────────────────────────────────────────────
_arch_image_cache: Dict[str, Optional[str]] = {}

def _fetch_archetype_image(archetype: str) -> Optional[str]:
  if archetype in _arch_image_cache:
    return _arch_image_cache[archetype]
  import requests
  try:
    r = requests.get(
      "https://db.ygoprodeck.com/api/v7/cardinfo.php",
      params={"archetype": archetype, "num": 1, "offset": 0},
      timeout=10
    )
    if r.status_code == 200:
      data = r.json()
      cards = data.get("data", [])
      if cards and cards[0].get("card_images"):
        url = cards[0]["card_images"][0].get("image_url_cropped")
        _arch_image_cache[archetype] = url
        return url
  except Exception:
    pass
  _arch_image_cache[archetype] = None
  return None

def tid_key(tid: str) -> str:
  return f"t_{tid}"

class Reject(Exception):
  """Raised inside an update_tdoc mutation to abort without writing."""
  def __init__(self, payload: dict, status: int = 400):
    super().__init__(payload)
    self.payload, self.status = payload, status

def update_tdoc(tid: str, mutate, attempts: int = 20):
  # Optimistic read-modify-write so concurrent writers (e.g. a burst of public
  # registrations) can't silently overwrite each other. Returns (t, result) or None.
  key = tid_key(tid)
  for attempt in range(attempts):
    raw = kv_get_raw(key)
    if raw is None:
      time.sleep(0.2)
      raw = kv_get_raw(key)
      if raw is None:
        return None
    t = json.loads(raw)
    result = mutate(t)
    if kv_cas_json(key, raw, t):
      return t, result
    time.sleep(random.uniform(0, 0.03 * 2 ** min(attempt, 5)))
  raise Reject({"error": "Lots of people are updating this tournament right now. Please try again."}, 503)

def reject_response(e: "Reject"):
  return jsonify(e.payload), e.status

def decks_key(tid: str, pid: str = "") -> str:
  # One key per player so concurrent submissions can't clobber each other.
  # Not prefixed "t_" so tournament index rebuilds never pick these up.
  return f"decks_{tid}_{pid}"

def read_tdoc_or_retry(tid: str, attempts: int = 6, delay: float = 0.2):
  key = tid_key(tid)
  for _ in range(attempts):
    raw = kv_get_raw(key)
    if raw is not None:
      seen = getattr(g, "tdoc_raw", None)
      if seen is not None:
        seen[key] = raw
      return json.loads(raw)
    time.sleep(delay)
  return None

class TdocConflict(BaseException):
  # BaseException on purpose: handlers end in a broad `except Exception`, and this
  # must get past them to retry_on_conflict.
  pass

def save_tdoc(tid: str, t: dict) -> None:
  # Write only if the doc is unchanged since this request read it; otherwise the
  # whole handler is re-run on fresh data by retry_on_conflict.
  key = tid_key(tid)
  seen = getattr(g, "tdoc_raw", None)
  if seen is None or key not in seen:
    kv_set_json(key, t)
    return
  if not kv_cas_json(key, seen[key], t):
    raise TdocConflict()
  seen[key] = json.dumps(t, separators=(",", ":"))

def retry_on_conflict(fn):
  @wraps(fn)
  def wrapper(*args, **kwargs):
    for attempt in range(20):
      g.tdoc_raw = {}
      try:
        return fn(*args, **kwargs)
      except TdocConflict:
        time.sleep(random.uniform(0, 0.03 * 2 ** min(attempt, 5)))
    return jsonify({"error": "Lots of people are updating this tournament right now. Please try again."}), 503
  return wrapper

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
  losses: List[object] = field(default_factory=list)  # Node or "FORFEIT" (round missed by a late entrant)
  draws: List[object] = field(default_factory=list)   # Node (retro format)
  lost_rounds: List[int] = field(default_factory=list)
  game_wins: int = 0    # total individual games won (retro)
  game_losses: int = 0  # total individual games lost (retro)

  def num_byes(self) -> int:
    return sum(1 for w in self.wins if w == "BYE")

  def wins_excl_bye(self) -> int:
    return sum(1 for w in self.wins if w != "BYE")

  def matches_played_excl_bye(self) -> int:
    return self.wins_excl_bye() + len(self.losses) + len(self.draws)

  def match_points(self) -> int:
    # Win=3, Draw=1 (retro), Loss=0; BYE counts as Win for points
    return 3 * len(self.wins) + 1 * len(self.draws)

  def match_win_pct(self) -> float:
    denom = self.matches_played_excl_bye()
    return (self.wins_excl_bye() / denom) if denom else 0.0

  def game_win_pct(self) -> float:
    total = self.game_wins + self.game_losses
    return (self.game_wins / total) if total else 0.0

def rebuild_graph(t: dict) -> Dict[str, Node]:
  is_retro = t.get("format") == "retro"
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
        if is_retro:
          a.game_wins += 2  # BYE counts as 2-0 for game win %
        continue
      if not b:
        continue
      # Parse game score if present (retro format): [gw_a, gw_b]
      score = m.get("score")  # e.g. [2, 0], [2, 1], [1, 1]
      if r == "A":
        a.wins.append(b); b.losses.append(a); b.lost_rounds.append(n)
      elif r == "B":
        b.wins.append(a); a.losses.append(b); a.lost_rounds.append(n)
      elif r == "TIE":
        if is_retro:
          # Retro: TIE = Draw (1pt each, no loss recorded)
          a.draws.append(b); b.draws.append(a)
        else:
          # Standard: TIE = Double Loss (0pt each)
          a.losses.append(b); b.losses.append(a)
          a.lost_rounds.append(n); b.lost_rounds.append(n)
      # Accumulate game wins/losses for retro tiebreaking
      if is_retro and score and len(score) == 2:
        a.game_wins += score[0]; a.game_losses += score[1]
        b.game_wins += score[1]; b.game_losses += score[0]
  for pid, n in missed_rounds(t):
    node = players[pid]
    node.losses.append("FORFEIT"); node.lost_rounds.append(n)
    if is_retro:
      node.game_losses += 2  # mirrors BYE counting as 2-0
  return players

def missed_rounds(t: dict) -> list[tuple[str, int]]:
  # (player_id, round) for each round a late entrant was not paired in, up to the
  # round that existed when they joined. Derived, so Edit Pairings / Revert stay consistent.
  out = []
  late = [p for p in t.get("players", []) if p.get("joined_round")]
  if not late:
    return out
  for rnd in t.get("rounds", []):
    present = {m["a"] for m in rnd["matches"]} | {m["b"] for m in rnd["matches"] if m.get("b")}
    for p in late:
      if rnd["n"] <= p["joined_round"] and p["id"] not in present:
        out.append((p["id"], rnd["n"]))
  return out

def opp_win_pct(p: Node) -> float:
  tot, num = 0.0, 0
  for opp in p.wins + p.losses + p.draws:
    if not isinstance(opp, Node):
      continue
    tot += opp.match_win_pct()
    num += 1
  return tot / num if num else 0.0

def compute_standings(t: dict):
  is_retro = t.get("format") == "retro"
  nodes = rebuild_graph(t)
  dropped = set(t.get("dropped", []))
  deck_map = {pl["id"]: pl.get("deck", "") for pl in t.get("players", [])}
  rows = []
  for p in nodes.values():
    aa = p.match_points()
    bbb = max(0, int(round(opp_win_pct(p), 3) * 1000))
    acc, nopp = 0.0, 0
    for opp in p.wins + p.losses + p.draws:
      if not isinstance(opp, Node):
        continue
      acc += opp_win_pct(opp); nopp += 1
    ccc = max(0, int(round((acc / nopp) if nopp else 0.0, 3) * 1000))
    ddd_raw = sum(r * r for r in p.lost_rounds)
    # For retro format, DDD slot stores game win % (higher is better)
    # For standard format, DDD stores sum of squared lost rounds (lower is better, so we invert)
    if is_retro:
      gwp = int(round(p.game_win_pct(), 3) * 1000)
      ddd = max(0, gwp)
      kts = f"{str(aa).zfill(2)}{str(bbb).zfill(4)}{str(ccc).zfill(4)}{str(ddd).zfill(4)}"
    else:
      ddd = ddd_raw
      kts = f"{str(aa).zfill(2)}{str(bbb).zfill(4)}{str(ccc).zfill(4)}{str(ddd).zfill(4)}"

    d = p.matches_played_excl_bye()
    mw = (p.wins_excl_bye() / d * 100.0) if d else 0.0
    omw = opp_win_pct(p) * 100.0
    oomw = (acc / nopp * 100.0) if nopp else 0.0

    row = {
      "player_id": p.id, "player": p.name, "pts": aa,
      "mw": round(mw, 1), "omw": round(omw, 1), "oomw": round(oomw, 1),
      "ddd": str(ddd).zfill(4), "kts": kts,
      "dropped": p.id in dropped,
      "deck": deck_map.get(p.id, ""),
    }
    if is_retro:
      row["gw"] = round(p.game_win_pct() * 100, 1)
      row["game_wins"] = p.game_wins
      row["game_losses"] = p.game_losses
    rows.append(row)
  rows.sort(key=lambda r: -int(r["kts"]))
  for i, r in enumerate(rows, start=1):
    r["rank"] = i
  return rows

def player_match_history(t: dict, player_id: str) -> list[dict]:
  is_retro = t.get("format") == "retro"
  id2name = {p["id"]: p["name"] for p in t["players"]}
  id2deck = {p["id"]: p.get("deck", "") for p in t["players"]}
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
        result = "Draw" if is_retro else "Double Loss"
      elif r == "A":
        result = "Win" if m["a"] == player_id else "Loss"
      elif r == "B":
        result = "Win" if m.get("b") == player_id else "Loss"
      else:
        result = r
      opponent_id = m.get("b") if m["a"] == player_id else m["a"]
      # Format game score string if available
      score = m.get("score")
      score_str = ""
      if score and len(score) == 2:
        if m["a"] == player_id:
          score_str = f"{score[0]}-{score[1]}"
        else:
          score_str = f"{score[1]}-{score[0]}"
      history.append({
        "round": rnd["n"],
        "opponent": id2name.get(opponent_id, "BYE") if opponent_id else "BYE",
        "opponent_deck": id2deck.get(opponent_id, "") if opponent_id else "",
        "result": result,
        "score": score_str,
        "match_id": m["id"]
      })
  for pid, n in missed_rounds(t):
    if pid == player_id:
      history.append({"round": n, "opponent": "—", "opponent_deck": "", "result": "Loss (late entry)", "score": "0-2" if is_retro else "", "match_id": ""})
  history.sort(key=lambda h: h["round"])
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
@admin_required
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
@admin_required
def debug_kv_auth():
  try:
    import requests
    url = f"{_kv_url()}/ping"
    r = requests.get(url, headers={"Authorization": f"Bearer {_kv_token()}"}, timeout=10)
    return jsonify({"status": r.status_code, "text": r.text})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments")
@admin_required
def create_tournament():
  try:
    data = request.get_json(force=True)
    name = (data.get("name") or "Tournament").strip()
    total_rounds = int(data.get("total_rounds") or 4)
    players = [p.strip() for p in (data.get("players") or []) if p.strip()]

    fmt = (data.get("format") or "standard").strip().lower()
    if fmt not in ("standard", "retro"):
      fmt = "standard"
    decklists = bool(data.get("decklists")) and fmt == "retro"
    registration = bool(data.get("registration")) and decklists
    if not players and not registration:
      return jsonify({"error": "players list is required"}), 400

    tid = uuid.uuid4().hex[:10]
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tdoc = {
      "name": name,
      "total_rounds": total_rounds,
      "format": fmt,
      "decklists": decklists,
      "registration": registration,
      "players": [{"id": new_id("p"), "name": n} for n in players],
      "rounds": [],
      "created_at": created_at,
    }
    kv_set_json(tid_key(tid), tdoc)

    # Update tournament index
    idx = kv_get_json(TOURNAMENT_INDEX_KEY) or []
    idx.append({"id": tid, "name": name, "created_at": created_at, "player_count": len(players), "format": fmt})
    kv_set_json(TOURNAMENT_INDEX_KEY, idx)

    initial_info = {
      "id": tid,
      "name": name,
      "total_rounds": total_rounds,
      "round": 0,
      "format": fmt,
      "decklists": decklists,
      "registration": registration,
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
      "format": t.get("format", "standard"),
      "decklists": bool(t.get("decklists")),
      "registration": bool(t.get("registration")),
      "round": current_round_number(t),
      "players": t.get("players", []),
      "dropped": t.get("dropped", []),
    })
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/edit-result")
@admin_required
@retry_on_conflict
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

    score = body.get("score")  # optional [gw_a, gw_b] for retro
    if res == "BYE":
      found["b"] = None
      found["r"] = "BYE"
      found.pop("score", None)
    else:
      if found.get("b") in (None, "BYE"):
        return jsonify({"ok": False, "message": "Cannot set result on BYE match without an opponent."}), 400
      found["r"] = res
      if score and isinstance(score, list) and len(score) == 2:
        found["score"] = score
      elif "score" in found and res == "PENDING":
        found.pop("score", None)

    save_tdoc(tid, t)

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
@admin_required
def api_pair_next(tid):
  try:
    def mutate(t):
      if round_has_pending(latest_round(t)):
        raise Reject({"ok": False, "message": "Finalize the current round before pairing the next."}, 200)
      curr = current_round_number(t)
      if curr >= int(t["total_rounds"]):
        raise Reject({"ok": False, "message": "All rounds completed.", "round": curr}, 200)
      dropped = set(t.get("dropped", []))
      if sum(1 for p in t.get("players", []) if p["id"] not in dropped) < 2:
        raise Reject({"ok": False, "message": "At least 2 players are needed to pair a round."}, 200)
      _sync_deck_archetypes(tid, t)
      rnd_no, matches = pair_next(t)
      t["rounds"].append({"n": rnd_no, "matches": matches})
      return rnd_no, matches

    res = update_tdoc(tid, mutate)
    if not res:
      return jsonify({"error": "not found"}), 404
    t, (rnd_no, matches) = res

    id2name = {p["id"]: p["name"] for p in t["players"]}
    pairs = [{
      "table": m["t"],
      "a": id2name[m["a"]],
      "b": (id2name.get(m["b"]) if m.get("b") else "BYE"),
      "match_id": m["id"]
    } for m in matches]
    return jsonify({"ok": True, "round": rnd_no, "pairs": pairs})
  except Reject as e:
    return reject_response(e)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/finalize-round")
@admin_required
@retry_on_conflict
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
        # Store game score for retro format (e.g. [2,0], [2,1], [1,1])
        score = r.get("score")
        if score and isinstance(score, list) and len(score) == 2:
          by_id[mid]["score"] = score

    save_tdoc(tid, t)
    return jsonify({"ok": True, "standings": compute_standings(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/edit-pairings")
@admin_required
@retry_on_conflict
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
    save_tdoc(tid, t)

    return jsonify({"pairs": pairs_for_ui(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/restart-round")
@admin_required
@retry_on_conflict
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
    save_tdoc(tid, t)

    return jsonify({"ok": True, "round": last["n"], "pairs": pairs_for_ui(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

MAX_NAME_LEN = 40

def _append_player(t: dict, name: str) -> dict:
  name = " ".join(name.split())
  if not name:
    raise Reject({"error": "Player name is required."})
  if len(name) > MAX_NAME_LEN:
    raise Reject({"error": f"Name must be at most {MAX_NAME_LEN} characters."})
  if any(p["name"].strip().lower() == name.lower() for p in t.get("players", [])):
    raise Reject({"error": f"A player named '{name}' is already in this tournament."})
  player = {"id": new_id("p"), "name": name}
  if current_round_number(t) > 0:
    player["joined_round"] = current_round_number(t)
  t["players"].append(player)
  return player

def _update_index_count(tid: str, count: int) -> None:
  idx = kv_get_json(TOURNAMENT_INDEX_KEY) or []
  for e in idx:
    if e.get("id") == tid:
      e["player_count"] = count
  kv_set_json(TOURNAMENT_INDEX_KEY, idx)

def _roster_entry(t: dict, user: Optional[dict]) -> Optional[dict]:
  # The roster entry for a logged-in account: the one it registered (linked by username),
  # else an organizer-added entry under the account's player name that no account has taken yet.
  if not user:
    return None
  players = t.get("players", [])
  linked = next((p for p in players if p.get("account") == user["username"]), None)
  if linked:
    return linked
  name = " ".join(user["player_name"].split()).lower()
  return next((p for p in players if not p.get("account") and " ".join(p["name"].split()).lower() == name), None)

LOGIN_REQUIRED = {"error": "Log in to your player account first.", "login_required": True}

@app.post("/api/tournaments/<tid>/register")
def api_register(tid):
  # Public self-registration (player accounts only); closes at Round 1.
  try:
    user = current_user()
    if not user:
      return jsonify(LOGIN_REQUIRED), 401

    def mutate(t):
      existing = _roster_entry(t, user)
      if existing:
        # Already on the roster (e.g. added by the organizer): link it to the account.
        existing["account"] = user["username"]
        return existing
      if not t.get("registration"):
        raise Reject({"error": "Registration is not open for this tournament."})
      if t.get("rounds"):
        raise Reject({"error": "Registration is closed (the tournament has started)."})
      player = _append_player(t, user["player_name"])
      player["account"] = user["username"]
      return player

    res = update_tdoc(tid, mutate)
    if not res:
      return jsonify({"error": "not found"}), 404
    t, player = res
    _update_index_count(tid, len(t["players"]))
    return jsonify({"ok": True, "player": player})
  except Reject as e:
    return reject_response(e)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/set-rounds")
@admin_required
@retry_on_conflict
def api_set_rounds(tid):
  try:
    body = request.get_json(force=True) or {}
    try:
      total = int(body.get("total_rounds"))
    except (TypeError, ValueError):
      return jsonify({"error": "total_rounds must be a whole number."}), 400
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    played = current_round_number(t)
    if total < max(1, played) or total > 20:
      note = f" (Round {played} has already been paired)" if played else ""
      return jsonify({"error": f"Rounds must be between {max(1, played)} and 20{note}."}), 400
    t["total_rounds"] = total
    save_tdoc(tid, t)
    return jsonify({"ok": True, "total_rounds": total})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/add-player")
@admin_required
def api_add_player(tid):
  # Late entry: included from the next pairing onward (pair_next uses all non-dropped
  # players); rounds already paired without them count as losses (see missed_rounds).
  try:
    name = (request.get_json(force=True) or {}).get("name") or ""
    res = update_tdoc(tid, lambda t: _append_player(t, name))
    if not res:
      return jsonify({"error": "not found"}), 404
    t, player = res
    _update_index_count(tid, len(t["players"]))
    return jsonify({"ok": True, "player": player, "standings": compute_standings(t)})
  except Reject as e:
    return reject_response(e)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/remove-player")
@admin_required
def api_remove_player(tid):
  # Hard delete for typo/joke entries; only before Round 1, when no match references them.
  try:
    pid = (request.get_json(force=True) or {}).get("player_id")

    def mutate(t):
      if t.get("rounds"):
        raise Reject({"error": "Players can only be removed before Round 1. Use Drop instead."})
      player = next((p for p in t.get("players", []) if p["id"] == pid), None)
      if not player:
        raise Reject({"error": "Unknown player_id"})
      t["players"] = [p for p in t["players"] if p["id"] != pid]
      t["dropped"] = [d for d in t.get("dropped", []) if d != pid]
      return player

    res = update_tdoc(tid, mutate)
    if not res:
      return jsonify({"error": "not found"}), 404
    t, player = res
    kv_del(decks_key(tid, pid))
    _update_index_count(tid, len(t["players"]))
    return jsonify({"ok": True, "message": f"{player['name']} has been removed.", "standings": compute_standings(t)})
  except Reject as e:
    return reject_response(e)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/drop-player")
@admin_required
@retry_on_conflict
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
    save_tdoc(tid, t)

    name = next((p["name"] for p in t["players"] if p["id"] == pid), pid)
    return jsonify({"ok": True, "message": f"{name} has been dropped.", "standings": compute_standings(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/undrop-player")
@admin_required
@retry_on_conflict
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
    save_tdoc(tid, t)

    name = next((p["name"] for p in t["players"] if p["id"] == pid), pid)
    return jsonify({"ok": True, "message": f"{name} has been reinstated.", "standings": compute_standings(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/undo-finalize")
@admin_required
@retry_on_conflict
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
        m.pop("score", None)

    save_tdoc(tid, t)
    return jsonify({"ok": True, "round": last["n"], "pairs": pairs_for_ui(t), "standings": compute_standings(t)})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/tournaments/<tid>/revert-round")
@admin_required
@retry_on_conflict
def api_revert_round(tid):
  # Drop the latest round entirely (pairings + results) so the previous round,
  # with its results intact, becomes current again and can be corrected.
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    rounds = t.get("rounds") or []
    if len(rounds) < 2:
      return jsonify({"error": "No previous round to revert to."}), 400

    removed = rounds.pop()
    save_tdoc(tid, t)
    return jsonify({
      "ok": True,
      "removed_round": removed.get("n"),
      "round": rounds[-1].get("n"),
      "pairs": pairs_for_ui(t),
      "standings": compute_standings(t),
    })
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
      "format": t.get("format", "standard"),
    })
  idx.sort(key=lambda x: x.get("created_at", ""), reverse=True)
  kv_set_json(TOURNAMENT_INDEX_KEY, idx)
  return idx

@app.get("/api/tournament-history")
def api_tournament_history():
  try:
    idx = _rebuild_tournament_index()
    fmt = (request.args.get("format") or "").strip().lower()
    if fmt in ("standard", "retro"):
      idx = [e for e in idx if e.get("format", "standard") == fmt]
    return jsonify({"tournaments": idx})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.delete("/api/tournaments/<tid>")
@admin_required
def api_delete_tournament(tid):
  try:
    # Delete the tournament doc (and any submitted decklists)
    for key in [tid_key(tid)] + kv_keys(f"{decks_key(tid)}*"):
      kv_del(key)

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

@app.get("/api/archetype-image")
def api_archetype_image():
  try:
    name = (request.args.get("name") or "").strip()
    if not name:
      return jsonify({"error": "name required"}), 400
    url = _fetch_archetype_image(name)
    return jsonify({"image_url": url})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/archetype-images")
def api_archetype_images_batch():
  """Batch fetch archetype images to avoid N+1 requests."""
  try:
    body = request.get_json(force=True) or {}
    names = body.get("archetypes", [])
    result = {}
    for name in names[:30]:  # limit to 30 per request
      result[name] = _fetch_archetype_image(name)
    return jsonify({"images": result})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Deck archetype tagging ───────────────────────────────────────────────────

@app.post("/api/tournaments/<tid>/set-deck")
@admin_required
@retry_on_conflict
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
        p.pop("deck_auto", None)
        found = True
        break
    if not found:
      return jsonify({"error": "Unknown player_id"}), 400

    save_tdoc(tid, t)
    return jsonify({"ok": True, "archetypes": archetypes})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Metagame breakdown ───────────────────────────────────────────────────────

def _compute_tier(share: float, conversion: float) -> str:
  """Assign tier based on representation share and top-cut conversion rate."""
  if share >= 10 and conversion >= 30:
    return "Tier 1"
  if share >= 5 or conversion >= 20:
    return "Tier 2"
  return "Rogue"

@app.get("/api/tournaments/<tid>/metagame")
def api_metagame(tid):
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404

    nodes = rebuild_graph(t)
    standings = compute_standings(t)
    total_players = len(t["players"])
    # Top cut = top 25% or top 4, whichever is larger
    top_cut = max(4, total_players // 4)
    rank_map = {r["player_id"]: r["rank"] for r in standings}

    arch_stats: Dict[str, dict] = {}
    total_entries = 0

    for p in t["players"]:
      archetypes = p.get("archetypes") or []
      deck = p.get("deck") or ""
      if not archetypes:
        archetypes = [deck] if deck else ["Unknown"]
      node = nodes.get(p["id"])
      pw = node.wins_excl_bye() if node else 0
      pl = len(node.losses) if node else 0
      rank = rank_map.get(p["id"], total_players)
      topped = rank <= top_cut
      for arch in archetypes:
        if arch not in arch_stats:
          arch_stats[arch] = {"count": 0, "wins": 0, "losses": 0, "topped": 0, "ranks": []}
        arch_stats[arch]["count"] += 1
        arch_stats[arch]["wins"] += pw
        arch_stats[arch]["losses"] += pl
        arch_stats[arch]["ranks"].append(rank)
        if topped:
          arch_stats[arch]["topped"] += 1
        total_entries += 1

    result = []
    for arch, stats in sorted(arch_stats.items(), key=lambda x: -x[1]["count"]):
      total_matches = stats["wins"] + stats["losses"]
      share = round(stats["count"] / total_entries * 100, 1) if total_entries else 0
      conversion = round(stats["topped"] / stats["count"] * 100, 1) if stats["count"] else 0
      avg_place = round(sum(stats["ranks"]) / len(stats["ranks"]), 1) if stats["ranks"] else 0
      result.append({
        "archetype": arch,
        "count": stats["count"],
        "share": share,
        "wins": stats["wins"],
        "losses": stats["losses"],
        "win_rate": round(stats["wins"] / total_matches * 100, 1) if total_matches else 0,
        "topped": stats["topped"],
        "conversion": conversion,
        "avg_placement": avg_place,
        "tier": _compute_tier(share, conversion),
      })

    return jsonify({"metagame": result, "total_players": total_players, "top_cut": top_cut})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Cross-tournament player stats ────────────────────────────────────────────

@app.get("/api/player-stats")
def api_player_stats():
  try:
    player_name = request.args.get("name", "").strip()
    if not player_name:
      return jsonify({"error": "name query param required"}), 400

    idx = _rebuild_tournament_index()
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
      player = next((p for p in t.get("players", []) if p["name"].strip().lower() == player_name.lower()), None)
      if not player:
        continue
      pid = player["id"]
      stats["name"] = player["name"].strip()

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
        "format": t.get("format", "standard"),
        "wins": w,
        "losses": l,
        "draws": len(node.draws),
        "byes": b,
        "omw": round(omw, 1),
        "rank": rank,
        "total_players": len(t.get("players", [])),
        "rounds_played": current_round_number(t),
        "total_rounds": t.get("total_rounds"),
        "deck": player.get("deck") or "",
        "dropped": pid in set(t.get("dropped", [])),
      })

    total_matches = stats["total_wins"] + stats["total_losses"]
    stats["win_rate"] = round(stats["total_wins"] / total_matches * 100, 1) if total_matches else 0
    stats["avg_omw"] = round(omw_sum / omw_count, 1) if omw_count else 0
    stats["tournament_results"].sort(key=lambda x: x.get("date", ""), reverse=True)

    return jsonify(stats)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── GOAT decklists ───────────────────────────────────────────────────────────

GOAT_COPY_LIMITS = {"Forbidden": 0, "Limited": 1, "Semi-Limited": 2}

# GOAT card pool: Format Library's list (TCG releases up to SJC Indianapolis,
# 2005-08-20, April 2005 banlist), snapshotted by scripts/build_goat_pool.py.
# GOAT is a frozen format, so a bundled snapshot avoids depending on (and being
# rate-limited by) YGOPRODeck, whose own GOAT filter is missing legal cards.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _goat_cards import CARDS as GOAT_CARDS, ALIASES as GOAT_ALIASES  # noqa: E402

_goat_pool: Dict[int, dict] = {c["id"]: c for c in GOAT_CARDS}

def _goat_pool_cards() -> Dict[int, dict]:
  return _goat_pool

def _goat_card_id(cid: int) -> int:
  # Older drafts and decklists may hold an alternate-artwork id.
  return GOAT_ALIASES.get(cid, cid)

MONARCHS = {"Zaborg the Thunder Monarch", "Mobius the Frost Monarch", "Thestalos the Firestorm Monarch", "Granmarg the Rock Monarch"}

def _detect_goat_archetype(cards: Dict[int, dict], main: Dict[int, int], extra: Dict[int, int]) -> Optional[str]:
  # GOAT decks are named by strategy rather than card archetype, so check the
  # well-known signatures first, then fall back to card archetype / monster type.
  names = {cards[cid]["name"]: q for cid, q in main.items() if cid in cards}
  if names.get("Scapegoat") and names.get("Metamorphosis"):
    return "Goat Control"
  if sum(q for n, q in names.items() if n in MONARCHS) >= 3:
    return "Monarch"
  by_arch: Dict[str, int] = {}
  for cid, q in list(main.items()) + list(extra.items()):
    arch = (cards.get(cid) or {}).get("archetype")
    if arch:
      by_arch[arch] = by_arch.get(arch, 0) + q
  if by_arch:
    arch, n = max(by_arch.items(), key=lambda kv: kv[1])
    if n >= 8:
      return arch
  by_race: Dict[str, int] = {}
  monsters = 0
  for cid, q in main.items():
    c = cards.get(cid) or {}
    if "Monster" in (c.get("type") or ""):
      monsters += q
      if c.get("race"):
        by_race[c["race"]] = by_race.get(c["race"], 0) + q
  if monsters >= 8 and by_race:
    race, n = max(by_race.items(), key=lambda kv: kv[1])
    if n / monsters >= 0.6:
      return race
  return None

def _goat_cards_by_id(ids) -> Dict[int, dict]:
  return {cid: _goat_pool[_goat_card_id(cid)] for cid in set(ids) if _goat_card_id(cid) in _goat_pool}

def _deck_doc_archetype(tid: str, doc: dict) -> Optional[str]:
  # Older submissions predate detection: compute once and persist on the player's own key.
  if "archetype" in doc:
    return doc["archetype"]
  main = {e["id"]: e["qty"] for e in doc.get("main", [])}
  extra = {e["id"]: e["qty"] for e in doc.get("extra", [])}
  label = _detect_goat_archetype(_goat_cards_by_id(list(main) + list(extra)), main, extra)
  doc["archetype"] = label
  kv_set_json(decks_key(tid, doc["player_id"]), doc)
  return label

def _sync_deck_archetypes(tid: str, t: dict) -> bool:
  # Copy detected archetypes from submitted decklists onto players, never
  # overwriting a deck the organizer tagged by hand. Caller persists t.
  if not t.get("decklists"):
    return False
  docs = {d["player_id"]: d for d in (kv_get_json(k) for k in kv_keys(f"{decks_key(tid)}*")) if d}
  changed = False
  for p in t.get("players", []):
    doc = docs.get(p["id"])
    if not doc or (p.get("deck") and not p.get("deck_auto")):
      continue
    label = _deck_doc_archetype(tid, doc)
    if label and (p.get("deck") != label or p.get("archetypes") != [label]):
      p["deck"], p["archetypes"], p["deck_auto"] = label, [label], True
      changed = True
  return changed

@app.get("/api/cards/search")
def api_card_search():
  try:
    offset = max(0, int(request.args.get("offset", 0) or 0))
    q = (request.args.get("q") or "").strip().lower()
    want = {k: (request.args.get(k) or "").strip() for k in ("type", "attribute", "race", "level")}
    hits = [
      c for c in GOAT_CARDS
      if (not q or q in (c["name"] or "").lower())
      and (not want["type"] or c["type"] == want["type"])
      and (not want["attribute"] or c["attribute"] == want["attribute"])
      and (not want["race"] or c["race"] == want["race"])
      and (not want["level"] or str(c["level"]) == want["level"])
    ]
    page = hits[offset:offset + 40]
    resp = jsonify({
      "cards": page,
      "next_offset": offset + 40 if offset + 40 < len(hits) else None,
      "total": len(hits) or None,
    })
    resp.headers["Cache-Control"] = "public, s-maxage=600"
    return resp
  except Exception as e:
    return jsonify({"error": str(e)}), 502

@app.get("/api/cards/by-ids")
def api_cards_by_ids():
  try:
    ids = [int(x) for x in (request.args.get("ids") or "").split(",") if x.strip().isdigit()][:200]
    resp = jsonify({"cards": list(_goat_cards_by_id(ids).values())})
    resp.headers["Cache-Control"] = "public, s-maxage=86400"
    return resp
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.get("/api/card-image/<int:cid>")
def api_card_image(cid):
  # Proxied + edge-cached so we don't hotlink images.ygoprodeck.com on every view.
  try:
    import requests
    folder = "cards" if request.args.get("size") == "big" else "cards_small"
    r = requests.get(f"https://images.ygoprodeck.com/images/{folder}/{cid}.jpg", timeout=10)
    if r.status_code != 200:
      return Response(status=404)
    return Response(r.content, mimetype="image/jpeg", headers={
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable"
    })
  except Exception:
    return Response(status=502)

def _decklist_locked(t: dict) -> bool:
  return bool(t.get("rounds"))

def _can_submit_deck(t: dict, player: dict) -> bool:
  # Submission closes at Round 1, except for late entrants added after it started.
  return not _decklist_locked(t) or bool(player.get("joined_round"))

def _can_edit_deck(t: dict, player: dict) -> bool:
  # Edits are allowed until the player's first round is paired: Round 1 for everyone,
  # or the round after they joined for late entrants.
  return not _decklist_locked(t) or (bool(player.get("joined_round")) and current_round_number(t) == player["joined_round"])

def _validate_goat_deck(body: dict, complete: bool = True):
  # Returns (sections, cards). complete=False allows unfinished decks (saved decks).
  sections: Dict[str, Dict[int, int]] = {}
  for sec in ("main", "extra", "side"):
    counts: Dict[int, int] = {}
    for entry in body.get(sec) or []:
      cid, qty = _goat_card_id(int(entry["id"])), int(entry["qty"])
      if qty < 1 or qty > 3:
        raise Reject({"error": "Invalid card quantity."})
      counts[cid] = counts.get(cid, 0) + qty
    sections[sec] = counts
  # No Extra Deck size limit: the GOAT-era Fusion Deck was unlimited.
  main_n, side_n = (sum(sections[s].values()) for s in ("main", "side"))
  if complete and main_n < 40:
    raise Reject({"error": f"Main Deck must have 40-60 cards (has {main_n})."})
  if main_n > 60:
    raise Reject({"error": f"Main Deck must have 40-60 cards (has {main_n})."})
  if side_n > 15:
    raise Reject({"error": f"Side Deck can have at most 15 cards (has {side_n})."})
  totals: Dict[int, int] = {}
  for counts in sections.values():
    for cid, q in counts.items():
      totals[cid] = totals.get(cid, 0) + q
  # Verify every card against the GOAT card pool and banlist server-side.
  cards = _goat_cards_by_id(totals)
  for cid, total in totals.items():
    c = cards.get(cid)
    if not c:
      raise Reject({"error": f"Card {cid} is not legal in GOAT format."})
    limit = GOAT_COPY_LIMITS.get(c["ban"], 3)
    if total > limit:
      raise Reject({"error": f"{c['name']}: max {limit} copies allowed (has {total})."})
  for cid in sections["main"]:
    if cards[cid]["extra"]:
      raise Reject({"error": f"{cards[cid]['name']} belongs in the Extra Deck."})
  for cid in sections["extra"]:
    if not cards[cid]["extra"]:
      raise Reject({"error": f"{cards[cid]['name']} cannot go in the Extra Deck."})
  return sections, cards

def _deck_entries(sections: Dict[str, Dict[int, int]], cards: Dict[int, dict]) -> dict:
  return {sec: [{"id": cid, "name": cards[cid]["name"], "qty": q, "type": cards[cid]["type"], "ban": cards[cid]["ban"]}
                for cid, q in counts.items()] for sec, counts in sections.items()}

@app.get("/api/tournaments/<tid>/decklist-status")
def api_decklist_status(tid):
  # Status for the logged-in player only; the roster isn't exposed here.
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    user = current_user()
    p = _roster_entry(t, user)
    me = None
    if p:
      me = {"id": p["id"], "name": p["name"], "submitted": kv_get_raw(decks_key(tid, p["id"])) is not None,
            "can_submit": _can_submit_deck(t, p), "can_edit": _can_edit_deck(t, p)}
    resp = jsonify({
      "enabled": bool(t.get("decklists")),
      "registration": bool(t.get("registration")),
      "locked": _decklist_locked(t),
      "name": t["name"],
      "user": public_user(user) if user else None,
      "me": me,
    })
    resp.headers["Cache-Control"] = "no-store"
    return resp
  except Exception as e:
    return jsonify({"error": str(e)}), 500

def _deck_request(tid: str):
  # (t, player, user) for the logged-in player's own entry, or a (response, status) error.
  user = current_user()
  if not user:
    return None, (jsonify(LOGIN_REQUIRED), 401)
  t = read_tdoc_or_retry(tid)
  if not t:
    return None, (jsonify({"error": "not found"}), 404)
  player = _roster_entry(t, user)
  if not player:
    return None, (jsonify({"error": f"{user['player_name']} isn't registered in this tournament."}), 403)
  return (t, player, user), None

@app.post("/api/tournaments/<tid>/decklist")
def api_submit_decklist(tid):
  try:
    body = request.get_json(force=True) or {}
    ctx, err = _deck_request(tid)
    if err:
      return err
    t, player, user = ctx
    if not t.get("decklists"):
      return jsonify({"error": "Decklist submission is not enabled for this tournament."}), 400
    if not _can_submit_deck(t, player):
      return jsonify({"error": "Decklist submission is closed (the tournament has started)."}), 400
    sections, cards = _validate_goat_deck(body)
    pid = player["id"]
    key = decks_key(tid, pid)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    doc = {
      "player_id": pid,
      "player": player["name"],
      "account": user["username"],
      "submitted_at": now,
      "archetype": _detect_goat_archetype(cards, sections["main"], sections["extra"]),
      **_deck_entries(sections, cards),
    }
    if kv_set_nx_json(key, doc):
      return jsonify({"ok": True})

    if not _can_edit_deck(t, player):
      return jsonify({"error": "Decklists can't be changed once your first round has been paired. Ask the organizer."}), 409
    existing = kv_get_json(key) or {}
    doc["submitted_at"] = existing.get("submitted_at", now)
    doc["updated_at"] = now
    kv_set_json(key, doc)
    return jsonify({"ok": True, "updated": True})

  except Reject as e:
    return reject_response(e)
  except (KeyError, TypeError, ValueError):
    return jsonify({"error": "Malformed decklist."}), 400
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>/my-decklist")
def api_my_decklist(tid):
  # The logged-in player's submitted list, so it can be edited.
  try:
    ctx, err = _deck_request(tid)
    if err:
      return err
    t, player, _ = ctx
    doc = kv_get_json(decks_key(tid, player["id"]))
    if not doc:
      return jsonify({"error": "Decklist not found."}), 404
    resp = jsonify({"deck": {s: [{"id": e["id"], "qty": e["qty"]} for e in doc.get(s, [])] for s in ("main", "extra", "side")},
                    "can_edit": _can_edit_deck(t, player), "submitted_at": doc.get("submitted_at"), "updated_at": doc.get("updated_at")})
    resp.headers["Cache-Control"] = "no-store"
    return resp
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.get("/api/tournaments/<tid>/decklists")
@admin_required
@retry_on_conflict
def api_get_decklists(tid):
  # Admin-only: decklists are never exposed through any public endpoint.
  try:
    t = read_tdoc_or_retry(tid)
    if not t:
      return jsonify({"error": "not found"}), 404
    if t.get("rounds") and _sync_deck_archetypes(tid, t):
      save_tdoc(tid, t)
    prefix = decks_key(tid)
    docs = [d for d in (kv_get_json(k) for k in kv_keys(f"{prefix}*")) if d]
    for d in docs:
      _deck_doc_archetype(tid, d)
    tags = {p["id"]: p.get("deck") for p in t.get("players", []) if p.get("deck") and not p.get("deck_auto")}
    for d in docs:
      d["deck_tag"] = tags.get(d["player_id"]) or d.get("archetype")
      d.pop("edit_hash", None)
    docs.sort(key=lambda d: (d.get("player") or "").lower())
    return jsonify({"decklists": docs})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.delete("/api/tournaments/<tid>/decklist/<pid>")
@admin_required
def api_reset_decklist(tid, pid):
  try:
    kv_del(decks_key(tid, pid))
    return jsonify({"ok": True})
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
    if hmac.compare_digest(password.encode(), admin_pw.encode()):
      return jsonify({"ok": True})
    return jsonify({"ok": False, "message": "Incorrect password."}), 401
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── Player account endpoints ─────────────────────────────────────────────────

@app.post("/api/auth/register")
def api_auth_register():
  try:
    body = request.get_json(force=True) or {}
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    player_name = " ".join((body.get("player_name") or "").split())
    if not USERNAME_RE.match(username):
      return jsonify({"error": "Username must be 3-20 characters: letters, numbers, _ or -."}), 400
    if not 8 <= len(password) <= 128:
      return jsonify({"error": "Password must be at least 8 characters."}), 400
    if not player_name or len(player_name) > MAX_NAME_LEN:
      return jsonify({"error": f"Player name is required (max {MAX_NAME_LEN} characters)."}), 400

    doc = {"username": username, "player_name": player_name, "pw": hash_password(password), "pw_ver": 1,
           "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if not kv_set_nx_json(user_key(username), doc):
      return jsonify({"error": "That username is taken."}), 409
    if not kv_set_nx_json(claim_key(player_name), {"username": username, "name": player_name}):
      kv_del(user_key(username))
      return jsonify({"error": f"The player name '{player_name}' already belongs to another account. "
                               "Ask the organizer if it's yours."}), 409
    return _with_session(jsonify({"ok": True, "user": public_user(doc)}), doc)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/auth/login")
def api_auth_login():
  try:
    body = request.get_json(force=True) or {}
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    if not USERNAME_RE.match(username):
      _burn_password_check(password)
      return jsonify({"error": "Incorrect username or password."}), 401
    fails_key = f"loginfail_{username}"
    if int(kv_get_json(fails_key) or 0) >= LOGIN_MAX_FAILS:
      return jsonify({"error": "Too many failed attempts. Try again in 15 minutes."}), 429
    doc = kv_get_json(user_key(username))
    if not doc:
      _burn_password_check(password)
    if not doc or not check_password(password, doc.get("pw", "")):
      kv_incr_ttl(fails_key, LOGIN_LOCK_SECONDS)
      return jsonify({"error": "Incorrect username or password."}), 401
    kv_del(fails_key)
    return _with_session(jsonify({"ok": True, "user": public_user(doc)}), doc)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/auth/logout")
def api_auth_logout():
  resp = jsonify({"ok": True})
  resp.delete_cookie(SESSION_COOKIE, path="/")
  return resp

@app.get("/api/auth/me")
def api_auth_me():
  try:
    resp = jsonify({"user": public_user(current_user())})
    resp.headers["Cache-Control"] = "no-store"
    return resp
  except Exception as e:
    return jsonify({"error": str(e)}), 500

MAX_SAVED_DECKS = 30

def saved_decks_key(username: str) -> str:
  return f"udecks_{username}"

def _login_required():
  user = current_user()
  if not user:
    raise Reject({"error": "Log in to use saved decks."}, 401)
  return user

@app.get("/api/me/decks")
def api_my_saved_decks():
  try:
    user = _login_required()
    resp = jsonify({"decks": (kv_get_json(saved_decks_key(user["username"])) or {}).get("decks", [])})
    resp.headers["Cache-Control"] = "no-store"
    return resp
  except Reject as e:
    return reject_response(e)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/me/decks")
def api_save_deck():
  try:
    user = _login_required()
    body = request.get_json(force=True) or {}
    name = " ".join((body.get("name") or "").split())[:60]
    if not name:
      return jsonify({"error": "Give the deck a name."}), 400
    sections, cards = _validate_goat_deck(body, complete=False)
    key = saved_decks_key(user["username"])
    decks = (kv_get_json(key) or {}).get("decks", [])
    entry = {"id": body.get("id") or new_id("d"), "name": name,
             "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             **{s: [{"id": cid, "qty": q} for cid, q in sections[s].items()] for s in ("main", "extra", "side")}}
    idx = next((i for i, d in enumerate(decks) if d["id"] == entry["id"]), None)
    if idx is None:
      if len(decks) >= MAX_SAVED_DECKS:
        return jsonify({"error": f"You can save up to {MAX_SAVED_DECKS} decks. Delete one first."}), 400
      decks.append(entry)
    else:
      decks[idx] = entry
    decks.sort(key=lambda d: d["updated_at"], reverse=True)
    kv_set_json(key, {"decks": decks})
    return jsonify({"ok": True, "deck": entry})
  except Reject as e:
    return reject_response(e)
  except (KeyError, TypeError, ValueError):
    return jsonify({"error": "Malformed decklist."}), 400
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.delete("/api/me/decks/<deck_id>")
def api_delete_saved_deck(deck_id):
  try:
    user = _login_required()
    key = saved_decks_key(user["username"])
    decks = (kv_get_json(key) or {}).get("decks", [])
    kv_set_json(key, {"decks": [d for d in decks if d["id"] != deck_id]})
    return jsonify({"ok": True})
  except Reject as e:
    return reject_response(e)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.get("/api/admin/accounts")
@admin_required
def api_admin_accounts():
  try:
    docs = [d for d in kv_mget_json(kv_keys("user_*")) if isinstance(d, dict)]
    docs.sort(key=lambda d: d["username"])
    return jsonify({"accounts": [{"username": d["username"], "player_name": d["player_name"],
                                  "created_at": d.get("created_at", "")} for d in docs]})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/admin/accounts/reset-password")
@admin_required
def api_admin_reset_password():
  try:
    body = request.get_json(force=True) or {}
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    if not 8 <= len(password) <= 128:
      return jsonify({"error": "Password must be at least 8 characters."}), 400
    doc = kv_get_json(user_key(username))
    if not doc:
      return jsonify({"error": "No account with that username."}), 404
    doc["pw"] = hash_password(password)
    doc["pw_ver"] = int(doc.get("pw_ver", 1)) + 1
    kv_set_json(user_key(username), doc)
    kv_del(f"loginfail_{username}")
    return jsonify({"ok": True})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.post("/api/admin/accounts/rename")
@admin_required
def api_admin_rename_account():
  # Moves an account to a different player name and frees the old one.
  try:
    body = request.get_json(force=True) or {}
    username = (body.get("username") or "").strip().lower()
    new_name = " ".join((body.get("player_name") or "").split())
    if not new_name or len(new_name) > MAX_NAME_LEN:
      return jsonify({"error": f"Player name is required (max {MAX_NAME_LEN} characters)."}), 400
    doc = kv_get_json(user_key(username))
    if not doc:
      return jsonify({"error": "No account with that username."}), 404
    old_key, new_key = claim_key(doc["player_name"]), claim_key(new_name)
    claim = {"username": username, "name": new_name}
    if new_key == old_key:
      kv_set_json(new_key, claim)  # capitalisation/spacing fix of the same name
    elif not kv_set_nx_json(new_key, claim):
      owner = (kv_get_json(new_key) or {}).get("username", "another account")
      return jsonify({"error": f"'{new_name}' already belongs to @{owner}. Change or delete that account first."}), 409
    else:
      kv_del(old_key)
    doc["player_name"] = new_name
    kv_set_json(user_key(username), doc)
    return jsonify({"ok": True, "account": {"username": username, "player_name": new_name, "created_at": doc.get("created_at", "")}})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

@app.delete("/api/admin/accounts/<username>")
@admin_required
def api_admin_delete_account(username):
  # Deletes the account and frees its player name. Tournament history is untouched.
  try:
    username = username.strip().lower()
    doc = kv_get_json(user_key(username))
    if not doc:
      return jsonify({"error": "No account with that username."}), 404
    claim = kv_get_json(claim_key(doc["player_name"])) or {}
    if claim.get("username") == username:
      kv_del(claim_key(doc["player_name"]))
    kv_del(user_key(username))
    kv_del(f"loginfail_{username}")
    kv_del(saved_decks_key(username))
    return jsonify({"ok": True})
  except Exception as e:
    return jsonify({"error": str(e)}), 500

# ── All-player leaderboard ───────────────────────────────────────────────────

@app.get("/api/all-player-stats")
def api_all_player_stats():
  try:
    idx = _rebuild_tournament_index()
    fmt = (request.args.get("format") or "").strip().lower()
    if fmt in ("standard", "retro"):
      idx = [e for e in idx if e.get("format", "standard") == fmt]
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
            "draws": 0,
            "byes": 0,
            "omw_sum": 0.0,
            "omw_count": 0,
          }
        s = player_map[name_key]
        s["tournaments"] += 1
        s["wins"] += node.wins_excl_bye()
        s["losses"] += len(node.losses)
        s["draws"] += len(node.draws)
        s["byes"] += node.num_byes()
        omw = opp_win_pct(node) * 100.0
        s["omw_sum"] += omw
        s["omw_count"] += 1

    result = []
    for s in player_map.values():
      total = s["wins"] + s["losses"] + s["draws"]
      result.append({
        "name": s["name"],
        "tournaments": s["tournaments"],
        "wins": s["wins"],
        "losses": s["losses"],
        "draws": s["draws"],
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
    fmt = (request.args.get("format") or "").strip().lower()
    if fmt in ("standard", "retro"):
      idx = [e for e in idx if e.get("format", "standard") == fmt]
    arch_stats: Dict[str, dict] = {}
    total_entries = 0

    for entry in idx:
      t = kv_get_json(tid_key(entry["id"]))
      if not t:
        continue
      nodes = rebuild_graph(t)
      standings = compute_standings(t)
      tp = len(t.get("players", []))
      top_cut = max(4, tp // 4)
      rank_map = {r["player_id"]: r["rank"] for r in standings}

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
        rank = rank_map.get(p["id"], tp)
        topped = rank <= top_cut
        for arch in archetypes:
          if arch not in arch_stats:
            arch_stats[arch] = {"count": 0, "wins": 0, "losses": 0, "topped": 0, "ranks": []}
          arch_stats[arch]["count"] += 1
          arch_stats[arch]["wins"] += pw
          arch_stats[arch]["losses"] += pl
          arch_stats[arch]["ranks"].append(rank)
          if topped:
            arch_stats[arch]["topped"] += 1
          total_entries += 1

    result = []
    for arch, stats in sorted(arch_stats.items(), key=lambda x: -x[1]["count"]):
      total_matches = stats["wins"] + stats["losses"]
      share = round(stats["count"] / total_entries * 100, 1) if total_entries else 0
      conversion = round(stats["topped"] / stats["count"] * 100, 1) if stats["count"] else 0
      avg_place = round(sum(stats["ranks"]) / len(stats["ranks"]), 1) if stats["ranks"] else 0
      result.append({
        "archetype": arch,
        "count": stats["count"],
        "share": share,
        "wins": stats["wins"],
        "losses": stats["losses"],
        "win_rate": round(stats["wins"] / total_matches * 100, 1) if total_matches else 0,
        "topped": stats["topped"],
        "conversion": conversion,
        "avg_placement": avg_place,
        "tier": _compute_tier(share, conversion),
      })

    return jsonify({"metagame": result, "total_entries": total_entries})
  except Exception as e:
    return jsonify({"error": str(e)}), 500
