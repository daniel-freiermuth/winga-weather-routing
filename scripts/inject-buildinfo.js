// Writes public/buildinfo.json with the current git version before npm run build.
const { execSync } = require('child_process');
const { writeFileSync, readFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');

let version;
try {
  version = execSync('git describe --tags --always --dirty', { cwd: root }).toString().trim();
} catch {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  version = `v${pkg.version}`;
}

writeFileSync(join(root, 'public', 'buildinfo.json'), JSON.stringify({ version }) + '\n');
console.log(`buildinfo: ${version}`);
