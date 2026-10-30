import { renderLessons, lessons } from './lessons.js';
import { renderAchievements } from './achievements.js';
import { achievements } from './achievements.js';
import { renderMissions, missions } from './missions.js?v=landing-training-2026-10-29-2';
import { createInstructor } from './instructor.js';
import { initializeSimulator, initializeCockpitPractice } from './simulator.js?v=landing-training-2026-10-29-3';
import { ensureLessonProgress, canStartLesson, completeTheory as markTheoryComplete, completeQuiz as recordQuiz, enterPractice, completePractice as markPracticeComplete, canCompleteLesson, completeLesson as markLessonComplete } from './lesson-engine.mjs';
import { createMultiplayer, isSupabaseConfigured, loginCloudUser, logoutCloudUser, registerCloudUser, restoreCloudUser } from './multiplayer.js';
import { createCourseCreator } from './course-creator.js';

const pageTitles = { home: 'Главная', learning: 'Обучение', simulator: '3D-симулятор', missions: 'Миссии', competitions: 'Соревнования', 'course-creator': 'Конструктор уроков', tests: 'Тесты', profile: 'Мой профиль', achievements: 'Достижения', settings: 'Настройки' };
const storageKey = 'aeropilot-state-v1';
const usersKey = 'aeropilot-demo-users-v1';
const levelSteps = [
  { name: 'Курсант', xp: 0 }, { name: 'Начинающий пилот', xp: 500 }, { name: 'Младший пилот', xp: 1200 },
  { name: 'Опытный курсант', xp: 2500 }, { name: 'Выпускник учебного курса', xp: 5000 },
];
const blankProfile = (user) => ({ nickname: user.nickname, email: user.email, trainingLevel: user.trainingLevel, xp: 0, completedLessons: [], completedMissions: [], completedTests: [], testResults: {}, achievements: [], achievementDates: {}, rewardedAchievements: [], lessonProgress: {}, missionProgress: {} });
let state;
let users;
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
  const legacyProfile = stored.profiles ? null : { nickname: 'Алексей К.', email: '', trainingLevel: 'Новичок', xp: Number(stored.xp) || 0, completedLessons: [], completedMissions: [], completedTests: [], testResults: {}, achievements: [], achievementDates: {}, rewardedAchievements: [], lessonProgress: {}, missionProgress: {} };
  state = { theme: stored.theme === 'dark' ? 'dark' : 'light', sessionEmail: stored.sessionEmail || '', profiles: stored.profiles || (legacyProfile ? { guest: legacyProfile } : {}) };
  const savedUsers = JSON.parse(localStorage.getItem(usersKey) || '[]');
  users = Array.isArray(savedUsers) ? savedUsers : [];
} catch {
  state = { theme: 'light', sessionEmail: '', profiles: {} };
  users = [];
}
for (const savedProfile of Object.values(state.profiles)) {
  savedProfile.completedLessons ||= [];
  savedProfile.completedMissions ||= [];
  savedProfile.completedTests ||= [];
  savedProfile.testResults ||= {};
  savedProfile.achievements ||= [];
  savedProfile.achievementDates ||= {};
  savedProfile.rewardedAchievements ||= [];
  savedProfile.lessonProgress ||= {};
  savedProfile.missionProgress ||= {};
  savedProfile.completedLessons = [...new Set(savedProfile.completedLessons)];
  savedProfile.completedTests = [...new Set(savedProfile.completedTests)];
}
const saveState = () => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { toast('Не удалось сохранить данные в этом браузере'); } };
const profile = () => state.profiles[state.sessionEmail] || null;
const toast = (message) => {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
};
const instructor = createInstructor(document.querySelector('#instructor-widget'));
let missionSession = null;
let onlineUser = null;
let multiplayer = null;
let courseCreator = null;

function activateOnlineUser(user) {
  onlineUser = user;
  const saved = state.profiles[user.email] ||= blankProfile(user);
  saved.nickname = user.nickname;
  saved.trainingLevel = user.trainingLevel;
  state.sessionEmail = user.email;
  saveState();
  multiplayer?.setUser(user);
  refreshDashboard();
  renderProfile();
}

function updateOnlineAccount(account) {
  if (!onlineUser || onlineUser.id !== account.id) return;
  Object.assign(onlineUser, account);
  refreshDashboard();
  renderProfile();
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light', state.theme === 'light');
  document.querySelector('meta[name="theme-color"]').content = state.theme === 'light' ? '#edf7fb' : '#091321';
  document.querySelector('#theme-toggle').textContent = state.theme === 'dark' ? '☼' : '☾';
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.classList.toggle('selected', button.dataset.themeChoice === state.theme));
  saveState();
}

function navigate(page) {
  if (!pageTitles[page]) return;
  document.querySelectorAll('.page').forEach((element) => element.classList.toggle('active', element.id === `page-${page}`));
  document.querySelectorAll('.nav-link').forEach((element) => element.classList.toggle('active', element.dataset.page === page));
  document.querySelector('#breadcrumb-title').textContent = pageTitles[page];
  document.querySelector('#sidebar').classList.remove('open');
  history.replaceState(null, '', `#${page}`);
  if (page === 'simulator') {
    if (!window.aeroSimulator) window.aeroSimulator = initializeSimulator(document.querySelector('#simulator-root'), {
      onExit: () => navigate('home'), onInstrumentSelect: onSimulatorInstrument,
      onLandingMissionStart: beginLandingTrainingRecord,
      onLandingProgress: saveLandingMissionProgress,
      onLandingResult: (result) => finishMission(result.passed, result),
    });
    else window.aeroSimulator.setActive(true);
  } else if (window.aeroSimulator) {
    window.aeroSimulator.dispose();
    window.aeroSimulator = null;
  }
  if (page === 'profile') renderProfile();
  if (page === 'competitions') multiplayer?.open();
  if (page === 'course-creator') courseCreator?.open();
  if (page === 'tests') {
    const completed = profile()?.completedTests.includes('basic-heading') || false;
    document.querySelectorAll('[data-answer]').forEach((button) => { button.disabled = completed; });
    document.querySelector('#test-feedback').textContent = completed ? 'Этот вопрос уже пройден.' : '';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function currentLevel(xp) {
  let index = 0;
  levelSteps.forEach((step, i) => { if (xp >= step.xp) index = i; });
  return { ...levelSteps[index], next: levelSteps[index + 1] || null, index: index + 1 };
}

function recordStudyActivity(current) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (current.lastStudyDate === today) return;
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;
  current.studyStreak = current.lastStudyDate === yesterday ? (current.studyStreak || 0) + 1 : 1;
  current.lastStudyDate = today;
}

function ensureDailyGoals(current) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (current.dailyGoals?.date !== today) current.dailyGoals = { date: today, lesson: false, answers: [], instruments: [], mission: false };
  current.dailyGoals.answers ||= [];
  current.dailyGoals.instruments ||= [];
  return current.dailyGoals;
}

function recordDailyAnswer(current, questionId) {
  const goals = ensureDailyGoals(current);
  if (goals.answers.includes(questionId)) return;
  goals.answers.push(questionId);
  saveState();
  refreshDashboard();
}

