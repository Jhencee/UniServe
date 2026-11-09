const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'frontend-dist');
const allowed = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf']);
function copy(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copy(from, to);
    else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) fs.copyFileSync(from, to);
  }
}
for (const directory of ['Landing', 'User', 'Admin', 'Super Admin', 'shared']) {
  copy(path.join(root, directory), path.join(out, directory));
}
const base = process.env.UNISERVE_API_BASE;
if (base) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('UNISERVE_API_BASE must be an HTTPS API URL without credentials, query, or fragment.');
  }
  const config = path.join(out, 'shared', 'api-config.js');
  fs.writeFileSync(config, 'window.UNISERVE_API_BASE=' + JSON.stringify(base.replace(/\/$/, '')) + ';\n' + fs.readFileSync(config, 'utf8'));
} else {
  console.warn('UNISERVE_API_BASE is unset. The frontend will expect /api on its own host.');
}
console.log('Frontend built in frontend-dist');
