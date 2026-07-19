import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCalculateInput, isValidCoordinate } from '../validation';

void test('BUG-92: lat=0 and lon=0 are accepted (not rejected as falsy)', () => {
  const result = validateCalculateInput({
    start: { lat: 0, lon: 0 },
    end: { lat: 1, lon: 1 },
    departureTime: '2024-01-01T00:00:00Z',
  });
  assert.deepStrictEqual(result, { valid: true });
});

void test('BUG-92: isValidCoordinate accepts 0, rejects undefined/null/NaN/string', () => {
  assert.strictEqual(isValidCoordinate(0), true);
  assert.strictEqual(isValidCoordinate(-0), true);
  assert.strictEqual(isValidCoordinate(59.5), true);
  assert.strictEqual(isValidCoordinate(undefined), false);
  assert.strictEqual(isValidCoordinate(null), false);
  assert.strictEqual(isValidCoordinate(NaN), false);
  assert.strictEqual(isValidCoordinate('0'), false);
});

void test('validateCalculateInput: rejects missing start', () => {
  const result = validateCalculateInput({ end: { lat: 1, lon: 1 }, departureTime: '2024-01-01' });
  assert.strictEqual(result.valid, false);
});

void test('validateCalculateInput: rejects missing departureTime', () => {
  const result = validateCalculateInput({
    start: { lat: 0, lon: 0 },
    end: { lat: 1, lon: 1 },
  });
  assert.strictEqual(result.valid, false);
});

void test('validateCalculateInput: rejects empty departureTime string', () => {
  const result = validateCalculateInput({
    start: { lat: 0, lon: 0 },
    end: { lat: 1, lon: 1 },
    departureTime: '',
  });
  assert.strictEqual(result.valid, false);
});

void test('validateCalculateInput: accepts valid input with negative coordinates', () => {
  const result = validateCalculateInput({
    start: { lat: -33.45, lon: -70.66 },
    end: { lat: 0, lon: 0 },
    departureTime: '2024-06-15T12:00:00Z',
  });
  assert.deepStrictEqual(result, { valid: true });
});