function refreshDashboard() {
  const current = profile() || state.profiles.guest || null;
  const xp = (current?.xp ?? 0) + (onlineUser?.email === current?.email ? onlineUser.xp : 0);
  const completedCount = current?.completedLessons?.length ?? 0;
  const progress = Math.min(100, Math.round(completedCount / lessons.length * 100));
  document.querySelector('#learning-progress-label').textContent = `${completedCount} из ${lessons.length} уроков`;
  document.querySelector('#learning-progress-bar').style.width = `${progress}%`;
  const level = currentLevel(xp);
  document.querySelector('#xp-number').textContent = xp;
  document.querySelector('#top-xp').innerHTML = `<span>✦</span> ${xp} XP`;
  document.querySelector('#top-streak').innerHTML = `<span>♨</span> ${current?.studyStreak || 0} ${current?.studyStreak === 1 ? 'день' : 'дней'}`;
  document.querySelector('#progress-number').textContent = progress;
  document.querySelector('#progress-bar').style.width = `${progress}%`;
  document.querySelector('.xp-track i').style.width = `${level.next ? Math.min(100, (xp - level.xp) / (level.next.xp - level.xp) * 100) : 100}%`;
  document.querySelector('.stat-card:nth-child(2) .positive').textContent = level.next ? `До уровня ${level.index + 1}: ${level.next.xp - xp} XP` : 'Максимальный уровень';
  document.querySelector('#xp-next-level').textContent = level.next ? `До уровня ${level.index + 1}: ${level.next.xp - xp} XP` : 'Максимальный уровень';
  document.querySelector('#pilot-level-label').textContent = `Уровень ${level.index} · ${level.name}`;
  document.querySelector('#top-level').textContent = `Уровень ${level.index} · ${level.name}`;
  document.querySelector('#xp-level-target').textContent = level.next ? `${level.next.xp} XP` : 'MAX';
  document.querySelector('#sidebar-level-label').textContent = `Уровень ${level.index} · ${level.name}`;
  document.querySelector('.stat-card:nth-child(2) .stat-foot span:first-child').textContent = `Уровень ${level.index}`;
  document.querySelector('.stat-card:nth-child(2) .stat-foot span:last-child').textContent = level.next ? `${level.next.xp} XP` : 'MAX';
  const greeting = current?.nickname || 'будущий пилот';
  document.querySelector('#welcome-title').innerHTML = `Доброе утро, ${escapeHtml(greeting)} <span class="wave">✦</span>`;
  const earned = (current?.achievements || []).filter((id) => achievements.some((item) => item.id === id));
  document.querySelector('#nav-achievement-count').textContent = earned.length;
  const achievementDates = current?.achievementDates || {};
  renderAchievements(document.querySelector('#recent-achievements'), { recent: true, earnedIds: earned, achievementDates });
  renderAchievements(document.querySelector('#all-achievements'), { earnedIds: earned, achievementDates });
  const progressMap = current?.lessonProgress || {};
  renderLessons(document.querySelector('#course-grid'), { onStart: startLesson, onPreview: showLessonPreview, completedIds: current?.completedLessons || [], progressMap });
  renderLessons(document.querySelector('#all-course-grid'), { onStart: startLesson, onPreview: showLessonPreview, completedIds: current?.completedLessons || [], progressMap });
  renderFinalMissionNode(current);
  const missionProgress = current?.missionProgress || {};
  renderMissions(document.querySelector('#mission-grid'), { progressMap: missionProgress, completedIds: current?.completedMissions || [], onStart: startMission });
  document.querySelector('#mission-progress-count').textContent = `${missions.filter((mission) => current?.completedMissions.includes(mission.id)).length} из ${missions.length} миссий`;
  const completedMissions = missions.filter((mission) => current?.completedMissions.includes(mission.id)).length;
  document.querySelector('#completed-missions-count').textContent = completedMissions;
  document.querySelector('#total-missions-count').textContent = missions.length;
  document.querySelector('#mission-progress-bar').style.width = `${missions.length ? completedMissions / missions.length * 100 : 0}%`;
  const completedLessons = current?.completedLessons?.length ?? 0;
  document.querySelector('#first-flight-count').textContent = `${Math.min(completedLessons, 3)} из 3 уроков`;
  document.querySelector('#first-flight-progress').style.width = `${Math.min(100, completedLessons / 3 * 100)}%`;
  const goals = current ? ensureDailyGoals(current) : { lesson: false, answers: [], mission: false };
  document.querySelector('#daily-goal-date').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  document.querySelector('#daily-answer-count').textContent = Math.min(5, goals.answers.length);
  document.querySelector('#daily-instrument-count').textContent = Math.min(3, goals.instruments.length);
  document.querySelector('[data-daily-goal="lesson"]').classList.toggle('is-done', goals.lesson);
  document.querySelector('[data-daily-goal="answers"]').classList.toggle('is-done', goals.answers.length >= 5);
  document.querySelector('[data-daily-goal="instruments"]').classList.toggle('is-done', goals.instruments.length >= 3);
  document.querySelector('[data-daily-goal="mission"]').classList.toggle('is-done', goals.mission);
  if (current) saveState();
  document.querySelector('#achievement-earned-count').textContent = earned.length;
  document.querySelector('#achievement-total-count').textContent = achievements.length;
}

