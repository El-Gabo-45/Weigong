// ── Material Count Cache ──
// ES: Caché de conteo de material

let _cachedMaterial = -1;

export function initMaterialCache(): void {
  _cachedMaterial = -1;
}

export function invalidateMaterialCache(): void {
  _cachedMaterial = -1;
}

export function setMaterialCache(val: number): void {
  _cachedMaterial = val;
}

export function getMaterialCache(): number {
  return _cachedMaterial;
}