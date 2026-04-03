const FILTER_STORAGE_KEY = 'anime-page-filter';
const SORT_STORAGE_KEY = 'anime-page-sort';
const urlState = new URL(window.location.href);
let activeFilter = urlState.searchParams.get('filter') || localStorage.getItem(FILTER_STORAGE_KEY) || 'all';
let activeSort = urlState.searchParams.get('sort') || localStorage.getItem(SORT_STORAGE_KEY) || 'mal';
let activeSearch = '';

function filterMatches(item) {
  if (activeFilter === 'shows') {
    return item.type === 'TV' || item.type === 'Series';
  }

  if (activeFilter === 'other') {
    return item.type !== 'TV' && item.type !== 'Series';
  }

  return true;
}

function sortItems(collection) {
  const items = [...collection];

  if (activeSort === 'recent') {
    return items.sort((left, right) => PageUtils.compareRecentRecords(left, right));
  }

  return items.sort((left, right) => left.source_index - right.source_index);
}

function renderSubtitle(visibleItems) {
  const datedCount = visibleItems.filter((item) => item.date_completed).length;
  const parts = [`${visibleItems.length} completed shows`];

  if (activeSort === 'recent' && datedCount > 0) {
    parts.push(`${datedCount} with finish dates`);
  } else {
    parts.push('imported from MyAnimeList');
  }

  document.getElementById('count').textContent = parts.join(' · ');
}

function render() {
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('empty-state');
  const filtered = animeItems.filter((item) => {
    if (!filterMatches(item)) return false;

    if (activeSearch) {
      const query = activeSearch.toLowerCase();
      const haystack = [
        item.title,
        item.english_title,
        item.studio,
        item.type,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    }

    return true;
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
    if (item.entry_count > 1) {
      subtitleBits.push(`${item.entry_count} entries`);
    }
    if (item.type) {
      subtitleBits.push(item.type);
    }
    if (subtitleBits.length < 2 && item.studio) {
      subtitleBits.push(item.studio);
    }
    const subtitle = subtitleBits.join(' · ') || item.english_title || item.studio || item.premiered || item.type;
    if (item.entry_count > 1 && item.member_types?.length) {
      subtitleBits.push(item.member_types.join(' / '));
    }

    const img = item.cover
      ? `<img src="${PageUtils.escapeHtml(item.cover)}" alt="${PageUtils.escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="no-cover" style="display:none">${PageUtils.escapeHtml(item.title)}</div>`
      : `<div class="no-cover">${PageUtils.escapeHtml(item.title)}</div>`;
    const href = PageUtils.getItemUrl({ ...item, source_url: item.mal_url });
    const card = `
        <div class="item" title="${PageUtils.escapeHtml(item.title)}">
          ${img}
          <div class="overlay">
            <span class="title">${PageUtils.escapeHtml(item.title)}</span>
            ${subtitle ? `<span class="author">${PageUtils.escapeHtml(subtitle)}</span>` : ''}
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

function syncUrlState() {
  PageUtils.updateUrlQuery({
    filter: activeFilter !== 'all' ? activeFilter : '',
    sort: activeSort !== 'mal' ? activeSort : '',
    q: activeSearch || '',
  });
}

document.querySelectorAll('.filters button').forEach((button) => {
  button.classList.toggle('active', button.dataset.filter === activeFilter);
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    localStorage.setItem(FILTER_STORAGE_KEY, activeFilter);
    document.querySelectorAll('.filters button').forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      render();
      syncUrlState();
    });
});

document.querySelectorAll('.sort-toggle button').forEach((button) => {
  button.classList.toggle('active', button.dataset.sort === activeSort);
  button.addEventListener('click', () => {
    activeSort = button.dataset.sort;
    localStorage.setItem(SORT_STORAGE_KEY, activeSort);
    document.querySelectorAll('.sort-toggle button').forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      render();
      syncUrlState();
    });
});

document.getElementById('search-input').addEventListener('input', (event) => {
  activeSearch = event.target.value.trim();
  event.target.classList.toggle('has-value', activeSearch.length > 0);
  render();
  PageUtils.updateUrlQuery({ q: activeSearch }, { replace: true });
});

window.addEventListener('popstate', () => {
  const nextUrl = new URL(window.location.href);
  activeFilter = nextUrl.searchParams.get('filter') || 'all';
  activeSort = nextUrl.searchParams.get('sort') || 'mal';
  activeSearch = nextUrl.searchParams.get('q') || '';
  document.getElementById('search-input').value = activeSearch;
  document.getElementById('search-input').classList.toggle('has-value', activeSearch.length > 0);
  render();
});

render();