function renderProfile() {
  const current = profile();
  document.querySelector('#page-profile > p').textContent = onlineUser
    ? 'Онлайн-профиль Supabase и локальный прогресс обучения на этом устройстве.'
    : isSupabaseConfigured()
      ? 'Для соревнований войди через Supabase Auth. Локальный демонстрационный профиль не подключён к онлайн-матчам.'
      : 'Твоя карточка курсанта и история обучения. Вход демонстрационный, данные остаются в этом браузере.';
  document.querySelector('.auth-note').textContent = isSupabaseConfigured()
    ? 'Онлайн-аккаунт использует Supabase Auth. Пароль не сохраняется в LocalStorage.'
    : 'Демо-режим: профиль и хеш пароля хранятся только в LocalStorage этого браузера. Это не защищённая авторизация. Не используй настоящий пароль.';
  document.querySelector('#signed-out-panel').classList.toggle('hidden', Boolean(current));
  document.querySelector('#signed-in-panel').classList.toggle('hidden', !current);
  if (!current) {
    document.querySelector('#sidebar .avatar').textContent = 'АП';
    document.querySelector('#sidebar .user-mini b').textContent = 'Гость';
    document.querySelector('#sidebar .user-mini small').textContent = 'Войди в профиль';
    document.querySelector('.top-avatar').textContent = 'АП';
    return;
  }
  const totalXp = current.xp + (onlineUser?.email === current.email ? onlineUser.xp : 0);
  const level = currentLevel(totalXp);
  const progress = Math.min(100, Math.round(current.completedLessons.length / lessons.length * 100));
  const initials = current.nickname.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase('ru');
  document.querySelector('#profile-avatar').textContent = initials;
  document.querySelector('#sidebar .avatar').textContent = initials;
  document.querySelector('#sidebar .user-mini b').textContent = current.nickname;
  document.querySelector('#sidebar .user-mini small').textContent = level.name;
  document.querySelector('.top-avatar').textContent = initials;
  document.querySelector('#profile-nickname').textContent = current.nickname;
  document.querySelector('#profile-level').textContent = level.name;
  document.querySelector('#profile-next-level').textContent = level.next ? `Следующий уровень: ${level.next.name} · ${level.next.xp} XP` : 'Достигнут максимальный уровень';
  document.querySelector('#profile-training').textContent = current.trainingLevel;
  document.querySelector('#profile-email').textContent = current.email.toLocaleUpperCase('ru');
  document.querySelector('#profile-xp').textContent = `${totalXp} XP`;
  document.querySelector('#profile-progress').textContent = progress;
  document.querySelector('#profile-progress-bar').style.width = `${progress}%`;
  document.querySelector('#profile-lessons').textContent = current.completedLessons.length;
  document.querySelector('#profile-missions').textContent = current.completedMissions.length;
  const completedNames = current.completedLessons.map((id) => lessons.find((lesson) => lesson.id === id)?.title).filter(Boolean);
  document.querySelector('#profile-completed-list').innerHTML = completedNames.length ? completedNames.map((name) => `<div class="detail-row"><span>✓ ${escapeHtml(name)}</span><b>Пройден</b></div>`).join('') : '<span class="detail-empty">Пока нет пройденных уроков</span>';
  const missionNames = Object.fromEntries(missions.map((mission) => [mission.id, mission.title]));
  document.querySelector('#profile-mission-list').innerHTML = current.completedMissions.length ? current.completedMissions.map((id) => `<div class="detail-row"><span>✓ ${escapeHtml(missionNames[id] || id)}</span><b>Выполнена</b></div>`).join('') : '<span class="detail-empty">Пока нет выполненных миссий</span>';
  const tests = Object.entries(current.testResults || {});
  document.querySelector('#profile-test-results').innerHTML = tests.length ? tests.map(([name, result]) => `<div class="detail-row"><span>${escapeHtml(name)}</span><b>${result}%</b></div>`).join('') : '<span class="detail-empty">Пока нет результатов тестов</span>';
  const earned = (current.achievements || []).filter((id) => achievements.some((item) => item.id === id));
  const achievementNames = Object.fromEntries(achievements.map((item) => [item.id, item.title]));
  document.querySelector('#profile-achievements').innerHTML = earned.length ? earned.map((id) => `<div class="detail-row"><span>✦ ${escapeHtml(achievementNames[id] || id)}</span><b>${current.achievementDates?.[id] ? new Date(current.achievementDates[id]).toLocaleDateString('ru-RU') : 'Получено'}</b></div>`).join('') : '<span class="detail-empty">Здесь появятся твои награды</span>';
  const best = tests.length ? Math.max(...tests.map(([, value]) => value)) : null;
  document.querySelector('#best-test').textContent = best === null ? '—' : `${best}%`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function addAchievement(id) {
  const current = profile();
  const definition = achievements.find((item) => item.id === id);
  if (!current || !definition || current.achievements.includes(id)) return false;
  current.achievements.push(id);
  current.achievementDates ||= {};
  current.rewardedAchievements ||= [];
  current.achievementDates[id] = new Date().toISOString();
  if (!current.rewardedAchievements.includes(id)) {
    current.rewardedAchievements.push(id);
    current.xp += definition.rewardXp;
  }
  saveState();
  refreshDashboard();
  renderProfile();
  instructor?.achievement(definition.title);
  toast(`Достижение «${definition.title}»: +${definition.rewardXp} XP`);
  return true;
}

function awardXp(amount, label, uniqueId, collection) {
  const current = profile();
  if (!current) { toast('Войди или создай профиль, чтобы сохранять награды'); navigate('profile'); return false; }
  if (current[collection].includes(uniqueId)) { toast('Это задание уже отмечено как выполненное'); return false; }
  current[collection].push(uniqueId);
  current.xp += amount;
  saveState();
  refreshDashboard();
  renderProfile();
  toast(`${label}: +${amount} XP`);
  return true;
}

let lessonSession = null;
let lessonPracticeController = null;
let previewedLesson = null;
let previewedMission = null;
const lessonStepNames = ['ТЕОРИЯ', 'ПРОВЕРКА ЗНАНИЙ', 'ПРАКТИКА', 'РЕЗУЛЬТАТ'];
const quizPassMark = 80;

function getLessonProgress(id) {
  const current = profile();
  if (!current) return null;
  return ensureLessonProgress(current, id);
}

function persistLessonProgress(status, patch = {}) {
  const record = getLessonProgress(lessonSession.lesson.id);
  if (!record) return;
  Object.assign(record, patch);
  if (record.status !== 'completed') record.status = status;
  saveState();
  refreshDashboard();
}

function startLesson(lesson, locked = false) {
  if (!lesson) return;
  if (locked) { toast('Сначала заверши предыдущий урок'); return; }
  if (!profile()) { toast('Сначала создай профиль курсанта'); navigate('profile'); return; }
  const lessonIndex = lessons.findIndex((item) => item.id === lesson.id);
  const current = profile();
  if (!canStartLesson(lessons, current, lesson.id)) { toast('Сначала заверши предыдущий урок'); return; }
  const saved = getLessonProgress(lesson.id);
  recordStudyActivity(current);
  const replay = saved.status === 'completed';
  const step = replay ? 'theory' : saved.status;
  const quizAttempt = replay ? { questionIndex: 0, correct: 0, answered: false, lastCorrect: false, errors: 0 } : saved.quizAttempt;
  lessonSession = {
    lesson, step, replay, questionIndex: quizAttempt.questionIndex, correct: quizAttempt.correct,
    answered: quizAttempt.answered, lastCorrect: quizAttempt.lastCorrect, errors: quizAttempt.errors,
    quizOutcome: replay ? '' : (saved.quizOutcome || ''), quizBest: current.testResults[lesson.title] || 0,
    quizPercent: replay ? undefined : saved.lastQuizScore, quizCorrect: replay ? undefined : saved.lastQuizCorrect,
    practiceChoice: undefined, practiceCompleted: replay ? false : saved.practiceCompleted,
    practiceErrors: replay ? 0 : saved.practiceErrors, completedPracticeTasks: replay ? [] : saved.completedPracticeTasks,
    result: null, practiceOrder: lesson.practice.options ? shuffledIndexes(lesson.practice.options.length) : [],
    quizOrders: lesson.quiz.map((question) => shuffledIndexes(question.options.length)),
  };
  instructor?.lessonStart(lesson);
  if (!replay && saved.status !== 'completed') {
    saved.status ||= 'theory';
    persistLessonProgress(saved.status);
  }
  document.querySelector('#lesson-dialog [data-lesson-title]').textContent = lesson.title;
  renderLessonStep();
  document.querySelector('#lesson-dialog').showModal();
}

function showLessonPreview(lesson) {
  if (!lesson) return;
  const current = profile() || state.profiles.guest || {};
  if (!canStartLesson(lessons, current, lesson.id)) return;
  previewedLesson = lesson;
  previewedMission = null;
  const progress = current.lessonProgress?.[lesson.id];
  const status = current.completedLessons?.includes(lesson.id) ? 'УРОК ПРОЙДЕН · МОЖНО ПОВТОРИТЬ' : progress?.status === 'practice' ? 'ПРОДОЛЖИТЬ · ПРАКТИКА' : progress?.status === 'quiz' ? 'ПРОДОЛЖИТЬ · ТЕСТ' : 'ДОСТУПЕН · ЭТАП 1';
  document.querySelector('#preview-status').textContent = `ЭТАП ${lessons.findIndex((item) => item.id === lesson.id) + 1} · ${status}`;
  document.querySelector('#preview-title').textContent = lesson.title;
  document.querySelector('#preview-description').textContent = lesson.description;
  document.querySelector('#preview-question-count').textContent = lesson.quiz.length;
  document.querySelector('.preview-facts').innerHTML = `<span><b>${lesson.quiz.length}</b> вопросов</span><span><b>4</b> этапа</span><span><b>+100</b> XP за первое прохождение</span>`;
  document.querySelector('.preview-progress').innerHTML = '<span>Теория</span><i></i><span>Тест</span><i></i><span>Практика</span>';
  document.querySelector('[data-preview-start]').textContent = current.completedLessons?.includes(lesson.id) ? 'Повторить урок →' : progress?.status && progress.status !== 'theory' ? 'Продолжить урок →' : 'Начать урок →';
  document.querySelector('#lesson-preview-dialog').showModal();
}

function renderFinalMissionNode(current) {
  const mission = missions.find((item) => item.id === 'flight-exam');
  const container = document.querySelector('#course-grid');
  if (!mission || !container) return;
  const unlocked = (current?.completedLessons?.length ?? 0) === lessons.length;
  const completed = current?.completedMissions?.includes(mission.id) || false;
  const progress = current?.missionProgress?.[mission.id];
  const label = !unlocked ? 'Закрыта · заверши курс' : completed ? 'Пройдена ✓' : progress?.status === 'in_progress' ? 'В процессе' : 'Доступна';
  container.insertAdjacentHTML('beforeend', `<article class="course-card lesson-card map-final-mission ${unlocked ? 'is-available' : 'is-locked'} ${completed ? 'is-complete' : ''}" data-final-mission="${mission.id}">
    <div class="course-top"><span class="course-icon green">${mission.icon}</span><span class="course-status">${label}</span></div>
    <h3>7. Итоговая миссия</h3><p>${mission.description}</p>
    <div class="course-bottom"><span>${mission.questions.length} вопросов · экзамен</span><b>+${mission.rewardXp} XP</b></div>
    <div class="course-progress"><i style="width:${completed ? 100 : unlocked && progress?.status === 'in_progress' ? 45 : 0}%"></i></div>
    <button class="lesson-start-button" data-final-mission-start ${unlocked ? '' : 'disabled title="Заверши все уроки, чтобы открыть итоговую миссию"'}>${!unlocked ? 'Сначала заверши 6 уроков' : completed ? 'Повторить экзамен' : progress?.status === 'in_progress' ? 'Продолжить экзамен' : 'Подробнее о миссии'} <span>${unlocked ? '→' : 'Закрыта'}</span></button>
  </article>`);
  container.querySelector('[data-final-mission]')?.addEventListener('click', (event) => {
    if (event.target.closest('button')?.disabled) return;
    if (unlocked) showMissionPreview(mission);
  });
}

function showMissionPreview(mission) {
  if (!mission) return;
  previewedLesson = null;
  previewedMission = mission;
  document.querySelector('#preview-status').textContent = 'ИТОГОВАЯ МИССИЯ · ЭТАП 7';
  document.querySelector('#preview-title').textContent = mission.title;
  document.querySelector('#preview-description').textContent = mission.description;
  document.querySelector('#preview-question-count').textContent = `${mission.questions.length} вопросов`;
  document.querySelector('.preview-facts').innerHTML = `<span>Порог: <b>${mission.passCount} из ${mission.questions.length}</b></span><span>Финальная проверка</span><span>Награда: <b>+${mission.rewardXp} XP</b></span>`;
  document.querySelector('.preview-progress').innerHTML = '<span>Курс</span><i></i><span>Экзамен</span><i></i><span>Выпуск</span>';
  document.querySelector('[data-preview-start]').textContent = 'Начать итоговую миссию →';
  document.querySelector('#lesson-preview-dialog').showModal();
}

function shuffledIndexes(length) {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
}

function renderLessonStep() {
  if (!lessonSession) return;
  lessonPracticeController?.dispose?.();
  lessonPracticeController = null;
  const { lesson, step, questionIndex } = lessonSession;
  const stage = document.querySelector('#lesson-stage');
  const stepNum = step === 'theory' ? 1 : step === 'quiz' ? 2 : step === 'practice' ? 3 : 4;
  document.querySelector('#lesson-step-count').textContent = step === 'result' ? 'ГОТОВО' : `${stepNum} / 4`;
  document.querySelector('#lesson-overall-progress').style.width = `${stepNum / 4 * 100}%`;
  document.querySelector('#lesson-step-label').textContent = `${lesson.title.toLocaleUpperCase('ru')} · ${lessonStepNames[step === 'theory' ? 0 : step === 'quiz' ? 1 : step === 'practice' ? 2 : 3]}`;

  if (step === 'theory') {
    stage.innerHTML = `<div class="lesson-scroll"><div class="lesson-mentor-note"><span class="alex-mascot" aria-hidden="true"><i></i><b></b></span><p><b>Алекс:</b> Начнём с главного. Изучи тему, а затем проверим знания.</p></div><div class="lesson-intro"><span class="course-icon ${lesson.tone}">${lesson.icon}</span><div><span class="eyebrow">ТЕОРИЯ</span><p>Разберись в теме простыми шагами. Затем проверь знания.</p></div></div><div class="lesson-reading">${lesson.theory.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div><div class="lesson-diagram"><div class="diagram-title">СХЕМА · ${escapeHtml(lesson.title.toLocaleUpperCase('ru'))}</div><div class="diagram-grid">${lesson.diagram.map((item, index) => `<article class="diagram-item" style="--item-order:${index}"><span>${escapeHtml(item.icon)}</span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.text)}</small></article>`).join('')}</div></div><div class="lesson-safety-note">Учебный материал для знакомства с темой. Практические полёты выполняй только с инструктором и по руководству конкретного самолёта.</div><button class="button-primary lesson-next" data-complete-theory>Далее к проверке знаний <span>→</span></button></div>`;
    return;
  }

  if (step === 'quiz') {
    if (lessonSession.quizOutcome) {
      const passed = lessonSession.quizOutcome === 'passed';
      stage.innerHTML = `<div class="lesson-result ${passed ? 'passed' : 'retry'}"><div class="result-medal">${passed ? '✓' : '↻'}</div><span class="eyebrow">ПРОВЕРКА ЗНАНИЙ</span><h3>${passed ? 'Тест пройден' : 'Порог пока не достигнут'}</h3><div class="result-score"><strong>${lessonSession.quizCorrect ?? lessonSession.correct}</strong><span>из ${lesson.quiz.length} правильных</span><b>${lessonSession.quizPercent ?? Math.round(lessonSession.correct / lesson.quiz.length * 100)}%</b></div><p>${passed ? 'Отлично! Теперь выполни практическое задание, чтобы завершить урок.' : `Нужно набрать не менее ${quizPassMark}%. Изучи объяснения и попробуй снова.`}</p><div class="result-actions">${passed ? '<button class="button-primary" data-quiz-continue>Перейти к практике <span>→</span></button>' : '<button class="button-secondary" data-retry-quiz>Повторить тест</button>'}</div></div>`;
      return;
    }
    const question = lesson.quiz[questionIndex];
    const order = lessonSession.quizOrders[questionIndex];
    const feedback = lessonSession.answered
      ? `<div class="answer-explanation ${lessonSession.lastCorrect ? 'is-correct' : 'is-wrong'}"><b>${lessonSession.lastCorrect ? 'Верно!' : `Неверно. Правильный ответ: ${escapeHtml(question.options[question.answer])}`}</b><p>${escapeHtml(question.explanation)}</p><div class="feedback-mentor"><span class="alex-mascot" aria-hidden="true"><i></i><b></b></span><span>${lessonSession.lastCorrect ? 'Алекс: Отлично, так держать!' : 'Алекс: Ошибки помогают учиться. Сверь ответ с объяснением.'}</span></div></div><button class="button-primary lesson-next" data-quiz-next>${questionIndex < lesson.quiz.length - 1 ? 'Следующий вопрос' : 'Проверить результат'} <span>→</span></button>`
      : '';
    stage.innerHTML = `<div class="lesson-scroll"><div class="quiz-progress"><span>ВОПРОС ${questionIndex + 1} ИЗ ${lesson.quiz.length}</span><span>${lessonSession.correct} верно · порог ${quizPassMark}%</span></div><h3 class="lesson-prompt">${escapeHtml(question.question)}</h3><div class="practice-options quiz-options">${order.map((index) => `<button class="practice-option" data-lesson-answer="${index}" ${lessonSession.answered ? 'disabled' : ''}>${escapeHtml(question.options[index])}</button>`).join('')}</div>${feedback}</div>`;
    return;
  }

  if (step === 'practice') {
    if (lesson.practice.mode === 'cockpit') {
      stage.innerHTML = `<div class="lesson-scroll"><span class="pill-blue">3D-ТРЕНАЖЁР · ПРИБОРНАЯ ПАНЕЛЬ</span><h3 class="lesson-prompt">Найди приборы, указанные в задании.</h3><div class="cockpit-practice-host" id="cockpit-practice-host"></div><p class="lesson-safety-note">Это учебная схема для распознавания приборов, не модель кабины конкретного борта.</p></div>`;
      const host = stage.querySelector('#cockpit-practice-host');
      const session = lessonSession;
      initializeCockpitPractice(host, {
        tasks: lesson.practice.tasks,
        completedTasks: lessonSession.completedPracticeTasks,
        initialMistakes: lessonSession.practiceErrors,
        onProgress: ({ completedTasks, mistakes }) => {
          if (lessonSession !== session) return;
          lessonSession.completedPracticeTasks = completedTasks;
          lessonSession.practiceErrors = mistakes;
          persistLessonProgress('practice', { completedPracticeTasks: completedTasks, practiceErrors: mistakes });
        },
        onMistake: ({ mistakes }) => {
          if (lessonSession !== session) return;
          lessonSession.practiceErrors = mistakes;
          persistLessonProgress('practice', { practiceErrors: mistakes });
        },
        onComplete: ({ completedTasks, mistakes }) => { if (lessonSession === session) completePractice({ completedTasks, mistakes }); },
      }).then((controller) => {
        if (lessonSession !== session || lessonSession?.step !== 'practice') controller?.dispose?.();
        else lessonPracticeController = controller;
      });
      return;
    }
    const practice = lesson.practice;
    const practiceFeedback = lessonSession.practiceChoice === undefined ? '' : `<div class="answer-explanation ${lessonSession.practiceCorrect ? 'is-correct' : 'is-wrong'}"><b>${lessonSession.practiceCorrect ? 'Верно. Практика выполнена.' : `Неверно. Правильный вариант: ${escapeHtml(practice.options[practice.answer])}`}</b><p>${escapeHtml(practice.explanation)}</p></div>`;
    stage.innerHTML = `<div class="lesson-scroll"><span class="pill-blue">ПРАКТИЧЕСКОЕ ЗАДАНИЕ</span><h3 class="lesson-prompt">${escapeHtml(practice.prompt)}</h3><div class="practice-options">${lessonSession.practiceOrder.map((index) => `<button class="practice-option ${lessonSession.practiceChoice === index ? (lessonSession.practiceCorrect ? 'selected-correct' : 'selected-wrong') : ''}" data-practice-answer="${index}" ${lessonSession.practiceCorrect ? 'disabled' : ''}>${escapeHtml(practice.options[index])}</button>`).join('')}</div>${practiceFeedback}<button class="button-primary lesson-next" data-practice-check ${lessonSession.practiceChoice === undefined || lessonSession.practiceCorrect ? 'disabled' : ''}>Проверить задание</button></div>`;
    return;
  }

  const result = lessonSession.result;
  const recommendations = result.errors ? `Ошибок: ${result.errors}. ${result.errors > 1 ? 'Повтори теорию и внимательно изучи подписи на схеме.' : 'Повтори тему и обрати внимание на объяснение к ответу.'}` : 'Все этапы выполнены без ошибок. Можно переходить к следующему уроку.';
  stage.innerHTML = `<div class="lesson-result passed"><div class="lesson-mentor-note"><span class="alex-mascot" aria-hidden="true"><i></i><b></b></span><p><b>Алекс:</b> Полный этап пройден. Отличный полёт!</p></div><div class="result-medal">✦</div><span class="eyebrow">УРОК УСПЕШНО ЗАВЕРШЁН</span><h3>${escapeHtml(lesson.title)}</h3><div class="result-score"><strong>${result.quizCorrect}</strong><span>из ${lesson.quiz.length} в тесте</span><b>${result.quizPercent}%</b></div><p>${escapeHtml(recommendations)}</p><div class="result-rewards"><span>${result.rewardClaimedNow ? 'Награда за урок · +100 XP' : 'Награда за урок уже была получена'}</span><span>Верные ответы теста · XP сохраняются по каждому вопросу</span></div><div class="result-actions"><button class="button-secondary" data-close-lesson>К списку уроков</button></div></div>`;
}

