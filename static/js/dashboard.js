const state = {
  players: [],
  filtered: [],
  currentSort: { key: "total_points", direction: "desc" },
  focusPlayerId: null,
  playerLookup: [],
  fixtures: [],
  teamStrength: [],
};

const charts = {};
const playerHistoryCache = new Map();

const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const palette = [
  "#38bdf8",
  "#7c3aed",
  "#22d3ee",
  "#f97316",
  "#f472b6",
  "#34d399",
  "#60a5fa",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
];

const positionColors = {
  Goalkeeper: "#38bdf8",
  Defender: "#34d399",
  Midfielder: "#f97316",
  Forward: "#fb7185",
};

function difficultyClass(difficulty) {
  if (!Number.isFinite(difficulty)) {
    return "difficulty-unknown";
  }
  const clamped = Math.min(5, Math.max(1, Math.round(difficulty)));
  return `difficulty-${clamped}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function renderList(id, items, getLabel, getValue) {
  const target = document.getElementById(id);
  if (!target) {
    return;
  }
  target.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = getLabel(item);
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = getValue(item);
    li.append(label, value);
    target.append(li);
  });
}

function updateSummary(summary) {
  renderList(
    "top-points",
    summary.top_by_points || [],
    (p) => p.web_name,
    (p) => `${p.total_points} pts`,
  );
  renderList(
    "top-form",
    summary.top_by_form || [],
    (p) => p.web_name,
    (p) => p.form.toFixed(1),
  );
  renderList(
    "top-value",
    summary.top_by_value || [],
    (p) => p.web_name,
    (p) => p.value_form.toFixed(2),
  );
  renderList(
    "top-teams",
    summary.top_teams || [],
    (t) => t[0],
    (t) => `${numberFormat.format(t[1])} pts`,
  );
  renderList(
    "position-breakdown",
    summary.position_breakdown || [],
    (p) => p[0],
    (p) => `${numberFormat.format(p[1])} pts`,
  );
  renderList(
    "top-expected-points",
    summary.top_expected_points || [],
    (p) => p.web_name,
    (p) => `${p.expected_points_next.toFixed(1)} exp`,
  );
  renderList(
    "top-expected-goals",
    summary.top_expected_goals || [],
    (p) => p.web_name,
    (p) => `${p.expected_goals.toFixed(2)} xG`,
  );
  renderList(
    "top-expected-assists",
    summary.top_expected_assists || [],
    (p) => p.web_name,
    (p) => `${p.expected_assists.toFixed(2)} xA`,
  );
  renderList(
    "team-xgi",
    summary.team_xgi_leaders || [],
    (t) => t[0],
    (t) => `${numberFormat.format(t[1])} xGI`,
  );
}

function updateKpis(kpis) {
  if (!kpis) {
    return;
  }
  const avgPpg = document.getElementById("kpi-avg-ppg");
  const avgExpPoints = document.getElementById("kpi-avg-expected-points");
  const totalXgi = document.getElementById("kpi-total-xgi");
  const topXgiPlayer = document.getElementById("kpi-top-xgi-player");
  const topXgiValue = document.getElementById("kpi-top-xgi-value");

  if (avgPpg) {
    avgPpg.textContent = kpis.average_points_per_game.toFixed(2);
  }
  if (avgExpPoints) {
    avgExpPoints.textContent = kpis.average_expected_points_next.toFixed(2);
  }
  if (totalXgi) {
    totalXgi.textContent = numberFormat.format(kpis.total_expected_goal_involvements);
  }
  if (topXgiPlayer && topXgiValue) {
    const top = kpis.top_xgi_player || {};
    topXgiPlayer.textContent = top.name ? `${top.name}${top.team ? ` (${top.team})` : ""}` : "-";
    topXgiValue.textContent = top.name ? `${top.value.toFixed(2)} xGI` : "";
  }
}

function buildFilters(players) {
  const positions = Array.from(new Set(players.map((p) => p.position))).sort();
  const teams = Array.from(new Set(players.map((p) => p.team))).sort();

  const positionSelect = document.getElementById("position-filter");
  const teamSelect = document.getElementById("team-filter");

  const previousPosition = positionSelect.value;
  const previousTeam = teamSelect.value;

  while (positionSelect.options.length > 1) {
    positionSelect.remove(1);
  }
  while (teamSelect.options.length > 1) {
    teamSelect.remove(1);
  }

  positions.forEach((position) => {
    const option = document.createElement("option");
    option.value = position;
    option.textContent = position;
    positionSelect.append(option);
  });

  teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = team;
    option.textContent = team;
    teamSelect.append(option);
  });

  if (Array.from(positionSelect.options).some((opt) => opt.value === previousPosition)) {
    positionSelect.value = previousPosition;
  }
  if (Array.from(teamSelect.options).some((opt) => opt.value === previousTeam)) {
    teamSelect.value = previousTeam;
  }
}

function buildPlayerSelect(playerLookup) {
  const select = document.getElementById("player-insights-select");
  if (!select) {
    return;
  }

  const previous = select.value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a player...";
  select.append(placeholder);

  playerLookup.forEach((player) => {
    const option = document.createElement("option");
    option.value = String(player.id);
    const teamLabel = player.team_short || player.team || "";
    option.textContent = teamLabel
      ? `${player.web_name} (${teamLabel})`
      : player.web_name;
    select.append(option);
  });

  if (previous && Array.from(select.options).some((opt) => opt.value === previous)) {
    select.value = previous;
  } else if (state.focusPlayerId) {
    select.value = String(state.focusPlayerId);
  }
}

function applyFilters() {
  const positionFilter = document.getElementById("position-filter").value;
  const teamFilter = document.getElementById("team-filter").value;
  const searchValue = document.getElementById("search-filter").value.trim().toLowerCase();

  state.filtered = state.players.filter((player) => {
    const matchesPosition = positionFilter === "all" || player.position === positionFilter;
    const matchesTeam = teamFilter === "all" || player.team === teamFilter;
    const matchesSearch =
      searchValue.length === 0 ||
      player.web_name.toLowerCase().includes(searchValue) ||
      player.team.toLowerCase().includes(searchValue);
    return matchesPosition && matchesTeam && matchesSearch;
  });

  sortPlayers(state.currentSort.key, state.currentSort.direction, false);
  renderTable();
}

function sortPlayers(key, direction, toggle = true) {
  if (toggle) {
    if (state.currentSort.key === key) {
      direction = state.currentSort.direction === "asc" ? "desc" : "asc";
    }
  }

  state.currentSort = { key, direction };
  const multiplier = direction === "asc" ? 1 : -1;

  state.filtered.sort((a, b) => {
    const aValue = a[key];
    const bValue = b[key];
    if (typeof aValue === "number" && typeof bValue === "number") {
      return (aValue - bValue) * multiplier;
    }
    return aValue.toString().localeCompare(bValue.toString()) * multiplier;
  });

  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll("#players-table th").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.sort === state.currentSort.key) {
      th.classList.add(state.currentSort.direction === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });
}

function renderTable() {
  const tbody = document.querySelector("#players-table tbody");
  tbody.innerHTML = "";

  state.filtered.forEach((player) => {
    const row = document.createElement("tr");
    row.dataset.playerId = String(player.id);
    if (state.focusPlayerId === player.id) {
      row.classList.add("selected");
    }
    row.innerHTML = `
      <td>${player.web_name}</td>
      <td>${player.team}</td>
      <td>${player.position}</td>
      <td class="numeric">${player.total_points}</td>
      <td class="numeric">${player.expected_points_next.toFixed(1)}</td>
      <td class="numeric">${player.form.toFixed(1)}</td>
      <td class="numeric">${player.value_form.toFixed(2)}</td>
      <td class="numeric">${percentFormat.format(player.selected_by_percent)}%</td>
      <td class="numeric">${numberFormat.format(player.now_cost)}</td>
      <td class="numeric">${player.minutes}</td>
      <td class="numeric">${player.goals_scored}</td>
      <td class="numeric">${player.assists}</td>
      <td class="numeric">${player.clean_sheets}</td>
      <td class="numeric">${player.expected_goals.toFixed(2)}</td>
      <td class="numeric">${player.expected_assists.toFixed(2)}</td>
      <td class="numeric">${player.expected_goal_involvements.toFixed(2)}</td>
      <td class="numeric">${player.expected_goal_involvements_per_90.toFixed(2)}</td>
      <td class="numeric">${player.points_per_game.toFixed(2)}</td>
    `;
    row.addEventListener("click", () => {
      void setFocusPlayer(player.id, { fromTable: true });
    });
    tbody.append(row);
  });

  document.getElementById("player-count").textContent = `${state.filtered.length} players`;
}

function replaceChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === "undefined") {
    return;
  }
  if (charts[id]) {
    charts[id].destroy();
  }
  charts[id] = new Chart(canvas, config);
}

function renderCoreCharts(summary) {
  if (typeof Chart === "undefined") {
    return;
  }

  const xgLeaders = (summary.top_expected_goals || []).slice(0, 10);
  const xaLeaders = (summary.top_expected_assists || []).slice(0, 10);
  const teamXgi = (summary.team_xgi_leaders || []).slice(0, 8);

  replaceChart("chart-expected-goals", {
    type: "bar",
    data: {
      labels: xgLeaders.map((player) => player.web_name),
      datasets: [
        {
          label: "xG",
          data: xgLeaders.map((player) => player.expected_goals),
          backgroundColor: xgLeaders.map((_, idx) => palette[idx % palette.length]),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
        y: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
      },
    },
  });

  replaceChart("chart-expected-assists", {
    type: "bar",
    data: {
      labels: xaLeaders.map((player) => player.web_name),
      datasets: [
        {
          label: "xA",
          data: xaLeaders.map((player) => player.expected_assists),
          backgroundColor: xaLeaders.map((_, idx) => palette[(idx + 3) % palette.length]),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
        y: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
      },
    },
  });

  replaceChart("chart-team-xgi", {
    type: "bar",
    data: {
      labels: teamXgi.map((team) => team[0]),
      datasets: [
        {
          label: "xGI",
          data: teamXgi.map((team) => team[1]),
          backgroundColor: teamXgi.map((_, idx) => palette[(idx + 6) % palette.length]),
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
        y: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
      },
    },
  });
}

function renderXgiScatter(data = []) {
  if (typeof Chart === "undefined") {
    return;
  }
  if (!data.length) {
    if (charts["chart-xgi-scatter"]) {
      charts["chart-xgi-scatter"].destroy();
      delete charts["chart-xgi-scatter"];
    }
    return;
  }

  const datasetsMap = new Map();
  data.slice(0, 80).forEach((player) => {
    const position = player.position || "Other";
    if (!datasetsMap.has(position)) {
      datasetsMap.set(position, {
        label: position,
        data: [],
        backgroundColor: positionColors[position] || palette[datasetsMap.size % palette.length],
        borderWidth: 0,
        pointRadius: 5,
      });
    }
    datasetsMap.get(position).data.push({
      x: player.minutes,
      y: player.xgi_per_90,
      player,
    });
  });

  replaceChart("chart-xgi-scatter", {
    type: "scatter",
    data: {
      datasets: Array.from(datasetsMap.values()),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label(context) {
              const { player } = context.raw;
              return `${player.web_name} (${player.team_short || player.team}) - ${player.xgi_per_90.toFixed(2)} xGI/90, ${player.minutes} mins`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Minutes played" },
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.12)" },
        },
        y: {
          title: { display: true, text: "xGI per 90" },
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.12)" },
        },
      },
    },
  });
}

function renderTeamBalance(teamStrength = [], fixtures = []) {
  if (typeof Chart === "undefined") {
    return;
  }

  const difficultyMap = new Map();
  fixtures.forEach((team) => {
    difficultyMap.set(team.team, team.average_difficulty);
  });

  const dataset = teamStrength.map((team, idx) => {
    const difficulty = difficultyMap.get(team.team);
    return {
      x: team.attack,
      y: team.defence,
      r: difficulty ? Math.max(4, (6 - difficulty) * 3) : 5,
      team: team.team,
      team_short: team.team_short,
      difficulty,
      backgroundColor: palette[idx % palette.length],
    };
  });

  replaceChart("chart-team-balance", {
    type: "bubble",
    data: {
      datasets: [
        {
          label: "Teams",
          data: dataset,
          backgroundColor: dataset.map((point) => point.backgroundColor),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.raw;
              const name = value.team_short || value.team;
              const difficulty = value.difficulty ? value.difficulty.toFixed(2) : "?";
              return `${name}: attack ${value.x.toFixed(1)}, defence ${value.y.toFixed(1)}, avg diff ${difficulty}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Attack strength (lower = tougher opponent)" },
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.12)" },
        },
        y: {
          title: { display: true, text: "Defence strength (lower = tougher opponent)" },
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.12)" },
        },
      },
    },
  });
}

