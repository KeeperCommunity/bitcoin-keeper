const fs = require('fs');

const expected = 'https://channel.bitcoinkeeper.app/';
const envFile = process.argv[2];

if (!envFile || !fs.existsSync(envFile)) {
  throw new Error('Production environment file is missing');
}

const envContents = fs.readFileSync(envFile, 'utf8');
if (/^\s*(?:export\s+)?(?:RN_)?(?:GASFREE_API_(?:KEY|SECRET)|LETS_EXCHANGE_API_KEY)\s*=/m.test(envContents)) {
  throw new Error('Retired API credentials must not be included in a release environment');
}

const matches = envContents
  .split(/\r?\n/)
  .map(line => line.match(/^\s*(?:export\s+)?CHANNEL_URL\s*=\s*(.*?)\s*$/))
  .filter(Boolean)
  .map(match => match[1].replace(/^['"]|['"]$/g, ''));

if (matches.length !== 1 || matches[0] !== expected) {
  throw new Error(`Production CHANNEL_URL must be ${expected}`);
}

console.log('Production channel URL verified');