function completeTheory() {
  if (!lessonSession || lessonSession.step !== 'theory') return;
  const saved = getLessonProgress(lessonSession.lesson.id);
  if (!saved) return;
  markTheoryComplete(profile(), lessonSession.lesson.id);
  if (!lessonSession.replay) {
    const attempt = saved.quizAttempt;
    lessonSession.questionIndex = attempt.questionIndex;
    lessonSession.correct = attempt.correct;
    lessonSession.answered = attempt.answered;
    lessonSession.lastCorrect = attempt.lastCorrect;
    lessonSession.errors = attempt.errors;
    lessonSession.quizOutcome = saved.quizOutcome || '';
  }
  saveState();
  refreshDashboard();
  lessonSession.step = 'quiz';
  renderLessonStep();
}

function saveQuizAttempt() {
  if (lessonSession.replay) return;
  const saved = getLessonProgress(lessonSession.lesson.id);
  saved.quizAttempt = { questionIndex: lessonSession.questionIndex, correct: lessonSession.correct, answered: lessonSession.answered, lastCorrect: lessonSession.lastCorrect, errors: lessonSession.errors };
  saveState();
}

function completeQuiz() {
  const current = profile();
  const lesson = lessonSession.lesson;
  const percent = Math.round(lessonSession.correct / lesson.quiz.length * 100);
  const passed = recordQuiz(current, lesson.id, lesson.title, percent, quizPassMark, { replay: lessonSession.replay });
  lessonSession.quizPercent = percent;
  lessonSession.quizCorrect = lessonSession.correct;
  lessonSession.quizOutcome = passed ? 'passed' : 'failed';
  const saved = getLessonProgress(lesson.id);
  saved.lastQuizScore = percent;
  saved.lastQuizCorrect = lessonSession.correct;
  saved.quizOutcome = passed ? 'passed' : 'failed';
  if (saved.status !== 'completed') saved.status = 'quiz';
  if (!lessonSession.replay) saved.quizPassed = passed;
  saveQuizAttempt();
  saveState();
  refreshDashboard();
  renderProfile();
  renderLessonStep();
}

