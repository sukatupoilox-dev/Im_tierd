export const achievements = [
  { id: 'first-lesson', title: 'Первый урок', description: 'Успешно заверши любой урок.', icon: '✦', rewardXp: 50 },
  { id: 'instrument-expert', title: 'Знаток приборов', description: 'Найди указатель воздушной скорости в 3D-кабине.', icon: '◉', rewardXp: 50 },
  { id: 'theorist', title: 'Теоретик', description: 'Сдай итоговый теоретический экзамен с результатом не ниже 80%.', icon: '✓', rewardXp: 50 },
  { id: 'careful-pilot', title: 'Внимательный пилот', description: 'Заверши миссию, не допустив ошибок.', icon: '◆', rewardXp: 50 },
  { id: 'graduate', title: 'Выпускник', description: 'Успешно заверши все шесть уроков AeroPilot.', icon: '✈', rewardXp: 50 },
];

function formattedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function renderAchievements(container, { recent = false, earnedIds = [], achievementDates = {} } = {}) {
  if (!container) return;
  const list = recent ? achievements.filter((item) => earnedIds.includes(item.id)).sort((a, b) => new Date(achievementDates[b.id] || 0) - new Date(achievementDates[a.id] || 0)).slice(0, 2) : achievements;
  if (recent && !list.length) {
    container.innerHTML = '<span class="detail-empty">Первые награды появятся после завершения урока или миссии.</span>';
    return;
  }
  container.innerHTML = list.map((item) => {
    const unlocked = earnedIds.includes(item.id);
    const date = formattedDate(achievementDates[item.id]);
    const detail = unlocked ? `Получено${date ? ` · ${date}` : ''}` : item.description;
    return recent
      ? `<div class="achievement-item"><span class="achievement-medal">${item.icon}</span><span><b>${item.title}</b><small>${detail}</small></span></div>`
      : `<article class="achievement-full ${unlocked ? 'unlocked' : 'locked'}"><span class="achievement-medal">${item.icon}</span><span><b>${item.title}</b><small>${item.description}</small><small class="achievement-status">${unlocked ? `Открыто · ${date || 'дата не указана'} · +${item.rewardXp} XP` : `Закрыто · награда ${item.rewardXp} XP`}</small></span></article>`;
  }).join('');
}
