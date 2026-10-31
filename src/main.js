import './style.css';
import { createClient } from '@neondatabase/neon-js';

const CONFIG = {
  dataApiUrl: 'https://ep-mute-waterfall-aemei0yf.apirest.c-2.us-east-2.aws.neon.tech/neondb/rest/v1',
  authUrl: 'https://ep-mute-waterfall-aemei0yf.neonauth.c-2.us-east-2.aws.neon.tech/neondb/auth',
  editorUserId: 'd4e58c53-073d-4906-9b35-015b2f5c2835',
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
  session: null,
  isEditor: false,
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
  authDialog: $('#auth-dialog'),
  authForm: $('#auth-form'),
  authError: $('#auth-error'),
  authSubmit: $('#auth-submit'),
  accountLabel: $('#account-label'),
  authOpen: $('#auth-open'),
  signOut: $('#sign-out'),
  scoreDialog: $('#score-dialog'),
  scoreForm: $('#score-form'),
  scoreError: $('#score-error'),
  scoreSave: $('#score-save'),
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

function displayNumber(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

function getSessionUser(sessionResponse) {
  // Neon SDK releases have returned session data in slightly different wrappers.
  const root = sessionResponse?.data ?? sessionResponse;
  return root?.user ?? root?.session?.user ?? null;
}

async function refreshSession() {
  try {
    const response = await client.auth.getSession();
    state.session = response?.data?.session ?? response?.data ?? response?.session ?? null;
    const user = getSessionUser(response);
    state.isEditor = Boolean(user?.id && user.id === CONFIG.editorUserId);
  } catch {
    state.session = null;
    state.isEditor = false;
  }
  updateAccountControls();
}

function updateAccountControls() {
  const user = state.session?.user ?? getSessionUser(state.session);
  if (state.isEditor) {
    els.accountLabel.textContent = user?.email ? `Editor: ${user.email}` : 'Editor signed in';
    els.authOpen.classList.add('hidden');
    els.signOut.classList.remove('hidden');
  } else if (user?.id) {
    els.accountLabel.textContent = 'Signed in · view only';
    els.authOpen.classList.add('hidden');
    els.signOut.classList.remove('hidden');
  } else {
    els.accountLabel.textContent = 'Public view';
    els.authOpen.classList.remove('hidden');
    els.signOut.classList.add('hidden');
  }
}

async function loadData() {
  setStatus('Loading games and teams…');
  try {
    const [gamesResult, teamsResult] = await Promise.all([
      client.from('RegionalGame')
        .select('id, region, round, played, home, visitor, h_perf, v_perf, override_h_score, override_v_score, season_id')
        .order('season_id', { ascending: false })
        .order('round', { ascending: true }),
      client.from('Teams').select('id, name').order('name', { ascending: true }),
    ]);

    if (gamesResult?.error) throw gamesResult.error;
    if (teamsResult?.error) throw teamsResult.error;

    state.games = gamesResult?.data ?? [];
    state.teams = new Map((teamsResult?.data ?? []).map((team) => [String(team.id), team.name]));
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
      const homeName = state.teams.get(String(game.home)) ?? `Team ${game.home}`;
      const visitorName = state.teams.get(String(game.visitor)) ?? `Team ${game.visitor}`;
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

  if (homeOverride !== null && visitorOverride !== null) {
    return {
      home: homeOverride, visitor: visitorOverride, label: 'Actual score',
      winner: homeOverride === visitorOverride ? 'tie' : homeOverride > visitorOverride ? 'home' : 'visitor',
    };
  }
  if (homeOverride === null && visitorOverride === null) {
    return {
      home: homePerf, visitor: visitorPerf, label: 'Performance',
      winner: homePerf === null || visitorPerf === null ? null :
        homePerf === visitorPerf ? 'tie' : homePerf > visitorPerf ? 'home' : 'visitor',
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
  const homeName = state.teams.get(String(game.home)) ?? `Team ${game.home}`;
  const visitorName = state.teams.get(String(game.visitor)) ?? `Team ${game.visitor}`;
  const score = scoreInfo(game);
  const homeWon = score.winner === 'home';
  const visitorWon = score.winner === 'visitor';
  const playedLabel = game.played === true ? 'Played' : 'Not marked played';
  const editorAction = state.isEditor
    ? `<button class="edit-game" type="button" data-edit-id="${escapeHtml(game.id)}" aria-label="Edit score overrides for ${escapeHtml(homeName)} versus ${escapeHtml(visitorName)}">Edit score</button>`
    : '';

  return `
    <article class="game-card">
      <div class="game-meta">
        <span class="region-tag">${escapeHtml(game.region || 'No region')}</span>
        <span class="game-status ${game.played === true ? 'is-played' : ''}">${playedLabel}</span>
      </div>
      <div class="matchup">
        <div class="team-line ${homeWon ? 'winner' : ''}">
          <span class="team-name">${escapeHtml(homeName)}</span>
          <span class="team-score">${displayNumber(score.home)}</span>
        </div>
        <div class="team-line ${visitorWon ? 'winner' : ''}">
          <span class="team-name">${escapeHtml(visitorName)}</span>
          <span class="team-score">${displayNumber(score.visitor)}</span>
        </div>
      </div>
      <div class="card-bottom">
        <span class="score-type">${escapeHtml(score.label)}</span>
        ${editorAction}
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
  if (!state.isEditor) return;
  const game = state.games.find((item) => String(item.id) === String(gameId));
  if (!game) return;
  state.editingGame = game;
  const homeName = state.teams.get(String(game.home)) ?? `Team ${game.home}`;
  const visitorName = state.teams.get(String(game.visitor)) ?? `Team ${game.visitor}`;
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
  if (!state.isEditor || !state.editingGame) {
    els.scoreError.textContent = 'Your account is not authorized to edit scores.';
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
    els.scoreError.textContent = 'Save failed. Check your database UPDATE grants and RLS policy; only the configured editor account should be able to update these columns.';
  } finally {
    els.scoreSave.disabled = false;
    els.scoreSave.textContent = 'Save overrides';
  }
}

function wireEvents() {
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
    if (editButton) openScoreEditor(editButton.dataset.editId);
  });

  els.authOpen.addEventListener('click', () => {
    els.authError.textContent = '';
    els.authDialog.showModal();
  });
  $('#auth-close').addEventListener('click', () => els.authDialog.close());
  $('#score-close').addEventListener('click', () => els.scoreDialog.close());
  $('#score-cancel').addEventListener('click', () => els.scoreDialog.close());

  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    els.authError.textContent = '';
    els.authSubmit.disabled = true;
    els.authSubmit.textContent = 'Signing in…';
    try {
      const response = await client.auth.signIn.email({
        email: $('#auth-email').value.trim(),
        password: $('#auth-password').value,
      });
      if (response?.error) throw response.error;
      await refreshSession();
      if (!state.session) await refreshSession();
      els.authDialog.close();
      if (state.isEditor) {
        setStatus('Editor access confirmed.', 'success');
      } else {
        setStatus('Signed in, but this account is not authorized to edit scores.', 'notice');
      }
      renderGames();
    } catch (error) {
      console.error('Sign-in failed:', error);
      els.authError.textContent = 'Sign-in failed. Check the email/password and the Neon Auth allowed-origin configuration.';
    } finally {
      els.authSubmit.disabled = false;
      els.authSubmit.textContent = 'Sign in';
    }
  });

  els.signOut.addEventListener('click', async () => {
    try {
      await client.auth.signOut();
    } catch (error) {
      console.error('Sign-out issue:', error);
    }
    state.session = null;
    state.isEditor = false;
    updateAccountControls();
    renderGames();
    setStatus('Signed out.', 'success');
  });

  els.scoreForm.addEventListener('submit', saveScoreOverrides);
}

async function init() {
  wireEvents();
  await refreshSession();
  await loadData();
  // Do not make a failed public read prevent the user from seeing the sign-in UI.
}

init();


if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}
