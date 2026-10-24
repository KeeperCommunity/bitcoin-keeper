// Read-only reproduction of the fresh golden capture. Requires the pinned R5
// commit object locally; fetch that commit if using a shallow checkout.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const baseline = require('./miniscriptFeeSizing.baseline.json');
const h = require('./miniscriptFeeSizingHarness');
const root = path.resolve(__dirname, '../..');
const source = execFileSync('git', [
  'show', `${baseline.provenance.sourceCommit}:src/services/wallets/operations/index.ts`,
], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const blob = execFileSync('git', ['hash-object', '--stdin'], {
  cwd: root, encoding: 'utf8', input: source,
}).trim();
assert.equal(blob, baseline.provenance.operationsBlob);
assert.equal(require('@bitcoinerlab/miniscript/package.json').version, '1.4.0');
assert.equal(require('bitcoinjs-lib/package.json').version, '6.1.5');
const api = h.operations(source);
const generated = baseline.policies.map((fixture) => {
  const compiled = h.miniscript.generateMiniscript(fixture.policy);
  const witnesses = h.miniscript.generateScriptWitnesses(fixture.policy).scriptWitnesses;
  assert.equal(h.hash({ miniscript: compiled.miniscript, asm: compiled.asm, witnesses }), fixture.digest);
  assert.equal(witnesses.length, fixture.witnessCount);
  assert.deepEqual(witnesses.map((witness) => h.inputLength(api,
    h.wallet(fixture.m, fixture.n, 'P2WSH', compiled.miniscript), witness)), fixture.lengths);
  return { compiled, witnesses };
});
for (const fixture of baseline.apiCases) {
  const policy = baseline.policies[fixture.policy];
  const { compiled, witnesses } = generated[fixture.policy];
  const actual = h.apiOutcomes(api, h.wallet(policy.m, policy.n, fixture.scriptType, compiled.miniscript),
    witnesses[fixture.witness], fixture.inputMode, fixture.feeRate, fixture.insufficient);
  assert.equal(h.hash(actual), fixture.digest);
}
console.log(`Verified immutable ${baseline.provenance.sourceCommit}: ${baseline.policies.length} policies, ${generated.reduce((count, item) => count + item.witnesses.length, 0)} witnesses, ${baseline.apiCases.length} public fee API scenarios. No fixture files changed.`);