function renderFixtureHeatmap(fixtures = []) {
  const table = document.getElementById("fixture-heatmap-table");
  if (!table) {
    return;
  }
  if (!fixtures.length) {
    table.innerHTML = '<caption>No upcoming fixture data available.</caption>';
    return;
  }

  const events = Array.from(
    new Set(fixtures.flatMap((team) => team.fixtures.map((fixture) => fixture.event)))
  )
    .filter((event) => event != null)
    .sort((a, b) => a - b);

  table.innerHTML = "";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = `<th>Team</th><th class="numeric">Avg</th>${events
    .map((event) => `<th>GW ${event}</th>`)
    .join("")}`;
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  fixtures.forEach((team) => {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("th");
    nameCell.textContent = team.team_short || team.team;
    tr.append(nameCell);

    const avgCell = document.createElement("td");
    avgCell.className = "numeric";
    avgCell.textContent = Number.isFinite(team.average_difficulty)
      ? team.average_difficulty.toFixed(2)
      : "-";
    tr.append(avgCell);

    events.forEach((event) => {
      const td = document.createElement("td");
      const fixturesForEvent = team.fixtures.filter((fixture) => fixture.event === event);
      if (!fixturesForEvent.length) {
        td.classList.add("empty");
      } else {
        fixturesForEvent.forEach((fixture) => {
          const chip = document.createElement("span");
          chip.className = `fixture-chip ${difficultyClass(fixture.difficulty)}`;
          const location = fixture.was_home ?? fixture.is_home ? "H" : "A";
          const opponent = fixture.opponent_short || fixture.opponent || "TBD";
          const diffLabel = Number.isFinite(fixture.difficulty)
            ? fixture.difficulty
            : "?";
          chip.textContent = `${opponent} ${location} (${diffLabel})`;
          td.append(chip);
        });
      }
      tr.append(td);
    });

    tbody.append(tr);
  });

  table.append(tbody);
}

