import time
from typing import Any, Dict, List

import requests
from flask import Flask, jsonify, render_template

app = Flask(__name__)

FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"
CACHE_TTL = 60 * 5  # seconds

_cache: Dict[str, Any] = {"data": None, "timestamp": 0.0}

POSITION_MAP = {
    1: "Goalkeeper",
    2: "Defender",
    3: "Midfielder",
    4: "Forward",
}


def fetch_bootstrap_data() -> Dict[str, Any]:
    """Retrieve the main Fantasy Premier League bootstrap data feed."""
    response = requests.get(FPL_BOOTSTRAP_URL, timeout=15)
    response.raise_for_status()
    return response.json()


def get_bootstrap_data() -> Dict[str, Any]:
    """Return cached bootstrap data, refreshing if it is stale."""
    now = time.time()
    if not _cache["data"] or now - _cache["timestamp"] > CACHE_TTL:
        data = fetch_bootstrap_data()
        _cache["data"] = data
        _cache["timestamp"] = now
    return _cache["data"]


def build_player_payload(player: Dict[str, Any], teams: Dict[int, str], positions: Dict[int, str]) -> Dict[str, Any]:
    return {
        "id": player["id"],
        "first_name": player["first_name"],
        "second_name": player["second_name"],
        "web_name": player["web_name"],
        "team": teams.get(player["team"]),
        "position": positions.get(player["element_type"], "Unknown"),
        "total_points": player["total_points"],
        "now_cost": player["now_cost"] / 10,
        "selected_by_percent": float(player["selected_by_percent"]),
        "form": float(player["form"]),
        "ict_index": float(player["ict_index"]),
        "minutes": player["minutes"],
        "goals_scored": player["goals_scored"],
        "assists": player["assists"],
        "clean_sheets": player["clean_sheets"],
        "influence": float(player["influence"]),
        "creativity": float(player["creativity"]),
        "threat": float(player["threat"]),
        "points_per_game": float(player["points_per_game"]),
        "value_form": float(player["value_form"]),
        "value_season": float(player["value_season"]),
    }


def summarise_players(players: List[Dict[str, Any]]) -> Dict[str, Any]:
    top_by_points = sorted(players, key=lambda p: p["total_points"], reverse=True)[:5]
    top_by_form = sorted(players, key=lambda p: p["form"], reverse=True)[:5]
    top_by_value = sorted(players, key=lambda p: p["value_form"], reverse=True)[:5]

    team_totals: Dict[str, float] = {}
    position_totals: Dict[str, float] = {}

    for player in players:
        team_totals[player["team"]] = team_totals.get(player["team"], 0) + player["total_points"]
        position_totals[player["position"]] = position_totals.get(player["position"], 0) + player["total_points"]

    top_teams = sorted(team_totals.items(), key=lambda kv: kv[1], reverse=True)[:8]
    position_breakdown = sorted(position_totals.items(), key=lambda kv: kv[1], reverse=True)

    return {
        "top_by_points": top_by_points,
        "top_by_form": top_by_form,
        "top_by_value": top_by_value,
        "top_teams": top_teams,
        "position_breakdown": position_breakdown,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/players")
def api_players():
    try:
        data = get_bootstrap_data()
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    teams = {team["id"]: team["name"] for team in data["teams"]}
    players = [
        build_player_payload(player, teams, POSITION_MAP)
        for player in data["elements"]
    ]
    players = sorted(players, key=lambda p: p["total_points"], reverse=True)
    return jsonify({"players": players})


@app.route("/api/summary")
def api_summary():
    try:
        data = get_bootstrap_data()
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    teams = {team["id"]: team["name"] for team in data["teams"]}
    players = [
        build_player_payload(player, teams, POSITION_MAP)
        for player in data["elements"]
    ]

    summary = summarise_players(players)
    return jsonify(summary)


if __name__ == "__main__":
    app.run(debug=True)