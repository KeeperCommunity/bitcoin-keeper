import { resolveInitialTimelock } from 'src/services/wallets/operations/miniscript/initialTimelock';
import { MiniscriptTypes } from 'src/services/wallets/enums';
import {
  generateEnhancedVaultElements,
  ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET,
  ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_TESTNET,
  ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_MAINNET,
  ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET,
} from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import { generateMiniscriptPolicy } from 'src/services/wallets/operations/miniscript/policy-generator';

jest.mock('src/utils/utilities', () => ({ getKeyUID: (s) => s.masterFingerprint }));
jest.mock('src/utils/service-utilities/utils', () => ({
  getDerivationPath: (p) => p.replace('m/', ''),
}));
const required = [
  MiniscriptTypes.TIMELOCKED,
  MiniscriptTypes.INHERITANCE,
  MiniscriptTypes.EMERGENCY,
];
const mk = (fp) =>
  ({
    masterFingerprint: fp,
    derivationPath: "m/48'/0'/0'/2'",
    xpub: `xpub${fp}`,
    account: 0,
  } as any);

describe('Timelock generation boundary', () => {
  test.each([undefined, null, '', 0, NaN, -1, 123])(
    'rejects missing or malformed required selection %s',
    (value) => {
      expect(() => resolveInitialTimelock(required, value, () => 100)).toThrow();
    }
  );
  test.each([0, -1, NaN, Infinity, 0.5, undefined])(
    'rejects invalid resolved duration %s',
    (value) => {
      expect(() => resolveInitialTimelock(required, 'invalid', () => value)).toThrow();
    }
  );
  test.each([
    [],
    [MiniscriptTypes.INHERITANCE],
    [MiniscriptTypes.EMERGENCY],
    [MiniscriptTypes.INHERITANCE, MiniscriptTypes.EMERGENCY],
  ])('allows legitimate no-initial-timelock %j', (...args) => {
    const types = args.flat() as MiniscriptTypes[];
    for (const value of [undefined, null, '', 0])
      expect(resolveInitialTimelock(types, value, () => undefined)).toBe(0);
  });
  test.each([
    ['mainnet timestamp', ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET, 1767225600],
    ['testnet timestamp', ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_TESTNET, 1767225600],
    ['mainnet height', ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_MAINNET, 950000],
    ['testnet height', ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET, 100000],
  ])('preserves all policy activation times for %s', (_name, table: any, base: number) => {
    for (const durationLabel of ['MONTHS_3', 'MONTHS_6', 'MONTHS_9', 'MONTHS_12']) {
      const duration = resolveInitialTimelock(required, durationLabel, (label) => table[label]);
      const elements = generateEnhancedVaultElements(
        [mk('AAAAAAAA'), mk('BBBBBBBB'), mk('CCCCCCCC')],
        [{ signer: mk('DDDDDDDD'), timelock: base + duration + table.MONTHS_12 }],
        [{ signer: mk('EEEEEEEE'), timelock: base + duration + table.MONTHS_36 }],
        { m: 2, n: 3 },
        base + duration
      );
      const { policy, miniscriptPhases } = generateMiniscriptPolicy(elements);
      expect(miniscriptPhases.map((p) => p.timelock)).toEqual([
        base + duration,
        base + duration + table.MONTHS_12,
        base + duration + table.MONTHS_36,
      ]);
      for (const phase of miniscriptPhases) expect(policy).toContain(`after(${phase.timelock})`);
    }
  });
});

describe('Already-affected disposable policy assessment', () => {
  test.each([
    ['timestamp', ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET, 1767225600],
    ['block height', ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_MAINNET, 950000],
  ])(
    'distinguishes an omitted initial lock and shifted fallback schedule (%s)',
    (_name, table: any, base: number) => {
      const generate = (initial: number) =>
        generateMiniscriptPolicy(
          generateEnhancedVaultElements(
            [mk('AAAAAAAA'), mk('BBBBBBBB'), mk('CCCCCCCC')],
            [{ signer: mk('DDDDDDDD'), timelock: base + initial + table.MONTHS_12 }],
            [{ signer: mk('EEEEEEEE'), timelock: base + initial + table.MONTHS_36 }],
            { m: 2, n: 3 },
            initial ? base + initial : 0
          )
        );
      const affected = generate(0);
      const intended = generate(table.MONTHS_6);
      // Inspect the policy generated from each fixture, not a TIMELOCKED metadata flag.
      expect(affected.miniscriptPhases.map((p) => p.timelock)).toEqual([
        0,
        base + table.MONTHS_12,
        base + table.MONTHS_36,
      ]);
      expect(intended.miniscriptPhases.map((p) => p.timelock)).toEqual([
        base + table.MONTHS_6,
        base + table.MONTHS_6 + table.MONTHS_12,
        base + table.MONTHS_6 + table.MONTHS_36,
      ]);
      expect(affected.policy).not.toContain(`after(${base + table.MONTHS_6})`);
      expect(intended.policy).toContain(`after(${base + table.MONTHS_6})`);
      expect(affected.policy).not.toBe(intended.policy);
    }
  );
});
