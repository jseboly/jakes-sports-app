import './style.css';
import { createClient } from '@neondatabase/neon-js';

const CONFIG = {
  dataApiUrl: 'https://ep-mute-waterfall-aemei0yf.apirest.c-2.us-east-2.aws.neon.tech/neondb/rest/v1',
  authUrl: 'https://ep-mute-waterfall-aemei0yf.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth',
};

const client = createClient({
  auth: {
    url: CONFIG.authUrl,
    allowAnonymous: true,
  },
  dataApi: {
    url: CONFIG.dataApiUrl,
  },
});

const $ = (selector) => document.querySelector(selector);
const state = {
  games: [],
  teams: new Map(),
  standings: [],
  standingsLoaded: false,
  openRounds: new Set(),
  editingGame: null,
};

const els = {
  season: $('#season-filter'),
  region: $('#region-filter'),
  round: $('#round-filter'),
  played: $('#played-filter'),
  team: $('#team-filter'),
  rounds: $('#rounds-list'),
  summary: $('#results-summary'),
  status: $('#status-message'),
  lastUpdated: $('#last-updated'),
  scoreDialog: $('#score-dialog'),
  scoreForm: $('#score-form'),
  scoreError: $('#score-error'),
  scoreSave: $('#score-save'),
  markFilteredPlayed: $('#mark-filtered-played'),
  resultsNav: $('#results-nav'),
  standingsNav: $('#standings-nav'),
  resultsPage: $('#results-page'),
  standingsPage: $('#standings-page'),
  standingsSeason: $('#standings-season-filter'),
  standingsRegion: $('#standings-region-filter'),
  standingsSort: $('#standings-sort'),
  standingsDirection: $('#standings-direction'),
  standingsSummary: $('#standings-summary'),
  standingsStatus: $('#standings-status'),
  standingsRows: $('#standings-rows'),
};

function setStatus(message, kind = '') {
  els.status.textContent = message;
  els.status.className = `status-message ${kind}`.trim();
  els.status.hidden = !message;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayNumber(value, decimalPlaces = null) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return decimalPlaces === null ? String(n) : n.toFixed(decimalPlaces);
}

function teamSeasonKey(regId, seasonId) {
  return JSON.stringify([String(seasonId ?? ''), String(regId ?? '')]);
}

function getTeamName(regId, seasonId) {
  return state.teams.get(teamSeasonKey(regId, seasonId))?.name ?? `Team ${regId}`;
}

