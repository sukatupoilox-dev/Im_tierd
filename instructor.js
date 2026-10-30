const lessonHints = {
  cockpit: 'Сначала найди на панели приборы полёта. В практике я попрошу тебя отыскать ASI и высотомер.',
  controls: 'Запомни три оси: тангаж — нос вверх или вниз, крен — наклон крыльев, рыскание — поворот носа влево или вправо.',
  aerodynamics: 'Представь баланс сил: подъёмная сила вверх, тяжесть вниз, тяга вперёд, сопротивление назад.',
  orientation: 'Смотри на символ самолёта и линию горизонта вместе: так легче заметить тангаж и крен.',
  instruments: 'Сначала определи, какой параметр ищешь: скорость, высоту, вертикальную скорость или обороты.',
  final: 'Не торопись. Прочитай вопрос до конца и вспомни, какой параметр показывает каждый прибор.',
};

export function createInstructor(root) {
  if (!root) return null;
  const panel = root.querySelector('[data-instructor-panel]');
  const message = root.querySelector('[data-instructor-message]');
  const label = root.querySelector('[data-instructor-label]');
  const toggle = root.querySelector('[data-instructor-toggle]');
  let lessonId = null;
  let lastMission = null;
  let errors = 0;
  let lastAdvice = 'Я Алекс, твой виртуальный инструктор. Могу объяснить прибор, подсказать по уроку или помочь разобрать ошибку.';

  const say = (text, category = 'Совет Алекса', open = true) => {
    lastAdvice = text;
    label.textContent = category;
    message.textContent = text;
    document.querySelectorAll('[data-alex-inline]').forEach((element) => { element.textContent = `Алекс: ${text}`; });
    if (open) {
      panel.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
    }
  };
  toggle.addEventListener('click', () => {
    const open = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) say(lastAdvice, 'Алекс · на связи', false);
  });
  return {
    welcome(nickname = '') {
      lessonId = null; lastMission = null;
      const name = nickname ? `, ${nickname}` : '';
      say(`Привет${name}! Я Алекс, виртуальный инструктор AeroPilot. Изучай приборы, выполняй миссии — я подскажу, если станет сложно.`, 'Инструктор Алекс', false);
    },
    lessonStart(lesson) {
      lessonId = lesson?.id || null; lastMission = null; errors = 0;
      say(`Начинаем урок «${lesson?.title || 'обучение'}». ${lessonHints[lessonId] || 'Сначала изучи теорию, затем проверь себя и выполни практику.'}`, 'Урок · совет Алекса');
    },
    correct(context = '') {
      say(context || 'Верно! Хорошее наблюдение. Продолжай и связывай показание с назначением прибора.', 'Верный ответ');
    },
    mistake(context = '') {
      errors += 1;
      const retry = errors >= 2 ? 'Похоже, тема пока даётся непросто. Вернись к теории и попробуй ещё раз — обучение рассчитано на повторение.' : 'Ничего страшного. Сравни варианты и вспомни объяснение из теории, затем попробуй снова.';
      say(context ? `${context} ${retry}` : retry, 'Разберём ошибку');
    },
    missionStart(mission) {
      lastMission = mission; lessonId = null; errors = 0;
      say(`Миссия «${mission.title}». ${mission.goal} Условие: ${mission.condition}. Я помогу, если понадобится подсказка.`, 'Миссия · брифинг');
    },
    instrument(instrument) {
      say(`${instrument.title}: ${instrument.purpose} Сейчас на приборе ${instrument.reading}. В учебной модели смотри, как показание меняется после управляющего действия.`, 'Прибор · пояснение');
    },
    lessonComplete(lesson) {
      say(`Поздравляю! Урок «${lesson.title}» завершён. Ты прошёл теорию, проверку знаний и практику. Отличная работа!`, 'Урок завершён');
      lessonId = null; lastMission = null;
    },
    missionResult(mission, result) {
      const advice = result.passed
        ? result.errors ? `Миссия «${mission.title}» выполнена. Ты набрал ${result.score} очков. Повтори материал об ошибках: ${result.recommendation}` : `Миссия «${mission.title}» выполнена без ошибок. Отличная внимательность!`
        : `Миссия «${mission.title}» пока не пройдена. ${result.recommendation} Попробуй ещё раз.`;
      say(advice, result.passed ? 'Результат миссии' : 'Рекомендация');
      lastMission = mission;
    },
    achievement(title) { say(`Новое достижение — «${title}»! Награда добавлена в твой профиль.`, 'Новое достижение'); },
    help() {
      let advice = lastAdvice;
      if (lastMission) advice = `Подсказка к миссии «${lastMission.title}»: ${lastMission.goal} Условие выполнения: ${lastMission.condition}`;
      else if (lessonId) advice = lessonHints[lessonId] || 'Вспомни основные понятия урока и свяжи их с показаниями приборов.';
      say(advice, lastMission ? 'Подсказка к миссии' : lessonId ? 'Подсказка к уроку' : 'Совет Алекса');
      return advice;
    },
  };
}