function updateTableSelection() {
  document.querySelectorAll("#players-table tbody tr").forEach((row) => {
    if (Number(row.dataset.playerId) === state.focusPlayerId) {
      row.classList.add("selected");
    } else {
      row.classList.remove("selected");
    }
  });
}

function clearPlayerInsights() {
  const name = document.getElementById("insights-player-name");
  const team = document.getElementById("insights-player-team");
  const position = document.getElementById("insights-player-position");
  const upcoming = document.getElementById("insights-upcoming");

  if (name) name.textContent = "-";
  if (team) team.textContent = "";
  if (position) position.textContent = "";
  if (upcoming) upcoming.innerHTML = '<li class="empty">Select a player to see upcoming fixtures.</li>';

  ["chart-player-points", "chart-player-price"].forEach((id) => {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  });
}

async function setFocusPlayer(playerId, { fromTable = false, initial = false } = {}) {
  if (!playerId) {
    state.focusPlayerId = null;
    clearPlayerInsights();
    updateTableSelection();
    const select = document.getElementById("player-insights-select");
    if (select && !initial) {
      select.value = "";
    }
    return;
  }

  const numericId = Number(playerId);
  if (!Number.isFinite(numericId)) {
    return;
  }

  state.focusPlayerId = numericId;
  updateTableSelection();

  const select = document.getElementById("player-insights-select");
  if (select && select.value !== String(numericId)) {
    select.value = String(numericId);
  }

  const player = state.players.find((item) => item.id === numericId);
  if (!player) {
    return;
  }

  let history = playerHistoryCache.get(numericId);
  if (!history) {
    try {
      history = await fetchJson(`/api/players/${numericId}/history`);
      playerHistoryCache.set(numericId, history);
    } catch (error) {
      console.error(error);
      setStatus("Unable to load player history.", "error");
      return;
    }
  }

  renderPlayerInsights(player, history);
}

