function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

const totalHours = stats.allMediaHours ?? stats.totalHours;
const totalDays = stats.allMediaDays ?? stats.totalDays;
const totalMinimumWageValue = stats.allMediaMinimumWageValue ?? stats.minimumWageValue;
const totalAverageWageValue = stats.allMediaAverageWageValue ?? stats.averageWageValue;
const animeHours = stats.animeHours ?? stats.anime?.hours ?? 0;
const animeDays = stats.animeDays ?? stats.anime?.days ?? 0;
const tvHours = stats.tvHours ?? stats.tv?.hours ?? 0;
const tvDays = stats.tvDays ?? stats.tv?.days ?? 0;
const yearlyComparison = (stats.yearlyComparison || []).slice(-5);
const hourRows = [
  { label: 'Reading', hours: stats.readingHours, className: 'book' },
  { label: 'Movies', hours: stats.movieHours ?? stats.watchingHours, className: 'movie' },
  { label: 'TV', hours: tvHours, className: 'tv' },
  { label: 'Anime', hours: animeHours, className: 'anime' },
];

const timeStats = [
  {
    label: 'Reading',
    value: `~${stats.readingHours}h`,
    meta: `~${stats.readingDays} days`,
  },
  {
    label: 'Movies',
    value: `${stats.movieHours ?? stats.watchingHours}h`,
    meta: `${stats.movieDays ?? stats.watchingDays} days`,
  },
  {
    label: 'TV',
    value: `${tvHours}h`,
    meta: `${tvDays} days`,
  },
  {
    label: 'Anime',
    value: `${animeHours}h`,
    meta: `${animeDays} days`,
  },
  {
    label: 'Total',
    value: `~${totalHours}h`,
    meta: `~${totalDays} days`,
  },
];

const valueStats = [
  {
    label: 'Min Wage',
    value: formatCurrency(totalMinimumWageValue),
    meta: `$${stats.minimumWageHourly}/hr`,
  },
  {
    label: 'Avg Wage',
    value: formatCurrency(totalAverageWageValue),
    meta: `$${stats.averageWageHourly}/hr`,
  },
];

function renderStats(targetId, entries) {
  document.getElementById(targetId).innerHTML = entries.map((entry) => `
    <div class="header-stat">
      <span class="header-stat-label">${entry.label}</span>
      <span class="header-stat-value">${entry.value}</span>
      <span class="header-stat-meta">${entry.meta}</span>
    </div>
  `).join('');
}

function renderHoursChart(entries) {
  const maxHours = Math.max(...entries.map((entry) => entry.hours), 1);
  document.getElementById('hours-chart').innerHTML = entries.map((entry) => `
    <div class="hours-bar-row">
      <div class="hours-bar-label">${entry.label}</div>
      <div class="hours-bar-track">
        <div class="hours-bar-fill ${entry.className}" style="width:${(entry.hours / maxHours) * 100}%"></div>
      </div>
      <div class="hours-bar-value">${entry.hours}h</div>
    </div>
  `).join('');
}

function renderYearlyComparison(entries) {
  const chart = document.getElementById('yearly-chart');
  if (!entries.length) {
    chart.innerHTML = '<div class="yearly-empty">No yearly data available yet.</div>';
    return;
  }

  const maxHours = Math.max(
    ...entries.flatMap((entry) => [entry.readingHours || 0, entry.movieHours || 0]),
    1
  );

  chart.innerHTML = entries.map((entry) => `
    <div class="yearly-row">
      <div class="yearly-year">${entry.year}</div>
      <div class="yearly-bars">
        <div class="yearly-bar">
          <div class="yearly-bar-head">
            <span class="yearly-bar-label">Reading</span>
            <span class="yearly-bar-value">${entry.readingHours}h</span>
          </div>
          <div class="hours-bar-track yearly-track">
            <div class="hours-bar-fill book" style="width:${(entry.readingHours / maxHours) * 100}%"></div>
          </div>
        </div>
        <div class="yearly-bar">
          <div class="yearly-bar-head">
            <span class="yearly-bar-label">Movies</span>
            <span class="yearly-bar-value">${entry.movieHours}h</span>
          </div>
          <div class="hours-bar-track yearly-track">
            <div class="hours-bar-fill movie" style="width:${(entry.movieHours / maxHours) * 100}%"></div>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

renderYearlyComparison(yearlyComparison);
renderHoursChart(hourRows);
renderStats('time-stats', timeStats);
renderStats('value-stats', valueStats);
