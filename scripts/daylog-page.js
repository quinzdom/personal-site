const dayLogContainer = document.getElementById('day-log');

const dayLogDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDayLogDate(dateString) {
  return dayLogDateFormatter.format(new Date(`${dateString}T00:00:00Z`));
}

function renderAnkiSummary(anki) {
  if (!anki || !anki.reviewCount) {
    return '';
  }

  const segments = [
    `${anki.reviewCount} reviews`,
    `${anki.distinctCards} cards`,
    `${anki.minutes}m`,
  ];

  return `
    <div class="auto-note">
      <span class="auto-note-label">Anki</span>
      <span class="auto-note-copy">${segments.join(' • ')}</span>
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
          ${notes.map((note) => `<li>${note}</li>`).join('')}
        </ul>
      ` : ''}
    </section>
  `;
}

dayLogContainer.innerHTML = (Array.isArray(dayLogEntries) ? dayLogEntries : [])
  .map(renderEntry)
  .join('');