async function loadData() {
  setStatus('Loading games and teams…');
  try {
    const [gamesResult, teamsResult] = await Promise.all([
      client.from('RegionalGame')
        .select('id, region, round, played, home, visitor, h_perf, v_perf, override_h_score, override_v_score, season_id')
        .order('season_id', { ascending: false })
        .order('round', { ascending: true }),
      client.from('TeamSeason').select('reg_id, season_id, name, rating').order('name', { ascending: true }),
    ]);

    if (gamesResult?.error) throw gamesResult.error;
    if (teamsResult?.error) throw teamsResult.error;

    state.games = gamesResult?.data ?? [];
    state.teams = new Map((teamsResult?.data ?? []).map((team) => [
      teamSeasonKey(team.reg_id, team.season_id),
      { name: team.name, rating: toNumberOrNull(team.rating) },
    ]));
    populateFilters();
    renderGames();
    setStatus(state.games.length ? '' : 'No games were returned. Check database permissions and table names.', state.games.length ? '' : 'notice');
    els.lastUpdated.textContent = `Loaded ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) {
    console.error('Could not load sports data:', error);
    setStatus(
      'Could not load games. Check the Data API connection, Neon Auth anonymous access, table exposure, and SELECT policies. See README.md for setup checks.',
      'error',
    );
    els.summary.textContent = 'Database connection needs attention.';
  }
}

function populateSelect(select, values, allLabel, formatter = (value) => value) {
  const previous = select.value;
  select.replaceChildren(new Option(allLabel, ''));
  values.forEach((value) => select.add(new Option(formatter(value), String(value))));
  if (values.some((value) => String(value) === previous)) select.value = previous;
}

function compareStandingsValues(left, right, direction) {
  const leftMissing = left === null || left === undefined || left === '';
  const rightMissing = right === null || right === undefined || right === '';
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  const comparison = bothNumeric
    ? leftNumber - rightNumber
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? comparison : -comparison;
}

function getStandingsSortKeys() {
  const selectedSort = els.standingsSort.value;
  if (selectedSort === 'default') {
    return [
      { key: 'season_id', direction: 'desc' },
      { key: 'wins', direction: 'desc' },
      { key: 'rating', direction: 'desc' },
    ];
  }

  return [
    { key: selectedSort, direction: els.standingsDirection.value },
    ...[
      { key: 'season_id', direction: 'desc' },
      { key: 'wins', direction: 'desc' },
      { key: 'rating', direction: 'desc' },
    ].filter(({ key }) => key !== selectedSort),
  ];
}

function filteredStandings() {
  const season = els.standingsSeason.value;
  const region = els.standingsRegion.value;
  const sortKeys = getStandingsSortKeys();

  return state.standings
    .filter((team) => (!season || String(team.season_id ?? '') === season)
      && (!region || String(team.region ?? '') === region))
    .sort((left, right) => {
      for (const { key, direction } of sortKeys) {
        const comparison = compareStandingsValues(left[key], right[key], direction);
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
}

function renderStandings() {
  const standings = filteredStandings();
  els.standingsSummary.textContent = `${standings.length} team${standings.length === 1 ? '' : 's'}`;
  els.standingsDirection.disabled = els.standingsSort.value === 'default';
  els.standingsRows.innerHTML = standings.length
    ? standings.map((team) => `
      <tr>
        <td>${escapeHtml(team.season_id ?? '—')}</td>
        <td>${escapeHtml(team.name ?? '—')}</td>
        <td>${escapeHtml(team.region ?? '—')}</td>
        <td>${escapeHtml(displayNumber(team.rating))}</td>
        <td>${escapeHtml(displayNumber(team.proxy))}</td>
        <td>${escapeHtml(displayNumber(team.wins))}</td>
        <td>${escapeHtml(displayNumber(team.losses))}</td>
      </tr>`).join('')
    : '<tr><td class="table-empty" colspan="7">No teams match these filters.</td></tr>';
}

async function loadStandings() {
  if (state.standingsLoaded) return;
  els.standingsStatus.textContent = 'Loading standings…';
  els.standingsStatus.className = 'status-message';
  try {
    const result = await client.from('RegionalTeamsFullView')
      .select('season_id, name, region, rating, proxy, wins, losses')
      .order('season_id', { ascending: false })
      .order('wins', { ascending: false })
      .order('rating', { ascending: false });

    if (result?.error) throw result.error;
    state.standings = result?.data ?? [];
    state.standingsLoaded = true;

    const seasons = [...new Set(state.standings
      .map((team) => team.season_id)
      .filter((value) => value !== null && value !== undefined))]
      .sort((a, b) => compareStandingsValues(a, b, 'desc'));
    const regions = [...new Set(state.standings.map((team) => team.region).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));
    populateSelect(els.standingsSeason, seasons, 'All seasons');
    populateSelect(els.standingsRegion, regions, 'All regions');

    els.standingsStatus.textContent = '';
    els.standingsStatus.hidden = true;
    renderStandings();
  } catch (error) {
    console.error('Could not load standings:', error);
    els.standingsStatus.textContent = 'Could not load standings. Check that RegionalTeamsFullView is exposed to the Data API and has the required SELECT permissions.';
    els.standingsStatus.className = 'status-message error';
    els.standingsStatus.hidden = false;
  }
}

async function showPage(page) {
  const isStandings = page === 'standings';
  els.resultsPage.hidden = isStandings;
  els.standingsPage.hidden = !isStandings;
  els.resultsNav.classList.toggle('is-active', !isStandings);
  els.standingsNav.classList.toggle('is-active', isStandings);
  if (isStandings) {
    els.standingsNav.setAttribute('aria-current', 'page');
    els.resultsNav.removeAttribute('aria-current');
    await loadStandings();
  } else {
    els.resultsNav.setAttribute('aria-current', 'page');
    els.standingsNav.removeAttribute('aria-current');
  }
}

function populateFilters() {
  const seasons = [...new Set(state.games.map((game) => game.season_id).filter((v) => v !== null))]
    .sort((a, b) => Number(b) - Number(a));
  const regions = [...new Set(state.games.map((game) => game.region).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
  const rounds = [...new Set(state.games.map((game) => game.round).filter((v) => v !== null))]
    .sort((a, b) => Number(a) - Number(b));
  populateSelect(els.season, seasons, 'All seasons');
  populateSelect(els.region, regions, 'All regions');
  populateSelect(els.round, rounds, 'All rounds', (value) => `Round ${value}`);
}

function filteredGames() {
  const season = els.season.value;
  const region = els.region.value;
  const round = els.round.value;
  const played = els.played.value;
  const teamQuery = els.team.value.trim().toLocaleLowerCase();

  return state.games.filter((game) => {
    if (season && String(game.season_id ?? '') !== season) return false;
    if (region && String(game.region ?? '') !== region) return false;
    if (round && String(game.round) !== round) return false;
    if (played === 'played' && game.played !== true) return false;
    if (played === 'unplayed' && game.played === true) return false;
    if (teamQuery) {
      const homeName = getTeamName(game.home, game.season_id);
      const visitorName = getTeamName(game.visitor, game.season_id);
      if (!`${homeName} ${visitorName}`.toLocaleLowerCase().includes(teamQuery)) return false;
    }
    return true;
  });
}

function scoreInfo(game) {
  const homeOverride = toNumberOrNull(game.override_h_score);
  const visitorOverride = toNumberOrNull(game.override_v_score);
  const homePerf = toNumberOrNull(game.h_perf);
  const visitorPerf = toNumberOrNull(game.v_perf);
  const isPlayed = game.played === true;

  if (!isPlayed) {
    return {
      home: state.teams.get(teamSeasonKey(game.home, game.season_id))?.rating ?? null,
      visitor: state.teams.get(teamSeasonKey(game.visitor, game.season_id))?.rating ?? null,
      decimalPlaces: 1,
      label: 'Team rating',
      winner: null,
    };
  }

  if (homeOverride !== null && visitorOverride !== null) {
    return {
      home: homeOverride, visitor: visitorOverride, label: 'Actual score',
      winner: homeOverride === visitorOverride ? 'tie' : homeOverride > visitorOverride ? 'home' : 'visitor',
    };
  }
  if (homeOverride === null && visitorOverride === null) {
    const homeRating = state.teams.get(teamSeasonKey(game.home, game.season_id))?.rating;
    const visitorRating = state.teams.get(teamSeasonKey(game.visitor, game.season_id))?.rating;
    const homeAdjusted = homePerf === null || homeRating === null || homeRating === undefined
      ? null
      : homePerf + homeRating;
    const visitorAdjusted = visitorPerf === null || visitorRating === null || visitorRating === undefined
      ? null
      : visitorPerf + visitorRating;
    return {
      home: homeAdjusted, visitor: visitorAdjusted, decimalPlaces: 1, label: 'Performance + rating',
      winner: homeAdjusted === null || visitorAdjusted === null ? null :
        homeAdjusted === visitorAdjusted ? 'tie' : homeAdjusted > visitorAdjusted ? 'home' : 'visitor',
    };
  }
  // A partially populated override is treated as incomplete rather than inventing a final result.
  return {
    home: homeOverride, visitor: visitorOverride, label: 'Incomplete override',
    winner: null,
  };
}

function groupByRound(games) {
  const groups = new Map();
  for (const game of games) {
    const key = String(game.round ?? 'Unknown');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === 'Unknown') return 1;
    if (b[0] === 'Unknown') return -1;
    return Number(a[0]) - Number(b[0]);
  });
}

function gameCard(game) {
  const homeName = getTeamName(game.home, game.season_id);
  const visitorName = getTeamName(game.visitor, game.season_id);
  const score = scoreInfo(game);
  const homeWon = score.winner === 'home';
  const visitorWon = score.winner === 'visitor';
  const playedLabel = game.played === true ? 'Played' : 'Not marked played';
  const markPlayedAction = game.played === true
    ? ''
    : `<button class="mark-played" type="button" data-played-id="${escapeHtml(game.id)}" aria-label="Mark ${escapeHtml(homeName)} versus ${escapeHtml(visitorName)} as played">Mark played</button>`;

  return `
    <article class="game-card">
      <div class="game-meta">
        <span class="region-tag">${escapeHtml(game.region || 'No region')}</span>
        <span class="game-status ${game.played === true ? 'is-played' : ''}">${playedLabel}</span>
      </div>
      <div class="matchup">
        <div class="team-line ${visitorWon ? 'winner' : ''}">
          <span class="team-name">${escapeHtml(visitorName)}</span>
          <span class="team-score">${displayNumber(score.visitor, score.decimalPlaces)}</span>
        </div>
        <div class="team-line ${homeWon ? 'winner' : ''}">
          <span class="team-name">${escapeHtml(homeName)}</span>
          <span class="team-score">${displayNumber(score.home, score.decimalPlaces)}</span>
        </div>
      </div>
      <div class="card-bottom">
        <span class="score-type">${escapeHtml(score.label)}</span>
        <div class="game-actions">
          ${markPlayedAction}
          <button class="edit-game" type="button" data-edit-id="${escapeHtml(game.id)}" aria-label="Edit score overrides for ${escapeHtml(homeName)} versus ${escapeHtml(visitorName)}">Edit score</button>
        </div>
      </div>
    </article>`;
}

function renderGames() {
  const games = filteredGames();
  const groups = groupByRound(games);
  const roundCount = groups.length;
  els.summary.textContent = `${games.length} game${games.length === 1 ? '' : 's'} across ${roundCount} round${roundCount === 1 ? '' : 's'}`;

  if (!games.length) {
    els.rounds.innerHTML = '<div class="empty-state"><strong>No games match these filters.</strong><span>Try clearing one or more filters.</span></div>';
    return;
  }

  els.rounds.innerHTML = groups.map(([round, roundGames]) => {
    const open = state.openRounds.has(round) || state.openRounds.size === 0;
    const id = `round-${round.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    return `
      <section class="round-group">
        <button class="round-toggle" type="button" data-round="${escapeHtml(round)}" aria-expanded="${open}" aria-controls="${id}">
          <span class="round-number">${round === 'Unknown' ? 'Round —' : `Round ${escapeHtml(round)}`}</span>
          <span class="round-count">${roundGames.length} game${roundGames.length === 1 ? '' : 's'}</span>
          <span class="chevron ${open ? 'is-open' : ''}" aria-hidden="true">⌄</span>
        </button>
        <div id="${id}" class="round-content ${open ? '' : 'hidden'}">
          ${roundGames.map(gameCard).join('')}
        </div>
      </section>`;
  }).join('');
}

