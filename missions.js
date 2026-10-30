export const missions = [
  {
    id: 'landing-training', title: 'Посадка в аэропорту', icon: '▰', kind: 'landing',
    description: 'Выполни заход и остановись на полосе, управляя самолётом вручную.',
    goal: 'Выровняться с ВПП, выпустить закрылки и шасси, коснуться полосы и затормозить.',
    condition: 'Посадить самолёт и остановиться в пределах полосы.', rewardXp: 150,
  },
  {
    id: 'find-airspeed', title: 'Найди указатель скорости', icon: '◉', kind: 'instrument',
    description: 'Открой 3D-кабину и найди прибор, который показывает скорость самолёта относительно воздуха.',
    goal: 'Выбрать указатель воздушной скорости на приборной панели.', condition: 'Нажать на прибор ASI в 3D-кабине.', rewardXp: 50, targetInstrument: 'airspeed',
  },
  {
    id: 'attitude-check', title: 'Положение по авиагоризонту', icon: '⌁', kind: 'quiz',
    description: 'Определи, какое положение самолёта показывает учебный авиагоризонт.',
    goal: 'Верно определить правый крен.', condition: 'Выбрать правильное положение самолёта.', rewardXp: 50, passCount: 1,
    questions: [{ prompt: 'На схеме правое крыло опущено ниже левого. Как называется это положение?', options: ['Правый крен', 'Тангаж вверх', 'Снижение тяги'], answer: 0, explanation: 'Когда правое крыло ниже левого, самолёт находится в правом крене.' }],
  },
  {
    id: 'aerodynamics-check', title: 'Основы аэродинамики', icon: '↗', kind: 'quiz',
    description: 'Проверь, как ты различаешь четыре основные силы, действующие на самолёт.',
    goal: 'Правильно ответить хотя бы на 2 вопроса из 3.', condition: 'Набрать не менее 2 правильных ответов.', rewardXp: 75, passCount: 2,
    questions: [
      { prompt: 'Какая сила направлена вверх и возникает при обтекании крыла воздухом?', options: ['Подъёмная сила', 'Сила тяжести', 'Сопротивление'], answer: 0, explanation: 'Подъёмная сила направлена вверх и связана с движением воздуха вокруг крыла.' },
      { prompt: 'Какая сила направлена к центру Земли?', options: ['Тяга', 'Сила тяжести', 'Подъёмная сила'], answer: 1, explanation: 'Сила тяжести тянет самолёт вниз, к центру Земли.' },
      { prompt: 'В каком направлении действует тяга двигателя при обычном горизонтальном полёте?', options: ['Вперёд', 'Назад', 'Только вверх'], answer: 0, explanation: 'Тяга двигателя направлена вперёд и помогает преодолевать сопротивление воздуха.' },
    ],
  },
  {
    id: 'altimeter-reading', title: 'Считай высоту', icon: '⌖', kind: 'quiz',
    description: 'Считай показание высотомера на учебном приборе и выбери подходящее значение.',
    goal: 'Определить высоту по показанию 2 500 ft.', condition: 'Выбрать значение 2 500 футов.', rewardXp: 50, passCount: 1,
    displayReading: '2 500 ft',
    questions: [{ prompt: 'Учебный высотомер показывает 2 500 ft. Какое значение нужно записать?', options: ['2 500 футов', '250 футов', '25 000 футов'], answer: 0, explanation: 'Большая стрелка на условной схеме соответствует 2 500 футам. Реальные высотомеры требуют настройки и изучения по руководству конкретного самолёта.' }],
  },
  {
    id: 'flight-exam', title: 'Теоретический экзамен', icon: '★', kind: 'quiz',
    description: 'Итоговая проверка по приборам, управлению и основам полёта.',
    goal: 'Ответить правильно минимум на 4 вопроса из 5.', condition: 'Набрать не менее 80% правильных ответов.', rewardXp: 100, passCount: 4,
    questions: [
      { prompt: 'Какой прибор показывает положение самолёта относительно горизонта?', options: ['Авиагоризонт', 'Высотомер', 'Тахометр'], answer: 0, explanation: 'Авиагоризонт показывает тангаж и крен относительно горизонта.' },
      { prompt: 'Что показывает высотомер?', options: ['Высоту относительно установленного уровня отсчёта', 'Обороты двигателя', 'Курс'], answer: 0, explanation: 'Высотомер показывает высоту; показание зависит от корректной установки давления.' },
      { prompt: 'Как называются поворот носа вокруг вертикальной оси?', options: ['Рыскание', 'Тангаж', 'Крен'], answer: 0, explanation: 'Рыскание — вращение вокруг вертикальной оси.' },
      { prompt: 'Какой прибор показывает темп набора высоты или снижения?', options: ['Указатель вертикальной скорости', 'Компас', 'Указатель скорости'], answer: 0, explanation: 'Указатель вертикальной скорости показывает скорость изменения высоты.' },
      { prompt: 'Что помогает преодолевать сопротивление воздуха?', options: ['Тяга двигателя', 'Сила тяжести', 'Вертикальная скорость'], answer: 0, explanation: 'Тяга направлена вперёд и помогает преодолевать сопротивление.' },
    ],
  },
];

export function renderMissions(container, { progressMap = {}, completedIds = [], onStart } = {}) {
  if (!container) return;
  container.innerHTML = missions.map((mission) => {
    const progress = progressMap[mission.id] || {};
    const completed = progress.status === 'completed' || completedIds.includes(mission.id);
    const status = completed ? 'Выполнена' : progress.status === 'in_progress' ? 'Можно продолжить' : 'Доступна';
    const latest = progress.results?.at(-1);
    const history = progress.attempts ? `<small class="mission-history">Попыток: ${progress.attempts}${progress.bestScore != null ? ` · лучший результат: ${progress.bestScore} очков` : ''}${latest ? ` · последняя: ${latest.passed ? 'успех' : 'повтор'}, ${latest.errors} ошибок` : ''}${progress.completedAt ? ` · ${new Date(progress.completedAt).toLocaleDateString('ru-RU')}` : ''}</small>` : '';
    return `<article class="mission-card mission-item ${completed ? 'is-complete' : ''}"><div class="mission-icon">${mission.icon}</div><div class="mission-copy"><div class="mission-card-top"><span class="pill-blue">${mission.kind === 'instrument' ? '3D-КАБИНА' : 'УЧЕБНОЕ ЗАДАНИЕ'}</span><span class="mission-status ${completed ? 'is-complete' : ''}">${status}</span></div><h3>${mission.title}</h3><p>${mission.description}</p><div class="mission-goal"><b>Цель:</b> ${mission.goal}</div><div class="mission-goal"><b>Условие:</b> ${mission.condition}</div><div class="mission-reward">Награда · +${mission.rewardXp} XP <span>Начисляется один раз</span></div>${history}</div><button class="button-primary" data-mission-start="${mission.id}">${completed ? 'Повторить' : progress.status === 'in_progress' ? 'Продолжить' : 'Начать миссию'} <span>→</span></button></article>`;
  }).join('');
  container.querySelectorAll('[data-mission-start]').forEach((button) => button.addEventListener('click', () => {
    const mission = missions.find((item) => item.id === button.dataset.missionStart);
    onStart?.(mission);
  }));
}
