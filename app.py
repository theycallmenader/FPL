"""FPL dashboard application."""
import os
import threading
import time
from statistics import fmean
from typing import Any, Dict, Iterable, List

import requests
from flask import Flask, jsonify, render_template

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False  # Preserve ordering for readability on the client

FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"
FPL_ELEMENT_SUMMARY_URL = "https://fantasy.premierleague.com/api/element-summary/{player_id}/"
FPL_FIXTURES_URL = "https://fantasy.premierleague.com/api/fixtures/"

CACHE_TTL = int(os.getenv("FPL_CACHE_TTL", 60 * 5))  # seconds
PLAYER_CACHE_TTL = int(os.getenv("FPL_PLAYER_CACHE_TTL", 60 * 10))
FIXTURES_CACHE_TTL = int(os.getenv("FPL_FIXTURES_CACHE_TTL", 60 * 15))
REQUEST_TIMEOUT = int(os.getenv("FPL_REQUEST_TIMEOUT", 15))

_cache: Dict[str, Any] = {"data": None, "timestamp": 0.0}
_cache_lock = threading.Lock()

_player_cache: Dict[int, Dict[str, Any]] = {}
_player_cache_meta: Dict[int, float] = {}
_player_cache_lock = threading.Lock()

_fixtures_cache: Dict[str, Any] = {"data": None, "timestamp": 0.0}
_fixtures_lock = threading.Lock()

POSITION_MAP = {
    1: "Goalkeeper",
    2: "Defender",
    3: "Midfielder",
    4: "Forward",
}


def http_get(url: str) -> requests.Response:
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response





def fetch_bootstrap_data() -> Dict[str, Any]:
    """Retrieve the Fantasy Premier League bootstrap dataset."""
    return http_get(FPL_BOOTSTRAP_URL).json()


def fetch_element_summary(player_id: int) -> Dict[str, Any]:
    """Fetch per-player historical data from the FPL API."""
    url = FPL_ELEMENT_SUMMARY_URL.format(player_id=player_id)
    return http_get(url).json()


def fetch_fixtures() -> List[Dict[str, Any]]:
    """Retrieve fixture information used for upcoming difficulty grids."""
    return http_get(FPL_FIXTURES_URL).json()


def get_bootstrap_data() -> Dict[str, Any]:
    """Return cached bootstrap data, refreshing it when the TTL expires."""
    now = time.time()
    with _cache_lock:
        is_stale = not _cache["data"] or (now - _cache["timestamp"] > CACHE_TTL)
        if is_stale:
            data = fetch_bootstrap_data()
            _cache["data"] = data
            _cache["timestamp"] = now
    return _cache["data"]





def get_element_summary(player_id: int) -> Dict[str, Any]:
    """Return cached per-player history, refreshing on expiry."""
    now = time.time()
    with _player_cache_lock:
        cached = _player_cache.get(player_id)
        timestamp = _player_cache_meta.get(player_id, 0.0)
        if cached and now - timestamp < PLAYER_CACHE_TTL:
            return cached
    data = fetch_element_summary(player_id)
    with _player_cache_lock:
        _player_cache[player_id] = data
        _player_cache_meta[player_id] = now
    return data


def get_fixtures() -> List[Dict[str, Any]]:
    """Return cached fixture data, refreshing on expiry."""
    now = time.time()
    with _fixtures_lock:
        cached = _fixtures_cache.get("data")
        timestamp = _fixtures_cache.get("timestamp", 0.0)
        if cached and now - timestamp < FIXTURES_CACHE_TTL:
            return cached
    fixtures = fetch_fixtures()
    with _fixtures_lock:
        _fixtures_cache["data"] = fixtures
        _fixtures_cache["timestamp"] = now
    return fixtures



