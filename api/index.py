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



def _bye_already_from_rounds(t: dict) -> set[str]:
    s: set[str] = set()
    for rnd in t.get("rounds", []):
        for m in rnd.get("matches", []):
            if m.get("r") == "BYE" or (m.get("b") in (None, "BYE")):
                if m.get("a"):
                    s.add(m["a"])
    return s

def _bye_history_get(t: dict) -> set[str]:
    arr = t.get("bye_history") or []
    try:
        return set(arr)
    except Exception:
        return set()

def _bye_history_add(t: dict, player_id: str) -> None:
    if not player_id:
        return
    arr = t.get("bye_history")
    if not isinstance(arr, list):
        arr = []
        t["bye_history"] = arr
    if player_id not in arr:
        arr.append(player_id)
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

def _pair_within_bracket(order: list[str], prior_pairs: set[tuple[str, str]]) -> None | list[tuple[str, str]]:
    """
    Backtracking with adjacency bias (1v2,3v4,...) while avoiding rematches.
    No rematch fallback here — caller (_pair_brackets) handles reorders/borrows.
    """
    n = len(order)
    if n == 0:
        return []
    used = [False] * n
    pairs: list[tuple[str, str]] = []
    prior_lookup = {(a, b) if a < b else (b, a) for (a, b) in prior_pairs}

    def bt(i: int) -> bool:
        while i < n and used[i]:
            i += 1
        if i >= n:
            return True
        used[i] = True
        ai = order[i]

        for j in range(i + 1, n):
            if used[j]:
                continue
            aj = order[j]
            if ai == aj:
                continue  # self-pair hard guard
            key = (ai, aj) if ai < aj else (aj, ai)
            if key in prior_lookup:
                continue
            used[j] = True
            pairs.append((ai, aj))
            if bt(i + 1):
                return True
            pairs.pop()
            used[j] = False
        used[i] = False
        return False

    ok = bt(0)
    return pairs if ok else None


