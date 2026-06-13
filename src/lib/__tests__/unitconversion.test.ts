// Tests for unit conversion helpers used by the weather routing webapp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalFormula, fmt, parseUnit, toDisplay, toSI, fromSI, type UnitPrefs } from '../unitconversion';

// Representative SignalK unit preset shapes
const nauticalMetric: UnitPrefs = {
  speed:    { formula: 'value / 0.514444', inverseFormula: 'value * 0.514444', symbol: 'kn',  displayFormat: '1' },
  depth:    { formula: 'value * 1',        inverseFormula: 'value / 1',        symbol: 'm',   displayFormat: '1' },
  distance: { formula: 'value / 1852.001', inverseFormula: 'value * 1852.001', symbol: 'nmi', displayFormat: '2' },
};

const imperialUs: UnitPrefs = {
  speed: { formula: 'value * 2.23694', inverseFormula: 'value / 2.23694', symbol: 'mph', displayFormat: '4' },
  depth: { formula: 'value * 3.28084', inverseFormula: 'value / 3.28084', symbol: 'ft',  displayFormat: '4' },
};

const metric: UnitPrefs = {
  speed:    { formula: 'value * 3.6',     inverseFormula: 'value / 3.6',     symbol: 'km/h', displayFormat: '4' },
  distance: { formula: 'value / 1000',    inverseFormula: 'value * 1000',    symbol: 'km',   displayFormat: '4' },
};

// --- evalFormula ---

test('evalFormula: multiply', () => {
  assert.ok(Math.abs(evalFormula('value * 3.6', 10) - 36) < 0.001);
});

test('evalFormula: divide', () => {
  assert.ok(Math.abs(evalFormula('value / 0.514444', 0.514444) - 1) < 0.001);
});

test('evalFormula: add', () => {
  assert.ok(Math.abs(evalFormula('value + 273.15', 0) - 273.15) < 0.001);
});

test('evalFormula: subtract', () => {
  assert.ok(Math.abs(evalFormula('value - 273.15', 273.15) - 0) < 0.001);
});

test('evalFormula: unknown operator returns value unchanged', () => {
  assert.equal(evalFormula('value ^ 2', 5), 5);
});

// --- fmt: nautical-metric (kn internal → kn display, identity) ---

test('fmt: speed kn→kn with nautical-metric preset', () => {
  const { sym } = fmt(10, 'speed', nauticalMetric);
  assert.equal(sym, 'kn');
});

test('fmt: speed 10 kn rounds correctly with nautical-metric', () => {
  const { num } = fmt(10, 'speed', nauticalMetric);
  assert.ok(Math.abs(parseFloat(num) - 10) < 0.1);
});

test('fmt: depth m→m identity with nautical-metric', () => {
  const r = fmt(5, 'depth', nauticalMetric);
  assert.equal(r.sym, 'm');
  assert.ok(Math.abs(parseFloat(r.num) - 5) < 0.01);
});

// --- fmt: imperial-us (kn → mph, m → ft) ---

test('fmt: speed kn→mph with imperial-us preset', () => {
  const r = fmt(1, 'speed', imperialUs);
  assert.equal(r.sym, 'mph');
  // 1 kn = 0.514444 m/s * 2.23694 = 1.15078 mph
  assert.ok(Math.abs(parseFloat(r.num) - 1.151) < 0.01);
});

test('fmt: depth m→ft with imperial-us preset', () => {
  const r = fmt(1, 'depth', imperialUs);
  assert.equal(r.sym, 'ft');
  // 1 m = 3.28084 ft
  assert.ok(Math.abs(parseFloat(r.num) - 3.281) < 0.01);
});

// --- fmt: metric (kn → km/h, nmi → km) ---

test('fmt: speed kn→km/h with metric preset', () => {
  const r = fmt(1, 'speed', metric);
  assert.equal(r.sym, 'km/h');
  // 1 kn = 0.514444 m/s * 3.6 = 1.852 km/h
  assert.ok(Math.abs(parseFloat(r.num) - 1.852) < 0.01);
});

test('fmt: distance nmi→km with metric preset', () => {
  const r = fmt(1, 'distance', metric);
  assert.equal(r.sym, 'km');
  // 1 nmi = 1852.001 m / 1000 = 1.852 km
  assert.ok(Math.abs(parseFloat(r.num) - 1.852) < 0.01);
});

// --- fmt: null prefs fallback ---

test('fmt: speed falls back to kn when prefs null', () => {
  const r = fmt(10, 'speed', null);
  assert.equal(r.sym, 'kn');
  assert.equal(r.num, '10.0');
});

test('fmt: depth falls back to m when prefs null', () => {
  const r = fmt(3, 'depth', null);
  assert.equal(r.sym, 'm');
  assert.equal(r.num, '3.0');
});

test('fmt: distance falls back to nmi when prefs null', () => {
  const r = fmt(100, 'distance', null);
  assert.equal(r.sym, 'nmi');
});

// --- fmt: windSpeedMs override ---

test('fmt: forceMs=true converts kn to m/s', () => {
  const r = fmt(1, 'speed', nauticalMetric, true);
  assert.equal(r.sym, 'm/s');
  // 1 kn = 0.514444 m/s; toFixed(2) gives 0.51 — tolerance covers rounding
  assert.ok(Math.abs(parseFloat(r.num) - 0.514444) < 0.01);
});

test('fmt: forceMs=true ignores preset', () => {
  const r = fmt(1, 'speed', imperialUs, true);
  assert.equal(r.sym, 'm/s');
});

// --- parseUnit round-trips ---

test('parseUnit: speed nautical-metric round-trip', () => {
  const displayed = parseFloat(fmt(10, 'speed', nauticalMetric).num);
  const back = parseUnit(displayed, 'speed', nauticalMetric);
  assert.ok(Math.abs(back - 10) < 0.1);
});

test('parseUnit: speed imperial-us round-trip', () => {
  const displayed = parseFloat(fmt(10, 'speed', imperialUs).num);
  const back = parseUnit(displayed, 'speed', imperialUs);
  assert.ok(Math.abs(back - 10) < 0.1);
});

test('parseUnit: depth imperial-us round-trip', () => {
  const displayed = parseFloat(fmt(3, 'depth', imperialUs).num);
  const back = parseUnit(displayed, 'depth', imperialUs);
  assert.ok(Math.abs(back - 3) < 0.01);
});

test('parseUnit: forceMs=true parses m/s back to kn', () => {
  const ms = toSI.speed(10);  // 10 kn in m/s
  const back = parseUnit(ms, 'speed', nauticalMetric, true);
  assert.ok(Math.abs(back - 10) < 0.01);
});

test('parseUnit: falls back to identity when prefs null', () => {
  assert.equal(parseUnit(10, 'speed', null), 10);
});

// --- toDisplay ---

test('toDisplay: returns m/s when forceMs', () => {
  const ms = toDisplay(1, 'speed', null, true);
  assert.ok(Math.abs(ms - toSI.speed(1)) < 0.001);
});

test('toDisplay: returns internal value when prefs null', () => {
  assert.equal(toDisplay(5, 'speed', null), 5);
});
