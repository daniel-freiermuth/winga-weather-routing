// Input validation helpers for route calculation request parameters.

export function isValidCoordinate(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export interface CalculateInput {
  start?: { lat?: unknown; lon?: unknown };
  end?: { lat?: unknown; lon?: unknown };
  departureTime?: unknown;
}

export function validateCalculateInput(input: CalculateInput): { valid: true } | { valid: false; error: string } {
  const { start, end, departureTime } = input;
  if (!isValidCoordinate(start?.lat) || !isValidCoordinate(start?.lon) ||
      !isValidCoordinate(end?.lat) || !isValidCoordinate(end?.lon) || !departureTime) {
    return { valid: false, error: 'Required: start {lat,lon}, end {lat,lon}, departureTime (ISO 8601)' };
  }
  return { valid: true };
}