def to_float(value: Any) -> float:
    """Convert API values that may be strings to floats safely."""
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def build_player_payload(
    player: Dict[str, Any],
    teams: Dict[int, str],
    short_names: Dict[int, str],
) -> Dict[str, Any]:
    """Normalise raw FPL player data for the client dashboard."""
    team_id = player["team"]
    return {
        "id": player["id"],
        "first_name": player["first_name"],
        "second_name": player["second_name"],
        "web_name": player["web_name"],
        "team": teams.get(team_id, "Unknown"),
        "team_short": short_names.get(team_id, ""),
        "position": POSITION_MAP.get(player["element_type"], "Unknown"),
        "total_points": player.get("total_points", 0),
        "now_cost": player.get("now_cost", 0) / 10,
        "selected_by_percent": to_float(player.get("selected_by_percent", 0.0)),
        "form": to_float(player.get("form", 0.0)),
        "ict_index": to_float(player.get("ict_index", 0.0)),
        "minutes": player.get("minutes", 0),
        "goals_scored": player.get("goals_scored", 0),
        "assists": player.get("assists", 0),
        "clean_sheets": player.get("clean_sheets", 0),
        "influence": to_float(player.get("influence", 0.0)),
        "creativity": to_float(player.get("creativity", 0.0)),
        "threat": to_float(player.get("threat", 0.0)),
        "points_per_game": to_float(player.get("points_per_game", 0.0)),
        "value_form": to_float(player.get("value_form", 0.0)),
        "value_season": to_float(player.get("value_season", 0.0)),
        "expected_points_next": to_float(player.get("ep_next", 0.0)),
        "expected_points_this": to_float(player.get("ep_this", 0.0)),
        "expected_goals": to_float(player.get("expected_goals", 0.0)),
        "expected_assists": to_float(player.get("expected_assists", 0.0)),
        "expected_goal_involvements": to_float(player.get("expected_goal_involvements", 0.0)),
        "expected_goals_per_90": to_float(player.get("expected_goals_per_90", 0.0)),
        "expected_assists_per_90": to_float(player.get("expected_assists_per_90", 0.0)),
        "expected_goal_involvements_per_90": to_float(player.get("expected_goal_involvements_per_90", 0.0)),
    }


def average(values: Iterable[float]) -> float:
    """Return the mean of iterable values, guarding against empties."""
    items = [value for value in values if value is not None]
    return fmean(items) if items else 0.0


def summarise_players(
    players: Iterable[Dict[str, Any]],
    teams_meta: Iterable[Dict[str, Any]],
) -> Dict[str, Any]:
    """Generate derived statistics for dashboard summary widgets and charts."""
    player_list = list(players)
    teams_meta_list = list(teams_meta)

    top_by_points = sorted(player_list, key=lambda p: p["total_points"], reverse=True)[:5]
    top_by_form = sorted(player_list, key=lambda p: p["form"], reverse=True)[:5]
    top_by_value = sorted(player_list, key=lambda p: p["value_form"], reverse=True)[:5]
    top_expected_points = sorted(
        player_list, key=lambda p: p["expected_points_next"], reverse=True
    )[:5]
    top_expected_goals = sorted(
        player_list, key=lambda p: p["expected_goals"], reverse=True
    )[:5]
    top_expected_assists = sorted(
        player_list, key=lambda p: p["expected_assists"], reverse=True
    )[:5]

    team_points: Dict[str, float] = {}
    team_xgi: Dict[str, float] = {}
    position_points: Dict[str, float] = {}
    position_xgi: Dict[str, float] = {}

    for player in player_list:
        team_name = player["team"]
        team_points[team_name] = team_points.get(team_name, 0.0) + player["total_points"]
        team_xgi[team_name] = team_xgi.get(team_name, 0.0) + player["expected_goal_involvements"]

        position = player["position"]
        position_points[position] = position_points.get(position, 0.0) + player["total_points"]
        position_xgi[position] = position_xgi.get(position, 0.0) + player[
            "expected_goal_involvements"
        ]

    top_teams = sorted(team_points.items(), key=lambda kv: kv[1], reverse=True)[:8]
    team_xgi_leaders = sorted(team_xgi.items(), key=lambda kv: kv[1], reverse=True)[:8]
    position_breakdown = sorted(position_points.items(), key=lambda kv: kv[1], reverse=True)
    position_xgi_breakdown = sorted(position_xgi.items(), key=lambda kv: kv[1], reverse=True)

    top_xgi_player = max(
        player_list, key=lambda p: p["expected_goal_involvements"], default=None
    )

    kpis = {
        "average_points_per_game": average(player["points_per_game"] for player in player_list),
        "average_expected_points_next": average(
            player["expected_points_next"] for player in player_list
        ),
        "total_expected_goal_involvements": sum(
            p["expected_goal_involvements"] for p in player_list
        ),
        "top_xgi_player": {
            "name": top_xgi_player["web_name"] if top_xgi_player else None,
            "team": top_xgi_player["team"] if top_xgi_player else None,
            "value": top_xgi_player["expected_goal_involvements"] if top_xgi_player else 0.0,
        },
    }

    xgi_vs_minutes = [
        {
            "id": player["id"],
            "web_name": player["web_name"],
            "team": player["team"],
            "team_short": player.get("team_short", ""),
            "position": player["position"],
            "minutes": player["minutes"],
            "xgi_per_90": round(player["expected_goal_involvements_per_90"], 2),
            "xgi_total": round(player["expected_goal_involvements"], 2),
            "expected_points_next": round(player["expected_points_next"], 2),
        }
        for player in player_list
        if player["minutes"] >= 180
    ]
    xgi_vs_minutes.sort(key=lambda item: item["xgi_per_90"], reverse=True)

    player_lookup = [
        {
            "id": player["id"],
            "web_name": player["web_name"],
            "team": player["team"],
            "team_short": player.get("team_short", ""),
            "position": player["position"],
        }
        for player in sorted(player_list, key=lambda p: p["web_name"])
    ]

    team_strength = [
        {
            "team": team["name"],
            "team_short": team.get("short_name", ""),
            "attack": fmean(
                [
                    float(team.get("strength_attack_home", 0)),
                    float(team.get("strength_attack_away", 0)),
                ]
            ),
            "defence": fmean(
                [
                    float(team.get("strength_defence_home", 0)),
                    float(team.get("strength_defence_away", 0)),
                ]
            ),
            "overall": float(team.get("strength", 0)),
        }
        for team in teams_meta_list
    ]
    team_strength.sort(key=lambda item: item["overall"])  # lower value = tougher opponent

    return {
        "top_by_points": top_by_points,
        "top_by_form": top_by_form,
        "top_by_value": top_by_value,
        "top_expected_points": top_expected_points,
        "top_expected_goals": top_expected_goals,
        "top_expected_assists": top_expected_assists,
        "top_teams": top_teams,
        "team_xgi_leaders": team_xgi_leaders,
        "position_breakdown": position_breakdown,
        "position_xgi": position_xgi_breakdown,
        "kpis": kpis,
        "xgi_vs_minutes": xgi_vs_minutes,
        "player_lookup": player_lookup,
        "team_strength": team_strength,
    }



