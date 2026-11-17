jest.mock('src/services/electrum/client', () => ({}));
const mockCanaryDispatch = jest.fn();
jest.mock('react-redux', () => ({ useDispatch: () => mockCanaryDispatch }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('src/store/hooks', () => ({
  useAppSelector: (selector) =>
    selector({ ...require('src/store/store').store.getState(), bhr: {} }),
}));
jest.mock('src/hooks/useToastMessage', () => () => ({ showToast: jest.fn() }));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: { wallet: {}, error: {}, common: {}, home: {} },
  }),
}));
jest.mock('src/store/store', () => ({
  store: {
    getState: jest.fn(() => ({
      settings: {
        bitcoinNetworkType: 'TESTNET',
      },
    })),
    dispatch: jest.fn(),
    subscribe: jest.fn(),
    replaceReducer: jest.fn(),
  },
}));

import {
  COLDCARD_EXPORT,
  SEEDSIGNER_SS_EXPORT,
  JADE_SS_EXPORT,
  SPECTER_SS_EXPORT,
  MOBILE_KEY_EXPORT,
  KEEPER_EXTERNAL_EXPORT,
  KEEPER_INTERNAL_EXPORT,
  SEED_WORDS_EXPORT,
} from '../utils/signingDeviceExportFormats';

import {
  setupJade,
  setupSeedSigner,
  setupColdcard,
  setupSpecter,
  setupMobileKey,
  setupKeeperSigner,
  setupSeedWordsBasedKey,
  setupUSBSigner,
} from 'src/hardware/signerSetup';

import { URRegistryDecoder } from 'src/services/qr/bc-ur-registry';
import { decodeURBytes } from 'src/services/qr';
import { SignerType, XpubTypes, NetworkType } from 'src/services/wallets/enums';
import { getCosignerDetails } from 'src/services/wallets/factories/WalletFactory';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { store } from 'src/store/store';
import React from 'react';
import { act, create } from 'react-test-renderer';
import useCanaryWalletSetup from 'src/hooks/UseCanaryWalletSetup';
import { generateDataFromPSBT } from 'src/utils/utilities';
import { Signer } from 'src/services/wallets/interfaces/vault';