def _pair_brackets(
    brackets: list[list[str]],
    prior_pairs: set[tuple[str, str]],
    bye_already: set[str] | None = None,   # optional; pass a set() of players who already had BYE
) -> list[tuple[str, str]]:
    """
    Swiss pairing with:
      - BYE to true last place, avoiding players who've already had a BYE
      - Strong no-repeat preference (reorders + one cross-bracket float)
      - No self-pairs; de-dup input and final validation with global repair fallback
    """
    import random

    bye_already = bye_already or set()

    # --- Preselect BYE (odd total): scan last bracket tail -> head, skipping prior-BYE players
    total_players = sum(len(b) for b in brackets)
    bye_player: str | None = None
    if total_players % 2 == 1:
        chosen = None
        for k in range(len(brackets) - 1, -1, -1):
            if not brackets[k]:
                continue
            for idx in range(len(brackets[k]) - 1, -1, -1):
                cand = brackets[k][idx]
                if cand not in bye_already:
                    chosen = (k, idx, cand)
                    break
            if chosen:
                break
        if chosen is None:
            # everyone already had a BYE; give it to strict last-place tail
            for k in range(len(brackets) - 1, -1, -1):
                if brackets[k]:
                    chosen = (k, len(brackets[k]) - 1, brackets[k][-1])
                    break
        if chosen:
            k, idx, cand = chosen
            bye_player = cand
            del brackets[k][idx]

    def _dedupe(seq: list[str]) -> list[str]:
        seen = set()
        out = []
        for x in seq:
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
        return out

    def try_orderings(base: list[str]) -> list[list[str]]:
        # a handful of deterministic local permutations to break deadlocks
        base = _dedupe(base)  # IMPORTANT: remove duplicate IDs in this working set
        variants = [base[:]]
        n = len(base)
        if n >= 4:
            v = base[:]; v[-1], v[-2] = v[-2], v[-1]; variants.append(v)
            v = base[:]; v[1], v[2] = v[2], v[1]; variants.append(v)
            v = base[:]; v = v[::2] + v[1::2]; variants.append(v)
        if n >= 6:
            v = base[:]; v[2], v[5] = v[5], v[2]; variants.append(v)
        rnd = random.Random(n * 911)  # deterministic per size
        v = base[:]; rnd.shuffle(v); variants.append(v)
        out, seen = [], set()
        for arr in variants:
            t = tuple(arr)
            if t not in seen:
                seen.add(t); out.append(arr)
        return out

    pairs: list[tuple[str, str]] = []
    carry_down: list[str] = []

    def pair_bucket(work: list[str]) -> None | list[tuple[str, str]]:
        work = _dedupe(work)  # de-duplicate within the working list
        for cand in try_orderings(work):
            res = _pair_within_bracket(cand, prior_pairs)
            if res is not None:
                # sanitize any accidental self-pair (belt-and-suspenders)
                res = [(a, b) for (a, b) in res if a != b]
                return res
        return None

    for idx, bucket in enumerate(brackets):
        work = (carry_down + bucket) if carry_down else list(bucket)
        carry_down = []

        work = _dedupe(work)  # de-duplicate again after merge

        if not work:
            continue

        # keep even; float lowest to next bracket if needed
        if len(work) % 2 == 1:
            carry_down = [work.pop()]

        # 1) attempt no-repeat pairing with local reorders
        res = pair_bucket(work)

        # 2) if impossible, borrow ONE from next bracket and try again
        if res is None and idx + 1 < len(brackets):
            next_bucket = list(brackets[idx + 1])
            if next_bucket:
                candidate = next_bucket.pop(0)
                work2 = work + ([candidate] if candidate not in work else [])
                if len(work2) % 2 == 1:
                    carry_down = [work2.pop()] + carry_down
                res = pair_bucket(work2)
                if res is not None:
                    pairs.extend(res)
                    brackets[idx + 1] = next_bucket
                    continue

        if res is not None:
            pairs.extend(res)
            continue

        # 3) LAST resort: minimal repeats greedy (still no self-pair)
        used = [False] * len(work)
        chosen: list[tuple[str, str]] = []
        prior_lookup = {(a, b) if a < b else (b, a) for (a, b) in prior_pairs}

        def greedy_pair():
            for i in range(len(work)):
                if used[i]: continue
                used[i] = True
                best_j = None
                for j in range(i + 1, len(work)):
                    if used[j]: continue
                    a, b = work[i], work[j]
                    if a == b:
                        continue
                    key = (a, b) if a < b else (b, a)
                    if key not in prior_lookup:
                        used[j] = True
                        chosen.append((a, b))
                        break
                    if best_j is None:
                        best_j = j
                else:
                    if best_j is not None:
                        j = best_j
                        used[j] = True
                        a, b = work[i], work[j]
                        if a != b:
                            chosen.append((a, b))
                    else:
                        return False
            return True

        ok = greedy_pair()
        if not ok:
            carry_down = work + carry_down
        else:
            pairs.extend(chosen)

    # Append BYE chosen above
    if bye_player is not None:
        pairs.append((bye_player, "BYE"))

    # --- Final validation ---
    def _valid(ps: list[tuple[str, str]]) -> bool:
        seen_once = set()
        for a, b in ps:
            if a == b:
                return False
            if b == "BYE":
                if a in seen_once:
                    return False
                seen_once.add(a)
                continue
            if a in seen_once or b in seen_once:
                return False
            seen_once.add(a); seen_once.add(b)
        return True

    if _valid(pairs):
        return pairs

    # Emergency repair: global no-rematch backtracking across the whole round
    pool = []
    for a, b in pairs:
        if b == "BYE":
            continue
        pool.extend([a, b])
    pool = _dedupe(pool)

    def _global_backtrack(order: list[str]) -> None | list[tuple[str, str]]:
        n = len(order)
        used = [False] * n
        result: list[tuple[str, str]] = []
        prior_lookup = {(a, b) if a < b else (b, a) for (a, b) in prior_pairs}

        def bt(i: int) -> bool:
            while i < n and used[i]:
                i += 1
            if i >= n:
                return True
            used[i] = True
            ai = order[i]
            for j in range(i + 1, n):
                if used[j]: continue
                aj = order[j]
                if ai == aj: continue
                key = (ai, aj) if ai < aj else (aj, ai)
                if key in prior_lookup:  # try to avoid repeats globally
                    continue
                used[j] = True
                result.append((ai, aj))
                if bt(i + 1):
                    return True
                result.pop()
                used[j] = False
            used[i] = False
            return False

        return result if bt(0) else None

    # Try a few deterministic permutations before giving up
    for seed in (123, 321, 777, 991):
        rnd = random.Random(seed)
        cand = pool[:]; rnd.shuffle(cand)
        rebuilt = _global_backtrack(cand)
        if rebuilt:
            # keep the same BYE if present
            if bye_player is not None:
                rebuilt.append((bye_player, "BYE"))
            if _valid(rebuilt):
                return rebuilt

    # If still not valid (extremely unlikely), last-sanitize: remove any self-pairs and dup edges
    final = []
    seen_edges = set()
    used_players = set()
    for a, b in pairs:
        if a == b:
            continue
        if b == "BYE":
            if a in used_players:
                continue
            used_players.add(a)
            final.append((a, b))
            continue
        if a in used_players or b in used_players:
            continue
        key = (a, b) if a < b else (b, a)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        used_players.add(a); used_players.add(b)
        final.append((a, b))
    return final


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
# Restart current round (clear & re-pair same round)
# ──────────────────────────────────────────────────────────────────────────────

