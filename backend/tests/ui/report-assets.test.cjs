const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

test('both staff report layouts resolve their shared print images', () => {
  for (const [directory, script] of [['Admin','admin.js'], ['Super Admin','super-admin.js']]) {
    const source = fs.readFileSync(path.join(root, directory, script), 'utf8');
    const letterhead = source.slice(source.indexOf('function reportLetterhead()'), source.indexOf('function reportSignatureBlock('));
    const imagePaths = [...letterhead.matchAll(/<img[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
    assert.equal(imagePaths.length, 3, `${directory} report images`);
    for (const imagePath of imagePaths) assert.ok(fs.existsSync(path.resolve(root, directory, imagePath)), `${directory}: ${imagePath}`);
  }
});