function renderPlayerInsights(player, historyPayload) {
  const name = document.getElementById("insights-player-name");
  const team = document.getElementById("insights-player-team");
  const position = document.getElementById("insights-player-position");

  if (name) {
    name.textContent = player.web_name;
  }
  if (team) {
    const label = player.team_short ? `${player.team} (${player.team_short})` : player.team;
    team.textContent = label;
  }
  if (position) {
    position.textContent = player.position;
  }

  const history = (historyPayload.history || []).slice(-12);
  const upcoming = historyPayload.upcoming || [];
  populateUpcomingList(upcoming);

  if (!history.length) {
    ["chart-player-points", "chart-player-price"].forEach((id) => {
      if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
      }
    });
    return;
  }

  const labels = history.map((entry) => `GW ${entry.event ?? "?"}`);
  const actualPoints = history.map((entry) => entry.total_points || 0);
  const expectedPoints = history.map((entry) => {
    if (entry.expected_points) {
      return entry.expected_points;
    }
    if (entry.expected_goal_involvements) {
      return entry.expected_goal_involvements;
    }
    return 0;
  });

  replaceChart("chart-player-points", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Points",
          data: actualPoints,
          borderColor: palette[0],
          backgroundColor: "transparent",
          tension: 0.25,
        },
        {
          label: "Expected",
          data: expectedPoints,
          borderColor: palette[3],
          backgroundColor: "transparent",
          borderDash: [6, 4],
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.12)" },
        },
        x: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
      },
    },
  });

  const priceSeries = history.map((entry) => entry.value);
  const pointsSeries = history.map((entry) => entry.total_points || 0);

  replaceChart("chart-player-price", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Price (?m)",
          data: priceSeries,
          yAxisID: "y",
          borderColor: palette[5],
          backgroundColor: "transparent",
          tension: 0.25,
        },
        {
          label: "Points",
          data: pointsSeries,
          yAxisID: "y1",
          borderColor: palette[1],
          backgroundColor: "transparent",
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: {
          position: "left",
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.12)" },
        },
        y1: {
          position: "right",
          ticks: { color: "#94a3b8" },
          grid: { drawOnChartArea: false },
        },
        x: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
      },
    },
  });
}