function openScoreEditor(gameId) {
  const game = state.games.find((item) => String(item.id) === String(gameId));
  if (!game) return;
  state.editingGame = game;
  const homeName = getTeamName(game.home, game.season_id);
  const visitorName = getTeamName(game.visitor, game.season_id);
  $('#score-dialog-title').textContent = `Round ${game.round} score`;
  $('#score-dialog-description').textContent = `${homeName} vs. ${visitorName} · only score overrides can be changed.`;
  $('#editing-game-id').value = String(game.id);
  $('#home-score-input').value = game.override_h_score ?? '';
  $('#visitor-score-input').value = game.override_v_score ?? '';
  els.scoreError.textContent = '';
  els.scoreDialog.showModal();
}

async function saveScoreOverrides(event) {
  event.preventDefault();
  if (!state.editingGame) {
    els.scoreError.textContent = 'Select a game before saving score overrides.';
    return;
  }

  const homeRaw = $('#home-score-input').value.trim();
  const visitorRaw = $('#visitor-score-input').value.trim();
  const homeScore = homeRaw === '' ? null : Number(homeRaw);
  const visitorScore = visitorRaw === '' ? null : Number(visitorRaw);

  if ((homeRaw !== '' && !Number.isInteger(homeScore)) || (visitorRaw !== '' && !Number.isInteger(visitorScore))) {
    els.scoreError.textContent = 'Enter whole numbers or leave a field blank.';
    return;
  }

  els.scoreSave.disabled = true;
  els.scoreSave.textContent = 'Saving…';
  els.scoreError.textContent = '';
  try {
    const result = await client.from('RegionalGame')
      .update({
        override_h_score: homeScore,
        override_v_score: visitorScore,
      })
      .eq('id', state.editingGame.id)
      .select('id, override_h_score, override_v_score');

    if (result?.error) throw result.error;
    if (!result?.data?.length) {
      throw new Error('No row was updated. The database may have rejected the update or the game ID was not found.');
    }

    const updated = result.data[0];
    state.games = state.games.map((game) => String(game.id) === String(updated.id)
      ? { ...game, override_h_score: updated.override_h_score, override_v_score: updated.override_v_score }
      : game);
    els.scoreDialog.close();
    state.editingGame = null;
    renderGames();
    setStatus('Score overrides saved.', 'success');
    window.setTimeout(() => { if (els.status.textContent === 'Score overrides saved.') setStatus(''); }, 3500);
  } catch (error) {
    console.error('Could not update score overrides:', error);
    els.scoreError.textContent = 'Save failed. Check that anonymous database updates are enabled for the score override columns.';
  } finally {
    els.scoreSave.disabled = false;
    els.scoreSave.textContent = 'Save overrides';
  }
}

