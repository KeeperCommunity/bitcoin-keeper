const baseline = require('./miniscriptFeeSizing.baseline.json');
const {
  operations, wallet, inputLength, apiOutcomes, hash, plain, enums, miniscript, recipientAddress,
} = require('./miniscriptFeeSizingHarness');

const api = operations();
const generated = [];

beforeAll(() => {
  expect(require('@bitcoinerlab/miniscript/package.json').version).toBe('1.4.0');
  expect(require('bitcoinjs-lib/package.json').version).toBe('6.1.5');
  for (const fixture of baseline.policies) {
    const compiled = miniscript.generateMiniscript(fixture.policy);
    const witnesses = miniscript.generateScriptWitnesses(fixture.policy).scriptWitnesses;
    generated.push({ compiled, witnesses });
  }
}, 180000);

describe('fresh R5 prepatch equivalence vectors', () => {
  test('the capture covers 78 policies, 927 witnesses and 120 financial API cases', () => {
    expect(baseline.provenance.sourceCommit).toBe('3eb92fc8a622a3e09926d49f47243c163e32d009');
    expect(baseline.policies).toHaveLength(78);
    expect(generated.reduce((count, item) => count + item.witnesses.length, 0)).toBe(927);
    expect(baseline.apiCases).toHaveLength(120);
    expect(new Set(baseline.policies.map((item) => item.family))).toEqual(new Set([
      'base', 'initial-timelock', 'inheritance', 'inheritance-emergency',
    ]));
  });

  baseline.policies.forEach((fixture, index) => {
    test(`${fixture.family} ${fixture.m}-of-${fixture.n}: compiler witnesses and actual input sizing`, () => {
      const { compiled, witnesses } = generated[index];
      expect(witnesses).toHaveLength(fixture.witnessCount);
      expect(hash({ miniscript: compiled.miniscript, asm: compiled.asm, witnesses })).toBe(fixture.digest);
      // Exercise all branches of the real helper that use miniscript sizing.
      for (const scriptType of [enums.ScriptTypes.P2WSH, enums.ScriptTypes.P2WPKH, enums.ScriptTypes.P2TR]) {
        const vault = wallet(fixture.m, fixture.n, scriptType, compiled.miniscript);
        expect(witnesses.map((witness) => inputLength(api, vault, witness))).toEqual(fixture.lengths);
      }
    });
  });

  baseline.apiCases.forEach((fixture, index) => {
    const policy = baseline.policies[fixture.policy];
    test(`API vector ${index}: ${policy.family} ${policy.m}-of-${policy.n}, witness ${fixture.witness}, ${fixture.scriptType}, ${fixture.inputMode}, rate ${fixture.feeRate}${fixture.insufficient ? ', insufficient funds' : ''}`, () => {
      const { compiled, witnesses } = generated[fixture.policy];
      const vault = wallet(policy.m, policy.n, fixture.scriptType, compiled.miniscript);
      const result = apiOutcomes(api, vault, witnesses[fixture.witness], fixture.inputMode, fixture.feeRate, fixture.insufficient);
      // Covers complete outputs, selected inputs, all fee priorities, change,
      // insufficient-funds returns, send-max retry and input mutation.
      expect(hash(result)).toBe(fixture.digest);
      if (!fixture.insufficient) {
        expect(result.sendMax.fee).toBe(fixture.fees.sendMax);
        expect(Object.fromEntries(Object.entries(result.priorities.txPrerequisites).map(([priority, entry]) => [priority, entry.fee]))).toEqual(fixture.fees.priorities);
        expect(result.custom.txPrerequisites.custom.fee).toBe(fixture.fees.custom);
      } else {
        expect(result.priorities).toEqual({ fee: fixture.fees.normal, balance: 1 });
        expect(result.custom).toEqual({ txPrerequisites: { fee: fixture.fees.custom }, txRecipients: {} });
      }
    });
  });
});