def restart_current_round_doc(t: dict) -> tuple[int, list[dict]] | tuple[None, str]:
    """
    Pop the latest (active) round and regenerate its pairings using current rules.
    Returns (round_no, matches) on success, or (None, error_message) on failure.
    """
    # Must have at least one round and it must still be active (has PENDING/ BYE)
    last = latest_round(t)
    if not last:
        return None, "no round to restart"
    # If round is fully finalized, do not restart
    if not round_has_pending(last):
        return None, "round already finalized"

    # Remove the active round completely to avoid counting its pairs as 'prior'
    t["rounds"].pop()

    # Re-pair the same round number via pair_next (which computes n = current + 1)
    rnd_no, matches = pair_next(t)
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



@app.post("/api/tournaments/<tid>/restart-round")
def api_restart_round(tid):
    """
    Pop the current (active) round and regenerate pairings for the same round.
    Keeps players and past rounds intact.
    """
    try:
        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404

        # Validate we have an active (unfinalized) round to restart
        last = latest_round(t)
        if not last:
            return jsonify({"ok": False, "message": "No round to restart."}), 400
        if not round_has_pending(last):
            return jsonify({"ok": False, "message": "Round already finalized; cannot restart."}), 400

        # Perform restart
        out = restart_current_round_doc(t)
        if isinstance(out, tuple) and out[0] is None:
            # Error path
            return jsonify({"ok": False, "message": out[1]}), 400

        rnd_no, matches = out

        # Persist updated tournament
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