function matchesSelectedGameScope(game, filters) {
  return (!filters.season || String(game.season_id ?? '') === filters.season)
    && (!filters.region || String(game.region ?? '') === filters.region)
    && (!filters.round || String(game.round ?? '') === filters.round);
}

async function markGamePlayed(gameId, button) {
  const game = state.games.find((item) => String(item.id) === String(gameId));
  if (!game || game.played === true) return;

  button.disabled = true;
  try {
    const result = await client.from('RegionalGame')
      .update({ played: true })
      .eq('id', game.id)
      .select('id, played');

    if (result?.error) throw result.error;
    if (!result?.data?.length) {
      throw new Error('No row was updated. Check anonymous database UPDATE permissions and the game ID.');
    }

    const updated = result.data[0];
    state.games = state.games.map((item) => String(item.id) === String(updated.id)
      ? { ...item, played: updated.played }
      : item);
    renderGames();
    setStatus('Game marked as played.', 'success');
  } catch (error) {
    console.error('Could not mark game as played:', error);
    setStatus('Could not mark the game as played. Check anonymous database UPDATE permissions for the played column.', 'error');
    button.disabled = false;
  }
}

async function markFilteredGamesPlayed() {
  const filters = {
    season: els.season.value,
    region: els.region.value,
    round: els.round.value,
  };
  const scopeDescription = [
    `Season: ${filters.season || 'all'}`,
    `Region: ${filters.region || 'all'}`,
    `Round: ${filters.round ? `Round ${filters.round}` : 'all'}`,
  ].join('\n');

  if (!window.confirm(
    `Mark every unplayed game matching these filters as played?\n\n${scopeDescription}\n\nThis applies to database rows beyond the currently displayed games, if any.`,
  )) return;

  els.markFilteredPlayed.disabled = true;
  try {
    let update = client.from('RegionalGame')
      .update({ played: true })
      .eq('played', false);
    if (filters.season) update = update.eq('season_id', filters.season);
    if (filters.region) update = update.eq('region', filters.region);
    if (filters.round) update = update.eq('round', filters.round);

    const result = await update.select('id');
    if (result?.error) throw result.error;
    if (!result?.data?.length) {
      setStatus('No unplayed games matched those season, region, and round filters.', 'notice');
      return;
    }

    state.games = state.games.map((game) => (
      game.played === false && matchesSelectedGameScope(game, filters)
        ? { ...game, played: true }
        : game
    ));
    renderGames();
    setStatus('All matching unplayed games were marked as played.', 'success');
  } catch (error) {
    console.error('Could not mark matching games as played:', error);
    setStatus('Could not update matching games. Check anonymous database UPDATE permissions for the played column.', 'error');
  } finally {
    els.markFilteredPlayed.disabled = false;
  }
}

