const dayLogContainer = document.getElementById('day-log');
const composerForm = document.getElementById('daylog-input-form');
const composerInput = document.getElementById('daylog-input');
const composerSubmit = document.getElementById('daylog-submit');
const composerStatus = document.getElementById('daylog-input-status');
const composerModel = document.getElementById('daylog-model');

const dayLogDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  timeZone: 'UTC',
});
const pageNumberFormatter = new Intl.NumberFormat('ja-JP');
let currentEntries = Array.isArray(dayLogEntries) ? dayLogEntries : [];
let composerEnabled = false;

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

function renderDayLog(entries) {
  dayLogContainer.innerHTML = (Array.isArray(entries) ? entries : [])
    .map(renderEntry)
    .join('');
}

function setComposerState(message, state = 'idle') {
  composerStatus.textContent = message || '';
  if (message) {
    composerStatus.dataset.state = state;
    return;
  }

  delete composerStatus.dataset.state;
}

function setComposerAvailability(enabled, statusText = '') {
  composerEnabled = enabled;
  composerInput.disabled = !enabled;
  composerSubmit.disabled = !enabled;
  if (statusText) {
    setComposerState(statusText, enabled ? 'idle' : 'error');
  }
}

async function loadComposerStatus() {
  try {
    const response = await fetch('/api/daylog/status', {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error('AI入力はこのサーバーでは使えません。');
    }

    const payload = await response.json();
    if (payload.model) {
      composerModel.textContent = payload.model.toUpperCase();
    }

    if (!payload.enabled) {
      setComposerAvailability(false, 'OPENAI_API_KEY を設定したローカルサーバーで使えます。');
      return;
    }

    setComposerAvailability(true, 'そのまま書けば反映されます。');
  } catch (error) {
    setComposerAvailability(false, 'AI入力はローカルの Node サーバーでのみ使えます。');
  }
}

async function handleComposerSubmit(event) {
  event.preventDefault();

  if (!composerEnabled) {
    return;
  }

  const inputText = composerInput.value.trim();
  if (!inputText) {
    setComposerState('何か書いてから送ってください。', 'error');
    return;
  }

  composerInput.disabled = true;
  composerSubmit.disabled = true;
  setComposerState('整えています…', 'idle');

  try {
    const response = await fetch('/api/daylog/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        inputText,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || '更新できませんでした。');
    }

    currentEntries = Array.isArray(payload.entries) ? payload.entries : currentEntries;
    renderDayLog(currentEntries);
    composerInput.value = '';
    setComposerState('更新しました。', 'success');
  } catch (error) {
    setComposerState(error instanceof Error ? error.message : '更新できませんでした。', 'error');
  } finally {
    composerInput.disabled = !composerEnabled;
    composerSubmit.disabled = !composerEnabled;
  }
}

renderDayLog(currentEntries);

if (composerForm) {
  composerForm.addEventListener('submit', handleComposerSubmit);
  loadComposerStatus();
}
