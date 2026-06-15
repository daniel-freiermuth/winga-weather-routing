// Writes public/buildinfo.json with the current git version before npm run build.
// Preserves an existing file written by dev-deploy.sh when git is not available (Docker build).
const { execSync } = require('child_process');
const { writeFileSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const buildinfoPath = join(root, 'public', 'buildinfo.json');

let version;
try {
  version = execSync('git describe --tags --always --dirty', { cwd: root }).toString().trim();
} catch {
  // If buildinfo.json already exists (e.g. from dev-deploy.sh), keep it.
  try {
    if (existsSync(buildinfoPath)) {
      const existing = JSON.parse(readFileSync(buildinfoPath, 'utf-8'));
      if (existing.version) {
        console.log(`buildinfo: ${existing.version} (existing, not overwritten)`);
        process.exit(0);
      }
    }
  } catch { /* fall through to package.json fallback */ }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  version = `v${pkg.version}`;
}

writeFileSync(buildinfoPath, JSON.stringify({ version }) + '\n');
console.log(`buildinfo: ${version}`);
