import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { SignerType } from 'src/services/wallets/enums';
import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';
import { RecoverablePolicyDraftError } from 'src/services/wallets/recoverable/policyDraft';
import {
  importRecoverableHardwarePublicData,
  RecoverableHardwarePublicImportInput,
} from 'src/services/wallets/recoverable/hardwarePublicImport';

const bip32 = BIP32Factory(ecc);
const path = "m/48'/1'/0'/2'";
const root = bip32.fromSeed(Buffer.alloc(32, 17), bitcoin.networks.testnet);
const tpub = root.derivePath(path).neutered().toBase58();
const fingerprint = root.fingerprint.toString('hex').toUpperCase();

function coldcard(
  overrides: Partial<RecoverableHardwarePublicImportInput> = {}
): RecoverableHardwarePublicImportInput {
  return {
    device: SignerType.COLDCARD,
    transport: 'file' as const,
    sourceId: 'coldcard-public-export-1',
    payload: {
      chain: 'XTN',
      xfp: fingerprint.toLowerCase(),
      bip48_2: { deriv: path, xpub: tpub },
      bip84: { deriv: "m/84'/1'/0'", xpub: 'unused-public-single-key' },
    },
    ...overrides,
  };
}

function jade(
  overrides: Partial<RecoverableHardwarePublicImportInput> = {}
): RecoverableHardwarePublicImportInput {
  return {
    device: SignerType.JADE,
    transport: 'qr' as const,
    sourceId: 'jade-public-qr-1',
    payload: {
      network: 'testnet',
      48: { xPub: tpub, derivationPath: path, mfp: fingerprint.toLowerCase() },
      84: { xPub: 'unused-public-single-key', derivationPath: "m/84'/1'/0'" },
    },
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RecoverablePolicyDraftError);
    expect((error as RecoverablePolicyDraftError).code).toBe(code);
  }
}

