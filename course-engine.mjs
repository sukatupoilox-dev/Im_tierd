export const COURSE_BLOCKS = Object.freeze({
  start: { label: 'Начало', icon: '▶', outputs: ['next'] },
  theory: { label: 'Теория', icon: '▤', outputs: ['next'] },
  image: { label: 'Изображение', icon: '▧', outputs: ['next'] },
  video: { label: 'Видео', icon: '▷', outputs: ['next'] },
  test: { label: 'Тест', icon: '✓', outputs: ['next'] },
  question: { label: 'Вопрос', icon: '?', outputs: ['next'] },
  practice: { label: 'Практика', icon: '✈', outputs: ['next'] },
  simulation: { label: 'Полётная симуляция', icon: '◉', outputs: ['next'] },
  condition: { label: 'Условие', icon: '◇', outputs: ['pass', 'fail'] },
  branch: { label: 'Разветвление', icon: '⑂', outputs: ['pass', 'fail'] },
  finish: { label: 'Завершение', icon: '■', outputs: [] },
});

export const COURSE_PALETTE = Object.freeze([
  'start', 'theory', 'image', 'video', 'test', 'question',
  'practice', 'simulation', 'condition', 'branch', 'finish',
]);

export function createCourse(title = 'Новый курс') {
  const start = createBlock('start');
  const finish = createBlock('finish');
  return {
    id: createId(),
    title,
    description: '',
    updatedAt: new Date().toISOString(),
    blocks: [start, finish],
    connections: [{ from: start.id, port: 'next', to: finish.id }],
  };
}

export function createBlock(type) {
  if (!COURSE_BLOCKS[type]) throw new Error(`Unknown course block: ${type}`);
  const config = {
    title: COURSE_BLOCKS[type].label,
    content: '',
    questions: [createQuestion()],
    question: createQuestion(),
    thresholdPercent: 80,
    missionId: '',
    completionCondition: '',
    criteria: '',
    asset: null,
    videoUrl: '',
  };
  return { id: createId(), type, config };
}

export function insertBlock(course, type, targetIndex = course.blocks.findIndex((block) => block.type === 'finish')) {
  const block = createBlock(type);
  const index = Math.max(0, Math.min(targetIndex, course.blocks.length));
  course.blocks.splice(index, 0, block);
  const previous = course.blocks[index - 1];
  const next = course.blocks[index + 1];
  if (previous && COURSE_BLOCKS[previous.type].outputs.includes('next')) {
    connectBlocks(course, previous.id, 'next', block.id);
  }
  if (type !== 'finish' && next && COURSE_BLOCKS[type].outputs.includes('next')) {
    connectBlocks(course, block.id, 'next', next.id);
  }
  return block;
}

export function createQuestion() {
  return {
    prompt: '',
    options: ['Вариант 1', 'Вариант 2'],
    answer: 0,
    explanation: '',
    points: 1,
  };
}

export function connectBlocks(course, from, port, to) {
  const source = course.blocks.find((block) => block.id === from);
  const target = course.blocks.find((block) => block.id === to);
  if (!source || !target) throw new Error('Блок не найден.');
  if (from === to) throw new Error('Нельзя соединить блок с самим собой.');
  if (!COURSE_BLOCKS[source.type].outputs.includes(port)) {
    throw new Error('У этого блока нет такого выхода.');
  }
  course.connections = course.connections.filter((edge) => !(edge.from === from && edge.port === port));
  course.connections.push({ from, port, to });
  return course;
}

export function disconnectBlocks(course, from, port) {
  course.connections = course.connections.filter((edge) => !(edge.from === from && edge.port === port));
  return course;
}

export function moveBlock(course, blockId, targetIndex) {
  const index = course.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return course;
  const [block] = course.blocks.splice(index, 1);
  course.blocks.splice(Math.max(0, Math.min(targetIndex, course.blocks.length)), 0, block);
  return course;
}

export function validateCourse(course) {
  const errors = [];
  const blocks = new Map((course?.blocks || []).map((block) => [block.id, block]));
  const starts = [...blocks.values()].filter((block) => block.type === 'start');
  const finishes = [...blocks.values()].filter((block) => block.type === 'finish');
  if (!course?.title?.trim()) errors.push('Укажи название курса.');
  if (starts.length !== 1) errors.push('В курсе должен быть ровно один блок «Начало».');
  if (!finishes.length) errors.push('Добавь блок «Завершение».');
  for (const edge of course?.connections || []) {
    const source = blocks.get(edge.from);
    if (!source || !blocks.has(edge.to)) errors.push('В связях есть блок, которого больше нет.');
    else if (!COURSE_BLOCKS[source.type].outputs.includes(edge.port)) errors.push('Указан недопустимый выход блока.');
  }
  const reachable = new Set();
  const pending = starts.map((block) => block.id);
  while (pending.length) {
    const current = pending.pop();
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of course.connections.filter((item) => item.from === current)) pending.push(edge.to);
  }
  if (starts.length === 1 && !finishes.some((block) => reachable.has(block.id))) {
    errors.push('Соедини блок «Начало» с «Завершением».');
  }
  if (reachable.size !== blocks.size) errors.push('Соедини каждый блок с началом курса или с одной из его ветвей.');
  return [...new Set(errors)];
}

export function evaluateQuestions(questions, answers) {
  const validQuestions = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => question.prompt.trim());
  if (!validQuestions.length) throw new Error('Добавь хотя бы один вопрос с текстом.');
  let points = 0;
  let earned = 0;
  validQuestions.forEach(({ question, index }) => {
    const weight = Math.max(1, Number(question.points) || 1);
    points += weight;
    if (Number(answers[index]) === Number(question.answer)) earned += weight;
  });
  return {
    score: Math.round(earned / points * 100),
    correct: validQuestions.filter(({ question, index }) => Number(answers[index]) === Number(question.answer)).length,
    total: validQuestions.length,
  };
}

export function nextCourseBlock(course, block, score = 0) {
  const port = block.type === 'condition' || block.type === 'branch'
    ? score >= Number(block.config.thresholdPercent ?? 80) ? 'pass' : 'fail'
    : 'next';
  return course.connections.find((edge) => edge.from === block.id && edge.port === port)?.to || null;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