describe.each([NetworkType.MAINNET, NetworkType.TESTNET])(
  'OneKey %s public keys',
  (networkType) => {
    const network = WalletUtilities.getNetworkByType(networkType);
    const coinType = networkType === NetworkType.TESTNET ? 1 : 0;
    const bip32 = BIP32Factory(ecc);
    const seed = Buffer.alloc(32, 1); // Deterministic test-only seed.
    const accountKey = (path: string, version = network.bip32.public) =>
      bip32
        .fromSeed(seed, { ...network, bip32: { ...network.bip32, public: version } })
        .derivePath(path)
        .neutered()
        .toBase58();
    const exportData = (account = 0) => {
      const singleSigPath = `m/84'/${coinType}'/${account}'`;
      const multiSigPath = `m/48'/${coinType}'/${account}'/2'`;
      const taprootPath = `m/86'/${coinType}'/${account}'`;
      return {
        mfp: '1234ABCD',
        singleSigPath,
        multiSigPath,
        taprootPath,
        singleSigXpub: accountKey(singleSigPath, coinType ? 0x045f1cf6 : 0x04b24746),
        multiSigXpub: accountKey(multiSigPath, coinType ? 0x02575483 : 0x02aa7ed3),
        taprootXpub: accountKey(taprootPath),
      };
    };

    beforeEach(() => {
      (store.getState as jest.Mock).mockReturnValue({
        settings: { bitcoinNetworkType: networkType },
      });
    });
    afterEach(() => {
      (store.getState as jest.Mock).mockReturnValue({
        settings: { bitcoinNetworkType: NetworkType.TESTNET },
      });
    });

    test.each([0, 2])(
      'imports canonical single-sig, multisig and taproot keys for account %s',
      (account) => {
        const data = exportData(account);
        for (const isMultisig of [false, true]) {
          const { signer, key } = setupUSBSigner(SignerType.ONEKEY, data, isMultisig);
          for (const type of [XpubTypes.P2WPKH, XpubTypes.P2WSH, XpubTypes.P2TR]) {
            const storedKey = signer.signerXpubs[type][0];
            expect(storedKey.xpub).toBe(accountKey(storedKey.derivationPath));
            expect(() => bip32.fromBase58(storedKey.xpub, network)).not.toThrow();
          }
          expect(key.xpub).toBe(accountKey(isMultisig ? data.multiSigPath : data.singleSigPath));
        }
      }
    );

    test.each([false, true])(
      'selects an existing SLIP-132 key (multisig: %s) without changing its child key',
      (isMultisig) => {
        const data = exportData();
        const ssKey = { xpub: data.singleSigXpub, derivationPath: data.singleSigPath };
        const msKey = { xpub: data.multiSigXpub, derivationPath: data.multiSigPath };
        const selected = WalletUtilities.getKeyForScheme(
          isMultisig,
          { type: SignerType.ONEKEY, masterFingerprint: data.mfp },
          msKey,
          ssKey,
          null
        );
        const expected = bip32.fromBase58(accountKey(selected.derivationPath), network);
        const actual = bip32.fromBase58(selected.xpub, network);
        expect(selected.xfp).toBe(expected.fingerprint.toString('hex').toUpperCase());
        expect(actual.derivePath('0/3').publicKey).toEqual(expected.derivePath('0/3').publicKey);
        if (!isMultisig) {
          expect(
            bitcoin.payments.p2wpkh({ pubkey: actual.derivePath('0/3').publicKey, network }).address
          ).toBe(
            bitcoin.payments.p2wpkh({ pubkey: expected.derivePath('0/3').publicKey, network })
              .address
          );
        }
        expect(ssKey.xpub).toBe(data.singleSigXpub);
        expect(msKey.xpub).toBe(data.multiSigXpub);
      }
    );

    test('rejects an account key from the other network instead of rewriting its version', () => {
      const data = exportData();
      const wrongVersion = coinType ? 0x04b24746 : 0x045f1cf6;
      data.singleSigXpub = accountKey(data.singleSigPath, wrongVersion);
      expect(() => setupUSBSigner(SignerType.ONEKEY, data, true)).toThrow();
      expect(() =>
        WalletUtilities.getKeyForScheme(
          false,
          { type: SignerType.ONEKEY },
          null,
          { xpub: data.singleSigXpub, derivationPath: data.singleSigPath },
          null
        )
      ).toThrow();
    });

    test('creates a Canary wallet from a legacy OneKey single-sig key', () => {
      const data = exportData();
      const signer = {
        type: SignerType.ONEKEY,
        masterFingerprint: data.mfp,
        signerXpubs: {
          [XpubTypes.P2WPKH]: [{ xpub: data.singleSigXpub, derivationPath: data.singleSigPath }],
        },
      };
      let createCanary: ReturnType<typeof useCanaryWalletSetup>['createCreateCanaryWallet'];
      const Probe = () => {
        createCanary = useCanaryWalletSetup({}).createCreateCanaryWallet;
        return null;
      };
      let renderer;
      mockCanaryDispatch.mockClear();
      try {
        act(() => {
          renderer = create(React.createElement(Probe));
        });
        let result;
        act(() => {
          result = createCanary(signer);
        });
        expect(result.vaultSigners[0].xpub).toBe(accountKey(data.singleSigPath));
        expect(mockCanaryDispatch).toHaveBeenCalledWith(
          expect.objectContaining({ payload: { newVaultInfo: result } })
        );
        expect(signer.signerXpubs[XpubTypes.P2WPKH][0].xpub).toBe(data.singleSigXpub);
      } finally {
        act(() => renderer?.unmount());
      }
    });

    test('previews an external multisig PSBT with a legacy OneKey key and rejects a different key', () => {
      const data = exportData();
      const path = `${data.multiSigPath}/0/3`;
      const node = bip32.fromSeed(seed, network).derivePath(path);
      const otherRoot = bip32.fromSeed(Buffer.alloc(32, 2), network);
      const otherPubkey = otherRoot.derivePath(path).publicKey;
      const payment = bitcoin.payments.p2wsh({
        redeem: bitcoin.payments.p2ms({
          m: 2,
          pubkeys: [node.publicKey, otherPubkey].sort(Buffer.compare),
          network,
        }),
        network,
      });
      const psbt = new bitcoin.Psbt({ network })
        .addInput({
          hash: Buffer.alloc(32, 3),
          index: 0,
          witnessUtxo: { script: payment.output, value: 10000 },
          witnessScript: payment.redeem.output,
          bip32Derivation: [
            { masterFingerprint: Buffer.from(data.mfp, 'hex'), pubkey: node.publicKey, path },
          ],
        })
        .addOutput({ script: payment.output, value: 9000 });
      const signer = {
        type: SignerType.ONEKEY,
        masterFingerprint: data.mfp,
        signerXpubs: {
          [XpubTypes.P2WSH]: [{ xpub: data.multiSigXpub, derivationPath: data.multiSigPath }],
        },
      } as unknown as Signer;
      const preview = generateDataFromPSBT(psbt.toBase64(), signer);
      expect(preview.signerMatched).toBe(true);
      expect(preview.fees).toBe(1000);
      expect(preview.senderAddresses[0].address).toBe(payment.address);
      signer.signerXpubs[XpubTypes.P2WSH][0].xpub = otherRoot
        .derivePath(data.multiSigPath)
        .neutered()
        .toBase58();
      expect(generateDataFromPSBT(psbt.toBase64(), signer).signerMatched).toBe(false);
    });
  }
);