describe('testnet public hardware import', () => {
  test('normalizes a Coldcard BIP48 export without carrying unrelated export fields', () => {
    const result = importRecoverableHardwarePublicData(coldcard());
    expect(result).toEqual({
      kind: 'public-hardware-import',
      signer: {
        role: 'hardware',
        signerType: SignerType.COLDCARD,
        masterFingerprint: fingerprint,
        xpub: tpub,
        derivationPath: path,
        origin: {
          kind: 'hardware-device',
          device: SignerType.COLDCARD,
          transport: 'file',
          sourceId: 'coldcard-public-export-1',
        },
      },
      deviceVerification: 'not-verified',
      policyVerification: 'not-verified',
      fundable: false,
    });
    expect(JSON.stringify(result)).not.toContain('bip84');
  });

  test('accepts the mapped Jade QR shape and a direct BIP48 Jade object', () => {
    const mapped = importRecoverableHardwarePublicData(jade());
    expect(mapped.signer).toMatchObject({
      signerType: SignerType.JADE,
      masterFingerprint: fingerprint,
      xpub: tpub,
      derivationPath: path,
      origin: { transport: 'qr', sourceId: 'jade-public-qr-1' },
    });
    expect(mapped.deviceVerification).toBe('not-verified');

    const direct = importRecoverableHardwarePublicData(
      jade({
        transport: 'desktop-usb',
        payload: { xPub: tpub, derivationPath: path, mfp: fingerprint },
      })
    );
    expect(direct.signer.origin.transport).toBe('desktop-usb');
    expect(direct.policyVerification).toBe('not-verified');
  });

  test('accepts a JSON file as input and keeps its status unverified', () => {
    const input = coldcard();
    const result = importRecoverableHardwarePublicData({
      ...input,
      payload: JSON.stringify(input.payload),
    });
    expect(result.signer.xpub).toBe(tpub);
    expect(result.fundable).toBe(false);
  });

  test('accepts an explicit nonzero testnet BIP48 account', () => {
    const accountPath = "m/48'/1'/7'/2'";
    const accountTpub = root.derivePath(accountPath).neutered().toBase58();
    const result = importRecoverableHardwarePublicData(
      coldcard({
        payload: {
          xfp: fingerprint,
          bip48_2: { deriv: accountPath, xpub: accountTpub },
        },
      })
    );
    expect(result.signer.derivationPath).toBe(accountPath);
    expect(result.signer.xpub).toBe(accountTpub);
  });

  test('rejects mainnet paths, extended keys, and declared mainnet exports', () => {
    const mainnetRoot = bip32.fromSeed(Buffer.alloc(32, 18), bitcoin.networks.bitcoin);
    const mainnetXpub = mainnetRoot.derivePath("m/48'/0'/0'/2'").neutered().toBase58();
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          coldcard({
            payload: { xfp: fingerprint, bip48_2: { deriv: "m/48'/0'/0'/2'", xpub: tpub } },
          })
        ),
      'INVALID_DERIVATION'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          jade({ payload: { xPub: mainnetXpub, derivationPath: path, mfp: fingerprint } })
        ),
      'INVALID_XPUB'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          coldcard({
            payload: { chain: 'BTC', xfp: fingerprint, bip48_2: { deriv: path, xpub: tpub } },
          })
        ),
      'TESTNET_ONLY'
    );
  });

  test('rejects wrong BIP48 script branch and non-account extended keys', () => {
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          jade({ payload: { xPub: tpub, derivationPath: "m/48'/1'/0'/1'", mfp: fingerprint } })
        ),
      'INVALID_DERIVATION'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          jade({
            payload: { xPub: root.neutered().toBase58(), derivationPath: path, mfp: fingerprint },
          })
        ),
      'INVALID_XPUB_ORIGIN'
    );
  });

  test('rejects private material even in otherwise valid public exports', () => {
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          coldcard({
            payload: {
              xfp: fingerprint,
              bip48_2: { deriv: path, xpub: tpub, xprv: 'private-value' },
            },
          })
        ),
      'PRIVATE_MATERIAL'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          jade({
            payload: { 48: { xPub: tpub, derivationPath: path, mfp: fingerprint }, seed: 'secret' },
          })
        ),
      'PRIVATE_MATERIAL'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          jade({
            payload: {
              xPub: root.derivePath(path).toBase58(),
              derivationPath: path,
              mfp: fingerprint,
            },
          })
        ),
      'PRIVATE_MATERIAL'
    );
  });

  test('rejects unsupported hardware/transport, ambiguous Jade data and missing source', () => {
    expectCode(
      () => importRecoverableHardwarePublicData(jade({ transport: 'nfc' })),
      'UNSUPPORTED_HARDWARE'
    );
    expectCode(
      () => importRecoverableHardwarePublicData(jade({ device: SignerType.TAPSIGNER as any })),
      'UNSUPPORTED_HARDWARE'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          jade({
            payload: {
              48: { xPub: tpub, derivationPath: path, mfp: fingerprint },
              xPub: tpub,
            },
          })
        ),
      'INVALID_HARDWARE_EXPORT'
    );
    expectCode(
      () => importRecoverableHardwarePublicData(coldcard({ sourceId: '' })),
      'INVALID_ORIGIN'
    );
  });

  test('rejects malformed or missing public material', () => {
    expectCode(
      () => importRecoverableHardwarePublicData(coldcard({ payload: '{broken' })),
      'INVALID_HARDWARE_EXPORT'
    );
    expectCode(
      () => importRecoverableHardwarePublicData(coldcard({ payload: { xfp: fingerprint } })),
      'INVALID_HARDWARE_EXPORT'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(jade({ payload: { xPub: tpub, mfp: fingerprint } })),
      'INVALID_DERIVATION'
    );
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          coldcard({ payload: { xfp: 'bad', bip48_2: { deriv: path, xpub: tpub } } })
        ),
      'INVALID_FINGERPRINT'
    );
  });

  test('rejects oversized object exports before parsing public fields', () => {
    expectCode(
      () =>
        importRecoverableHardwarePublicData(
          coldcard({
            payload: {
              xfp: fingerprint,
              bip48_2: { deriv: path, xpub: tpub },
              padding: Array(2050).fill('unused'),
            },
          })
        ),
      'INVALID_HARDWARE_EXPORT'
    );
  });
});
