function toSafeInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function createZoneHardeningConfig(seed = {}) {
  return {
    maxZones: toSafeInt(seed.maxZones, 5),
    maxZonePoints: toSafeInt(seed.maxZonePoints, 48),
    maxHolePoints: toSafeInt(seed.maxHolePoints, 24),
    maxHolesPerZone: toSafeInt(seed.maxHolesPerZone, 4),
  };
}

export function canCreateZone(zones = [], limits = {}) {
  const maxZones = toSafeInt(limits.maxZones, 5);
  const total = Array.isArray(zones) ? zones.length : 0;
  return {
    ok: total < maxZones,
    total,
    maxZones,
    remaining: Math.max(0, maxZones - total),
  };
}

export function canAddContourPoint(points = [], limits = {}) {
  const maxZonePoints = toSafeInt(limits.maxZonePoints, 48);
  const total = Array.isArray(points) ? points.length : 0;
  return {
    ok: total < maxZonePoints,
    total,
    maxZonePoints,
    remaining: Math.max(0, maxZonePoints - total),
  };
}

export function canStartHole(holes = [], limits = {}) {
  const maxHolesPerZone = toSafeInt(limits.maxHolesPerZone, 4);
  const total = Array.isArray(holes) ? holes.length : 0;
  return {
    ok: total < maxHolesPerZone,
    total,
    maxHolesPerZone,
    remaining: Math.max(0, maxHolesPerZone - total),
  };
}

export function canAddHolePoint(holePoints = [], limits = {}) {
  const maxHolePoints = toSafeInt(limits.maxHolePoints, 24);
  const total = Array.isArray(holePoints) ? holePoints.length : 0;
  return {
    ok: total < maxHolePoints,
    total,
    maxHolePoints,
    remaining: Math.max(0, maxHolePoints - total),
  };
}

export function describeZoneLimits(limits = {}) {
  const cfg = createZoneHardeningConfig(limits);
  return `до ${cfg.maxZones} зон, до ${cfg.maxZonePoints} точек в зоне, до ${cfg.maxHolesPerZone} вырезов, до ${cfg.maxHolePoints} точек на вырез`;
}
