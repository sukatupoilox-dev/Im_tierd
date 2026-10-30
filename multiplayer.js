const sdkUrl = 'https://esm.sh/@supabase/supabase-js@2?bundle';
let clientPromise;

export function isSupabaseConfigured() {
  const config = window.AEROPILOT_SUPABASE;
  return Boolean(config?.url?.trim() && config?.anonKey?.trim());
}

async function supabase() {
  if (!isSupabaseConfigured()) throw new Error('Supabase не настроен. Заполни URL и anon key в supabase-config.js.');
  clientPromise ||= import(sdkUrl).then(({ createClient }) => {
    const config = window.AEROPILOT_SUPABASE;
    return createClient(config.url.trim(), config.anonKey.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  });
  return clientPromise;
}

async function syncCloudProfile(client, user) {
  const nickname = user.user_metadata?.nickname || user.email?.split('@')[0] || `Pilot-${user.id.slice(0, 6)}`;
  const trainingLevel = user.user_metadata?.training_level || 'Новичок';
  const { data, error } = await client.rpc('create_competition_profile', {
    p_nickname: nickname,
    p_training_level: trainingLevel,
  });
  if (error) throw error;
  return {
    id: user.id,
    email: user.email || '',
    nickname: data.nickname,
    trainingLevel: data.training_level,
    xp: data.xp,
    rating: data.rating,
  };
}

export async function registerCloudUser({ email, password, nickname, trainingLevel }) {
  const client = await supabase();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { nickname, training_level: trainingLevel } },
  });
  if (error) throw error;
  if (!data.session || !data.user) return { confirmed: false, onlineUser: null };
  return { confirmed: true, onlineUser: await syncCloudProfile(client, data.user) };
}

export async function loginCloudUser({ email, password }) {
  const client = await supabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Supabase не вернул данные профиля.');
  return syncCloudProfile(client, data.user);
}

export async function restoreCloudUser() {
  if (!isSupabaseConfigured()) return null;
  const client = await supabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) return null;
  return syncCloudProfile(client, data.session.user);
}

