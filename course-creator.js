import {
  COURSE_BLOCKS,
  COURSE_PALETTE,
  connectBlocks,
  createCourse,
  disconnectBlocks,
  evaluateQuestions,
  insertBlock,
  moveBlock,
  nextCourseBlock,
  validateCourse,
} from './course-engine.mjs';

const STORAGE_KEY = 'aeropilot-course-drafts-v1';
const STORAGE_BUCKET = 'course-materials';
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPTED_FILES = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['application/pdf', 'pdf'],
  ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov'],
  ['audio/mpeg', 'mp3'], ['audio/mp4', 'm4a'], ['audio/wav', 'wav'], ['audio/ogg', 'ogg'], ['audio/webm', 'weba'],
]);

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};
const newId = () => globalThis.crypto?.randomUUID?.() || `course-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const textArea = (label, field, value, placeholder = '') => `<label class="course-field">${label}<textarea data-field="${field}" rows="5" placeholder="${placeholder}">${escapeHtml(value)}</textarea></label>`;
const textInput = (label, field, value, placeholder = '') => `<label class="course-field">${label}<input data-field="${field}" value="${escapeHtml(value)}" placeholder="${placeholder}"></label>`;
const points = (value) => Math.max(1, Number(value) || 1);
let sdkPromise;

async function supabaseClient() {
  const config = window.AEROPILOT_SUPABASE;
  if (!config?.url?.trim() || !config?.anonKey?.trim()) throw new Error('Для облачной загрузки сначала настрой Supabase в supabase-config.js.');
  sdkPromise ||= import('https://esm.sh/@supabase/supabase-js@2?bundle').then(({ createClient }) => createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }));
  const client = await sdkPromise;
  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw error;
  if (!session?.user) throw new Error('Войди через онлайн-аккаунт Supabase в профиле, чтобы загружать материалы в облако.');
  return { client, user: session.user };
}

export function createCourseCreator({ root, missions, getProfile, onNavigate, toast }) {
  let courses = loadCourses();
  let selectedCourseId = null;
  let selectedBlockId = null;
  let connecting = null;
  let runtime = null;
  const previewUrls = new Set();

  function loadCourses() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return Array.isArray(saved.courses)
        ? saved.courses.map((course) => ({ ...course, owner: course.owner || 'guest' }))
        : [];
    } catch (error) {
      console.error('Unable to load course drafts', error);
      toast('Не удалось прочитать черновики курсов. Сохранившиеся данные не изменены.');
      return [];
    }
  }

  function ownerKey() {
    return getProfile()?.email || 'guest';
  }

  function persist() {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      all.courses ||= [];
      const saved = courses.map((course) => ({ ...course, owner: course.owner || ownerKey() }));
      const otherOwners = all.courses.filter((course) => course.owner !== ownerKey());
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ courses: [...otherOwners, ...saved] }));
      courses = saved;
      return true;
    } catch (error) {
      console.error('Unable to save course drafts', error);
      toast('Не удалось сохранить черновик. Освободи место в браузере или загрузи крупные файлы в облако.');
      return false;
    }
  }

  function ownedCourses() {
    return courses.filter((course) => (course.owner || 'guest') === ownerKey());
  }

  function course() {
    return courses.find((item) => item.id === selectedCourseId) || null;
  }

  function block() {
    return course()?.blocks.find((item) => item.id === selectedBlockId) || null;
  }

  function cleanupPreviews() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.clear();
  }

  function render() {
    cleanupPreviews();
    if (runtime) {
      renderPlayer();
      return;
    }
    if (!selectedCourseId) {
      renderLibrary();
      return;
    }
    renderEditor();
  }

  function renderLibrary() {
    const mine = ownedCourses();
    root.innerHTML = `<div class="course-creator-heading">
        <div><span class="eyebrow">АВТОРСКИЙ КОНТЕНТ</span><h2>Мои курсы</h2><p>Создавай интерактивные курсы из связанных блоков. Черновики сохраняются в этом браузере.</p></div>
        <button class="button-primary" data-course-create>＋ Создать курс</button>
      </div>
      <form class="course-create-form hidden" data-course-create-form>
        <label class="course-field">Название курса<input data-course-new-title maxlength="80" placeholder="Например, Основы воздушной навигации" required></label>
        <label class="course-field">Краткое описание<input data-course-new-description maxlength="240" placeholder="Для кого этот курс и чему он научит"></label>
        <div><button class="button-primary" type="submit">Создать черновик</button><button class="button-secondary" type="button" data-course-create-cancel>Отмена</button></div>
      </form>
      <div class="course-cloud-note panel"><b>Материалы курса</b><span>Изображения, PDF, видео и аудио загружаются в закрытый Supabase Storage. Для загрузки настрой bucket <code>${STORAGE_BUCKET}</code> и войди через Supabase Auth. Сами черновики пока хранятся локально.</span></div>
      <div class="course-draft-grid">${mine.length ? mine.map(renderCourseCard).join('') : '<div class="course-empty panel"><span>▤</span><b>Курсов пока нет</b><small>Создай первый курс и собери урок из блоков.</small></div>'}</div>`;
  }

  function renderCourseCard(item) {
    const updatedAt = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('ru-RU') : 'Черновик';
    const summary = `${item.blocks.length} блоков · ${item.connections.length} связей`;
    return `<article class="course-draft-card panel">
      <div class="course-draft-icon">▤</div><span class="course-draft-badge">ЧЕРНОВИК</span>
      <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || 'Описание пока не добавлено.')}</p>
      <small>${summary} · изменён ${escapeHtml(updatedAt)}</small>
      <div class="course-card-actions"><button class="button-primary" data-course-edit="${escapeHtml(item.id)}">Редактировать</button><button class="button-secondary" data-course-preview="${escapeHtml(item.id)}">Предпросмотр</button><button class="button-secondary" data-course-duplicate="${escapeHtml(item.id)}" aria-label="Дублировать курс">⧉</button><button class="danger-button" data-course-delete="${escapeHtml(item.id)}" aria-label="Удалить черновик">Удалить</button></div>
    </article>`;
  }

  function renderEditor() {
    const current = course();
    if (!current) {
      selectedCourseId = null;
      renderLibrary();
      return;
    }
    const selected = block();
    const errors = validateCourse(current);
    root.innerHTML = `<div class="course-editor-heading">
        <button class="button-secondary" data-course-back>← Курсы</button>
        <div><span class="eyebrow">ВИЗУАЛЬНЫЙ РЕДАКТОР</span><h2>${escapeHtml(current.title || 'Новый курс')}</h2></div>
        <div class="course-editor-actions"><span class="course-save-status">Черновик сохранён автоматически</span><button class="button-secondary" data-course-preview="${escapeHtml(current.id)}">Предпросмотр</button><button class="button-primary" data-course-save>Сохранить</button></div>
      </div>
      <div class="course-meta panel"><label>Название курса<input data-course-meta="title" maxlength="80" value="${escapeHtml(current.title)}"></label><label>Описание<input data-course-meta="description" maxlength="240" value="${escapeHtml(current.description)}"></label></div>
      <div class="course-editor-layout">
        <aside class="course-palette panel"><h3>Элементы</h3><p>Перетащи на поле</p><div class="course-palette-list">${COURSE_PALETTE.map((type) => `<button draggable="true" class="course-palette-item" data-palette-block="${type}"><span>${COURSE_BLOCKS[type].icon}</span>${COURSE_BLOCKS[type].label}<b>＋</b></button>`).join('')}</div></aside>
        <section class="course-workspace">
          <div class="course-canvas-heading"><div><b>Рабочее поле</b><small>Перетаскивай блоки для порядка. Выбери выход, затем блок-цель, чтобы соединить.</small></div><span>${current.blocks.length} блоков</span></div>
          <div class="course-validation ${errors.length ? 'has-errors' : 'is-valid'}">${errors.length ? errors.map(escapeHtml).join('<br>') : 'Структура связана — можно открыть предпросмотр.'}</div>
          <div class="course-canvas" data-course-canvas>${current.blocks.length ? current.blocks.map((item, index) => renderNode(item, index, current)).join('') : '<p class="course-canvas-empty">Добавь блок из панели элементов слева.</p>'}</div>
        </section>
        <aside class="course-inspector panel"><h3>Настройки блока</h3>${selected ? renderInspector(selected, current) : '<p class="course-inspector-empty">Выбери блок на рабочем поле, чтобы изменить его настройки.</p>'}</aside>
      </div>
      <div class="course-connect-status ${connecting ? 'is-connecting' : ''}" aria-live="polite">${connecting ? `Выход «${escapeHtml(portLabel(connecting.port))}» выбран — нажми на целевой блок.` : 'Подсказка: блок «Условие» имеет два выхода — «Да» и «Нет».'}</div>`;
    if (selected?.config.asset) previewAsset(root.querySelector('[data-course-asset-preview]'), selected.config.asset);
  }

  function renderNode(item, index, current) {
    const selected = item.id === selectedBlockId;
    const definition = COURSE_BLOCKS[item.type];
    const edges = current.connections.filter((edge) => edge.from === item.id);
    const targetLabels = edges.map((edge) => {
      const target = current.blocks.find((candidate) => candidate.id === edge.to);
      return `<span class="course-edge-label">${escapeHtml(portLabel(edge.port))} → ${escapeHtml(target?.config.title || definitionLabel(target?.type))}<button type="button" data-course-disconnect="${escapeHtml(item.id)}" data-course-port="${escapeHtml(edge.port)}" aria-label="Удалить связь">×</button></span>`;
    }).join('');
    return `${index ? '<div class="course-flow-arrow" aria-hidden="true">↓</div>' : ''}
      <article class="course-node ${selected ? 'is-selected' : ''} ${connecting ? 'is-target' : ''} ${item.type === 'condition' || item.type === 'branch' ? 'is-branch' : ''}" draggable="true" data-course-node="${escapeHtml(item.id)}" data-course-index="${index}">
        <button class="course-node-select" type="button" data-course-select="${escapeHtml(item.id)}">
          <span class="course-node-icon">${definition.icon}</span><span class="course-node-main"><b>${escapeHtml(item.config.title || definition.label)}</b><small>${escapeHtml(definition.label)}</small></span><span class="course-node-grip" title="Перетащить">⠿</span>
        </button>
        ${definition.outputs.length ? `<div class="course-node-ports">${definition.outputs.map((port) => `<button type="button" class="course-port ${connecting?.from === item.id && connecting.port === port ? 'is-selected' : ''}" data-course-connect-from="${escapeHtml(item.id)}" data-course-port="${port}">${escapeHtml(portLabel(port))} <span>＋</span></button>`).join('')}</div>` : ''}
        ${targetLabels ? `<div class="course-node-edges">${targetLabels}</div>` : ''}
        ${connecting ? `<button type="button" class="course-connect-target" data-course-connect-to="${escapeHtml(item.id)}">Соединить сюда</button>` : ''}
      </article>`;
  }

  function definitionLabel(type) {
    return COURSE_BLOCKS[type]?.label || 'блок';
  }

  function portLabel(port) {
    return port === 'pass' ? 'Да' : port === 'fail' ? 'Нет' : 'Далее';
  }

  function renderInspector(item, current) {
    const config = item.config;
    let settings = '';
    if (item.type === 'theory') settings = `${textInput('Заголовок', 'title', config.title)}${textArea('Текст теории', 'content', config.content, 'Добавь объяснение, тезисы и ссылки на материалы…')}${mediaControl(config, item, current)}`;
    else if (item.type === 'test') settings = `${renderQuestions(config.questions, 'test')}${mediaControl(config, item, current)}`;
    else if (item.type === 'question') settings = `${renderQuestion(config.question, 'single')}${mediaControl(config, item, current)}`;
    else if (item.type === 'practice') settings = `${textInput('Заголовок', 'title', config.title)}<label class="course-field">Миссия AeroPilot<select data-field="missionId"><option value="">Выбери существующую миссию</option>${missions.map((mission) => `<option value="${escapeHtml(mission.id)}" ${mission.id === config.missionId ? 'selected' : ''}>${escapeHtml(mission.title)}</option>`).join('')}</select></label>${textArea('Условия завершения', 'completionCondition', config.completionCondition, 'Например, миссия должна быть успешно выполнена')}${textArea('Критерии оценки', 'criteria', config.criteria, 'Что должен проверить ученик после миссии?')}`;
    else if (item.type === 'condition' || item.type === 'branch') settings = `${textInput('Заголовок', 'title', config.title)}<label class="course-field">Условие проверки<select data-field="conditionMode"><option value="score" ${config.conditionMode !== 'mission' ? 'selected' : ''}>Процент правильных ответов</option><option value="mission" ${config.conditionMode === 'mission' ? 'selected' : ''}>Результат миссии</option></select></label>${config.conditionMode === 'mission' ? `<label class="course-field">Миссия<select data-field="missionId"><option value="">Выбери миссию</option>${missions.map((mission) => `<option value="${escapeHtml(mission.id)}" ${mission.id === config.missionId ? 'selected' : ''}>${escapeHtml(mission.title)}</option>`).join('')}</select></label>` : `<label class="course-field">Порог правильных ответов <span class="course-range-value">${Number(config.thresholdPercent ?? 80)}%</span><input type="range" min="0" max="100" step="5" data-field="thresholdPercent" value="${Number(config.thresholdPercent ?? 80)}"></label>`}`;
    else if (item.type === 'image' || item.type === 'video') settings = `${textInput('Заголовок', 'title', config.title)}${textInput(item.type === 'video' ? 'Ссылка на видео (необязательно)' : 'Подпись', item.type === 'video' ? 'videoUrl' : 'content', item.type === 'video' ? config.videoUrl : config.content, 'Название материала')}${mediaControl(config, item, current, item.type)}`;
    else if (item.type === 'simulation') settings = `${textInput('Заголовок', 'title', config.title)}${textArea('Инструкция', 'content', config.content, 'Поясни, что нужно проверить в 3D-симуляторе.')}`;
    else if (item.type === 'start' || item.type === 'finish') settings = `${textInput('Заголовок', 'title', config.title)}${textArea('Описание', 'content', config.content, 'Короткая подсказка для учащегося.')}`;
    else settings = `${textInput('Заголовок', 'title', config.title)}${textArea('Содержание', 'content', config.content)}`;
    return `<div class="course-inspector-block"><span class="course-node-icon">${COURSE_BLOCKS[item.type].icon}</span><span><b>${escapeHtml(COURSE_BLOCKS[item.type].label)}</b><small>Настрой параметры блока</small></span></div>
      ${settings}
      <div class="course-inspector-links"><b>Переходы</b>${COURSE_BLOCKS[item.type].outputs.map((port) => {
        const edge = current.connections.find((candidate) => candidate.from === item.id && candidate.port === port);
        const target = current.blocks.find((candidate) => candidate.id === edge?.to);
        return `<div><span>${escapeHtml(portLabel(port))}</span><select data-course-edge-from="${escapeHtml(item.id)}" data-course-edge-port="${port}"><option value="">Не подключено</option>${current.blocks.filter((candidate) => candidate.id !== item.id).map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === target?.id ? 'selected' : ''}>${escapeHtml(candidate.config.title || definitionLabel(candidate.type))}</option>`).join('')}</select></div>`;
      }).join('')}</div>
      ${item.type !== 'start' && item.type !== 'finish' ? `<button type="button" class="danger-button course-delete-block" data-course-remove-block="${escapeHtml(item.id)}">Удалить блок</button>` : ''}`;
  }

  function renderQuestion(question, prefix) {
    const options = question.options || [];
    return `<div class="course-question-editor">
      ${textArea('Текст вопроса', `${prefix}.prompt`, question.prompt, 'Введи вопрос')}
      <div class="course-answer-options"><span>Варианты ответа</span>${options.map((option, index) => `<div><input data-question-option="${index}" data-question-prefix="${prefix}" value="${escapeHtml(option)}" aria-label="Вариант ${index + 1}"><label><input type="radio" name="correct-${prefix}" data-question-answer="${prefix}" value="${index}" ${Number(question.answer) === index ? 'checked' : ''}> верный</label><button type="button" data-question-remove-option="${index}" data-question-prefix="${prefix}" aria-label="Удалить вариант">×</button></div>`).join('')}
      <button type="button" class="button-secondary" data-question-add-option="${prefix}">＋ Вариант ответа</button></div>
      ${textArea('Объяснение ответа', `${prefix}.explanation`, question.explanation, 'Поясни правильный ответ')}
      <label class="course-field">Баллы<input type="number" min="1" max="100" data-question-points="${prefix}" value="${points(question.points)}"></label>
    </div>`;
  }

  function renderQuestions(questions, prefix) {
    return `<div class="course-questions-editor"><div class="course-field-heading"><b>Вопросы теста</b><small>Баллы задают вес вопроса в результате.</small></div>${questions.map((question, index) => `<details class="course-question-card" open><summary>Вопрос ${index + 1}</summary>${renderQuestion(question, `${prefix}.${index}`)}<button type="button" class="danger-button" data-question-remove="${index}">Удалить вопрос</button></details>`).join('')}<button type="button" class="button-secondary" data-question-add>＋ Добавить вопрос</button></div>`;
  }

  function mediaControl(config, item, current, type = '') {
    const asset = config.asset;
    const inputAccept = type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'image/*,application/pdf,video/*,audio/*';
    return `<div class="course-media-settings"><div class="course-field-heading"><b>${type === 'image' ? 'Изображение' : type === 'video' ? 'Видео' : 'Материалы'}</b><small>Файлы хранятся в закрытом Supabase Storage.</small></div>
      <label class="course-upload-control"><span>Выбрать файл для загрузки</span><input type="file" data-course-upload="${escapeHtml(item.id)}" accept="${inputAccept}"></label>
      ${asset ? `<div class="course-asset-card"><span class="course-asset-preview" data-course-asset-preview="${escapeHtml(item.id)}"></span><span><b>${escapeHtml(asset.name)}</b><small>${formatSize(asset.size)} · ${escapeHtml(asset.mime)}</small><small>${escapeHtml(asset.path ? 'В облачном хранилище' : 'Только текущая сессия')}</small></span><button type="button" data-course-remove-asset="${escapeHtml(item.id)}" aria-label="Удалить материал">×</button></div>` : '<p class="course-inspector-empty">Материалы не добавлены.</p>'}
    </div>`;
  }

  async function resolveAsset(asset) {
    if (!asset?.path) return asset?.previewUrl || '';
    const { client } = await supabaseClient();
    const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUrl(asset.path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  async function previewAsset(container, asset) {
    if (!container || !asset) return;
    try {
      const url = await resolveAsset(asset);
      if (!url) return;
      if (asset.mime.startsWith('image/')) container.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(asset.name)}">`;
      else if (asset.mime.startsWith('video/')) container.innerHTML = `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
      else if (asset.mime.startsWith('audio/')) container.innerHTML = `<audio src="${escapeHtml(url)}" controls></audio>`;
      else container.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Открыть PDF ↗</a>`;
    } catch (error) {
      container.textContent = error.message || 'Не удалось открыть материал.';
    }
  }

  function formatSize(size) {
    return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(size / 1024))} КБ`;
  }

  function createNewCourse(title, description = '') {
    const newCourse = createCourse(title.trim());
    newCourse.description = description.trim();
    newCourse.owner = ownerKey();
    courses.push(newCourse);
    selectedCourseId = newCourse.id;
    selectedBlockId = newCourse.blocks[0].id;
    persist();
    toast('Черновик курса создан');
    render();
  }

  function updateConfigValue(field, value) {
    const selected = block();
    if (!selected) return;
    if (field.startsWith('test.')) {
      const [, index, key] = field.split('.');
      selected.config.questions[Number(index)][key] = key === 'points' ? points(value) : value;
    } else if (field.startsWith('single.')) {
      const key = field.split('.')[1];
      selected.config.question[key] = key === 'points' ? points(value) : value;
    } else if (field === 'thresholdPercent') selected.config.thresholdPercent = Number(value);
    else selected.config[field] = value;
    touchCourse();
  }

  function touchCourse() {
    const current = course();
    if (current) current.updatedAt = new Date().toISOString();
    persist();
  }

  function updateEdge(from, port, to) {
    const current = course();
    if (!current) return;
    if (!to) disconnectBlocks(current, from, port);
    else connectBlocks(current, from, port, to);
    touchCourse();
    renderEditor();
  }

  function appendBlock(type, targetIndex = null) {
    const current = course();
    if (!current) return;
    const finishIndex = current.blocks.findIndex((candidate) => candidate.type === 'finish');
    const item = insertBlock(current, type, targetIndex ?? finishIndex);
    selectedBlockId = item.id;
    touchCourse();
    renderEditor();
  }

  function deleteBlock(blockId) {
    const current = course();
    const item = current?.blocks.find((candidate) => candidate.id === blockId);
    if (!item || item.type === 'start' || item.type === 'finish') return;
    current.blocks = current.blocks.filter((candidate) => candidate.id !== blockId);
    current.connections = current.connections.filter((edge) => edge.from !== blockId && edge.to !== blockId);
    selectedBlockId = null;
    touchCourse();
    renderEditor();
  }

  async function uploadFile(file, targetBlockId = null) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const allowed = ACCEPTED_FILES.get(file.type) || ACCEPTED_FILES.get([...ACCEPTED_FILES.keys()].find((mime) => mime.split('/')[0] === file.type.split('/')[0] && mime !== 'application/pdf'));
    if (!allowed || (extension && !new Set(ACCEPTED_FILES.values()).has(extension))) throw new Error('Формат файла не поддерживается. Используй изображение, PDF, видео или аудио.');
    if (file.size > MAX_FILE_SIZE) throw new Error('Максимальный размер файла — 50 МБ.');
    if (!file.size) throw new Error('Файл пустой.');
    const current = course();
    if (!current) throw new Error('Сначала создай курс.');
    const target = targetBlockId ? current.blocks.find((item) => item.id === targetBlockId) : block();
    if (!target) throw new Error('Сначала выбери блок, к которому нужно прикрепить материал.');
    try {
      const { client, user } = await supabaseClient();
      const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || `material.${allowed}`;
      const path = `${user.id}/${current.id}/${newId()}-${safeName}`;
      const { error } = await client.storage.from(STORAGE_BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        cacheControl: '3600',
        upsert: false,
      });
      if (error) throw error;
      target.config.asset = { name: file.name, size: file.size, mime: file.type || 'application/octet-stream', path };
      touchCourse();
      toast('Материал загружен в Supabase Storage');
    } finally {
      renderEditor();
    }
  }

  async function removeAsset(blockId) {
    const item = course()?.blocks.find((candidate) => candidate.id === blockId);
    const asset = item?.config.asset;
    if (!item || !asset) return;
    if (asset.path) {
      const shared = courses.some((savedCourse) => savedCourse.blocks.some((candidate) =>
        candidate.id !== item.id && candidate.config.asset?.path === asset.path));
      if (!shared) {
        const { client, user } = await supabaseClient();
        if (!asset.path.startsWith(`${user.id}/`)) throw new Error('Нельзя удалить материал другого пользователя.');
        const { error } = await client.storage.from(STORAGE_BUCKET).remove([asset.path]);
        if (error) throw error;
      }
    }
    item.config.asset = null;
    touchCourse();
    renderEditor();
  }

  function duplicateCourse(courseId) {
    const original = courses.find((item) => item.id === courseId);
    if (!original) return;
    const map = new Map(original.blocks.map((item) => [item.id, newId()]));
    const copy = structuredClone(original);
    copy.id = newId();
    copy.title = `${original.title} — копия`;
    copy.owner = ownerKey();
    copy.updatedAt = new Date().toISOString();
    copy.blocks = copy.blocks.map((item) => ({ ...item, id: map.get(item.id) }));
    copy.connections = copy.connections.map((edge) => ({ ...edge, from: map.get(edge.from), to: map.get(edge.to) }));
    courses.push(copy);
    persist();
    toast('Курс продублирован');
    renderLibrary();
  }

  function startPreview(courseId) {
    const target = courses.find((item) => item.id === courseId);
    if (!target) return;
    const errors = validateCourse(target);
    if (errors.length) {
      toast(`Предпросмотр недоступен: ${errors[0]}`);
      return;
    }
    selectedCourseId = courseId;
    runtime = { courseId, nodeId: target.blocks.find((item) => item.type === 'start').id, lastScore: 0, lastCorrect: 0, lastTotal: 0, visited: 0, answers: null };
    render();
  }

  function runCourse() {
    const target = course();
    if (!runtime || !target) return;
    let nodeId = runtime.nodeId;
    let hops = 0;
    while (nodeId && hops < target.blocks.length * 3) {
      hops += 1;
      const item = target.blocks.find((candidate) => candidate.id === nodeId);
      if (!item) break;
      if (item.type === 'start') {
        runtime.visited += 1;
        runtime.nodeId = nextCourseBlock(target, item, runtime.lastScore);
        nodeId = runtime.nodeId;
        continue;
      }
      if (item.type === 'condition' || item.type === 'branch') {
        const passed = item.config.conditionMode === 'mission'
          ? Boolean(item.config.missionId && getProfile()?.completedMissions?.includes(item.config.missionId))
          : runtime.lastScore >= Number(item.config.thresholdPercent ?? 80);
        const port = passed ? 'pass' : 'fail';
        runtime.visited += 1;
        runtime.nodeId = target.connections.find((edge) => edge.from === item.id && edge.port === port)?.to || null;
        nodeId = runtime.nodeId;
        continue;
      }
      break;
    }
    if (nodeId && hops >= target.blocks.length * 3) {
      toast('В этой ветке слишком много повторных переходов. Проверь циклы и условие выхода.');
      renderPlayer();
      return;
    }
    if (!runtime.nodeId) {
      toast('В этой ветке нет следующего блока. Проверь связи на рабочем поле.');
      renderPlayer();
      return;
    }
    renderPlayer();
  }

  function nextFromCurrent() {
    const target = course();
    const item = target?.blocks.find((candidate) => candidate.id === runtime?.nodeId);
    if (!item) return;
    runtime.visited += 1;
    runtime.nodeId = nextCourseBlock(target, item, runtime.lastScore);
    runtime.answers = null;
    if (!runtime.nodeId) {
      toast('Следующий блок не подключён. Черновик сохранён.');
      renderPlayer();
      return;
    }
    runCourse();
  }

  function renderPlayer() {
    const target = course();
    const item = target?.blocks.find((candidate) => candidate.id === runtime?.nodeId);
    if (!item) {
      root.innerHTML = `<div class="course-player"><button class="button-secondary" data-course-exit>← Закрыть</button><h2>Ветвь завершена</h2><p>Путь по курсу закончен. Последний результат: ${runtime?.lastScore || 0}%.</p></div>`;
      return;
    }
    const actions = (button, label) => `<div class="course-player-actions">${button ? `<button class="button-primary" data-course-player-next>${label}</button>` : ''}<button class="button-secondary" data-course-exit>Выйти из предпросмотра</button></div>`;
    const head = `<div class="course-player-header"><span class="pill-blue">ПРЕДПРОСМОТР КУРСА</span><span>${runtime.visited + 1} шаг</span></div><h2>${escapeHtml(target.title)}</h2><div class="course-player-progress"><i style="width:${Math.min(100, runtime.visited / Math.max(1, target.blocks.length) * 100)}%"></i></div>`;
    let body = '';
    let canContinue = true;
    if (item.type === 'finish') body = `<div class="course-player-result"><span>✦</span><h3>${escapeHtml(item.config.title || 'Курс завершён')}</h3><p>${escapeHtml(item.config.content || 'Ты прошёл текущую ветку курса.')}</p><b>Последний результат: ${runtime.lastScore}%</b></div>`;
    else if (item.type === 'theory') body = `<div class="course-player-content"><span class="eyebrow">ТЕОРИЯ</span><h3>${escapeHtml(item.config.title)}</h3><p>${escapeHtml(item.config.content).replace(/\n/g, '<br>')}</p>${item.config.asset ? `<div class="course-player-media" data-player-asset></div>` : ''}</div>`;
    else if (item.type === 'image' || item.type === 'video') body = `<div class="course-player-content"><span class="eyebrow">${escapeHtml(COURSE_BLOCKS[item.type].label.toUpperCase())}</span><h3>${escapeHtml(item.config.title)}</h3><p>${escapeHtml(item.config.content)}</p>${item.config.asset ? `<div class="course-player-media" data-player-asset></div>` : ''}${item.type === 'video' && safeUrl(item.config.videoUrl) ? `<p><a href="${escapeHtml(safeUrl(item.config.videoUrl))}" target="_blank" rel="noopener">Открыть ссылку на видео ↗</a></p>` : ''}</div>`;
    else if (item.type === 'test') {
      const questions = item.config.questions || [];
      canContinue = false;
      body = `<form class="course-player-quiz" data-course-quiz><span class="eyebrow">ТЕСТ · ${questions.length} ВОПРОСОВ</span>${questions.map((question, index) => `<fieldset><legend>${index + 1}. ${escapeHtml(question.prompt || 'Вопрос без текста')}</legend>${(question.options || []).map((option, optionIndex) => `<label><input type="radio" name="course-answer-${index}" value="${optionIndex}" required>${escapeHtml(option)}</label>`).join('')}</fieldset>`).join('')}<button class="button-primary" type="submit">Проверить ответы</button></form><div class="course-player-feedback" data-course-feedback></div>`;
    } else if (item.type === 'question') {
      canContinue = false;
      const question = item.config.question;
      body = `<form class="course-player-quiz" data-course-single><span class="eyebrow">ВОПРОС</span><fieldset><legend>${escapeHtml(question.prompt || 'Вопрос без текста')}</legend>${(question.options || []).map((option, index) => `<label><input type="radio" name="course-single-answer" value="${index}" required>${escapeHtml(option)}</label>`).join('')}</fieldset><button class="button-primary" type="submit">Ответить</button></form><div class="course-player-feedback" data-course-feedback></div>`;
    } else if (item.type === 'condition' || item.type === 'branch') {
      const pass = item.config.conditionMode === 'mission'
        ? Boolean(item.config.missionId && getProfile()?.completedMissions?.includes(item.config.missionId))
        : runtime.lastScore >= Number(item.config.thresholdPercent ?? 80);
      const branch = pass ? 'pass' : 'fail';
      body = `<div class="course-player-content"><span class="eyebrow">УСЛОВИЕ</span><h3>${escapeHtml(item.config.title)}</h3><p>Результат: ${runtime.lastScore}%. ${item.config.conditionMode === 'mission' ? (pass ? 'Миссия выполнена.' : 'Миссия ещё не отмечена как выполненная.') : `Порог: ${Number(item.config.thresholdPercent ?? 80)}%.`}</p><b class="${pass ? 'course-condition-pass' : 'course-condition-fail'}">Ветка: ${pass ? 'Да' : 'Нет'}</b><small>Следующий блок подключён: ${escapeHtml(COURSE_BLOCKS[item.type].outputs.includes(branch) ? 'да' : 'нет')}</small></div>`;
    } else if (item.type === 'practice') {
      const mission = missions.find((candidate) => candidate.id === item.config.missionId);
      const completed = Boolean(mission && getProfile()?.completedMissions?.includes(mission.id));
      body = `<div class="course-player-content"><span class="eyebrow">ПРАКТИКА</span><h3>${escapeHtml(item.config.title)}</h3><p>${escapeHtml(mission?.description || 'Выбери миссию в настройках блока.')}</p><p><b>Условия:</b> ${escapeHtml(item.config.completionCondition || mission?.condition || 'Выполни миссию.')}</p><p><b>Критерии:</b> ${escapeHtml(item.config.criteria || 'Успешное завершение выбранной миссии.')}</p><div class="course-practice-status ${completed ? 'is-complete' : ''}">${completed ? 'Миссия отмечена как выполненная ✓' : 'После успешного выполнения миссии вернись сюда и проверь результат.'}</div><div class="course-player-actions"><button class="button-secondary" data-course-open-missions>Открыть миссии AeroPilot</button><button class="button-secondary" data-course-check-mission>${completed ? 'Продолжить курс' : 'Проверить выполнение'}</button><button class="button-secondary" data-course-exit>Выйти из предпросмотра</button></div></div>`;
      canContinue = false;
    } else if (item.type === 'simulation') {
      body = `<div class="course-player-content"><span class="eyebrow">ПОЛЁТНАЯ СИМУЛЯЦИЯ</span><h3>${escapeHtml(item.config.title)}</h3><p>${escapeHtml(item.config.content || 'Открой 3D-симулятор и выполни задание инструктора.')}</p><button class="button-secondary" data-course-open-simulator>Открыть 3D-симулятор</button></div>`;
    } else body = `<div class="course-player-content"><span class="eyebrow">${escapeHtml(COURSE_BLOCKS[item.type].label.toUpperCase())}</span><h3>${escapeHtml(item.config.title)}</h3><p>${escapeHtml(item.config.content || item.config.title)}</p></div>`;

    root.innerHTML = `<div class="course-player">${head}<section class="course-player-step">${body}${actions(canContinue, item.type === 'finish' ? 'Завершить' : 'Продолжить →')}</section></div>`;
    if (item.config.asset) previewAsset(root.querySelector('[data-player-asset]'), item.config.asset);
  }

  function submitQuiz(form, questions) {
    const answers = questions.map((_, index) => {
      const value = new FormData(form).get(`course-answer-${index}`);
      return value === null ? -1 : Number(value);
    });
    const result = evaluateQuestions(questions, answers);
    runtime.lastScore = result.score;
    runtime.lastCorrect = result.correct;
    runtime.lastTotal = result.total;
    runtime.answers = answers;
    const feedback = root.querySelector('[data-course-feedback]');
    const explanations = questions.map((question, index) => `<li class="${Number(answers[index]) === Number(question.answer) ? 'is-correct' : 'is-wrong'}">${Number(answers[index]) === Number(question.answer) ? 'Верно' : 'Неверно'}: ${escapeHtml(question.explanation || question.prompt)}</li>`).join('');
    feedback.innerHTML = `<div class="course-score-result"><b>${result.score}%</b><span>${result.correct} из ${result.total} правильных</span></div><ul class="course-answer-explanations">${explanations}</ul><button type="button" class="button-primary" data-course-player-next>Продолжить →</button>`;
    form.querySelectorAll('input,button').forEach((input) => { input.disabled = true; });
  }

  function handleInput(event) {
    const target = event.target;
    const current = course();
    if (!current) return;
    if (target.matches('[data-course-meta]')) {
      current[target.dataset.courseMeta] = target.value;
      current.updatedAt = new Date().toISOString();
      persist();
      root.querySelector('.course-editor-heading h2').textContent = current.title || 'Новый курс';
      return;
    }
    if (target.matches('[data-field]')) {
      updateConfigValue(target.dataset.field, target.value);
      if (target.dataset.field === 'thresholdPercent') {
        const display = target.closest('label').querySelector('.course-range-value');
        if (display) display.textContent = `${target.value}%`;
      }
      return;
    }
    if (target.matches('[data-question-option]')) {
      const selected = block();
      const prefix = target.dataset.questionPrefix;
      const question = getQuestion(selected, prefix);
      if (question) question.options[Number(target.dataset.questionOption)] = target.value;
      touchCourse();
      return;
    }
    if (target.matches('[data-question-answer]')) {
      const question = getQuestion(block(), target.dataset.questionAnswer);
      if (question) question.answer = Number(target.value);
      touchCourse();
      return;
    }
    if (target.matches('[data-question-points]')) {
      const question = getQuestion(block(), target.dataset.questionPoints);
      if (question) question.points = points(target.value);
      touchCourse();
    }
  }

  function getQuestion(selected, prefix) {
    if (!selected) return null;
    if (prefix === 'single') return selected.config.question;
    const [, index] = prefix.split('.');
    return selected.config.questions[Number(index)];
  }

  async function handleClick(event) {
    const target = event.target;
    try {
      if (target.closest('[data-course-create]')) {
        root.querySelector('[data-course-create-form]').classList.remove('hidden');
        root.querySelector('[data-course-new-title]').focus();
      } else if (target.closest('[data-course-create-cancel]')) renderLibrary();
      else if (target.closest('[data-course-back]')) { selectedCourseId = null; selectedBlockId = null; connecting = null; renderLibrary(); }
      else if (target.closest('[data-course-save]')) { touchCourse(); toast('Черновик сохранён'); renderEditor(); }
      else if (target.closest('[data-palette-block]')) appendBlock(target.closest('[data-palette-block]').dataset.paletteBlock);
      else if (target.closest('[data-course-edit]')) {
        selectedCourseId = target.closest('[data-course-edit]').dataset.courseEdit;
        selectedBlockId = course()?.blocks[0]?.id || null;
        renderEditor();
      } else if (target.closest('[data-course-preview]')) startPreview(target.closest('[data-course-preview]').dataset.coursePreview);
      else if (target.closest('[data-course-duplicate]')) duplicateCourse(target.closest('[data-course-duplicate]').dataset.courseDuplicate);
      else if (target.closest('[data-course-delete]')) {
        const id = target.closest('[data-course-delete]').dataset.courseDelete;
        const selected = courses.find((item) => item.id === id);
        if (!selected || !confirm(`Удалить черновик «${selected.title}»?`)) return;
        courses = courses.filter((item) => item.id !== id);
        persist();
        renderLibrary();
      } else if (target.closest('[data-course-select]')) {
        selectedBlockId = target.closest('[data-course-select]').dataset.courseSelect;
        connecting = null;
        renderEditor();
      } else if (target.closest('[data-course-connect-from]')) {
        const button = target.closest('[data-course-connect-from]');
        connecting = { from: button.dataset.courseConnectFrom, port: button.dataset.coursePort };
        renderEditor();
      } else if (target.closest('[data-course-connect-to]')) {
        const to = target.closest('[data-course-connect-to]').dataset.courseConnectTo;
        if (connecting) {
          connectBlocks(course(), connecting.from, connecting.port, to);
          connecting = null;
          touchCourse();
          renderEditor();
        }
      } else if (target.closest('[data-course-disconnect]')) {
        const button = target.closest('[data-course-disconnect]');
        disconnectBlocks(course(), button.dataset.courseDisconnect, button.dataset.coursePort);
        touchCourse();
        renderEditor();
      } else if (target.closest('[data-course-remove-block]')) deleteBlock(target.closest('[data-course-remove-block]').dataset.courseRemoveBlock);
      else if (target.closest('[data-course-remove-asset]')) {
        await removeAsset(target.closest('[data-course-remove-asset]').dataset.courseRemoveAsset);
      }
      else if (target.closest('[data-question-add]')) {
        block().config.questions.push({ prompt: '', options: ['Вариант 1', 'Вариант 2'], answer: 0, explanation: '', points: 1 });
        touchCourse();
        renderEditor();
      } else if (target.closest('[data-question-remove]')) {
        const index = Number(target.closest('[data-question-remove]').dataset.questionRemove);
        if (block().config.questions.length <= 1) throw new Error('В тесте должен остаться хотя бы один вопрос.');
        block().config.questions.splice(index, 1);
        touchCourse();
        renderEditor();
      } else if (target.closest('[data-question-add-option]')) {
        const question = getQuestion(block(), target.closest('[data-question-add-option]').dataset.questionAddOption);
        question.options.push(`Вариант ${question.options.length + 1}`);
        touchCourse();
        renderEditor();
      } else if (target.closest('[data-question-remove-option]')) {
        const button = target.closest('[data-question-remove-option]');
        const question = getQuestion(block(), button.dataset.questionPrefix);
        const index = Number(button.dataset.questionRemoveOption);
        if (question.options.length <= 2) throw new Error('Добавь не менее двух вариантов ответа.');
        question.options.splice(index, 1);
        if (question.answer >= question.options.length) question.answer = 0;
        touchCourse();
        renderEditor();
      } else if (target.closest('[data-course-player-next]')) nextFromCurrent();
      else if (target.closest('[data-course-exit]')) { runtime = null; render(); }
      else if (target.closest('[data-course-open-missions]')) onNavigate('missions');
      else if (target.closest('[data-course-open-simulator]')) onNavigate('simulator');
      else if (target.closest('[data-course-check-mission]')) {
        const item = course()?.blocks.find((candidate) => candidate.id === runtime?.nodeId);
        if (!item?.config.missionId || !getProfile()?.completedMissions?.includes(item.config.missionId)) throw new Error('Сначала успешно выполни выбранную миссию в разделе «Миссии».');
        runtime.lastScore = 100;
        nextFromCurrent();
      }
    } catch (error) {
      toast(error.message || 'Не удалось выполнить действие.');
    }
  }

  root.addEventListener('click', (event) => {
    handleClick(event).catch((error) => toast(error.message));
  });
  root.addEventListener('input', handleInput);
  root.addEventListener('change', async (event) => {
    const target = event.target;
    try {
      if (target.matches('[data-course-edge-from]')) {
        updateEdge(target.dataset.courseEdgeFrom, target.dataset.courseEdgePort, target.value);
      } else if (target.matches('[data-course-upload]')) {
        const file = target.files?.[0];
        if (file) await uploadFile(file, target.dataset.courseUpload || null);
      } else if (target.matches('[data-field="conditionMode"]')) {
        updateConfigValue('conditionMode', target.value);
        renderEditor();
      } else if (target.matches('[data-field="missionId"]')) {
        updateConfigValue('missionId', target.value);
        renderEditor();
      }
    } catch (error) {
      toast(error.message || 'Не удалось загрузить файл.');
    }
  });
  root.addEventListener('submit', (event) => {
    if (event.target.matches('[data-course-create-form]')) {
      event.preventDefault();
      const title = root.querySelector('[data-course-new-title]').value;
      const description = root.querySelector('[data-course-new-description]').value;
      if (title.trim()) createNewCourse(title, description);
    } else if (event.target.matches('[data-course-quiz]')) {
      event.preventDefault();
      const item = course()?.blocks.find((candidate) => candidate.id === runtime?.nodeId);
      try {
        if (item?.type !== 'test') throw new Error('Текущий блок курса не является тестом.');
        submitQuiz(event.target, item.config.questions);
      } catch (error) { toast(error.message); }
    } else if (event.target.matches('[data-course-single]')) {
      event.preventDefault();
      const item = course()?.blocks.find((candidate) => candidate.id === runtime?.nodeId);
      if (item?.type !== 'question') { toast('Текущий блок курса не является вопросом.'); return; }
      const question = item.config.question;
      const result = evaluateQuestions([question], [Number(new FormData(event.target).get('course-single-answer'))]);
      runtime.lastScore = result.score;
      runtime.lastCorrect = result.correct;
      runtime.lastTotal = result.total;
      const feedback = root.querySelector('[data-course-feedback]');
      feedback.innerHTML = `<div class="course-score-result"><b>${result.score}%</b><span>${escapeHtml(question.explanation || (result.score ? 'Верно!' : 'Неверно.'))}</span></div><button type="button" class="button-primary" data-course-player-next>Продолжить →</button>`;
      event.target.querySelectorAll('input,button').forEach((input) => { input.disabled = true; });
    }
  });
  root.addEventListener('dragstart', (event) => {
    const palette = event.target.closest('[data-palette-block]');
    const node = event.target.closest('[data-course-node]');
    if (palette) {
      event.dataTransfer.setData('application/aeropilot-block', palette.dataset.paletteBlock);
      event.dataTransfer.effectAllowed = 'copy';
    } else if (node) {
      event.dataTransfer.setData('application/aeropilot-node', node.dataset.courseNode);
      event.dataTransfer.effectAllowed = 'move';
    }
  });
  root.addEventListener('dragover', (event) => {
    if (event.target.closest('[data-course-node]') || event.target.closest('[data-course-canvas]') || event.target.closest('[data-palette-block]')) event.preventDefault();
  });
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    const canvas = event.target.closest('[data-course-canvas]');
    const node = event.target.closest('[data-course-node]');
    const paletteType = event.dataTransfer.getData('application/aeropilot-block');
    const draggedId = event.dataTransfer.getData('application/aeropilot-node');
    if (paletteType && canvas) appendBlock(paletteType);
    else if (paletteType && node) appendBlock(paletteType, Number(node.dataset.courseIndex));
    else if (draggedId && node) {
      moveBlock(course(), draggedId, Number(node.dataset.courseIndex));
      touchCourse();
      renderEditor();
    }
  });
  root.addEventListener('dragend', () => {
    root.querySelectorAll('.course-node').forEach((element) => element.classList.remove('is-dragging'));
  });
  return { render, open() { selectedCourseId = null; runtime = null; render(); } };
}
