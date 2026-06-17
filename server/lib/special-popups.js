const DEFAULT_SPECIAL_POPUPS = [
  {
    id: 'special-predictions-closed-initial',
    title: 'סגירת ניחושים מיוחדים',
    image_url: '/special-predictions-closed.png',
    start_at: '2026-06-17T00:00:00',
    end_at: '2026-06-25T23:59:59',
    enabled: true,
    sort_order: 10
  },
  {
    id: 'special-predictions-closed-2026-06-26',
    title: 'סגירת ניחושים מיוחדים',
    image_url: '/special-predictions-closed.png',
    start_at: '2026-06-26T00:00:00',
    end_at: '2026-06-26T23:59:59',
    enabled: true,
    sort_order: 20
  }
];

function normalizeId(value, fallback = '') {
  const clean = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || fallback;
}

function normalizeDateTime(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const normalized = raw.replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized) ? normalized : fallback;
}

function normalizeSpecialPopup(item, index = 0) {
  const fallbackId = `special-popup-${index + 1}`;
  return {
    id: normalizeId(item?.id, fallbackId),
    title: String(item?.title || '').trim(),
    image_url: String(item?.image_url || '').trim(),
    start_at: normalizeDateTime(item?.start_at),
    end_at: normalizeDateTime(item?.end_at),
    enabled: item?.enabled === false ? false : String(item?.enabled || '').trim() !== '0',
    sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index * 10
  };
}

function sortSpecialPopups(items) {
  return [...items].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if (a.start_at !== b.start_at) return String(a.start_at || '').localeCompare(String(b.start_at || ''));
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function parseSpecialPopups(raw, { useDefaultsWhenMissing = false } = {}) {
  if (raw == null || String(raw).trim() === '') {
    return useDefaultsWhenMissing ? DEFAULT_SPECIAL_POPUPS.map((item, index) => normalizeSpecialPopup(item, index)) : [];
  }

  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) {
      return useDefaultsWhenMissing ? DEFAULT_SPECIAL_POPUPS.map((item, index) => normalizeSpecialPopup(item, index)) : [];
    }
    const normalized = parsed
      .map((item, index) => normalizeSpecialPopup(item, index))
      .filter((item) => item.id && item.start_at && item.end_at);
    return sortSpecialPopups(normalized);
  } catch {
    return useDefaultsWhenMissing ? DEFAULT_SPECIAL_POPUPS.map((item, index) => normalizeSpecialPopup(item, index)) : [];
  }
}

module.exports = {
  DEFAULT_SPECIAL_POPUPS,
  normalizeId,
  normalizeDateTime,
  normalizeSpecialPopup,
  parseSpecialPopups,
  sortSpecialPopups
};
