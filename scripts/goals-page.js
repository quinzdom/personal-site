const goalsContainer = document.getElementById('goals-list');
const todaySummary = document.getElementById('today-summary');
const dayStartHour = typeof goalsDayStartHour === 'number' ? goalsDayStartHour : 4;
const maxHeatWeeks = 53;
const minLabelWeeks = 2;
const escapeHtml = window.PageUtils.escapeHtml;

const cellDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
});
const weekdayLabels = ['Mon', '', 'Wed', '', 'Fri', '', ''];

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLogicalToday() {
  return formatLocalDate(new Date(Date.now() - dayStartHour * 60 * 60 * 1000));
}

function toUtcDate(dateString) {
  return new Date(`${dateString}T00:00:00Z`);
}

function addDays(dateString, days) {
  const date = toUtcDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate, endDate) {
  return Math.round((toUtcDate(endDate) - toUtcDate(startDate)) / 86400000);
}

function startOfWeek(dateString) {
  const date = toUtcDate(dateString);
  const isoWeekday = (date.getUTCDay() + 6) % 7;
  return addDays(dateString, -isoWeekday);
}

function countCurrentStreak(doneSet, startDate, today) {
  let cursor = doneSet.has(today) ? today : addDays(today, -1);
  let streak = 0;

  while (cursor >= startDate && doneSet.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

// A day only counts against the goal once continuous tracking has started.
// Earlier days are shown, but only the ones we actually have a record for.
function isTracked(goal, date, today) {
  return date >= goal.trackedFrom && date <= today;
}

function countLongestStreak(doneDates) {
  let longest = 0;
  let running = 0;
  let previous = '';

  doneDates.forEach((date) => {
    running = previous && addDays(previous, 1) === date ? running + 1 : 1;
    previous = date;
    longest = Math.max(longest, running);
  });

  return longest;
}

function summarizeGoal(goal, today) {
  const doneDates = Array.isArray(goal.done) ? goal.done.filter((date) => date <= today) : [];
  const doneSet = new Set(doneDates);
  const trackedDays = Math.max(0, daysBetween(goal.trackedFrom, today) + 1);
  const windowStart = trackedDays > 30 ? addDays(today, -29) : goal.trackedFrom;
  const windowDays = Math.max(1, daysBetween(windowStart, today) + 1);
  const windowDone = doneDates.filter((date) => date >= windowStart).length;
  const earlierDone = doneDates.filter((date) => date < goal.trackedFrom).length;

  return {
    doneDates,
    doneSet,
    trackedDays,
    windowDays,
    windowDone,
    earlierDone,
    doneToday: doneSet.has(today),
    currentStreak: countCurrentStreak(doneSet, goal.trackedFrom, today),
    longestStreak: countLongestStreak(doneDates),
    rate: Math.round((windowDone / windowDays) * 100),
  };
}

function buildHeatWeeks(goal, today) {
  const lastWeekStart = startOfWeek(today);
  const earliestWeekStart = addDays(lastWeekStart, -(maxHeatWeeks - 1) * 7);
  const goalWeekStart = startOfWeek(goal.startDate);
  const firstWeekStart = goalWeekStart > earliestWeekStart ? goalWeekStart : earliestWeekStart;
  const weekCount = Math.floor(daysBetween(firstWeekStart, lastWeekStart) / 7) + 1;

  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = addDays(firstWeekStart, weekIndex * 7);
    return {
      weekStart,
      days: Array.from({ length: 7 }, (_, dayIndex) => addDays(weekStart, dayIndex)),
    };
  });
}

function findMonthStarts(weeks) {
  let previousMonth = '';

  return weeks.reduce((starts, week, weekIndex) => {
    const month = week.weekStart.slice(0, 7);
    if (month !== previousMonth) {
      starts.push({ weekIndex, weekStart: week.weekStart });
    }

    previousMonth = month;
    return starts;
  }, []);
}

function renderMonthLabels(weeks) {
  const starts = findMonthStarts(weeks);
  let lastLabeledIndex = -minLabelWeeks;

  return starts
    .filter((start, index) => {
      const nextIndex = index + 1 < starts.length ? starts[index + 1].weekIndex : weeks.length;
      const hasRoom = nextIndex - start.weekIndex >= minLabelWeeks;
      const clearsPrevious = start.weekIndex - lastLabeledIndex >= minLabelWeeks;

      if (!hasRoom || !clearsPrevious) {
        return false;
      }

      lastLabeledIndex = start.weekIndex;
      return true;
    })
    .map((start) => `<span class="heat-month" style="grid-column: ${start.weekIndex + 1};">${escapeHtml(monthFormatter.format(toUtcDate(start.weekStart)))}</span>`)
    .join('');
}

function renderHeatCell(date, goal, summary, today) {
  if (date < goal.startDate || date > today) {
    return '<span class="heat-cell" data-state="inactive"></span>';
  }

  const isDone = summary.doneSet.has(date);
  const isToday = date === today;
  let state = 'missed';

  if (isDone) {
    state = 'done';
  } else if (isToday) {
    state = 'pending';
  } else if (!isTracked(goal, date, today)) {
    state = 'untracked';
  }

  const stateLabels = { done: 'done', missed: 'missed', pending: 'not yet', untracked: 'no record' };
  const label = `${cellDateFormatter.format(toUtcDate(date))} — ${stateLabels[state]}`;

  return `
    <span
      class="heat-cell"
      data-state="${state}"
      ${isToday ? 'data-today="true"' : ''}
      title="${escapeHtml(label)}"
    ></span>
  `;
}