def transform_players(
    raw_players: Iterable[Dict[str, Any]],
    teams: Dict[int, str],
    short_names: Dict[int, str],
) -> List[Dict[str, Any]]:
    """Map and sort the players returned from the FPL API."""
    players = [build_player_payload(player, teams, short_names) for player in raw_players]
    return sorted(players, key=lambda p: p["total_points"], reverse=True)


def build_upcoming_fixtures(
    fixtures: Iterable[Dict[str, Any]],
    team_names: Dict[int, str],
    short_names: Dict[int, str],
    limit: int = 5,
) -> List[Dict[str, Any]]:
    """Return upcoming fixtures grouped per team for heatmap visualisation."""
    grouped: Dict[int, List[Dict[str, Any]]] = {team_id: [] for team_id in team_names.keys()}

    for fixture in fixtures:
        if fixture.get("event") is None:
            continue
        if fixture.get("finished") or fixture.get("finished_provisional"):
            continue

        event = fixture.get("event")
        kickoff = fixture.get("kickoff_time")
        home_team = fixture.get("team_h")
        away_team = fixture.get("team_a")

        if home_team is None or away_team is None:
            continue

        grouped[home_team].append(
            {
                "event": event,
                "opponent": team_names.get(away_team, ""),
                "opponent_short": short_names.get(away_team, ""),
                "difficulty": fixture.get("team_h_difficulty"),
                "was_home": True,
                "kickoff_time": kickoff,
            }
        )
        grouped[away_team].append(
            {
                "event": event,
                "opponent": team_names.get(home_team, ""),
                "opponent_short": short_names.get(home_team, ""),
                "difficulty": fixture.get("team_a_difficulty"),
                "was_home": False,
                "kickoff_time": kickoff,
            }
        )

    upcoming: List[Dict[str, Any]] = []
    for team_id, matches in grouped.items():
        if not matches:
            continue
        matches.sort(key=lambda item: item.get("event", 99))
        trimmed = matches[:limit]
        if not trimmed:
            continue
        avg_difficulty = average(
            float(match["difficulty"]) for match in trimmed if match.get("difficulty") is not None
        )
        upcoming.append(
            {
                "team_id": team_id,
                "team": team_names.get(team_id, ""),
                "team_short": short_names.get(team_id, ""),
                "fixtures": trimmed,
                "average_difficulty": avg_difficulty,
            }
        )

    upcoming.sort(key=lambda item: item["team"])
    return upcoming