export async function logoutCloudUser() {
  const client = await supabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const initials = (name) => String(name || 'Пилот').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toLocaleUpperCase('ru');
const formatDuration = (milliseconds) => {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const formatDate = (value) => value ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const levelFromXp = (xp) => 1 + [500, 1200, 2500, 5000].filter((threshold) => Number(xp || 0) >= threshold).length;

export function createMultiplayer({ root, getUser, toast, onAccountUpdate }) {
  let clientPromiseForGame;
  let currentRoomId = null;
  let currentSnapshot = null;
  let roomChannel = null;
  let previousLists = null;
  let currentUserId = null;
  let busy = false;
  let finalizing = false;
  let lists = { incoming: [], outgoing: [], active: [], history: [] };

  const client = () => clientPromiseForGame ||= supabase();
  const call = async (name, args = {}) => {
    const api = await client();
    const { data, error } = await api.rpc(name, args);
    if (error) throw error;
    return data;
  };
  const user = () => getUser();

  function showMessage(message) {
    const banner = root.querySelector('[data-comp-message]');
    banner.textContent = message;
    banner.classList.remove('hidden');
  }

  function report(error) {
    toast(error?.message || 'Не удалось выполнить действие соревнования.');
  }

  async function stopRoomSubscription() {
    if (!roomChannel) return;
    const api = await client();
    await api.removeChannel(roomChannel);
    roomChannel = null;
  }

  function renderAuthState() {
    const authenticated = Boolean(user()?.id);
    root.querySelector('[data-comp-auth-required]').classList.toggle('hidden', authenticated);
    root.querySelector('[data-comp-content]').classList.toggle('hidden', !authenticated);
    root.querySelector('[data-comp-message]').classList.add('hidden');
    root.querySelector('[data-comp-config-note]').classList.toggle('hidden', isSupabaseConfigured());
    if (!authenticated) {
      return;
    }
  }

  function renderCollections() {
    root.querySelector('#competition-invites').innerHTML = lists.incoming.length
      ? lists.incoming.map((invite) => `<article class="competition-list-row">
          <div class="competition-list-person"><span class="competition-avatar">${escapeHtml(initials(invite.nickname))}</span><span><b>${escapeHtml(invite.nickname)}</b><small>Рейтинг ${invite.rating} · код ${escapeHtml(invite.room_code)}</small></span></div>
          <div class="competition-row-actions"><button class="button-primary" data-comp-accept="${escapeHtml(invite.room_code)}">Принять</button><button class="button-secondary" data-comp-reject="${escapeHtml(invite.id)}">Отклонить</button></div>
        </article>`).join('')
      : '<p class="competition-empty">Новых вызовов пока нет.</p>';

    root.querySelector('#competition-active-list').innerHTML = lists.active.length
      ? lists.active.map((room) => `<button class="competition-list-row competition-open-row" data-comp-open="${escapeHtml(room.id)}">
          <span class="competition-list-person"><span class="competition-avatar">✈</span><span><b>Против ${escapeHtml(room.nickname || 'соперника')}</b><small>Код ${escapeHtml(room.room_code)} · ${escapeHtml(room.status)}</small></span></span><span class="competition-open-arrow">Открыть →</span>
        </button>`).join('')
      : '<p class="competition-empty">Активных соревнований нет.</p>';

    root.querySelector('#competition-outgoing').innerHTML = lists.outgoing.length
      ? lists.outgoing.map((room) => `<article class="competition-list-row">
          <span class="competition-list-person"><span class="competition-avatar">✈</span><span><b>${room.nickname ? `Против ${escapeHtml(room.nickname)}` : 'Ожидание соперника'}</b><small>Код ${escapeHtml(room.room_code)} · ${escapeHtml(room.status)}</small></span></span>
          ${room.status === 'waiting' || room.status === 'ready' ? `<button class="button-secondary" data-comp-open="${escapeHtml(room.id)}">Комната</button>` : ''}
        </article>`).join('')
      : '';

    root.querySelector('#competition-history').innerHTML = lists.history.length
      ? lists.history.map((room) => {
        const result = room.result;
        const myResult = result?.players?.find((player) => player.user_id === user().id);
        const opponentResult = result?.players?.find((player) => player.user_id !== user().id);
        const outcome = room.status === 'cancelled' ? 'Отменено'
          : room.winner_id === user().id ? 'Победа'
            : room.winner_id ? 'Поражение' : 'Ничья';
        return `<article class="competition-history-row">
          <span><b>${escapeHtml(outcome)} · ${escapeHtml(room.nickname || 'Соперник')}</b><small>${escapeHtml(formatDate(room.completed_at || room.created_at))} · код ${escapeHtml(room.room_code)}</small></span>
          <span class="competition-history-score">${myResult ? `${myResult.correct}/${myResult.completed} — ${opponentResult.correct}/${opponentResult.completed}` : '—'}</span>
          ${room.status === 'completed' ? `<button class="button-secondary" data-comp-rematch="${escapeHtml(room.nickname || '')}">Реванш</button>` : ''}
        </article>`;
      }).join('')
      : '<p class="competition-empty">История появится после первых соревнований.</p>';
  }

  async function refreshCollections() {
    if (!user()?.id) return;
    const result = await call('list_my_competitions');
    lists = {
      incoming: result.incoming || [],
      outgoing: result.outgoing || [],
      active: result.active || [],
      history: result.history || [],
    };
    if (previousLists) {
      const oldIncoming = new Set(previousLists.incoming.map((item) => item.id));
      if (lists.incoming.some((item) => !oldIncoming.has(item.id))) toast('Вам бросили вызов!');
      const oldOutgoing = new Map(previousLists.outgoing.map((item) => [item.id, item.status]));
      if (lists.outgoing.some((item) => oldOutgoing.get(item.id) === 'waiting' && item.status !== 'waiting')) toast('Вызов принят');
    }
    previousLists = lists;
    renderCollections();
    if (!currentRoomId) {
      const firstRoom = lists.active[0] || lists.outgoing[0];
      if (firstRoom) await openRoom(firstRoom.id);
    }
  }

  function renderWaitingRoom(room, players) {
    const other = players.find((player) => player.user_id !== user().id);
    const isCreator = room.created_by === user().id;
    return `<section class="competition-room-card">
      <div class="competition-room-top"><span class="pill-blue">ТЕОРЕТИЧЕСКАЯ ДУЭЛЬ</span><span class="competition-status">Ожидание соперника</span></div>
      <h3>Комната ${escapeHtml(room.room_code)}</h3>
      <p>${room.opponent_id ? `Соперник ${escapeHtml(other?.nickname || 'подключился')}. Оба пилота должны подтвердить готовность.` : 'Поделись кодом комнаты с другом или дождись игрока из быстрого поиска.'}</p>
      <div class="competition-code">${escapeHtml(room.room_code)}</div>
      <div class="competition-row-actions">
        ${room.opponent_id ? `<button class="button-primary" data-comp-ready ${((isCreator && room.creator_ready) || (!isCreator && room.opponent_ready)) ? 'disabled' : ''}>${(isCreator ? room.creator_ready : room.opponent_ready) ? 'Ты готов ✓' : 'Я готов'}</button>` : ''}
        ${isCreator ? '<button class="button-secondary" data-comp-cancel>Отменить приглашение</button>' : ''}
      </div>
      <div class="competition-player-pair">${players.map((player) => `<div class="competition-player"><span class="competition-avatar">${escapeHtml(initials(player.nickname))}</span><span><b>${escapeHtml(player.nickname)}</b><small>${escapeHtml(player.training_level)} · Ур. ${player.rating}</small></span><i>${player.ready ? 'ГОТОВ' : 'ОЖИДАНИЕ'}</i></div>`).join('')}${!other ? '<div class="competition-player competition-player-empty"><span class="competition-avatar">?</span><span><b>Ожидание пилота</b><small>Ссылка на комнату готова</small></span></div>' : ''}</div>
    </section>`;
  }

  function renderScoreboard(snapshot) {
    const room = snapshot.room;
    const players = snapshot.players || [];
    const total = 5;
    return `<div class="competition-scoreboard">${players.map((player) => `<article class="competition-score-player ${player.user_id === user().id ? 'is-me' : ''}">
        <div class="competition-score-identity"><span class="competition-avatar">${escapeHtml(initials(player.nickname))}</span><span><b>${escapeHtml(player.nickname)}</b><small>Ур. ${levelFromXp(player.xp)} · ${escapeHtml(player.training_level)} · рейтинг ${player.rating}</small></span></div>
        <div class="competition-score-progress"><span>Прогресс</span><b>${player.completed}/${total}</b><i><em style="width:${Math.min(100, player.completed / total * 100)}%"></em></i></div>
        <div class="competition-score-stats"><span>Верно <b>${player.correct}</b></span><span>Ошибки <b>${player.errors}</b></span><span>Статус <b>${player.completed >= total ? 'Завершил' : 'Выполняет'}</b></span></div>
      </article>`).join('')}</div>${room.deadline_at ? `<p class="competition-timer">Осталось <b data-comp-timer="${escapeHtml(room.deadline_at)}">05:00</b></p>` : ''}`;
  }

  function renderResult(snapshot) {
    const room = snapshot.room;
    const result = room.result;
    if (!result) return '<p class="competition-empty">Ожидание сохранённого результата…</p>';
    const winner = (snapshot.players || []).find((player) => player.user_id === result.winner_id);
    const myResult = result.players.find((player) => player.user_id === user().id);
    const otherResult = result.players.find((player) => player.user_id !== user().id);
    const draw = !result.winner_id;
    return `<div class="competition-result ${draw ? 'is-draw' : ''}">
      <span class="eyebrow">СОРЕВНОВАНИЕ ЗАВЕРШЕНО</span><h3>${draw ? 'Ничья' : `${escapeHtml(winner?.nickname || 'Победитель')} победил!`}</h3>
      <div class="competition-result-grid">${result.players.map((player) => {
        const participant = snapshot.players.find((item) => item.user_id === player.user_id);
        return `<article><b>${escapeHtml(participant?.nickname || 'Пилот')}</b><strong>${player.correct}/${player.completed}</strong><small>${player.errors} ошибок · ${formatDuration(player.elapsed_ms)}</small><small>+${player.xp} XP · рейтинг ${player.rating_change > 0 ? '+' : ''}${player.rating_change}</small></article>`;
      }).join('')}</div>
      <p>${myResult ? `Твой результат: ${myResult.correct} верных, ${myResult.errors} ошибок за ${formatDuration(myResult.elapsed_ms)}.` : ''} ${otherResult ? `Соперник: ${otherResult.correct} верных.` : ''}</p>
      <button class="button-primary" data-comp-rematch="${escapeHtml(snapshot.players.find((player) => player.user_id !== user().id)?.nickname || '')}">Реванш</button>
    </div>`;
  }

  async function loadQuestion() {
    if (!currentSnapshot || currentSnapshot.room.status !== 'active') return null;
    return call('get_next_competition_question', { p_room_id: currentRoomId });
  }

  function renderActiveRoom(snapshot, question) {
    const room = snapshot.room;
    const ownCount = snapshot.own_answered?.length || 0;
    return `<section class="competition-room-card">
      <div class="competition-room-top"><span class="pill-blue">ОДНО ЗАДАНИЕ · ОДНОВРЕМЕННО</span><span class="competition-status is-live"><i></i> В эфире</span></div>
      <h3>Теоретическая дуэль</h3>${renderScoreboard(snapshot)}
      ${question ? `<div class="competition-question"><span class="eyebrow">ВОПРОС ${question.question_number} ИЗ 5</span><h4>${escapeHtml(question.prompt)}</h4><div class="competition-answer-options">${question.options.map((option, index) => `<button class="practice-option" data-comp-answer="${index}" data-comp-question="${question.question_number}">${escapeHtml(option)}</button>`).join('')}</div></div>`
        : `<div class="competition-waiting-answer"><b>${ownCount >= 5 ? 'Все ответы отправлены' : 'Синхронизация задания…'}</b><span>Результат будет завершён сервером после ответов обоих игроков.</span></div>`}
    </section>`;
  }

  async function renderRoom(snapshot) {
    const room = snapshot.room;
    const players = snapshot.players || [];
    let markup;
    if (room.status === 'waiting' || room.status === 'ready') markup = renderWaitingRoom(room, players);
    else if (room.status === 'countdown') {
      const remaining = Math.ceil((new Date(room.countdown_at).getTime() - Date.now()) / 1000);
      markup = `<section class="competition-room-card competition-countdown"><span class="eyebrow">СОПЕРНИК ГОТОВ</span><h3>${remaining > 0 ? Math.min(3, remaining) : 'START!'}</h3><p>Соревнование начинается. Приготовься ответить на одинаковые вопросы.</p>${renderScoreboard(snapshot)}</section>`;
      if (remaining <= 0) await call('begin_competition', { p_room_id: currentRoomId });
    } else if (room.status === 'active') markup = renderActiveRoom(snapshot, await loadQuestion());
    else if (room.status === 'completed') markup = renderResult(snapshot);
    else markup = '<section class="competition-room-card"><h3>Комната закрыта</h3><p>Приглашение отменено или отклонено.</p></section>';

    root.querySelector('#competition-room').innerHTML = markup;
    const countdown = room.countdown_at ? Math.ceil((new Date(room.countdown_at).getTime() - Date.now()) / 1000) : 0;
    if (room.status === 'countdown' && countdown <= 0) {
      await call('begin_competition', { p_room_id: currentRoomId });
      await refreshRoom();
    }
    updateTimer();
  }

  function updateTimer() {
    const countdown = root.querySelector('.competition-countdown h3');
    if (currentSnapshot?.room.status === 'countdown' && countdown) {
      const seconds = Math.ceil((new Date(currentSnapshot.room.countdown_at).getTime() - Date.now()) / 1000);
      countdown.textContent = seconds > 0 ? Math.min(3, seconds) : 'START!';
      if (seconds <= 0) refreshRoom().catch(report);
    }
    const timer = root.querySelector('[data-comp-timer]');
    if (timer) {
      const seconds = Math.max(0, Math.ceil((new Date(timer.dataset.compTimer).getTime() - Date.now()) / 1000));
      timer.textContent = formatDuration(seconds * 1000);
      if (seconds === 0 && !finalizing) {
        finalizing = true;
        call('finalize_competition', { p_room_id: currentRoomId })
          .then(refreshRoom)
          .catch(report)
          .finally(() => { finalizing = false; });
      }
    }
  }

  async function refreshRoom() {
    if (!currentRoomId || !user()?.id) return;
    const snapshot = await call('get_competition_snapshot', { p_room_id: currentRoomId });
    const prior = currentSnapshot;
    currentSnapshot = snapshot;
    const room = snapshot.room;
    if (prior) {
      if (prior.room.status === 'ready' && room.status === 'countdown') toast('Соревнование начинается');
      const priorOther = prior.players?.find((player) => player.user_id !== user().id);
      const nextOther = snapshot.players?.find((player) => player.user_id !== user().id);
      if (!priorOther?.ready && nextOther?.ready) toast('Соперник готов');
      if (prior.room.status !== 'completed' && room.status === 'completed') {
        const account = await call('get_competition_account');
        onAccountUpdate?.(account);
        toast('Соревнование завершено');
      }
    }
    await renderRoom(snapshot);
    if (room.status === 'completed' || room.status === 'cancelled') await refreshCollections();
  }

  async function openRoom(roomId) {
    if (currentRoomId !== roomId) {
      await stopRoomSubscription();
      currentRoomId = roomId;
      currentSnapshot = null;
      const api = await client();
      roomChannel = api.channel(`competition-${roomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'competition_rooms', filter: `id=eq.${roomId}` }, () => refreshRoom().catch(report))
        .subscribe();
    }
    await refreshRoom();
  }

  async function refresh() {
    renderAuthState();
    if (!user()?.id) return;
    await refreshCollections();
    if (currentRoomId) await refreshRoom();
    else {
      root.querySelector('#competition-room').innerHTML = '<p class="competition-empty">Создай соревнование или выбери комнату из списка.</p>';
      root.querySelector('#competition-outgoing').innerHTML = '';
    }
    const leaderboard = await call('get_competition_leaderboard');
    root.querySelector('#competition-leaderboard').innerHTML = leaderboard.length
      ? leaderboard.slice(0, 10).map((player, index) => `<article class="competition-rank-row"><span class="competition-rank">${index + 1}</span><span class="competition-list-person"><span class="competition-avatar">${escapeHtml(initials(player.nickname))}</span><span><b>${escapeHtml(player.nickname)}</b><small>Ур. ${levelFromXp(player.xp)} · ${player.wins} побед</small></span></span><strong>${player.rating}</strong></article>`).join('')
      : '<p class="competition-empty">Пока нет игроков в рейтинге.</p>';
  }

  function showStartError(error) {
    report(error);
    showMessage(error.message || 'Не удалось выполнить действие.');
  }

  async function handleClick(event) {
    if (!root.contains(event.target)) return;
    const action = event.target.closest('[data-comp-action]')?.dataset.compAction;
    const open = event.target.closest('[data-comp-open]')?.dataset.compOpen;
    const accept = event.target.closest('[data-comp-accept]')?.dataset.compAccept;
    const reject = event.target.closest('[data-comp-reject]')?.dataset.compReject;
    const answer = event.target.closest('[data-comp-answer]');
    const rematch = event.target.closest('[data-comp-rematch]');
    const ready = event.target.closest('[data-comp-ready]');
    const cancel = event.target.closest('[data-comp-cancel]');
    if (!action && !open && !accept && !reject && !answer && !rematch && !ready && !cancel) return;
    if (busy) return;
    busy = true;
    try {
      if (action === 'quick' || action === 'create') {
        const result = action === 'quick' ? await call('quick_match') : await call('create_competition');
        toast(result.status === 'waiting' ? `Комната ${result.room_code} создана — поделись кодом` : 'Соперник найден');
        await openRoom(result.id);
        await refreshCollections();
      } else if (action === 'invite') {
        const nickname = root.querySelector('#competition-friend-nickname').value.trim();
        if (!nickname) throw new Error('Введи никнейм друга.');
        const result = await call('create_competition', { p_invited_nickname: nickname });
        root.querySelector('#competition-friend-nickname').value = '';
        toast(`Приглашение отправлено. Код комнаты: ${result.room_code}`);
        await openRoom(result.id);
        await refreshCollections();
      } else if (open) await openRoom(open);
      else if (accept) {
        const joined = await call('join_competition', { p_room_code: accept });
        toast('Вызов принят');
        await openRoom(joined.id);
        await refreshCollections();
      } else if (reject) {
        await call('reject_competition_invite', { p_room_id: reject });
        toast('Вызов отклонён');
        await refreshCollections();
      } else if (ready) {
        await call('set_competition_ready', { p_room_id: currentRoomId });
        await refreshRoom();
      } else if (cancel) {
        await call('cancel_competition', { p_room_id: currentRoomId });
        toast('Приглашение отменено');
        currentRoomId = null;
        currentSnapshot = null;
        await stopRoomSubscription();
        await refresh();
      } else if (answer) {
        answer.disabled = true;
        await call('submit_competition_answer', {
          p_room_id: currentRoomId,
          p_question_number: Number(answer.dataset.compQuestion),
          p_selected_index: Number(answer.dataset.compAnswer),
        });
        await refreshRoom();
        await refreshCollections();
      } else if (rematch) {
        if (!rematch.dataset.compRematch) throw new Error('Не удалось определить никнейм соперника.');
        const result = await call('create_competition', { p_invited_nickname: rematch.dataset.compRematch });
        toast(`Вызов на реванш отправлен. Код: ${result.room_code}`);
        await openRoom(result.id);
        await refreshCollections();
      }
    } catch (error) {
      showStartError(error);
    } finally {
      busy = false;
    }
  }

  async function joinByCode(event) {
    event.preventDefault();
    try {
      const code = root.querySelector('#competition-room-code').value.trim();
      if (!code) throw new Error('Введи код комнаты.');
      const result = await call('join_competition', { p_room_code: code });
      root.querySelector('#competition-room-code').value = '';
      toast('Вызов принят');
      await openRoom(result.id);
      await refreshCollections();
    } catch (error) {
      showStartError(error);
    }
  }

  root.addEventListener('click', (event) => {
    handleClick(event).catch(report);
  });
  root.querySelector('#competition-code-form').addEventListener('submit', joinByCode);
  root.querySelector('[data-comp-reload]').addEventListener('click', () => refresh().catch(report));
  window.addEventListener('online', () => refresh().catch(report));
  setInterval(updateTimer, 1000);
  setInterval(() => {
    if (user()?.id && !document.hidden) refresh().catch(report);
  }, 5000);

  return {
    setUser(nextUser) {
      const changed = currentUserId !== (nextUser?.id || null);
      currentUserId = nextUser?.id || null;
      if (changed) {
        currentRoomId = null;
        currentSnapshot = null;
        previousLists = null;
        if (roomChannel) stopRoomSubscription().catch(report);
      }
      renderAuthState();
      if (nextUser?.id) refresh().catch(report);
      return nextUser;
    },
    open() { refresh().catch(report); },
  };
}