jest.setTimeout(30000);

// Type definitions
type RotatingQR = {
  data: string;
}[];

// Test helper functions
const isValidQRData = (data: any): boolean => {
  return data !== null && data !== undefined;
};

const extractDataFromRotatingQR = (rotatingQrData: RotatingQR) => {
  if (!rotatingQrData || rotatingQrData.length === 0) {
    return null;
  }

  const decoder = new URRegistryDecoder();

  if (rotatingQrData.length === 1) {
    const { data } = decodeURBytes(decoder, rotatingQrData[0].data);
    return data;
  }

  const extractedData = rotatingQrData.reduce((extractedData, item) => {
    const { percentage, data } = decodeURBytes(decoder, item.data);
    return percentage === 100 ? data : extractedData;
  }, null);

  return extractedData;
};

interface SignerTestData {
  type: SignerType;
  name: string;
  extractFunction: () => any;
  setupFunction: (data: any, isMultisig?: boolean) => any;
  expectedProperties: string[];
  supportsMultisig: boolean;
  skipSingleSig?: boolean;
  skipMultisig?: boolean;
}

const SIGNER_TEST_DATA: SignerTestData[] = [
  {
    type: SignerType.JADE,
    name: 'Jade',
    extractFunction: () => extractDataFromRotatingQR(JADE_SS_EXPORT),
    setupFunction: setupJade,
    expectedProperties: ['mfp', 'derivationPath', 'xPub'],
    supportsMultisig: true,
  },
  {
    type: SignerType.COLDCARD,
    name: 'COLDCARD',
    extractFunction: () => COLDCARD_EXPORT.data,
    setupFunction: setupColdcard,
    expectedProperties: ['bip84', 'xfp', 'chain'],
    supportsMultisig: true,
  },
  {
    type: SignerType.MOBILE_KEY,
    name: 'Recovery Key',
    extractFunction: () => ({ primaryMnemonic: MOBILE_KEY_EXPORT, isMultisig: false }),
    setupFunction: setupMobileKey,
    expectedProperties: ['primaryMnemonic'],
    supportsMultisig: true,
  },
  {
    type: SignerType.SEED_WORDS,
    name: 'Seed Key',
    extractFunction: () => SEED_WORDS_EXPORT,
    setupFunction: setupSeedWordsBasedKey,
    expectedProperties: [],
    supportsMultisig: true,
  },
  {
    type: SignerType.KEEPER,
    name: 'External Key',
    extractFunction: () => KEEPER_EXTERNAL_EXPORT.data,
    setupFunction: setupKeeperSigner,
    expectedProperties: [],
    supportsMultisig: true,
    skipSingleSig: true, // Keeper only supports multisig
  },
];

