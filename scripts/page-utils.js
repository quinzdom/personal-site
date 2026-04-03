(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function compareRecentRecords(left, right, options = {}) {
    const dateKey = options.dateKey || 'date_completed';
    const updatedKey = options.updatedKey || 'updated_date';
    const indexKey = options.indexKey || 'source_index';
    const leftDate = left[dateKey] || '';
    const rightDate = right[dateKey] || '';
    const leftHasDate = Boolean(leftDate);
    const rightHasDate = Boolean(rightDate);

    if (leftHasDate !== rightHasDate) {
      return Number(rightHasDate) - Number(leftHasDate);
    }

    if (leftDate !== rightDate) {
      return rightDate.localeCompare(leftDate);
    }

    const leftUpdated = left[updatedKey] || '';
    const rightUpdated = right[updatedKey] || '';
    if (leftUpdated !== rightUpdated) {
      return rightUpdated.localeCompare(leftUpdated);
    }

    return Number(left[indexKey] || 0) - Number(right[indexKey] || 0);
  }

  function getItemUrl(item) {
    if (!item) return '';
    if (item.source_url) return item.source_url;
    if (item.mal_url) return item.mal_url;
    if (item.tvmaze_url) return item.tvmaze_url;

    if (item.type === 'movie' && typeof item.id === 'string' && item.id.startsWith('lb-')) {
      return item.id.replace(/^lb-/, '');
    }

    if (item.type === 'book' && typeof item.id === 'string') {
      if (item.id.startsWith('gr-')) {
        return `https://www.goodreads.com/book/show/${item.id.slice(3)}`;
      }

      if (item.id.startsWith('bm-')) {
        return `https://bookmeter.com/books/${item.id.slice(3)}`;
      }
    }

    return '';
  }

  function updateUrlQuery(nextParams, options = {}) {
    const url = new URL(window.location.href);
    Object.entries(nextParams || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    });

    const nextUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
    const method = options.replace ? 'replaceState' : 'pushState';
    window.history[method]({}, '', nextUrl);
  }

  window.PageUtils = {
    escapeHtml,
    compareRecentRecords,
    getItemUrl,
    updateUrlQuery,
  };
})();
