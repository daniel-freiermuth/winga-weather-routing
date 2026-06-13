// Copies the platform-specific gdal-async .node binary from the matching optional
// dependency into gdal-async's binding path, so that --ignore-scripts installs work.

import * as fs from 'node:fs';
import * as path from 'node:path';

function gdalAsyncRoot(): string {
  const main = require.resolve('gdal-async');
  // main points to gdal-async/lib/gdal.js; root is one level up
  return path.resolve(main, '..');
}

export function ensureGdalBinary(): boolean {
  const abi = process.versions.modules;
  const arch = process.arch;
  const platform = process.platform;

  const nodeAbi = `node-v${abi}`;
  const binaryRel = path.join('lib', 'binding', nodeAbi, 'gdal.mod.node');
  const destPath = path.join(gdalAsyncRoot(), binaryRel);

  if (fs.existsSync(destPath)) return true;

  const subPkg = `@kristianwiklund/wr-gdal-${platform}-${arch}`;
  const subBinaryRel = path.join('binding', nodeAbi, 'gdal.mod.node');

  let srcPath: string;
  try {
    const subPkgJson = require.resolve(path.join(subPkg, 'package.json'));
    srcPath = path.join(path.dirname(subPkgJson), subBinaryRel);
  } catch {
    return false;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  return true;
}

ensureGdalBinary();