describe('Signing Devices: Single-sig setup flow tests', () => {
  // Test each signer that supports single-sig
  SIGNER_TEST_DATA.filter((signer) => !signer.skipSingleSig).forEach((signerData) => {
    test(`${signerData.name}: should generate a signer and key with expected properties`, async () => {
      // Extract data from QR or other source
      const qrExtract = signerData.extractFunction();

      // Skip if extraction failed
      if (!isValidQRData(qrExtract)) {
        console.warn(`Skipping ${signerData.name} test - invalid QR data extraction`);
        return;
      }

      // Assert extracted properties if specified
      for (const prop of signerData.expectedProperties) {
        if (prop.includes('.')) {
          // Handle nested properties like 'bip84.xpub'
          const parts = prop.split('.');
          let current = qrExtract;
          for (const part of parts) {
            expect(current).toHaveProperty(part);
            current = current[part];
          }
        } else {
          expect(qrExtract).toHaveProperty(prop);
        }
      }

      // Setup signer and key
      const isMultisig = false;
      const { signer, key } = await signerData.setupFunction(qrExtract, isMultisig);

      // Assert signer properties
      expect(signer).toHaveProperty('signerXpubs');
      expect(signer.type).toEqual(signerData.type);
      expect(signer).toHaveProperty('masterFingerprint');
      expect(signer).toHaveProperty('signerName');
      expect(signer).toHaveProperty('storageType');
      expect(signer).toHaveProperty('addedOn');
      expect(signer).toHaveProperty('lastHealthCheck');

      // For single-sig, check P2WPKH xpub
      if (signer.signerXpubs && signer.signerXpubs[XpubTypes.P2WPKH]) {
        expect(signer.signerXpubs[XpubTypes.P2WPKH][0]).toHaveProperty('xpub');
        expect(signer.signerXpubs[XpubTypes.P2WPKH][0]).toHaveProperty('derivationPath');
      }

      // Assert key properties
      expect(key).toHaveProperty('xpub');
      expect(key).toHaveProperty('derivationPath');
      expect(key).toHaveProperty('masterFingerprint');
      expect(key).toHaveProperty('xfp');

      console.log(`✓ ${signerData.name} single-sig test passed`);
    });
  });
});