function completePractice({ completedTasks = [], mistakes = 0 } = {}) {
  if (!lessonSession || lessonSession.step !== 'practice') return;
  const current = profile();
  if (!current) return;
  const saved = getLessonProgress(lessonSession.lesson.id);
  const requiredTasks = lessonSession.lesson.practice.mode === 'cockpit' ? lessonSession.lesson.practice.tasks.map((task) => task.id) : [];
  const completed = markPracticeComplete(current, lessonSession.lesson.id, {
    isCorrect: lessonSession.practiceCorrect, requiredTasks, completedTasks, replay: lessonSession.replay, mistakes: mistakes || lessonSession.practiceErrors || 0,
  });
  if (!saved?.theoryViewed || !completed) return;
  lessonSession.practiceCompleted = true;
  lessonSession.practiceErrors = mistakes || lessonSession.practiceErrors || 0;
  saveState();
  completeLesson();
}

function completeLesson() {
  if (!lessonSession || lessonSession.step !== 'practice') return false;
  const current = profile();
  const saved = getLessonProgress(lessonSession.lesson.id);
  if (!current || !canCompleteLesson(current, lessonSession.lesson.id)) return false;
  const outcome = markLessonComplete(current, lessonSession.lesson.id);
  const rewardClaimedNow = outcome.awarded;
  if (rewardClaimedNow) ensureDailyGoals(current).lesson = true;
  addAchievement('first-lesson');
  if (current.completedLessons.length >= lessons.length) addAchievement('graduate');
  saveState();
  refreshDashboard();
  renderProfile();
  lessonSession.result = {
    quizCorrect: lessonSession.quizCorrect ?? saved.lastQuizCorrect ?? lessonSession.correct,
    quizPercent: lessonSession.quizPercent ?? saved.lastQuizScore ?? 100,
    errors: lessonSession.errors + lessonSession.practiceErrors,
    rewardClaimedNow,
  };
  lessonSession.step = 'result';
  renderLessonStep();
  instructor?.lessonComplete(lessonSession.lesson);
  if (rewardClaimedNow) toast('Урок успешно завершён: +100 XP');
  return true;
}

function missionRecord(id) {
  const current = profile();
  if (!current) return null;
  current.missionProgress ||= {};
  current.missionProgress[id] ||= { status: 'available', attempts: 0, bestScore: null, rewardClaimed: current.completedMissions.includes(id) };
  return current.missionProgress[id];
}

