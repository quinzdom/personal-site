const dayLogContainer = document.getElementById('day-log');

const dayLogDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  timeZone: 'UTC',
});
const pageNumberFormatter = new Intl.NumberFormat('ja-JP');

function formatDayLogDate(dateString) {
  return dayLogDateFormatter
    .format(new Date(`${dateString}T00:00:00Z`))
    .replace(/\s+/g, '');
}

function formatMinutes(minutes) {
  const totalMinutes = Number(minutes || 0);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (!hours) {
    return `${remainingMinutes}分`;
  }

  if (!remainingMinutes) {
    return `${hours}時間`;
  }

  return `${hours}時間${remainingMinutes}分`;
}

function renderAnkiSummary(anki) {
  if (!anki || !anki.reviewCount) {
    return '';
  }

  const segments = [
    `${pageNumberFormatter.format(anki.reviewCount)}回`,
    `${pageNumberFormatter.format(anki.distinctCards)}枚`,
    formatMinutes(anki.minutes),
  ];

  return `
    <div class="auto-note">
      <span class="auto-note-label">Anki</span>
      <span class="auto-note-copy">${segments.join(' ・ ')}</span>
    </div>
  `;
}

function renderEstimate(estimate) {
  if (!estimate || !estimate.pages || !estimate.minutes) {
    return '';
  }

  return `
    <div class="note-estimate">
      推定 ${pageNumberFormatter.format(estimate.pages)}ページ ・ ${formatMinutes(estimate.minutes)}
    </div>
  `;
}

function renderEntry(entry) {
  const notes = Array.isArray(entry.notes) ? entry.notes : [];

  return `
    <section class="log-entry">
      <p class="entry-date">${formatDayLogDate(entry.date)}</p>
      ${renderAnkiSummary(entry.anki)}
      ${notes.length ? `
        <ul class="day-notes">
          ${notes.map((note) => `
            <li>
              <div class="note-text">${note.text}</div>
              ${renderEstimate(note.estimate)}
            </li>
          `).join('')}
        </ul>
      ` : ''}
    </section>
  `;
}

dayLogContainer.innerHTML = (Array.isArray(dayLogEntries) ? dayLogEntries : [])
  .map(renderEntry)
  .join('');
