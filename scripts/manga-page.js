const MANGA_SORT_STORAGE_KEY = 'manga-page-sort';
const mangaUrlState = new URL(window.location.href);
let activeSort = mangaUrlState.searchParams.get('sort') || localStorage.getItem(MANGA_SORT_STORAGE_KEY) || 'source';
let activeSearch = mangaUrlState.searchParams.get('q') || '';

function sortManga(collection) {
  const items = [...collection];

  if (activeSort === 'score') {
    return items.sort((left, right) => {
      const scoreDelta = Number(right.score || 0) - Number(left.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return left.source_index - right.source_index;
    });
  }

  return items.sort((left, right) => left.source_index - right.source_index);
}

function formatProgress(item) {
  const bits = [];
  if (item.chapters_read) bits.push(`${item.chapters_read} ch`);
  if (item.volumes_read) bits.push(`${item.volumes_read} vol`);
  return bits.join(' · ');
}

function renderSubtitle(visibleItems) {
  const totalChapters = visibleItems.reduce((sum, item) => sum + Number(item.chapters_read || 0), 0);
  const totalVolumes = visibleItems.reduce((sum, item) => sum + Number(item.volumes_read || 0), 0);
  const parts = [`${visibleItems.length} manga`, `${totalChapters} chapters`];

  if (totalVolumes > 0) {
    parts.push(`${totalVolumes} volumes`);
  }

  parts.push(activeSort === 'score' ? 'sorted by your score' : 'in your source order');
  document.getElementById('count').textContent = parts.join(' · ');
}

function syncUrlState() {
  PageUtils.updateUrlQuery({
    sort: activeSort !== 'source' ? activeSort : '',
    q: activeSearch || '',
  });
}

function render() {
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('empty-state');
  const filtered = mangaItems.filter((item) => {
    if (!activeSearch) return true;
    const query = activeSearch.toLowerCase();
    const haystack = [
      item.title,
      item.english_title,
      item.author,
      item.type,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const sorted = sortManga(filtered);

  renderSubtitle(sorted);

  if (!sorted.length) {
    grid.innerHTML = '';
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  grid.innerHTML = sorted.map((item) => {
    const progress = formatProgress(item);
    const metaBits = [];
    if (item.published_year) metaBits.push(String(item.published_year));
    if (progress) metaBits.push(progress);
    const href = PageUtils.getItemUrl({ ...item, source_url: item.mal_url });
    const img = item.cover
      ? `<img src="${PageUtils.escapeHtml(item.cover)}" alt="${PageUtils.escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="no-cover" style="display:none">${PageUtils.escapeHtml(item.title)}</div>`
      : `<div class="no-cover">${PageUtils.escapeHtml(item.title)}</div>`;
    const card = `
      <div class="item" title="${PageUtils.escapeHtml(item.title)}">
        ${img}
        <div class="overlay">
          <span class="title">${PageUtils.escapeHtml(item.title)}</span>
          ${item.author ? `<span class="author">${PageUtils.escapeHtml(item.author)}</span>` : ''}
          ${metaBits.length ? `<span class="date">${PageUtils.escapeHtml(metaBits.join(' · '))}</span>` : ''}
        </div>
      </div>
    `;

    return `
      <div class="entry">
        ${href ? `<a class="item-link" href="${PageUtils.escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${card}</a>` : card}
      </div>
    `;
  }).join('');
}

document.querySelectorAll('.sort-toggle button').forEach((button) => {
  button.classList.toggle('active', button.dataset.sort === activeSort);
  button.addEventListener('click', () => {
    activeSort = button.dataset.sort;
    localStorage.setItem(MANGA_SORT_STORAGE_KEY, activeSort);
    document.querySelectorAll('.sort-toggle button').forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    render();
    syncUrlState();
  });
});

const searchInput = document.getElementById('search-input');
searchInput.value = activeSearch;
searchInput.classList.toggle('has-value', activeSearch.length > 0);
searchInput.addEventListener('input', (event) => {
  activeSearch = event.target.value.trim();
  event.target.classList.toggle('has-value', activeSearch.length > 0);
  render();
  PageUtils.updateUrlQuery({ q: activeSearch }, { replace: true });
});

window.addEventListener('popstate', () => {
  const nextUrl = new URL(window.location.href);
  activeSort = nextUrl.searchParams.get('sort') || 'source';
  activeSearch = nextUrl.searchParams.get('q') || '';
  document.querySelectorAll('.sort-toggle button').forEach((button) => {
    button.classList.toggle('active', button.dataset.sort === activeSort);
  });
  searchInput.value = activeSearch;
  searchInput.classList.toggle('has-value', activeSearch.length > 0);
  render();
});

render();
