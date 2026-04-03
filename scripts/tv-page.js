const TV_SORT_STORAGE_KEY = 'tv-page-sort';
let activeSort = localStorage.getItem(TV_SORT_STORAGE_KEY) || 'source';
let activeSearch = '';

function sortItems(collection) {
  const items = [...collection];

  if (activeSort === 'recent') {
    return items.sort((left, right) => PageUtils.compareRecentRecords(left, right, {
      dateKey: 'date_completed',
    }));
  }

  return items.sort((left, right) => left.source_index - right.source_index);
}

function renderSubtitle(visibleItems) {
  const totalHours = visibleItems.reduce((sum, item) => sum + Number(item.hours || 0), 0);
  const datedCount = visibleItems.filter((item) => item.date_completed).length;
  const parts = [`${visibleItems.length} shows`, `${Math.round(totalHours)}h total`];

  if (activeSort === 'recent' && datedCount > 0) {
    parts.push(`${datedCount} with finish dates`);
  } else {
    parts.push('runtime from TVMaze');
  }

  document.getElementById('count').textContent = parts.join(' · ');
}

function render() {
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('empty-state');
  const filtered = tvItems.filter((item) => {
    if (!activeSearch) return true;
    const query = activeSearch.toLowerCase();
    const haystack = [
      item.title,
      item.network,
      item.language,
      item.format,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const sorted = sortItems(filtered);

  renderSubtitle(sorted);

  if (sorted.length === 0) {
    grid.innerHTML = '';
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  grid.innerHTML = sorted.map((item) => {
    const subtitleBits = [];
    if (item.episodes) subtitleBits.push(`${item.episodes} eps`);
    if (item.network) subtitleBits.push(item.network);
    else if (item.format) subtitleBits.push(item.format);
    const href = PageUtils.getItemUrl({ ...item, source_url: item.tvmaze_url });

    const img = item.cover
      ? `<img src="${PageUtils.escapeHtml(item.cover)}" alt="${PageUtils.escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="no-cover" style="display:none">${PageUtils.escapeHtml(item.title)}</div>`
      : `<div class="no-cover">${PageUtils.escapeHtml(item.title)}</div>`;

    return `
      <div class="entry">
        <div class="item" title="${PageUtils.escapeHtml(item.title)}">
          ${img}
          <div class="overlay">
            <span class="title">${PageUtils.escapeHtml(item.title)}</span>
            ${subtitleBits.length ? `<span class="author">${PageUtils.escapeHtml(subtitleBits.join(' · '))}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

document.querySelectorAll('.sort-toggle button').forEach((button) => {
  button.classList.toggle('active', button.dataset.sort === activeSort);
  button.addEventListener('click', () => {
    activeSort = button.dataset.sort;
    localStorage.setItem(TV_SORT_STORAGE_KEY, activeSort);
    document.querySelectorAll('.sort-toggle button').forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    render();
  });
});

document.getElementById('search-input').addEventListener('input', (event) => {
  activeSearch = event.target.value.trim();
  event.target.classList.toggle('has-value', activeSearch.length > 0);
  render();
});

render();