function wireEvents() {
  els.resultsNav.addEventListener('click', () => showPage('results'));
  els.standingsNav.addEventListener('click', () => showPage('standings'));
  [els.standingsSeason, els.standingsRegion, els.standingsSort, els.standingsDirection]
    .forEach((element) => element.addEventListener('change', renderStandings));
  [els.season, els.region, els.round, els.played].forEach((element) => element.addEventListener('change', renderGames));
  els.team.addEventListener('input', renderGames);

  $('#clear-filters').addEventListener('click', () => {
    els.season.value = '';
    els.region.value = '';
    els.round.value = '';
    els.played.value = '';
    els.team.value = '';
    renderGames();
  });

  $('#expand-all').addEventListener('click', () => {
    state.openRounds = new Set(groupByRound(filteredGames()).map(([round]) => round));
    renderGames();
  });
  $('#collapse-all').addEventListener('click', () => {
    state.openRounds = new Set(['__none_open__']);
    renderGames();
  });

  els.rounds.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-round]');
    if (toggle) {
      const round = toggle.dataset.round;
      // Empty set means all rounds open by default; turn it into an explicit set first.
      if (state.openRounds.size === 0) {
        state.openRounds = new Set(groupByRound(filteredGames()).map(([key]) => key));
      }
      if (state.openRounds.has(round)) state.openRounds.delete(round);
      else state.openRounds.add(round);
      if (state.openRounds.has('__none_open__')) state.openRounds.delete('__none_open__');
      renderGames();
      return;
    }
    const editButton = event.target.closest('[data-edit-id]');
    if (editButton) {
      openScoreEditor(editButton.dataset.editId);
      return;
    }
    const markPlayedButton = event.target.closest('[data-played-id]');
    if (markPlayedButton) markGamePlayed(markPlayedButton.dataset.playedId, markPlayedButton);
  });

  $('#score-close').addEventListener('click', () => els.scoreDialog.close());
  $('#score-cancel').addEventListener('click', () => els.scoreDialog.close());
  els.markFilteredPlayed.addEventListener('click', markFilteredGamesPlayed);
  els.scoreForm.addEventListener('submit', saveScoreOverrides);
}

async function init() {
  wireEvents();
  await loadData();
}

init();


if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}