function beginLandingTrainingRecord() {
  const current = profile();
  if (!current) {
    toast('Войди или создай профиль, чтобы сохранить результат посадки.');
    navigate('profile');
    return false;
  }
  const mission = missions.find((item) => item.id === 'landing-training');
  if (!mission) return false;
  const record = missionRecord(mission.id);
  recordStudyActivity(current);
  record.results ||= [];
  record.attempts = (record.attempts || 0) + 1;
  record.status = 'in_progress';
  record.attempt = { landingStage: 0, startedAt: new Date().toISOString() };
  missionSession = { mission, phase: 'landing', correct: 0, errors: 0, errorNotes: [] };
  saveState();
  refreshDashboard();
  renderProfile();
  instructor?.missionStart(mission);
  return true;
}

function saveLandingMissionProgress({ stage, touchdown }) {
  if (missionSession?.mission.id !== 'landing-training') return;
  const record = missionRecord('landing-training');
  if (!record) return;
  record.attempt ||= { startedAt: new Date().toISOString() };
  record.attempt.landingStage = stage;
  if (touchdown) record.attempt.touchdown = touchdown;
  record.status = 'in_progress';
  saveState();
  refreshDashboard();
}

function persistMissionAttempt() {
  if (!missionSession) return;
  const record = missionRecord(missionSession.mission.id);
  if (!record) return;
  record.attempt = { questionIndex: missionSession.questionIndex, correct: missionSession.correct, errors: missionSession.errors, answered: missionSession.answered, selected: missionSession.selected, score: missionSession.score, errorNotes: missionSession.errorNotes || [] };
  if (!profile().completedMissions.includes(missionSession.mission.id)) record.status = 'in_progress';
  saveState();
  refreshDashboard();
}

function startMission(mission) {
  if (!mission) return;
  const current = profile();
  if (!current) {
    toast('Войди в профиль, чтобы сохранять результаты миссий и награды.');
    navigate('profile');
    return;
  }
  if (mission.id === 'flight-exam' && current.completedLessons.length !== lessons.length) {
    toast('Итоговая миссия откроется после завершения всех шести уроков');
    return;
  }
  if (mission.kind === 'landing') {
    if (!beginLandingTrainingRecord()) return;
    navigate('simulator');
    window.aeroSimulator?.startLandingMission({ tracked: true });
    return;
  }
  const record = missionRecord(mission.id);
  recordStudyActivity(current);
  record.results ||= [];
  const savedAttempt = record.attempt;
  const resume = savedAttempt && !current.completedMissions.includes(mission.id);
  if (!resume) record.attempts = (record.attempts || 0) + 1;
  const attempt = resume ? savedAttempt : { questionIndex: 0, correct: 0, errors: 0, answered: false, selected: null, score: 0, errorNotes: [] };
  missionSession = { mission, ...attempt, phase: 'active' };
  missionSession.errorNotes ||= [];
  if (!current.completedMissions.includes(mission.id)) record.status = 'in_progress';
  persistMissionAttempt();
  instructor?.missionStart(mission);
  if (mission.kind === 'instrument') {
    document.querySelector('#mission-dialog').close();
    navigate('simulator');
    toast('Найди прибор, указанный Алексом, на панели 3D-кабины.');
    return;
  }
  renderMissionStage();
  const dialog = document.querySelector('#mission-dialog');
  if (!dialog.open) dialog.showModal();
}

function renderMissionStage() {
  if (!missionSession) return;
  const { mission } = missionSession;
  const stage = document.querySelector('#mission-dialog-stage');
  document.querySelector('#mission-dialog-title').textContent = mission.title;
  if (missionSession.phase === 'result') {
    const result = missionSession.result;
    stage.innerHTML = `<div class="mission-result ${result.passed ? 'passed' : 'failed'}"><span class="result-medal">${result.passed ? '✓' : '↻'}</span><span class="eyebrow">${result.passed ? 'МИССИЯ ВЫПОЛНЕНА' : 'ПОПРОБУЙ ЕЩЁ РАЗ'}</span><h3>${mission.title}</h3><div class="mission-result-stats"><span><b>${result.score}</b> очков</span><span><b>${result.percent}%</b> верных</span><span><b>+${result.xpEarned}</b> XP</span><span><b>${result.errors}</b> ошибок</span></div><p>${result.recommendation}</p><div class="result-actions"><button class="button-primary" data-mission-retry>Повторить миссию</button><button class="button-secondary" data-mission-menu>Вернуться к миссиям</button></div></div>`;
    document.querySelector('#mission-dialog-count').textContent = 'РЕЗУЛЬТАТ';
    return;
  }
  if (mission.displayReading) {
    stage.dataset.reading = 'true';
  } else delete stage.dataset.reading;
  const index = missionSession.questionIndex;
  const question = mission.questions[index];
  document.querySelector('#mission-dialog-count').textContent = `${index + 1} / ${mission.questions.length}`;
  const feedback = missionSession.answered ? `<div class="answer-explanation ${missionSession.selected === question.answer ? 'is-correct' : 'is-wrong'}"><b>${missionSession.selected === question.answer ? 'Верно!' : `Неверно. Правильный ответ: ${question.options[question.answer]}`}</b><p>${question.explanation}</p></div><button class="button-primary lesson-next" data-mission-next>${index < mission.questions.length - 1 ? 'Следующий вопрос' : 'Завершить проверку'} <span>→</span></button>` : '';
  stage.innerHTML = `${mission.displayReading ? `<div class="mission-reading-display"><small>ПОКАЗАНИЕ УЧЕБНОГО ВЫСОТОМЕРА</small><b>${mission.displayReading}</b><span>ALT · высота</span></div>` : ''}<div class="quiz-progress"><span>ВОПРОС ${index + 1} ИЗ ${mission.questions.length}</span><span>${missionSession.correct} верно · нужно ${mission.passCount}</span></div><h3 class="lesson-prompt">${question.prompt}</h3><div class="practice-options quiz-options">${question.options.map((option, optionIndex) => `<button class="practice-option ${missionSession.answered && missionSession.selected === optionIndex ? (optionIndex === question.answer ? 'selected-correct' : 'selected-wrong') : ''}" data-mission-answer="${optionIndex}" ${missionSession.answered ? 'disabled' : ''}>${option}</button>`).join('')}</div>${feedback}`;
}

function finishMission(passed, landingResult = null) {
  if (!missionSession || !['active', 'landing'].includes(missionSession.phase)) return;
  const current = profile();
  const { mission } = missionSession;
  const isLanding = mission.kind === 'landing';
  const correctCount = missionSession.correct || 0;
  const total = mission.questions?.length || 1;
  const percent = landingResult?.percent ?? Math.round(correctCount / total * 100);
  const score = landingResult?.score ?? Math.max(0, correctCount * 100 - missionSession.errors * 20);
  const errors = landingResult?.errors ?? missionSession.errors;
  const record = missionRecord(mission.id);
  const alreadyRewarded = current.completedMissions.includes(mission.id);
  let xpEarned = 0;
  if (passed && !alreadyRewarded) {
    current.completedMissions.push(mission.id);
    current.xp += mission.rewardXp;
    xpEarned = mission.rewardXp;
    record.rewardClaimed = true;
    record.rewardXpEarned = mission.rewardXp;
    record.completedAt = new Date().toISOString();
  }
  if (passed) record.status = 'completed';
  if (passed) ensureDailyGoals(current).mission = true;
  else if (!alreadyRewarded) record.status = 'in_progress';
  record.attempt = null;
  record.lastScore = score;
  record.lastPercent = percent;
  record.lastErrors = missionSession.errors;
  record.bestScore = record.bestScore == null ? score : Math.max(record.bestScore, score);
  const recommendation = landingResult?.recommendation || (passed
    ? missionSession.errors ? `Миссия пройдена. Разбери ошибки: ${(missionSession.errorNotes || []).join(' ')}` : 'Отличный результат. Продолжай изучать приборы и проверяй свои ответы.'
    : `Нужно выполнить условие: ${mission.condition.toLowerCase()}. ${(missionSession.errorNotes || []).at(-1) || 'Сравни варианты и попробуй ещё раз.'}`);
  record.lastResult = { passed, score, percent, errors, xpEarned, recommendation, ...(landingResult ? { checks: landingResult.checks } : {}), completedAt: new Date().toISOString() };
  record.results ||= [];
  record.results.push({ attempt: record.attempts, passed, score, percent, errors, xpEarned, recommendation, completedAt: record.lastResult.completedAt });
  if (record.results.length > 50) record.results.splice(0, record.results.length - 50);
  if (mission.questions) current.testResults[mission.title] = Math.max(current.testResults[mission.title] || 0, percent);
  missionSession.phase = 'result';
  missionSession.result = { passed, score, percent, errors, xpEarned, recommendation, checks: landingResult?.checks };
  if (mission.id === 'find-airspeed' && passed) addAchievement('instrument-expert');
  if (mission.id === 'flight-exam' && passed && percent >= 80) addAchievement('theorist');
  if (passed && errors === 0) addAchievement('careful-pilot');
  saveState();
  refreshDashboard();
  renderProfile();
  instructor?.missionResult(mission, missionSession.result);
  if (window.aeroSimulator) window.aeroSimulator.setPaused(true);
  if (!isLanding) {
    renderMissionStage();
    const dialog = document.querySelector('#mission-dialog');
    if (!dialog.open) dialog.showModal();
  }
  if (xpEarned) toast(`Миссия выполнена: +${xpEarned} XP`);
}

