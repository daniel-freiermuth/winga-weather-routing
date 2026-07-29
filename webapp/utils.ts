// Pure utility functions shared across the webapp.


/** Converts a Date to a datetime-local input value string. */
export function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


/**
 * Sort frontier points by bearing from origin (for isochrone rendering).
 */
export function sortByBearing(pts: number[][], origin: { lat: number; lon: number }): number[][] {
  return pts
    .slice()
    .sort(
      (a, b) => Math.atan2(a[1]! - origin.lon, a[0]! - origin.lat) - Math.atan2(b[1]! - origin.lon, b[0]! - origin.lat),
    );
}

/**
 * Split sorted ring at angular gaps larger than threshold.
 * Merges the last segment into the first if the wrap-around gap is within threshold.
 */
export function splitByAngularGap(
  pts: number[][],
  origin: { lat: number; lon: number },
  thresholdDeg: number,
): number[][][] {
  if (pts.length < 2) return [pts];
  const bearing = (p: number[]) => (Math.atan2(p[1]! - origin.lon, p[0]! - origin.lat) * 180) / Math.PI;
  const bearings = pts.map(bearing);
  const angularGap = (a: number, b: number) => ((b - a + 540) % 360) - 180;
  const segments: number[][][] = [];
  let current: number[][] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    if (angularGap(bearings[i - 1]!, bearings[i]!) > thresholdDeg) {
      segments.push(current);
      current = [pts[i]!];
    } else {
      current.push(pts[i]!);
    }
  }
  segments.push(current);
  if (segments.length > 1 && angularGap(bearings[bearings.length - 1]!, bearings[0]! + 360) <= thresholdDeg) {
    segments[0] = [...segments[segments.length - 1]!, ...segments[0]!];
    segments.pop();
  }
  return segments;
}