function renderHeatmap(goal, summary, today) {
  const weeks = buildHeatWeeks(goal, today);
  const cells = weeks
    .map((week) => week.days.map((date) => renderHeatCell(date, goal, summary, today)).join(''))
    .join('');

  return `
    <div class="heat">
      <div class="heat-scroll">
        <div class="heat-inner" style="--weeks: ${weeks.length};">
          <div class="heat-months">${renderMonthLabels(weeks)}</div>
          <div class="heat-weekdays">
            ${weekdayLabels.map((label) => `<span class="heat-weekday">${label}</span>`).join('')}
          </div>
          <div class="heat-grid" role="img" aria-label="Daily history for ${escapeHtml(goal.title)}">
            ${cells}
          </div>
        </div>
      </div>
      <div class="heat-legend">
        <span>Missed</span>
        <span class="heat-legend-cell heat-cell" data-state="missed"></span>
        <span class="heat-legend-cell heat-cell" data-state="done"></span>
        <span>Done</span>
        ${goal.trackedFrom > goal.startDate ? `
          <span class="heat-legend-gap"></span>
          <span class="heat-legend-cell heat-cell" data-state="untracked"></span>
          <span>No record</span>
        ` : ''}
      </div>
    </div>
  `;
}

function renderStat(label, value, unit, meta) {
  return `
    <div class="goal-stat">
      <span class="goal-stat-label">${escapeHtml(label)}</span>
      <span class="goal-stat-value">${escapeHtml(String(value))}${unit ? `<span class="goal-stat-unit">${escapeHtml(unit)}</span>` : ''}</span>
      ${meta ? `<span class="goal-stat-meta">${escapeHtml(meta)}</span>` : ''}
    </div>
  `;
}

function getStatus(goal, summary) {
  if (!goal.active) {
    return { state: 'paused', label: 'Paused' };
  }

  return summary.doneToday
    ? { state: 'done', label: 'Done today' }
    : { state: 'pending', label: 'Not yet today' };
}

function renderGoal(goal, today) {
  const summary = summarizeGoal(goal, today);
  const status = getStatus(goal, summary);
  const hasHistory = summary.doneDates.length > 0;

  return `
    <section class="goal">
      <div class="goal-head">
        <div class="goal-heading">
          <h2 class="goal-title">${escapeHtml(goal.title)}</h2>
          ${goal.context ? `<span class="goal-context">${escapeHtml(goal.context)}</span>` : ''}
        </div>
        <span class="goal-status" data-state="${status.state}">${escapeHtml(status.label)}</span>
      </div>
      ${goal.description ? `<p class="goal-description">${escapeHtml(goal.description)}</p>` : ''}
      <div class="goal-stats">
        ${renderStat('Current streak', summary.currentStreak, summary.currentStreak === 1 ? 'day' : 'days')}
        ${renderStat('Longest streak', summary.longestStreak, summary.longestStreak === 1 ? 'day' : 'days')}
        ${renderStat(
          summary.trackedDays > 30 ? 'Last 30 days' : 'Since start',
          `${summary.rate}%`,
          '',
          `${summary.windowDone} of ${summary.windowDays}`
        )}
        ${renderStat(
          'Days done',
          summary.doneDates.length,
          '',
          summary.earlierDone
            ? `${summary.earlierDone} from earlier records`
            : `tracking ${summary.trackedDays}`
        )}
      </div>
      ${hasHistory
        ? renderHeatmap(goal, summary, today)
        : '<p class="goal-empty">Nothing logged yet. The streak starts the first day you mark this done.</p>'}
    </section>
  `;
}

function renderTodaySummary(activeGoals, today) {
  if (!activeGoals.length) {
    todaySummary.innerHTML = '<span class="goal-empty">No active goals.</span>';
    return;
  }

  const doneCount = activeGoals.filter((goal) => summarizeGoal(goal, today).doneToday).length;
  const allDone = doneCount === activeGoals.length;

  todaySummary.innerHTML = `
    <div class="goal-stats">
      ${renderStat('Goals done', `${doneCount} / ${activeGoals.length}`, '', allDone ? 'all clear' : 'still open')}
    </div>
  `;
}

function renderGoals() {
  const allGoals = Array.isArray(goals) ? goals : [];
  const today = getLogicalToday();

  if (!allGoals.length) {
    goalsContainer.innerHTML = '<p class="goal-empty">No goals yet.</p>';
    todaySummary.innerHTML = '';
    return;
  }

  const activeGoals = allGoals.filter((goal) => goal.active);
  const ordered = [...activeGoals, ...allGoals.filter((goal) => !goal.active)];

  renderTodaySummary(activeGoals, today);
  goalsContainer.innerHTML = ordered
    .map((goal) => renderGoal(goal, today))
    .join('<div class="goals-divider"></div>');
}

renderGoals();
