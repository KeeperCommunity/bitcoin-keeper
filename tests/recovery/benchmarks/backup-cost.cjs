// Synthetic local CPU/size baseline. Not a mobile benchmark or network measurement.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');
const file = path.join(__dirname, '../../..', 'src/utils/service-utilities/encryption.ts');
const mod = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText,
  {
    module: mod,
    exports: mod.exports,
    require: (name) => (name === 'react-native-rsa-native' ? { RSA: {} } : require(name)),
  }
);
const { encrypt, decrypt, generateEncryptionKey } = mod.exports;
const key = generateEncryptionKey('synthetic-benchmark-only');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const [count, recordKiB] of [
  [10, 50],
  [100, 50],
  [100, 200],
  [1, 20000],
]) {
  const records = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${index}`,
    networkType: 'TESTNET',
    data: 'x'.repeat(recordKiB * 1024),
  }));
  const repetitions = [];
  let plaintextBytes = 0,
    ciphertextBytes = 0;
  for (let iteration = 0; iteration < 4; iteration++) {
    const start = performance.now();
    const payload = records.map((record) => JSON.stringify(record));
    const ciphertext = payload.map((record) => encrypt(key, record));
    const encrypted = performance.now();
    const ids = ciphertext.map((record) => JSON.parse(decrypt(key, record)).id);
    const done = performance.now();
    if (ids.length !== count) throw Error('incomplete synthetic round trip');
    plaintextBytes = payload.reduce((n, v) => n + Buffer.byteLength(v), 0);
    ciphertextBytes = ciphertext.reduce((n, v) => n + Buffer.byteLength(v), 0);
    if (iteration) repetitions.push({ encrypt: encrypted - start, decrypt: done - encrypted });
  }
  results.push({
    records: count,
    recordKiB,
    plaintextMiB: +(plaintextBytes / 2 ** 20).toFixed(2),
    ciphertextMiB: +(ciphertextBytes / 2 ** 20).toFixed(2),
    encryptMs: +median(repetitions.map((r) => r.encrypt)).toFixed(1),
    decryptAndParseMs: +median(repetitions.map((r) => r.decrypt)).toFixed(1),
    uploadPlusReadbackSecondsAt1Mbps: +((2 * ciphertextBytes * 8) / 1e6).toFixed(1),
  });
}
console.log(
  JSON.stringify(
    {
      environment: `${process.platform}/${process.arch} Node ${process.version}`,
      samples: 'one warm-up and three measured repetitions per case',
      networkTiming: 'theoretical payload transfer only; no measured network or protocol latency',
      results,
    },
    null,
    2
  )
);
