// ── Material Count Cache ──
// ES: Caché de conteo de material
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
