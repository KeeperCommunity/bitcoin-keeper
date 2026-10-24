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
  .map(match => match[1].trim());

if (matches.length !== 1 || matches[0] !== expected) {
  throw new Error(`Production CHANNEL_URL must be ${expected}`);
}

const stages = envContents
  .split(/\r?\n/)
  .map(line => line.match(/^\s*(?:export\s+)?ENVIRONMENT\s*=\s*(.*?)\s*$/))
  .filter(Boolean)
  .map(match => match[1].trim());

if (stages.length !== 1 || stages[0] !== 'PRODUCTION') {
  throw new Error('Production ENVIRONMENT must be PRODUCTION');
}

const required = [
  'RELAY',
  'SIGNING_SERVER_TESTNET',
  'SIGNING_SERVER_MAINNET',
  'HEXA_ID_TESTNET',
  'HEXA_ID_MAINNET',
];
const values = Object.fromEntries(required.map((name) => {
  const matches = envContents
    .split(/\r?\n/)
    .map(line => line.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`)))
    .filter(Boolean)
    .map(match => match[1].trim());
  // The native dotenv reader can retain malformed or mixed quotes. Keep the
  // reviewed value identical to the value that will be embedded in the app.
  if (matches.length !== 1 || !matches[0] || /['"]/.test(matches[0])) {
    throw new Error(`Production ${name} must be set exactly once`);
  }
  return [name, matches[0]];
}));

const serviceURLs = {};
for (const name of ['RELAY', 'SIGNING_SERVER_TESTNET', 'SIGNING_SERVER_MAINNET']) {
  let url;
  try {
    url = new URL(values[name]);
  } catch {
    throw new Error(`Production ${name} must be an HTTPS URL`);
  }
  if (!values[name].startsWith('https://') || values[name].includes('\\') ||
      url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.search || url.hash || !values[name].endsWith('/') || values[name].endsWith('//')) {
    throw new Error(`Production ${name} must be an HTTPS URL ending in / without credentials or query`);
  }
  serviceURLs[name] = url;
}

for (const name of ['HEXA_ID_TESTNET', 'HEXA_ID_MAINNET']) {
  if (!/^[0-9a-fA-F]{64}$/.test(values[name])) {
    throw new Error(`Production ${name} must be a 64-character hex ID`);
  }
}

if (serviceURLs.RELAY.hostname.replace(/\.+$/, '') === 'bithyve-dev-relay.el.r.appspot.com' ||
    serviceURLs.SIGNING_SERVER_MAINNET.hostname.replace(/\.+$/, '') === 'dev-sign.bithyve.com' ||
    values.HEXA_ID_MAINNET.toLowerCase() ===
      'b01623f1065ba45d68b516efe2873f59bfc9b9b2d8b194f94f989d87d711830a') {
  throw new Error('Production mainnet services must not use development defaults');
}

console.log('Production channel URL, environment, and service configuration verified');
