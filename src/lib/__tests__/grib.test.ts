import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGribName } from '../grib';

test('sanitizeGribName: accepts plain GRIB basenames', () => {
  assert.strictEqual(sanitizeGribName('forecast.grib2'), 'forecast.grib2');
  assert.strictEqual(sanitizeGribName('a.grb2'), 'a.grb2');
  assert.strictEqual(sanitizeGribName('mixed.GRIB'), 'mixed.GRIB'); // extension case-insensitive
});

test('sanitizeGribName: rejects non-GRIB extensions', () => {
  assert.strictEqual(sanitizeGribName('readme.txt'), null);
  assert.strictEqual(sanitizeGribName('archive.zip'), null);
  assert.strictEqual(sanitizeGribName('noext'), null);
});

test('sanitizeGribName: strips path components (no directory traversal)', () => {
  assert.strictEqual(sanitizeGribName('/etc/passwd'), null); // wrong extension + path stripped
  assert.strictEqual(sanitizeGribName('../../secret.grib2'), 'secret.grib2');
  assert.strictEqual(sanitizeGribName('sub/dir/x.grib2'), 'x.grib2');
  // Note: backslashes are not path separators on POSIX (the runtime platform); browsers also
  // send only the basename, so this is a non-issue in practice.
});

test('sanitizeGribName: rejects empty / dot / missing', () => {
  assert.strictEqual(sanitizeGribName(''), null);
  assert.strictEqual(sanitizeGribName(undefined), null);
  assert.strictEqual(sanitizeGribName(null), null);
  assert.strictEqual(sanitizeGribName('.'), null);
  assert.strictEqual(sanitizeGribName('..'), null);
});