function onSimulatorInstrument(instrument) {
  instructor?.instrument(instrument);
  const current = profile();
  if (current && instrument?.id) {
    recordStudyActivity(current);
    const goals = ensureDailyGoals(current);
    if (!goals.instruments.includes(instrument.id)) {
      goals.instruments.push(instrument.id);
      saveState();
      refreshDashboard();
    }
  }
  if (!missionSession || missionSession.phase !== 'active' || missionSession.mission.kind !== 'instrument') return;
  if (instrument.id === missionSession.mission.targetInstrument) {
    missionSession.correct = 1;
    missionSession.score = 100;
    finishMission(true);
    return;
  }
  missionSession.errors += 1;
  missionSession.errorNotes ||= [];
  missionSession.errorNotes.push(`Это ${instrument.title}; найди указатель воздушной скорости с маркировкой ASI.`);
  missionSession.score = Math.max(0, 100 - missionSession.errors * 20);
  persistMissionAttempt();
  instructor?.mistake(`Это ${instrument.title}. В этой миссии нужно найти указатель воздушной скорости (ASI).`);
}

function showAuthTab(tab) {
  const register = tab === 'register';
  document.querySelector('#login-form').classList.toggle('hidden', register);
  document.querySelector('#register-form').classList.toggle('hidden', !register);
  document.querySelectorAll('[data-auth-tab]').forEach((button) => button.classList.toggle('selected', button.dataset.authTab === tab));
}

