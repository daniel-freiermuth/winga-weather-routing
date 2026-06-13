// Copies the platform-specific gdal-async .node binary from the matching optional
// dependency into gdal-async's binding path, so that --ignore-scripts installs work.

import * as fs from 'node:fs';
import * as path from 'node:path';

function gdalAsyncLibDir(): string {
  // require.resolve('gdal-async') → gdal-async/lib/gdal.js; dirname → gdal-async/lib/
  return path.dirname(require.resolve('gdal-async'));
}

export function ensureGdalBinary(): boolean {
  const abi = process.versions.modules;
  const arch = process.arch;
  const platform = process.platform;

  // gdal-async and the sub-packages both use node-v{abi}-{platform}-{arch} as the dir name
  const bindingRel = path.join('binding', `node-v${abi}-${platform}-${arch}`, 'gdal.mod.node');
  const destPath = path.join(gdalAsyncLibDir(), bindingRel);

  if (fs.existsSync(destPath)) return true;

  const subPkg = `@kristianwiklund/wr-gdal-${platform}-${arch}`;
  let srcPath: string;
  try {
    const subPkgJson = require.resolve(path.join(subPkg, 'package.json'));
    srcPath = path.join(path.dirname(subPkgJson), bindingRel);
  } catch {
    return false;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  return true;
}

ensureGdalBinary();