describe('independently calculated anchors and mutation contract', () => {
  const signature = { asm: '<sig(K1<0;1>)>' };

  test('one signature and a 35-byte script retain a 28-byte input allowance', () => {
    // ceil((1 + 35 + 74) / 4) = 28. Digits inside multipath key identifiers
    // are not literal witness selectors.
    expect(inputLength(api, wallet(1, 1), signature)).toBe(28);
    const vault = wallet(1, 1);
    vault.specs.confirmedUTXOs = [{ txId: 'anchor', vout: 0, value: 100000 }];
    // 10-byte transaction overhead + 2 segwit bytes + 41 input base + 28
    // input allowance + 9 output base + 22-byte P2WPKH output = 112.
    for (const rate of [1, 3]) {
      expect(api.WalletOperations.calculateSendMaxFee(vault, [{ address: recipientAddress, amount: 0 }], rate, undefined, { selectedScriptWitness: signature })).toEqual({ fee: 112 * rate });
    }
  });

  test('empty witness has no literal selectors and keeps the existing formula', () => {
    expect(inputLength(api, wallet(1, 1, 'P2WSH', '1'), { asm: '' })).toBe(1);
    expect(inputLength(api, wallet(1, 1, 'P2WSH', '1'), { asm: '     ' })).toBe(1);
  });

  test('repeated selectors and spaces count each literal without counting key suffixes', () => {
    expect(inputLength(api, wallet(1, 1), { asm: '  <sig(K1<100;101>)>   0  1 0  ' })).toBe(29);
  });

  test('the inherited 1-of-4 pubkey allowance remains for its first branch', () => {
    const index = baseline.policies.findIndex((item) => item.family === 'base' && item.m === 1 && item.n === 4);
    const { compiled, witnesses } = generated[index];
    // Script: 19 opcode bytes + 34-byte pubkey push + 3 * 21-byte HASH160.
    // First path: ceil((1 + 2 + 116 + 74 + 34) / 4) = 57.
    expect(witnesses[0].asm).toBe('<sig(K1<0;1>)> 1');
    expect(inputLength(api, wallet(1, 4, 'P2WSH', compiled.miniscript), witnesses[0])).toBe(57);
    expect(inputLength(api, wallet(1, 4, 'P2WSH', compiled.miniscript), witnesses[1])).toBe(58);
  });

  test('mapping preserves input objects, order and financial fields, replacing only script', () => {
    const inputs = [{ txId: 'first', vout: 1, value: 12345, script: { length: 999 } }, { txId: 'second', vout: 2, value: 67890 }];
    const before = plain(inputs);
    const result = api.updateInputsForFeeCalculation(wallet(1, 1), inputs, { selectedScriptWitness: signature });
    expect(result).not.toBe(inputs);
    result.forEach((entry, index) => {
      expect(entry).toBe(inputs[index]);
      expect(entry.script).toEqual({ length: 28 });
      const { script: _previousScript, ...original } = before[index];
      const { script: _currentScript, ...current } = entry;
      expect(current).toEqual(original);
    });
  });
});

describe('other script branches retain their existing sizing', () => {
  const expected = {
    P2PKH: [107, 285], 'P2SH-P2WPKH': [50, 127], 'P2SH-P2WSH': [50, 127],
    P2WPKH: [27, 71], P2WSH: [27, 71], P2TR: [24, 71],
  };
  Object.entries(expected).forEach(([scriptType, [single, multisig]]) => {
    test(`${scriptType}: single-key and ordinary 2-of-3`, () => {
      const singleWallet = wallet(2, 3, scriptType);
      singleWallet.entityKind = enums.EntityKind.WALLET;
      singleWallet.isMultiSig = false;
      const ordinaryVault = wallet(2, 3, scriptType);
      ordinaryVault.type = enums.VaultType.DEFAULT;
      expect(inputLength(api, singleWallet)).toBe(single);
      expect(inputLength(api, ordinaryVault)).toBe(multisig);
    });
  });
  for (const scriptType of ['P2PKH', 'P2SH-P2WPKH', 'P2SH-P2WSH']) {
    test(`${scriptType}: miniscript keeps the existing untouched-input branch`, () => {
      const input = { value: 12345, script: { length: 17 } };
      const result = api.updateInputsForFeeCalculation(wallet(1, 1, scriptType), [input], { selectedScriptWitness: { asm: '<sig(K1<0;1>)> 1' } });
      expect(result[0]).toBe(input);
      expect(result[0].script.length).toBe(17);
    });
  }
});

describe('malformed text does not synthesize literal selectors', () => {
  // These deliberately differ from the old stripping behavior. They are not
  // claims of equivalence outside the compiler's normalized witness grammar.
  const cases = [
    ['<scr<script>ipt>', 35], ['<x>0', 35], ['0<x>', 35],
    ['((0))', 9], ['10', 9], ['01', 9], ['00', 9],
    ['<>', 9], ['<unclosed', 9], ['<sig(K1<0;1>)>foo', 65],
  ];
  test.each(cases)('%s is not a standalone 0/1 literal', (token, expectedLength) => {
    expect(inputLength(api, wallet(1, 1), { asm: [token, token, token].join(' ') })).toBe(expectedLength);
  });
});
