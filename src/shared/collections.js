export function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function uniqueBy(items, getKey) {
  const map = new Map();
  items.forEach(item => {
    map.set(getKey(item), item);
  });
  return Array.from(map.values());
}