async function passwordHash(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('Для демо-входа открой сайт через localhost в современном браузере.');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

document.querySelector('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('#register-message');
  message.textContent = '';
  const data = new FormData(form);
  const nickname = String(data.get('nickname') || '').trim();
  const email = String(data.get('email') || '').trim().toLowerCase();
  const password = String(data.get('password') || '');
  const trainingLevel = String(data.get('trainingLevel') || 'Новичок');
  if (nickname.length < 2) { message.textContent = 'Укажи имя или никнейм (минимум 2 символа).'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { message.textContent = 'Проверь формат электронной почты.'; return; }
  if (password.length < 8) { message.textContent = 'Пароль должен содержать не менее 8 символов.'; return; }
  if (isSupabaseConfigured()) {
    try {
      const result = await registerCloudUser({ email, password, nickname, trainingLevel });
      if (!result.confirmed) {
        message.textContent = 'Аккаунт создан. Подтверди электронную почту, затем войди в профиль.';
        return;
      }
      activateOnlineUser(result.onlineUser);
      form.reset();
      instructor?.welcome(nickname);
      toast('Онлайн-профиль создан');
      navigate('home');
    } catch (error) { message.textContent = error.message || 'Не удалось создать онлайн-профиль.'; }
    return;
  }
  if (users.some((user) => user.email === email)) { message.textContent = 'Этот адрес уже зарегистрирован. Попробуй войти.'; return; }
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltText = [...salt].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    users.push({ email, salt: saltText, hash: await passwordHash(password, saltText), nickname, trainingLevel });
    localStorage.setItem(usersKey, JSON.stringify(users));
    state.profiles[email] = blankProfile({ email, nickname, trainingLevel });
    state.sessionEmail = email;
    saveState();
    form.reset();
    refreshDashboard(); renderProfile();
    instructor?.welcome(nickname);
    toast('Профиль курсанта создан');
    navigate('home');
  } catch (error) { message.textContent = error.message || 'Не получилось создать профиль. Попробуй ещё раз.'; }
});

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('#login-message');
  message.textContent = '';
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim().toLowerCase();
  const password = String(data.get('password') || '');
  if (isSupabaseConfigured()) {
    try {
      const user = await loginCloudUser({ email, password });
      activateOnlineUser(user);
      form.reset();
      instructor?.welcome(user.nickname);
      toast(`С возвращением, ${user.nickname}!`);
      navigate('home');
    } catch (error) { message.textContent = error.message || 'Не удалось выполнить онлайн-вход.'; }
    return;
  }
  const user = users.find((item) => item.email === email);
  if (!user) { message.textContent = 'Профиль с такой почтой не найден.'; return; }
  try {
    const hash = await passwordHash(password, user.salt);
    if (hash !== user.hash) { message.textContent = 'Неверный пароль. Проверь данные и попробуй снова.'; return; }
    state.profiles[email] ||= blankProfile(user);
    state.sessionEmail = email;
    saveState();
    form.reset();
    refreshDashboard(); renderProfile();
    instructor?.welcome(user.nickname);
    toast(`С возвращением, ${user.nickname}!`);
    navigate('home');
  } catch (error) { message.textContent = error.message || 'Не удалось выполнить вход.'; }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-instructor-help]')) instructor?.help();
  const navButton = event.target.closest('[data-page]');
  if (navButton) navigate(navButton.dataset.page);
  if (event.target.closest('#theme-toggle')) applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  const themeChoice = event.target.closest('[data-theme-choice]');
  if (themeChoice) applyTheme(themeChoice.dataset.themeChoice);
  if (event.target.closest('[data-action="start-lesson"]')) navigate('learning');
  if (event.target.closest('[data-preview-close]')) document.querySelector('#lesson-preview-dialog').close();
  if (event.target.closest('[data-preview-start]') && (previewedLesson || previewedMission)) {
    const lesson = previewedLesson;
    const mission = previewedMission;
    previewedLesson = null;
    previewedMission = null;
    document.querySelector('#lesson-preview-dialog').close();
    if (mission) startMission(mission);
    else startLesson(lesson);
  }
  const tab = event.target.closest('[data-auth-tab]');
  if (tab) showAuthTab(tab.dataset.authTab);
  if (event.target.closest('#logout-button')) {
    (async () => {
      if (onlineUser) await logoutCloudUser();
      onlineUser = null;
      multiplayer?.setUser(null);
      state.sessionEmail = '';
      missionSession = null;
      saveState();
      renderProfile();
      showAuthTab('login');
      refreshDashboard();
      toast('Ты вышел из профиля');
    })().catch((error) => toast(error.message || 'Не удалось выйти из профиля.'));
  }
  if (event.target.closest('#reset-progress-button')) {
    if (!confirm('Сбросить XP, уроки, миссии, результаты тестов и достижения? Это действие нельзя отменить.')) return;
    const currentUser = users.find((user) => user.email === state.sessionEmail);
    if (!currentUser) { toast('Не удалось найти учётную запись для этого профиля'); return; }
    missionSession = null;
    if (document.querySelector('#mission-dialog').open) document.querySelector('#mission-dialog').close();
    state.profiles[state.sessionEmail] = blankProfile(currentUser);
    saveState(); refreshDashboard(); renderProfile(); toast('Игровой прогресс сброшен');
  }
  const missionAnswer = event.target.closest('[data-mission-answer]');
  if (missionAnswer && missionSession?.phase === 'active' && !missionSession.answered) {
    const question = missionSession.mission.questions[missionSession.questionIndex];
    missionSession.selected = Number(missionAnswer.dataset.missionAnswer);
    missionSession.answered = true;
    if (missionSession.selected === question.answer) {
      missionSession.correct += 1;
      recordDailyAnswer(current, `mission:${missionSession.mission.id}:${missionSession.questionIndex}`);
      instructor?.correct(question.explanation);
    } else {
      missionSession.errors += 1;
      missionSession.errorNotes ||= [];
      missionSession.errorNotes.push(question.explanation);
      instructor?.mistake(question.explanation);
    }
    missionSession.score = Math.max(0, missionSession.correct * 100 - missionSession.errors * 20);
    persistMissionAttempt();
    renderMissionStage();
    return;
  }
  if (event.target.closest('[data-mission-next]') && missionSession?.phase === 'active') {
    if (missionSession.questionIndex < missionSession.mission.questions.length - 1) {
      missionSession.questionIndex += 1;
      missionSession.answered = false;
      missionSession.selected = null;
      persistMissionAttempt();
      renderMissionStage();
    } else finishMission(missionSession.correct >= missionSession.mission.passCount);
    return;
  }
  if (event.target.closest('[data-mission-retry]') && missionSession) {
    const { mission } = missionSession;
    document.querySelector('#mission-dialog').close();
    startMission(mission);
    return;
  }
  if (event.target.closest('[data-mission-menu]')) {
    document.querySelector('#mission-dialog').close();
    missionSession = null;
    navigate('missions');
    return;
  }
  if (event.target.closest('[data-mission-close]')) document.querySelector('#mission-dialog').close();
  const answer = event.target.closest('[data-answer]');
  if (answer) {
    const current = profile();
    const feedback = document.querySelector('#test-feedback');
    if (!current) { feedback.textContent = 'Создай профиль, чтобы записать результат теста.'; navigate('profile'); return; }
    if (current.completedTests.includes('basic-heading')) { feedback.textContent = 'Этот вопрос уже пройден. XP за ответ уже начислен.'; return; }
    if (Number(answer.dataset.answer) === 1) {
      current.testResults['Основы полёта'] = 100;
      recordStudyActivity(current);
      recordDailyAnswer(current, 'basic-heading');
      awardXp(20, 'Правильный ответ', 'basic-heading', 'completedTests');
      feedback.textContent = 'Верно! Курс — направление продольной оси самолёта относительно севера.';
      document.querySelectorAll('[data-answer]').forEach((button) => { button.disabled = true; });
    } else { feedback.textContent = 'Пока неверно. Подсказка: это направление, выраженное в градусах.'; }
  }
  const practiceAnswer = event.target.closest('[data-practice-answer]');
  if (practiceAnswer && lessonSession?.step === 'practice') {
    const selected = Number(practiceAnswer.dataset.practiceAnswer);
    lessonSession.practiceChoice = selected;
    renderLessonStep();
  }
  if (event.target.closest('[data-complete-theory]') && lessonSession?.step === 'theory') completeTheory();
  if (event.target.closest('[data-quiz-continue]') && lessonSession?.step === 'quiz' && getLessonProgress(lessonSession.lesson.id)?.quizPassed) {
    if (!enterPractice(profile(), lessonSession.lesson.id, { replay: lessonSession.replay })) return;
    persistLessonProgress('practice');
    lessonSession.step = 'practice';
    lessonSession.practiceChoice = undefined;
    lessonSession.practiceCorrect = false;
    renderLessonStep();
  }
  if (event.target.closest('[data-practice-check]') && lessonSession?.step === 'practice' && lessonSession.practiceChoice !== undefined) {
    const practice = lessonSession.lesson.practice;
    lessonSession.practiceCorrect = lessonSession.practiceChoice === practice.answer;
    if (lessonSession.practiceCorrect) {
      instructor?.correct(practice.explanation);
      completePractice();
    } else {
      lessonSession.practiceErrors += 1;
      instructor?.mistake(practice.explanation);
      persistLessonProgress('practice', { practiceErrors: lessonSession.practiceErrors });
      renderLessonStep();
    }
  }
  if (event.target.closest('[data-retry-quiz]') && lessonSession?.step === 'quiz') {
    lessonSession.quizOutcome = '';
    lessonSession.questionIndex = 0;
    lessonSession.correct = 0;
    lessonSession.answered = false;
    lessonSession.lastCorrect = false;
    lessonSession.errors = 0;
    const saved = getLessonProgress(lessonSession.lesson.id);
    saved.quizOutcome = '';
    saveQuizAttempt();
    saveState();
    renderLessonStep();
  }
  if (event.target.closest('[data-quiz-next]') && lessonSession?.step === 'quiz') {
    if (lessonSession.questionIndex < lessonSession.lesson.quiz.length - 1) {
      lessonSession.questionIndex += 1;
      lessonSession.answered = false;
      lessonSession.lastCorrect = false;
      saveQuizAttempt();
      renderLessonStep();
    } else completeQuiz();
  }
  const lessonAnswer = event.target.closest('[data-lesson-answer]');
  if (lessonAnswer && lessonSession?.step === 'quiz' && !lessonSession.answered) {
    const current = profile();
    if (!current) { toast('Войди в профиль, чтобы сохранить результат ответа'); navigate('profile'); return; }
    const question = lessonSession.lesson.quiz[lessonSession.questionIndex];
    lessonSession.lastCorrect = Number(lessonAnswer.dataset.lessonAnswer) === question.answer;
    lessonSession.answered = true;
    if (lessonSession.lastCorrect) {
      lessonSession.correct += 1;
      instructor?.correct(question.explanation);
      recordDailyAnswer(current, `lesson:${lessonSession.lesson.id}:${lessonSession.questionIndex}`);
      awardXp(20, 'Верный ответ', `lesson-question:${lessonSession.lesson.id}:${lessonSession.questionIndex}`, 'completedTests');
    } else { lessonSession.errors += 1; instructor?.mistake(question.explanation); }
    saveQuizAttempt();
    renderLessonStep();
  }
  if (event.target.closest('[data-close-lesson]')) document.querySelector('#lesson-dialog').close();
  if (event.target.closest('#lesson-close')) document.querySelector('#lesson-dialog').close();
});

document.querySelector('#menu-toggle').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelector('#sidebar').classList.remove('open'); });

renderLessons(document.querySelector('#course-grid'), { onStart: startLesson, onPreview: showLessonPreview });
renderLessons(document.querySelector('#all-course-grid'), { onStart: startLesson, onPreview: showLessonPreview });
multiplayer = createMultiplayer({
  root: document.querySelector('#page-competitions'),
  getUser: () => onlineUser,
  toast,
  onAccountUpdate: updateOnlineAccount,
});
multiplayer.setUser(null);
courseCreator = createCourseCreator({
  root: document.querySelector('#course-creator-app'),
  missions,
  getProfile: () => profile(),
  onNavigate: navigate,
  toast,
});
courseCreator.render();
document.querySelector('#lesson-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
document.querySelector('#lesson-dialog').addEventListener('close', () => {
  lessonPracticeController?.dispose?.();
  lessonPracticeController = null;
  lessonSession = null;
});
applyTheme(state.theme);
renderProfile();
refreshDashboard();
instructor?.welcome(profile()?.nickname || '');
if (isSupabaseConfigured()) {
  restoreCloudUser()
    .then((user) => { if (user) activateOnlineUser(user); })
    .catch((error) => toast(error.message || 'Не удалось восстановить онлайн-сессию.'));
}
const initialPage = location.hash.slice(1);
if (pageTitles[initialPage]) navigate(initialPage);