def build_player_history_payload(
    summary: Dict[str, Any],
    team_lookup: Dict[int, Dict[str, str]],
) -> Dict[str, Any]:
    """Shape per-player history and upcoming fixtures for the client."""
    history_payload: List[Dict[str, Any]] = []
    for entry in summary.get("history", []):
        opponent = team_lookup.get(entry.get("opponent_team"), {})
        history_payload.append(
            {
                "event": entry.get("round"),
                "total_points": entry.get("total_points", 0),
                "expected_points": to_float(entry.get("expected_points", 0.0)),
                "expected_goal_involvements": to_float(entry.get("expected_goal_involvements", 0.0)),
                "expected_goals": to_float(entry.get("expected_goals", 0.0)),
                "expected_assists": to_float(entry.get("expected_assists", 0.0)),
                "minutes": entry.get("minutes", 0),
                "goals_scored": entry.get("goals_scored", 0),
                "assists": entry.get("assists", 0),
                "value": entry.get("value", 0) / 10,
                "ict_index": to_float(entry.get("ict_index", 0.0)),
                "was_home": entry.get("was_home", False),
                "kickoff_time": entry.get("kickoff_time"),
                "difficulty": entry.get("difficulty"),
                "opponent": opponent.get("name"),
                "opponent_short": opponent.get("short_name"),
            }
        )

    upcoming_payload: List[Dict[str, Any]] = []
    for entry in summary.get("fixtures", []):
        opponent = team_lookup.get(entry.get("opponent_team"), {})
        upcoming_payload.append(
            {
                "event": entry.get("event"),
                "difficulty": entry.get("difficulty"),
                "is_home": entry.get("is_home", False),
                "kickoff_time": entry.get("kickoff_time"),
                "opponent": opponent.get("name") or entry.get("opponent"),
                "opponent_short": opponent.get("short_name"),
            }
        )

    history_payload.sort(key=lambda item: item.get("event", 0))
    upcoming_payload.sort(key=lambda item: item.get("event", 99))

    return {
        "history": history_payload,
        "upcoming": upcoming_payload,
    }


@app.route("/")
def index() -> str:
    return render_template("index.html", cache_ttl=CACHE_TTL)


@app.route("/api/players")
def api_players():
    try:
        data = get_bootstrap_data()
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    teams = {team["id"]: team["name"] for team in data["teams"]}
    short_names = {team["id"]: team.get("short_name", "") for team in data["teams"]}
    players = transform_players(data["elements"], teams, short_names)
    return jsonify({"players": players})


@app.route("/api/summary")
def api_summary():
    try:
        data = get_bootstrap_data()
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    teams = {team["id"]: team["name"] for team in data["teams"]}
    short_names = {team["id"]: team.get("short_name", "") for team in data["teams"]}
    players = transform_players(data["elements"], teams, short_names)
    summary = summarise_players(players, data["teams"])
    return jsonify(summary)


@app.route("/api/players/<int:player_id>/history")
def api_player_history(player_id: int):
    try:
        player_summary = get_element_summary(player_id)
        bootstrap = get_bootstrap_data()
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    team_lookup = {
        team["id"]: {
            "name": team["name"],
            "short_name": team.get("short_name", ""),
        }
        for team in bootstrap["teams"]
    }
    payload = build_player_history_payload(player_summary, team_lookup)
    return jsonify(payload)


@app.route("/api/fixtures/upcoming")
def api_fixtures_upcoming():
    try:
        fixtures = get_fixtures()
        bootstrap = get_bootstrap_data()
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    team_names = {team["id"]: team["name"] for team in bootstrap["teams"]}
    short_names = {team["id"]: team.get("short_name", "") for team in bootstrap["teams"]}
    upcoming = build_upcoming_fixtures(fixtures, team_names, short_names)
    return jsonify({"teams": upcoming})



@app.route("/api/health")
def api_health():
    return jsonify({"status": "ok", "cache_age": time.time() - _cache["timestamp"]})


if __name__ == "__main__":
    app.run(debug=True)
