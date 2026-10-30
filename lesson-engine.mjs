/** Single source of truth for lesson state transitions and one-time rewards. */
export const LESSON_STATUSES = Object.freeze(['locked', 'theory', 'quiz', 'practice', 'completed']);

export function ensureLessonProgress(profile, lessonId) {
  profile.completedLessons ||= [];
  profile.testResults ||= {};
  profile.lessonProgress ||= {};
  profile.lessonProgress[lessonId] ||= {
    status: profile.completedLessons.includes(lessonId) ? 'completed' : 'theory',
    theoryViewed: profile.completedLessons.includes(lessonId),
    quizPassed: profile.completedLessons.includes(lessonId),
    practiceCompleted: profile.completedLessons.includes(lessonId),
    rewardClaimed: profile.completedLessons.includes(lessonId),
    completedPracticeTasks: [], practiceErrors: 0,
  };
  const progress = profile.lessonProgress[lessonId];
  progress.completedPracticeTasks ||= [];
  progress.practiceErrors ||= 0;
  progress.quizAttempt ||= { questionIndex: 0, correct: 0, answered: false, lastCorrect: false, errors: 0 };
  if (profile.completedLessons.includes(lessonId)) {
    progress.status = 'completed';
    progress.theoryViewed = true;
    progress.quizPassed = true;
    progress.practiceCompleted = true;
    progress.rewardClaimed = true;
  }
  return progress;
}

export function lessonStatus(lessons, profile, lessonId) {
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (index < 0) return 'locked';
  if (profile.completedLessons?.includes(lessonId)) return 'completed';
  if (index > 0 && !profile.completedLessons?.includes(lessons[index - 1].id)) return 'locked';
  return ensureLessonProgress(profile, lessonId).status;
}

export function canStartLesson(lessons, profile, lessonId) {
  return lessonStatus(lessons, profile, lessonId) !== 'locked';
}

export function completeTheory(profile, lessonId) {
  const progress = ensureLessonProgress(profile, lessonId);
  progress.theoryViewed = true;
  if (progress.status !== 'completed') progress.status = 'quiz';
  return progress;
}

export function completeQuiz(profile, lessonId, title, score, passMark, { replay = false } = {}) {
  const progress = ensureLessonProgress(profile, lessonId);
  const passed = score >= passMark;
  progress.lastQuizScore = score;
  progress.bestQuizScore = Math.max(progress.bestQuizScore || 0, score);
  progress.quizOutcome = passed ? 'passed' : 'failed';
  profile.testResults[title] = Math.max(profile.testResults[title] || 0, score);
  if (!replay) progress.quizPassed = passed;
  if (progress.status !== 'completed') progress.status = 'quiz';
  return passed;
}

export function enterPractice(profile, lessonId, { replay = false } = {}) {
  const progress = ensureLessonProgress(profile, lessonId);
  if (!progress.theoryViewed || (!replay && !progress.quizPassed)) return false;
  if (progress.status !== 'completed') progress.status = 'practice';
  return true;
}

export function completePractice(profile, lessonId, { isCorrect = false, requiredTasks = [], completedTasks = [], replay = false, mistakes = 0 } = {}) {
  const progress = ensureLessonProgress(profile, lessonId);
  if (!progress.theoryViewed || (!replay && !progress.quizPassed)) return false;
  const practicePassed = requiredTasks.length
    ? requiredTasks.every((task) => completedTasks.includes(task))
    : isCorrect;
  if (!practicePassed) return false;
  progress.practiceCompleted = true;
  progress.completedPracticeTasks = [...completedTasks];
  progress.practiceErrors = mistakes;
  if (progress.status !== 'completed') progress.status = 'practice';
  return true;
}

export function canCompleteLesson(profile, lessonId) {
  const progress = ensureLessonProgress(profile, lessonId);
  return progress.theoryViewed && progress.quizPassed && progress.practiceCompleted;
}

export function completeLesson(profile, lessonId) {
  const progress = ensureLessonProgress(profile, lessonId);
  if (!canCompleteLesson(profile, lessonId)) return { completed: false, awarded: false };
  const alreadyCompleted = profile.completedLessons.includes(lessonId) || progress.rewardClaimed;
  if (!profile.completedLessons.includes(lessonId)) profile.completedLessons.push(lessonId);
  progress.status = 'completed';
  progress.rewardClaimed = true;
  if (!alreadyCompleted) profile.xp += 100;
  return { completed: true, awarded: !alreadyCompleted };
}
