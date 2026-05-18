const DEFAULT_DEPARTMENTS = [
  'שיווק',
  'פיתוח',
  'תפעול',
  'מכירות',
  'כספים',
  'משאבי אנוש',
  'מוצר',
  'לוגיסטיקה',
  'שרות',
  'הנהלה'
];

function normalizeDepartment(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function uniqueDepartments(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const name = normalizeDepartment(value);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function parseDepartments(value) {
  if (Array.isArray(value)) return uniqueDepartments(value);
  if (!value) return [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return uniqueDepartments(parsed);
    } catch (_) {
      // fall through
    }
    return uniqueDepartments(text.split(/\r?\n|,/g));
  }
  return [];
}

function departmentForDemoUser(userIndex, departments = DEFAULT_DEPARTMENTS) {
  const list = uniqueDepartments(departments);
  const source = list.length ? list : DEFAULT_DEPARTMENTS;
  return source[(userIndex - 1) % source.length];
}

module.exports = {
  DEFAULT_DEPARTMENTS,
  normalizeDepartment,
  uniqueDepartments,
  parseDepartments,
  departmentForDemoUser
};