function populateUpcomingList(upcoming) {
  const list = document.getElementById("insights-upcoming");
  if (!list) {
    return;
  }
  list.innerHTML = "";

  if (!upcoming.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No upcoming fixtures tracked.";
    list.append(li);
    return;
  }

  upcoming.slice(0, 5).forEach((fixture) => {
    const li = document.createElement("li");
    const location = fixture.is_home ? "H" : "A";
    const diffClass = difficultyClass(fixture.difficulty);
    li.innerHTML = `GW ${fixture.event || "?"}: <span class="fixture-chip ${diffClass}">${
      fixture.opponent_short || fixture.opponent || "TBD"
    } ${location} (${fixture.difficulty ?? "?"})</span>`;
    list.append(li);
  });
}

function setStatus(message, type = "info") {
  const statusMessage = document.getElementById("status-message");
  statusMessage.textContent = message;
  statusMessage.dataset.variant = type;
}

async function loadDashboard() {
  try {
    setStatus("Loading data...");
    const [summary, playersPayload, fixturesPayload] = await Promise.all([
      fetchJson("/api/summary"),
      fetchJson("/api/players"),
      fetchJson("/api/fixtures/upcoming"),
    ]);

    updateSummary(summary);
    updateKpis(summary.kpis);
    renderCoreCharts(summary);
    renderXgiScatter(summary.xgi_vs_minutes || []);

    state.players = playersPayload.players || [];
    state.playerLookup = summary.player_lookup || [];
    state.fixtures = (fixturesPayload && fixturesPayload.teams) || [];
    state.teamStrength = summary.team_strength || [];

    renderTeamBalance(state.teamStrength, state.fixtures);
    renderFixtureHeatmap(state.fixtures);

    buildFilters(state.players);
    buildPlayerSelect(state.playerLookup);
    applyFilters();

    const defaultFocus =
      state.focusPlayerId ||
      (summary.top_expected_points && summary.top_expected_points[0]
        ? summary.top_expected_points[0].id
        : undefined) ||
      (state.players[0] ? state.players[0].id : undefined);

    if (defaultFocus) {
      await setFocusPlayer(defaultFocus, { initial: true });
    } else {
      clearPlayerInsights();
    }

    setStatus(`Last updated at ${new Date().toLocaleTimeString()}`, "success");
  } catch (error) {
    console.error(error);
    setStatus("Unable to load data. Check the server logs.", "error");
  }
}

function setupEventListeners() {
  document.getElementById("position-filter").addEventListener("change", applyFilters);
  document.getElementById("team-filter").addEventListener("change", applyFilters);
  document.getElementById("search-filter").addEventListener("input", applyFilters);
  document.getElementById("refresh-button").addEventListener("click", () => {
    void loadDashboard();
  });

  document.getElementById("player-insights-select").addEventListener("change", (event) => {
    const value = event.target.value;
    if (value) {
      void setFocusPlayer(Number(value));
    } else {
      void setFocusPlayer(null);
    }
  });

  document.querySelectorAll("#players-table th").forEach((th) => {
    th.addEventListener("click", () => {
      sortPlayers(th.dataset.sort, state.currentSort.direction);
      renderTable();
      updateTableSelection();
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  void loadDashboard();
});
