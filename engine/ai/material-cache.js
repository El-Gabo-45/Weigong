// ── Material Count Cache ──
// ES: Caché de conteo de material
// Module-level cache for countMaterial() — moved here to avoid circular import
// between search.js and moves.js.
// ES: Caché a nivel de módulo para countMaterial() — movido aquí para evitar
// import circular entre search.js y moves.js.

let _cachedMaterial = -1;

export function initMaterialCache() {
  _cachedMaterial = -1;
}

export function invalidateMaterialCache() {
  _cachedMaterial = -1;
}

export function setMaterialCache(val) {
  _cachedMaterial = val;
}

export function getMaterialCache() {
  return _cachedMaterial;
}