@app.post("/api/tournaments/<tid>/override-pair")
def api_override_pair(tid):
    """
    Force a specific table matchup, then re-run solver for the remaining players.
    Body accepts either IDs or names:
      { "a": "<player_id>", "b": "<player_id>" }
      or
      { "a_name": "Alice", "b_name": "Bob" }
    If an active round exists, this will POP it and rebuild the same round with the locked table.
    """
    try:
        body = request.get_json(silent=True) or {}
        a = body.get("a"); b = body.get("b")
        a_name = body.get("a_name"); b_name = body.get("b_name")

        t = read_tdoc_or_retry(tid)
        if not t:
            return jsonify({"error": "not found"}), 404

        # Resolve names to IDs if provided
        id_by_name = {p["name"]: p["id"] for p in t.get("players", []) if "id" in p and "name" in p}
        if (not a or not b) and (a_name and b_name):
            a = id_by_name.get(a_name)
            b = id_by_name.get(b_name)

        if not a or not b:
            return jsonify({"ok": False, "message": "Provide 'a' and 'b' (IDs) or 'a_name' and 'b_name'."}), 400
        if a == b:
            return jsonify({"ok": False, "message": "Cannot pair a player with themselves."}), 400

        # If there is an active round, pop it so we re-pair the same round
        last = latest_round(t)
        if last and round_has_pending(last):
            t["rounds"].pop()

        # Build new round with the locked pair
        rnd_no, matches = pair_next_with_overrides(t, [(a, b)])

        # Persist
        t["rounds"].append({"n": rnd_no, "matches": matches})
        kv_set_json(tid_key(tid), t)

        # Return UI-friendly pairs (names)
        id2name = {p["id"]: p["name"] for p in t["players"]}
        pairs = [{
            "table": m["t"],
            "a": id2name.get(m["a"], m["a"]),
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




# ──────────────────────────────────────────────────────────────────────────────
# Manual override: force specific matchup, then re-run solver for the rest
# ──────────────────────────────────────────────────────────────────────────────
def pair_next_with_overrides(t: dict, locked_pairs: list[tuple[str, str]]) -> tuple[int, list[dict]]:
    """
    Like pair_next, but 'locked_pairs' are pre-assigned into the round.
    Each tuple is (player_id_A, player_id_B). These two will be removed from
    the pool, and the solver will pair the remaining players with the usual rules
    (no self-pair, minimize repeats, last-place BYE; avoids repeat BYEs if helpers present).
    """
    nodes, pts_by_id, kts_by_id, id2name = _standings_maps(t)
    prior = prior_pairs_set(t)

    # Dedup player IDs
    seen = set()
    all_ids = []
    for p in t["players"]:
        pid = p["id"]
        if pid not in seen:
            seen.add(pid)
            all_ids.append(pid)

    # Remove locked players from pool and sanitize locked pairs
    locked_flat = set()
    sanitized_locked: list[tuple[str, str]] = []
    for a, b in locked_pairs:
        if not a or not b or a == b:
            continue
        if a in seen and b in seen and a not in locked_flat and b not in locked_flat:
            locked_flat.add(a); locked_flat.add(b)
            sanitized_locked.append((a, b))

    remaining = [pid for pid in all_ids if pid not in locked_flat]

    # Prepare brackets for remaining players
    brackets = _build_brackets(remaining, pts_by_id, kts_by_id, id2name)

    # BYE avoid-set: from saved rounds + persistent bye_history if available
    try:
        bye_seen_rounds = _bye_already_from_rounds(t)
    except NameError:
        bye_seen_rounds = set()
    try:
        bye_history = _bye_history_get(t)
    except NameError:
        bye_history = set()
    bye_already = bye_seen_rounds | bye_history

    # Solve for remaining players (includes possible BYE)
    id_pairs_rest = _pair_brackets(brackets, prior, bye_already=bye_already)

    # Build final list: locked first, then the rest
    rnd_no = current_round_number(t) + 1
    matches: list[dict] = []
    table = 1

    # Locked matches at the top
    for a, b in sanitized_locked:
        matches.append({"id": new_id("m"), "t": table, "a": a, "b": b, "r": "PENDING"})
        table += 1

    # Remaining matches (may include BYE)
    bye_recipient = None
    for a, b in id_pairs_rest:
        if b == "BYE":
            bye_recipient = a
            matches.append({"id": new_id("m"), "t": table, "a": a, "b": None, "r": "BYE"})
        else:
            matches.append({"id": new_id("m"), "t": table, "a": a, "b": b, "r": "PENDING"})
        table += 1

    # Persist BYE immediately if persistent BYE history is enabled
    try:
        if bye_recipient:
            _bye_history_add(t, bye_recipient)
    except NameError:
        pass

    return rnd_no, matches