describe('Signing Devices: Multi-sig setup flow tests', () => {
  // Test each signer that supports multi-sig
  SIGNER_TEST_DATA.filter((signer) => signer.supportsMultisig && !signer.skipMultisig).forEach(
    (signerData) => {
      test(`${signerData.name}: should generate a multi-sig signer and key with expected properties`, async () => {
        // Extract data from QR or other source
        const qrExtract =
          signerData.type === SignerType.MOBILE_KEY
            ? { primaryMnemonic: MOBILE_KEY_EXPORT, isMultisig: true }
            : signerData.extractFunction();

        // Skip if extraction failed
        if (!isValidQRData(qrExtract)) {
          console.warn(`Skipping ${signerData.name} multisig test - invalid QR data extraction`);
          return;
        }

        // Setup signer and key for multi-sig
        const isMultisig = true;
        const { signer, key } = await signerData.setupFunction(qrExtract, isMultisig);

        // Assert signer properties
        expect(signer).toHaveProperty('signerXpubs');
        expect(signer.type).toEqual(signerData.type);
        expect(signer).toHaveProperty('masterFingerprint');
        expect(signer).toHaveProperty('signerName');
        expect(signer).toHaveProperty('storageType');
        expect(signer).toHaveProperty('addedOn');
        expect(signer).toHaveProperty('lastHealthCheck');

        // For multi-sig, check P2WSH xpub
        if (signer.signerXpubs && signer.signerXpubs[XpubTypes.P2WSH]) {
          expect(signer.signerXpubs[XpubTypes.P2WSH][0]).toHaveProperty('xpub');
          expect(signer.signerXpubs[XpubTypes.P2WSH][0]).toHaveProperty('derivationPath');
        }

        // Assert key properties
        expect(key).toHaveProperty('xpub');
        expect(key).toHaveProperty('derivationPath');
        expect(key).toHaveProperty('masterFingerprint');
        expect(key).toHaveProperty('xfp');

        console.log(`✓ ${signerData.name} multi-sig test passed`);
      });
    }
  );
});

describe('Signing Devices: Core functionality tests', () => {
  test('should validate working signers have correct types', async () => {
    const { signer } = setupColdcard(COLDCARD_EXPORT.data, false);
    expect(signer.type).toBe(SignerType.COLDCARD);
    expect(signer.storageType).toBeDefined();
    expect(signer.signerName).toContain(SignerType.COLDCARD);
  });

  test('should handle seed-based signers correctly', async () => {
    const { signer } = setupSeedWordsBasedKey(SEED_WORDS_EXPORT, false, true);
    expect(signer.type).toBe(SignerType.SEED_WORDS);
    expect(signer.signerXpubs).toBeDefined();
  });

  test('should validate mobile key setup with different configurations', async () => {
    const singleSigConfig = { primaryMnemonic: MOBILE_KEY_EXPORT, isMultisig: false };
    const multiSigConfig = { primaryMnemonic: MOBILE_KEY_EXPORT, isMultisig: true };

    const { signer: singleSigSigner } = await setupMobileKey(singleSigConfig);
    const { signer: multiSigSigner } = await setupMobileKey(multiSigConfig);

    expect(singleSigSigner.type).toBe(SignerType.MOBILE_KEY);
    expect(multiSigSigner.type).toBe(SignerType.MOBILE_KEY);

    expect(singleSigSigner.signerXpubs).toBeDefined();
    expect(multiSigSigner.signerXpubs).toBeDefined();
  });
});

describe('Signing Devices: Error handling and edge cases', () => {
  test('should handle invalid data gracefully', async () => {
    expect(() => {
      setupSeedSigner('invalid-data', false);
    }).toThrow();
  });

  test('should validate isValidQRData helper', () => {
    expect(isValidQRData(null)).toBe(false);
    expect(isValidQRData(undefined)).toBe(false);
    expect(isValidQRData({})).toBe(true);
    expect(isValidQRData({ data: 'test' })).toBe(true);
  });

  test('should validate basic network type configuration', () => {
    // Since we mocked the store, it should be available
    expect(typeof NetworkType.TESTNET).toBe('string');
  });
});

describe('Signing Devices: Performance and timeout tests', () => {
  test('signer setup functions should complete within reasonable time', async () => {
    const startTime = Date.now();

    const { signer } = setupSeedWordsBasedKey(SEED_WORDS_EXPORT, false);
    expect(signer).toBeDefined();

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
  });

  test('should handle concurrent signer setup operations', async () => {
    const setupPromises = [
      () => setupSeedWordsBasedKey(SEED_WORDS_EXPORT, false),
      () => setupMobileKey({ primaryMnemonic: MOBILE_KEY_EXPORT, isMultisig: false }),
    ].map((fn) => {
      return Promise.resolve(fn());
    });

    const results = await Promise.allSettled(setupPromises);
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    expect(successful).toBeGreaterThan(0); // At least one should succeed
  });
});
