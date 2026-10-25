const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

function supportedNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return !!match && Number(match[1]) === 22 &&
    (Number(match[2]) > 23 || (Number(match[2]) === 23 && Number(match[3]) >= 4));
}

function verifyRuntime() {
  assert.ok(supportedNode(process.versions.node),
    'Use Node 22.23.4 or a later stable Node 22 patch for native builds');
  return {
    node: process.versions.node,
    openssl: process.versions.openssl,
    executable: process.execPath,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
  };
}

module.exports = { supportedNode, verifyRuntime };
if (require.main === module) console.log(JSON.stringify(verifyRuntime()));
