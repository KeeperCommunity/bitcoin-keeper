import * as bitcoinJS from 'bitcoinjs-lib';
import { VerificationType } from 'src/models/interfaces/AssistedKeys';
import WalletOperations from 'src/services/wallets/operations';
import WalletUtilities from 'src/services/wallets/operations/utils';
import {
  generateMiniscriptScheme,
  generateSeedWordsKey,
  generateVault,
} from 'src/services/wallets/factories/VaultFactory';
import {
  MiniscriptTypes,
  MultisigScriptType,
  NetworkType,
  SignerStorage,
  SignerType,
  TxPriority,
  VaultType,
} from 'src/services/wallets/enums';
import { generateSignerFromMetaData } from 'src/hardware';
import ElectrumClient from 'src/services/electrum/client';
import { predefinedTestnetNodes } from 'src/services/electrum/predefinedNodes';
import {
  AverageTxFeesByNetwork,
  SerializedPSBTEnvelop,
  TransactionPrerequisite,
} from 'src/services/wallets/interfaces';
import {
  MiniscriptElements,
  MiniscriptScheme,
  Signer,
  Vault,
  VaultScheme,
  VaultSigner,
} from 'src/services/wallets/interfaces/vault';
import { setupMobileKey, setupSeedWordsBasedKey } from 'src/hardware/signerSetup';
import { getKeyUID } from 'src/utils/utilities';
import { NewVaultInfo } from 'src/store/sagas/wallets';
import {
  ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET,
  generateEnhancedVaultElements,
} from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import {
  generateOutputDescriptors,
  parseTextforVaultConfig,
} from 'src/utils/service-utilities/utils';

jest.mock('src/store/store', () => ({
  store: {
    getState: () => ({
      settings: {
        bitcoinNetworkType: 'TESTNET',
      },
    }),
  },
}));

jest.mock('realm', () => ({}));

const connectToElectrumClient = async () => {
  try {
    ElectrumClient.setActivePeer(predefinedTestnetNodes);
    await ElectrumClient.connect();
    console.log('Electrum connected');
  } catch (err) {
    console.log('failed to connect to Electrum:', err);
    process.exit(1);
  }
};

describe('Vault: Single-Sig(1-of-1)', () => {
  let primaryMnemonic: string;
  let vault: Vault;
  let mobileKey: VaultSigner;
  let mobileKeySigner: Signer;
  let averageTxFees: AverageTxFeesByNetwork;
  let txPrerequisites: TransactionPrerequisite;
  let txnPriority: TxPriority;
  let currentBlockHeight: number;
  let serializedPSBTEnvelops: SerializedPSBTEnvelop[];
  let PSBT: bitcoinJS.Psbt;

  beforeAll(async () => {
    primaryMnemonic =
      'midnight auction hello stereo such fault legal outdoor manual recycle derive like';
    await connectToElectrumClient();
    const { signer, key } = await setupMobileKey({
      primaryMnemonic,
      isMultisig: false,
      isMock: true,
    }); // Note: 1-of-1 vault is now a single-sig vault(uses m/84 instead of m/48)
    mobileKeySigner = signer;
    mobileKey = key;
  });

  test('vault factory: creating a 1-of-1 vault(mobile-key)', async () => {
    const scheme: VaultScheme = { m: 1, n: 1 };
    const vaultType = VaultType.DEFAULT;
    const vaultSigners = [mobileKey];
    const vaultDetails = {
      name: 'Vault',
      description: 'Secure your sats',
    };

    vault = await generateVault({
      type: vaultType,
      vaultName: vaultDetails.name,
      vaultDescription: vaultDetails.description,
      scheme,
      signers: vaultSigners,
      networkType: NetworkType.TESTNET,
    });
    expect(vault.signers.length).toEqual(1);
    expect(vault.isMultiSig).toEqual(false);
  });

  test('vault operations: generating a receive address', () => {
    const { receivingAddress } = WalletOperations.getNextFreeExternalAddress(vault);
    expect(receivingAddress).toMatch(/^tb1[a-z0-9]{39}$/);
  });

  test('vault operations: fetching balance, UTXOs & transactions', async () => {
    const network = WalletUtilities.getNetworkByType(vault.networkType);
    const { synchedWallets } = await WalletOperations.syncWalletsViaElectrumClient(
      [vault],
      network
    );
    vault = synchedWallets[0].synchedWallet as Vault;

    const { balances, transactions, confirmedUTXOs, unconfirmedUTXOs } = vault.specs;
    const checkUTXO = (utxo) => {
      expect(utxo).toEqual(
        expect.objectContaining({
          txId: expect.any(String),
          vout: expect.any(Number),
          value: expect.any(Number),
          address: expect.any(String),
          height: expect.any(Number),
        })
      );
    };

    confirmedUTXOs.forEach(checkUTXO);
    unconfirmedUTXOs.forEach(checkUTXO);

    const netBalance = [...confirmedUTXOs, ...unconfirmedUTXOs].reduce(
      (sum, utxo) => sum + utxo.value,
      0
    );

    expect(balances.confirmed + balances.unconfirmed).toEqual(netBalance);
    expect(transactions.length).toBeGreaterThan(0);
  });

  test('vault operations: transaction fee fetch', async () => {
    averageTxFees = await WalletOperations.calculateAverageTxFee();
    expect(typeof averageTxFees).toBe('object');
    Object.values(NetworkType).forEach((network) => {
      const fees = averageTxFees[network];
      expect(fees).toBeDefined();
      expect(typeof fees).toBe('object');
      [TxPriority.LOW, TxPriority.MEDIUM, TxPriority.HIGH].forEach((priority) => {
        expect(fees[priority]).toEqual({
          estimatedBlocks: expect.any(Number),
          feePerByte: expect.any(Number),
        });
      });
    });
  });

  test('should fetch the current block height', async () => {
    txnPriority = TxPriority.LOW;
    currentBlockHeight = (await WalletUtilities.fetchCurrentBlockHeight()).currentBlockHeight;
    expect(currentBlockHeight).toBeGreaterThan(0);
  });

  test('should calculate transaction prerequisites using transferST1', async () => {
    const averageTxFeeByNetwork = averageTxFees[vault.networkType];
    const recipients = [
      {
        address: 'tb1ql7w62elx9ucw4pj5lgw4l028hmuw80sndtntxt',
        amount: 3000,
      },
    ];

    const res = await WalletOperations.transferST1(vault, recipients, averageTxFeeByNetwork);
    txPrerequisites = res.txPrerequisites;

    expect(res.txPrerequisites).toBeDefined();
    expect(res.txRecipients).toBeDefined();

    [TxPriority.LOW, TxPriority.MEDIUM, TxPriority.HIGH].forEach((priority) => {
      const prerequisites = txPrerequisites[priority];
      expect(prerequisites).toEqual(
        expect.objectContaining({
          inputs: expect.arrayContaining([
            expect.objectContaining({
              txId: expect.any(String),
              vout: expect.any(Number),
              value: expect.any(Number),
              address: expect.any(String),
              height: expect.any(Number),
            }),
          ]),
          outputs: expect.arrayContaining([
            expect.objectContaining({
              value: expect.any(Number),
              address: expect.any(String),
            }),
          ]),
          fee: expect.any(Number),
          estimatedBlocks: expect.any(Number),
        })
      );
    });
  });

  test('should construct and broadcast transaction using transferST2', async () => {
    const signerMap = { [getKeyUID(mobileKey)]: mobileKeySigner };
    const res = await WalletOperations.transferST2(
      vault,
      currentBlockHeight,
      txPrerequisites,
      txnPriority,
      null,
      signerMap
    );

    serializedPSBTEnvelops = (res as any).serializedPSBTEnvelops;
    expect(res.cachedTxid).toEqual(expect.any(String));
    expect(serializedPSBTEnvelops).toEqual([
      {
        isMockSigner: true,
        isSigned: true,
        mfp: mobileKey.masterFingerprint,
        serializedPSBT: expect.any(String),
        signerType: mobileKeySigner.type,
        signingPayload: [
          {
            inputs: [
              {
                address: 'tb1qgvtqknk3hmdlpzgc0pghzt3h67r95szmp8pr2d',
                height: expect.any(Number),
                script: { length: 27 },
                txId: '608710eb040d935dedb6c4d6321369382b2bd45533a7442a6fa98add3860d46b',
                value: 6000,
                vout: 1,
              },
            ],
            payloadTarget: mobileKeySigner.type,
          },
        ],
        xfp: mobileKey.xfp,
      },
    ]);
  });

  test('should construct and broadcast transaction using transferST3', async () => {
    const broadcastSpy = jest
      .spyOn(WalletOperations, 'broadcastTransaction')
      .mockResolvedValue('73833807769bbc4f56636cc1cbffb0f57a80bcc305c9df38652819d779df22a1'); // mocking transaction broadcast to avoid subsequent broadcast failure
    const { txid } = await WalletOperations.transferST3(
      vault,
      serializedPSBTEnvelops,
      txPrerequisites,
      txnPriority
    );
    expect(txid).toEqual('73833807769bbc4f56636cc1cbffb0f57a80bcc305c9df38652819d779df22a1');
    broadcastSpy.mockRestore();
  });
});

describe('Vault: Multi-sig(2-of-3)', () => {
  let primaryMnemonic: string;
  let vault: Vault;

  let mobileKey: VaultSigner; // Signer - 1
  let seedWordsKey: VaultSigner; // Signer - 2
  let signingServerKey: VaultSigner; // Signer - 3

  let seedWords;
  let signingServerConfig;
  let averageTxFees: AverageTxFeesByNetwork;
  let txPrerequisites: TransactionPrerequisite;
  let txnPriority: TxPriority;
  let currentBlockHeight: number;
  let serializedPSBTEnvelops: SerializedPSBTEnvelop[];
  const signerMap = {};

  beforeAll(async () => {
    primaryMnemonic =
      'midnight auction hello stereo such fault legal outdoor manual recycle derive like';

    // configure 1st singer: mobile-key
    const { signer, key } = await setupMobileKey({
      primaryMnemonic,
      isMultisig: true,
    });
    mobileKey = key;
    signerMap[getKeyUID(mobileKey)] = signer;

    // configure 2nd signer: seedwords based key
    seedWords = 'absent beauty three bronze reduce runway oil girl decide juice point cruel';
    const { signer: singer2, key: key2 } = setupSeedWordsBasedKey(seedWords, true);
    seedWordsKey = key2;
    signerMap[getKeyUID(seedWordsKey)] = singer2;

    // configure 3rd singer: signing server
    signingServerConfig = {
      method: 'TWO_FA',
      verifier: 'NZDA2HBHGIQSSUCY',
    };
    const { key: key3, signer: signer3 } = generateSignerFromMetaData({
      xpub: 'tpubDERPm4XUYBFJXrA1h3cUQyhZhVXiDkjRRQXJiaSFnqwXnucEseRVcqC99fYgGxZaPEE5ZZu3nKEoW2pVGz2obWBVnpS9Noncs7kw5QkF51q',
      derivationPath: "m/48'/1'/0'/2'",
      masterFingerprint: '3EE66DDF',
      signerType: SignerType.POLICY_SERVER,
      storageType: SignerStorage.WARM,
      isMultisig: true,
      signerPolicy: {
        verification: {
          method: VerificationType.TWO_FA,
        },
        restrictions: {
          none: false,
          maxTransactionAmount: 10000,
        },
        signingDelay: 0,
      },
    });
    signingServerKey = key3;
    signerMap[getKeyUID(signingServerKey)] = signer3;
  });

  test('vault factory: creating a 2-of-3 vault', async () => {
    const scheme = { m: 2, n: 3 };
    const vaultType = VaultType.DEFAULT;
    const vaultSigners = [mobileKey, seedWordsKey, signingServerKey];
    const vaultDetails = {
      name: 'Vault',
      description: 'Secure your sats',
    };

    vault = await generateVault({
      type: vaultType,
      vaultName: vaultDetails.name,
      vaultDescription: vaultDetails.description,
      scheme,
      signers: vaultSigners,
      networkType: NetworkType.TESTNET,
    });
    expect(vault.scheme.m).toEqual(2);
    expect(vault.signers.length).toEqual(3);
    expect(vault.isMultiSig).toEqual(true);
  });

  test('vault operations: generating a receive address', () => {
    const { receivingAddress } = WalletOperations.getNextFreeExternalAddress(vault);
    expect(receivingAddress).toEqual(
      'tb1qn0gxmwpqhrxadmxuawm9z6uj4fn5ehhm8fjkglysxp3fa3ft30esnm0max'
    );
  });

  test('vault operations: fetching balance, UTXOs & transactions', async () => {
    const network = WalletUtilities.getNetworkByType(vault.networkType);
    const { synchedWallets } = await WalletOperations.syncWalletsViaElectrumClient(
      [vault],
      network
    );
    vault = synchedWallets[0].synchedWallet as Vault;

    const { balances, transactions, confirmedUTXOs, unconfirmedUTXOs } = vault.specs;
    const checkUTXO = (utxo) => {
      expect(utxo).toEqual(
        expect.objectContaining({
          txId: expect.any(String),
          vout: expect.any(Number),
          value: expect.any(Number),
          address: expect.any(String),
          height: expect.any(Number),
        })
      );
    };

    confirmedUTXOs.forEach(checkUTXO);
    unconfirmedUTXOs.forEach(checkUTXO);
    const netBalance = [...confirmedUTXOs, ...unconfirmedUTXOs].reduce(
      (sum, utxo) => sum + utxo.value,
      0
    );

    expect(balances.confirmed + balances.unconfirmed).toEqual(netBalance);
    expect(transactions.length).toBeGreaterThan(0);
  });

  test('vault operations: transaction fee fetch', async () => {
    averageTxFees = await WalletOperations.calculateAverageTxFee();
    expect(typeof averageTxFees).toBe('object');
    Object.values(NetworkType).forEach((network) => {
      const fees = averageTxFees[network];
      expect(fees).toBeDefined();
      expect(typeof fees).toBe('object');
      [TxPriority.LOW, TxPriority.MEDIUM, TxPriority.HIGH].forEach((priority) => {
        expect(fees[priority]).toEqual({
          estimatedBlocks: expect.any(Number),
          feePerByte: expect.any(Number),
        });
      });
    });
  });

  test('should fetch the current block height', async () => {
    txnPriority = TxPriority.LOW;
    currentBlockHeight = (await WalletUtilities.fetchCurrentBlockHeight()).currentBlockHeight;
    expect(currentBlockHeight).toBeGreaterThan(0);
  });

  test('should calculate transaction prerequisites using transferST1', async () => {
    const averageTxFeeByNetwork = averageTxFees[vault.networkType];
    const recipients = [
      {
        address: 'tb1ql7w62elx9ucw4pj5lgw4l028hmuw80sndtntxt',
        amount: 3000,
      },
    ];

    const res = await WalletOperations.transferST1(vault, recipients, averageTxFeeByNetwork);
    txPrerequisites = res.txPrerequisites;

    expect(res.txPrerequisites).toBeDefined();
    expect(res.txRecipients).toBeDefined();

    [TxPriority.LOW, TxPriority.MEDIUM, TxPriority.HIGH].forEach((priority) => {
      const prerequisites = txPrerequisites[priority];
      expect(prerequisites).toEqual(
        expect.objectContaining({
          inputs: expect.arrayContaining([
            expect.objectContaining({
              txId: expect.any(String),
              vout: expect.any(Number),
              value: expect.any(Number),
              address: expect.any(String),
              height: expect.any(Number),
            }),
          ]),
          outputs: expect.arrayContaining([
            expect.objectContaining({
              value: expect.any(Number),
              address: expect.any(String),
            }),
          ]),
          fee: expect.any(Number),
          estimatedBlocks: expect.any(Number),
        })
      );
    });
  });

  test('should construct PSBTs to sign using transferST2', async () => {
    const res = await WalletOperations.transferST2(
      vault,
      currentBlockHeight,
      txPrerequisites,
      txnPriority,
      null,
      signerMap
    );
    serializedPSBTEnvelops = (res as any).serializedPSBTEnvelops;
    expect(res.cachedTxid).toEqual(expect.any(String));
    expect(serializedPSBTEnvelops.length).toBe(3);
  });

  test('should sign the PSBT using mobileKey - 1st signature', async () => {
    const mobileKeyEnvelopIndex = serializedPSBTEnvelops.findIndex(
      (envelop) => envelop.signerType === SignerType.MOBILE_KEY
    );
    expect(mobileKeyEnvelopIndex).toBeGreaterThanOrEqual(0);

    const { signedSerializedPSBT: mobileKeySignedSerializedPSBT } =
      WalletOperations.internallySignVaultPSBT(
        vault,
        serializedPSBTEnvelops[mobileKeyEnvelopIndex].serializedPSBT,
        mobileKey
      );
    expect(mobileKeySignedSerializedPSBT).toBeDefined();
    serializedPSBTEnvelops[mobileKeyEnvelopIndex] = {
      ...serializedPSBTEnvelops[mobileKeyEnvelopIndex],
      serializedPSBT: mobileKeySignedSerializedPSBT,
    };
  });

  test('should fail to construct and broadcast transaction w/ a single signature', async () => {
    await expect(
      WalletOperations.transferST3(
        vault,
        serializedPSBTEnvelops, // signature 1 of 3
        txPrerequisites,
        txnPriority
      )
    ).rejects.toThrow('Can not finalize input #0');
  });

  test('should sign the PSBT using seed words - 2nd signature', async () => {
    const seedKeyEnvelopIndex = serializedPSBTEnvelops.findIndex(
      (envelop) => envelop.signerType === SignerType.SEED_WORDS
    );
    expect(seedKeyEnvelopIndex).toBeGreaterThanOrEqual(0);

    const { xpub, xpriv } = generateSeedWordsKey(seedWords, NetworkType.TESTNET, true);
    if (seedWordsKey.xpub !== xpub) throw new Error('Invalid mnemonic; xpub mismatch');
    const { signedSerializedPSBT: seedKeySignedSerializedPSBT } =
      WalletOperations.internallySignVaultPSBT(
        vault,
        serializedPSBTEnvelops[seedKeyEnvelopIndex].serializedPSBT,
        { ...seedWordsKey, xpriv }
      );

    expect(seedKeySignedSerializedPSBT).toBeDefined();
    serializedPSBTEnvelops[seedKeyEnvelopIndex] = {
      ...serializedPSBTEnvelops[seedKeyEnvelopIndex],
      serializedPSBT: seedKeySignedSerializedPSBT,
    };
  });

  test('should construct and broadcast transaction using transferST3', async () => {
    const broadcastSpy = jest
      .spyOn(WalletOperations, 'broadcastTransaction')
      .mockResolvedValue('87e91c91d0b663f83d416f1c5b39786cc27fe9a5a5da4c24d391926648b4a868'); // mocking transaction broadcast to avoid subsequent broadcast failure
    const { txid } = await WalletOperations.transferST3(
      vault,
      serializedPSBTEnvelops, // signature 2 of 3
      txPrerequisites,
      txnPriority
    );
    expect(txid).toEqual('87e91c91d0b663f83d416f1c5b39786cc27fe9a5a5da4c24d391926648b4a868');
    broadcastSpy.mockRestore();
  });
});

describe('Miniscript Vault: 2-of-3 w/ Inheritance Key', () => {
  let primaryMnemonic: string;
  let vault: Vault;

  let mobileKey: VaultSigner; // Signer - 1
  let seedWordsKey: VaultSigner; // Signer - 2
  let signingServerKey: VaultSigner; // Signer - 3
  let seedWordsKeyInheritance: VaultSigner; // Signer - 4 (Inheritance Key)

  let seedWords: string;
  let seedWordsInheritance: string;
  let signingServerConfig;
  let averageTxFees: AverageTxFeesByNetwork;
  let txPrerequisites: TransactionPrerequisite;
  let txnPriority: TxPriority;
  let currentBlockHeight: number;
  let serializedPSBTEnvelops: SerializedPSBTEnvelop[];
  let serializedPSBTEnvelopsInitial: string;
  let miniscriptTxElements;

  const signerMap = {};

  beforeAll(async () => {
    primaryMnemonic =
      'midnight auction hello stereo such fault legal outdoor manual recycle derive like';

    // configure 1st singer: mobile-key
    const { signer, key } = await setupMobileKey({
      primaryMnemonic,
      isMultisig: true,
    });
    mobileKey = key;
    signerMap[getKeyUID(mobileKey)] = signer;

    // configure 2nd signer: seedwords based key
    seedWords = 'absent beauty three bronze reduce runway oil girl decide juice point cruel';
    const { signer: singer2, key: key2 } = setupSeedWordsBasedKey(seedWords, true);
    seedWordsKey = key2;
    signerMap[getKeyUID(seedWordsKey)] = singer2;

    // configure 3rd signer: signing server
    signingServerConfig = {
      method: 'TWO_FA',
      verifier: 'NZDA2HBHGIQSSUCY',
    };
    const { key: key3, signer: signer3 } = generateSignerFromMetaData({
      xpub: 'tpubDERPm4XUYBFJXrA1h3cUQyhZhVXiDkjRRQXJiaSFnqwXnucEseRVcqC99fYgGxZaPEE5ZZu3nKEoW2pVGz2obWBVnpS9Noncs7kw5QkF51q',
      derivationPath: "m/48'/1'/0'/2'",
      masterFingerprint: '3EE66DDF',
      signerType: SignerType.POLICY_SERVER,
      storageType: SignerStorage.WARM,
      isMultisig: true,
      signerPolicy: {
        verification: {
          method: VerificationType.TWO_FA,
        },
        restrictions: {
          none: false,
          maxTransactionAmount: 10000,
        },
        signingDelay: 0,
      },
    });
    signingServerKey = key3;
    signerMap[getKeyUID(signingServerKey)] = signer3;

    // configure 4th signer: Inheritance Key
    seedWordsInheritance =
      'erode copper burst fossil average cancel quantum gorilla essay neither pistol fat';
    const { signer: singer4, key: key4 } = setupSeedWordsBasedKey(seedWordsInheritance, true);
    seedWordsKeyInheritance = key4;
    signerMap[getKeyUID(seedWordsKeyInheritance)] = singer4;
  });

  test('Vault factory: Creating a 2-of-3 Miniscript Vault w/ Inheritance Key', async () => {
    const scheme = { m: 2, n: 3 };
    const vaultType = VaultType.DEFAULT;
    const vaultSigners = [mobileKey, seedWordsKey, signingServerKey];
    const vaultDetails = {
      name: 'Vault',
      description: 'Secure your sats',
    };

    const miniscriptTypes = [MiniscriptTypes.INHERITANCE];
    let vaultInfo: NewVaultInfo = {
      vaultType,
      vaultScheme: scheme,
      vaultSigners,
      vaultDetails,
      miniscriptTypes,
    };
    const timelock = ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET['MONTHS_3'];
    const initialTimelock = 0;
    currentBlockHeight = 85172;
    const inheritanceSignerWithTimelocks = [
      {
        signer: seedWordsKeyInheritance,
        timelock: currentBlockHeight + initialTimelock + timelock,
      },
    ];
    const emergencySignerWithTimelocks = [];

    let miniscriptElements: MiniscriptElements = generateEnhancedVaultElements(
      vaultInfo.vaultSigners,
      inheritanceSignerWithTimelocks,
      emergencySignerWithTimelocks,
      vaultInfo.vaultScheme,
      initialTimelock ? currentBlockHeight + initialTimelock : 0
    );
    vaultInfo.miniscriptElements = miniscriptElements;

    const miniscriptScheme: MiniscriptScheme = generateMiniscriptScheme(
      miniscriptElements,
      miniscriptTypes
    );
    const vaultScheme: VaultScheme = {
      ...vaultInfo.vaultScheme,
      multisigScriptType: MultisigScriptType.MINISCRIPT_MULTISIG,
      miniscriptScheme,
    };
    vaultInfo.vaultScheme = vaultScheme;

    if (miniscriptTypes.includes(MiniscriptTypes.INHERITANCE)) {
      vaultInfo.vaultSigners = [
        ...vaultInfo.vaultSigners,
        ...inheritanceSignerWithTimelocks.map(({ signer }) => signer),
      ];
    }

    vault = await generateVault({
      type: vaultType,
      vaultName: vaultDetails.name,
      vaultDescription: vaultDetails.description,
      scheme: vaultInfo.vaultScheme,
      signers: vaultInfo.vaultSigners,
      networkType: NetworkType.TESTNET,
    });
    expect(vault.isMultiSig).toEqual(true);
    expect(vault.scheme.multisigScriptType).toEqual(MultisigScriptType.MINISCRIPT_MULTISIG);
    expect(vault.scheme.miniscriptScheme).toBeDefined();
  });

  test('vault operations: generating a receive address', () => {
    const { receivingAddress } = WalletOperations.getNextFreeExternalAddress(vault);
    expect(receivingAddress).toEqual(
      'tb1q4vtx5pud9v5xhqr92x8qp8kyw4mst3at70z6fn64zmx5pgh9prtqj4lngd'
    );
  });

  test('vault operations: fetching balance, UTXOs & transactions', async () => {
    const network = WalletUtilities.getNetworkByType(vault.networkType);
    const { synchedWallets } = await WalletOperations.syncWalletsViaElectrumClient(
      [vault],
      network
    );
    vault = synchedWallets[0].synchedWallet as Vault;

    const { balances, transactions, confirmedUTXOs, unconfirmedUTXOs } = vault.specs;
    const checkUTXO = (utxo) => {
      expect(utxo).toEqual(
        expect.objectContaining({
          txId: expect.any(String),
          vout: expect.any(Number),
          value: expect.any(Number),
          address: expect.any(String),
          height: expect.any(Number),
        })
      );
    };

    confirmedUTXOs.forEach(checkUTXO);
    unconfirmedUTXOs.forEach(checkUTXO);
    const netBalance = [...confirmedUTXOs, ...unconfirmedUTXOs].reduce(
      (sum, utxo) => sum + utxo.value,
      0
    );

    expect(balances.confirmed + balances.unconfirmed).toEqual(netBalance);
    expect(transactions.length).toBeGreaterThan(0);
  });

  test('vault operations: transaction fee fetch', async () => {
    averageTxFees = await WalletOperations.calculateAverageTxFee();
    expect(typeof averageTxFees).toBe('object');
    Object.values(NetworkType).forEach((network) => {
      const fees = averageTxFees[network];
      expect(fees).toBeDefined();
      expect(typeof fees).toBe('object');
      [TxPriority.LOW, TxPriority.MEDIUM, TxPriority.HIGH].forEach((priority) => {
        expect(fees[priority]).toEqual({
          estimatedBlocks: expect.any(Number),
          feePerByte: expect.any(Number),
        });
      });
    });
  });

  test('should calculate transaction prerequisites using transferST1', async () => {
    const averageTxFeeByNetwork = averageTxFees[vault.networkType];
    const recipients = [
      {
        address: 'tb1ql7w62elx9ucw4pj5lgw4l028hmuw80sndtntxt',
        amount: 1000,
      },
    ];

    const res = await WalletOperations.transferST1(vault, recipients, averageTxFeeByNetwork);
    txPrerequisites = res.txPrerequisites;

    expect(res.txPrerequisites).toBeDefined();
    expect(res.txRecipients).toBeDefined();

    [TxPriority.LOW, TxPriority.MEDIUM, TxPriority.HIGH].forEach((priority) => {
      const prerequisites = txPrerequisites[priority];
      expect(prerequisites).toEqual(
        expect.objectContaining({
          inputs: expect.arrayContaining([
            expect.objectContaining({
              txId: expect.any(String),
              vout: expect.any(Number),
              value: expect.any(Number),
              address: expect.any(String),
              height: expect.any(Number),
            }),
          ]),
          outputs: expect.arrayContaining([
            expect.objectContaining({
              value: expect.any(Number),
              address: expect.any(String),
            }),
          ]),
          fee: expect.any(Number),
          estimatedBlocks: expect.any(Number),
        })
      );
    });
  });

  test('should construct PSBTs to sign using transferST2', async () => {
    txnPriority = TxPriority.LOW;
    miniscriptTxElements = { selectedPhase: 1, selectedPaths: [1] }; // 1st phase of the vault: w/o timelock and inheritance key
    const res = await WalletOperations.transferST2(
      vault,
      currentBlockHeight,
      txPrerequisites,
      txnPriority,
      null,
      signerMap,
      miniscriptTxElements
    );
    serializedPSBTEnvelops = (res as any).serializedPSBTEnvelops;
    expect(res.cachedTxid).toEqual(expect.any(String));
    expect(serializedPSBTEnvelops.length).toBe(3); // 3 signers: mobileKey, seedWordsKey, signingServerKey, doesn't include inheritance key

    serializedPSBTEnvelops.forEach((envelop, idx) => {
      // to check that inheritance key(seedWordsKeyInheritance) is not included in phase I
      expect(envelop.xfp).not.toEqual(seedWordsKeyInheritance.xfp);
    });
  });

  test('should sign the PSBT using mobileKey - 1st signature', async () => {
    const mobileKeyEnvelopIndex = serializedPSBTEnvelops.findIndex(
      (envelop) => envelop.signerType === SignerType.MOBILE_KEY
    );
    expect(mobileKeyEnvelopIndex).toBeGreaterThanOrEqual(0);

    const { signedSerializedPSBT: mobileKeySignedSerializedPSBT } =
      WalletOperations.internallySignVaultPSBT(
        vault,
        serializedPSBTEnvelops[mobileKeyEnvelopIndex].serializedPSBT,
        mobileKey
      );
    expect(mobileKeySignedSerializedPSBT).toBeDefined();
    serializedPSBTEnvelops[mobileKeyEnvelopIndex] = {
      ...serializedPSBTEnvelops[mobileKeyEnvelopIndex],
      serializedPSBT: mobileKeySignedSerializedPSBT,
    };
  });

  test('should fail to construct and broadcast transaction w/ a single signature', async () => {
    await expect(
      WalletOperations.transferST3(
        vault,
        serializedPSBTEnvelops, // signature 1 of 3
        txPrerequisites,
        txnPriority,
        null,
        null,
        miniscriptTxElements
      )
    ).rejects.toThrow('No suitable witness found for the available signatures');
  });

  test('should sign the PSBT using seed words - 2nd signature', async () => {
    const seedKeyEnvelopIndex = serializedPSBTEnvelops.findIndex(
      (envelop) => envelop.signerType === SignerType.SEED_WORDS
    );
    expect(seedKeyEnvelopIndex).toBeGreaterThanOrEqual(0);

    const { xpub, xpriv } = generateSeedWordsKey(seedWords, NetworkType.TESTNET, true);
    if (seedWordsKey.xpub !== xpub) throw new Error('Invalid mnemonic; xpub mismatch');
    const { signedSerializedPSBT: seedKeySignedSerializedPSBT } =
      WalletOperations.internallySignVaultPSBT(
        vault,
        serializedPSBTEnvelops[seedKeyEnvelopIndex].serializedPSBT,
        { ...seedWordsKey, xpriv }
      );

    expect(seedKeySignedSerializedPSBT).toBeDefined();
    serializedPSBTEnvelops[seedKeyEnvelopIndex] = {
      ...serializedPSBTEnvelops[seedKeyEnvelopIndex],
      serializedPSBT: seedKeySignedSerializedPSBT,
    };
  });

  test('should construct and broadcast transaction using transferST3', async () => {
    const broadcastSpy = jest
      .spyOn(WalletOperations, 'broadcastTransaction')
      .mockResolvedValue('87e91c91d0b663f83d416f1c5b39786cc27fe9a5a5da4c24d391926648b4a868'); // mocking transaction broadcast to avoid subsequent broadcast failure
    const { txid } = await WalletOperations.transferST3(
      vault,
      serializedPSBTEnvelops, // signature 2 of 3
      txPrerequisites,
      txnPriority,
      null,
      null,
      miniscriptTxElements
    );
    expect(txid).toEqual('87e91c91d0b663f83d416f1c5b39786cc27fe9a5a5da4c24d391926648b4a868');
    broadcastSpy.mockRestore();
  });

  test('should perform a transaction w/ Inheritance Key once phase 2 is activated(timeout expires)', async () => {
    const miniscriptTxElements = { selectedPhase: 2, selectedPaths: [1] }; // 1st phase of the vault: w/o timelock and inheritance key
    const res = await WalletOperations.transferST2(
      vault,
      currentBlockHeight,
      txPrerequisites,
      txnPriority,
      null,
      signerMap,
      miniscriptTxElements
    );
    const serializedPSBTEnvelops = (res as any).serializedPSBTEnvelops;
    expect(res.cachedTxid).toEqual(expect.any(String));
    expect(serializedPSBTEnvelops.length).toBe(4); // 4 signers: mobileKey, seedWordsKey, signingServerKey, seedWordsKeyInheritance

    // sign transaction w/ mobile key
    const mobileKeyEnvelopIndex = serializedPSBTEnvelops.findIndex(
      (envelop) => envelop.signerType === SignerType.MOBILE_KEY
    );
    expect(mobileKeyEnvelopIndex).toBeGreaterThanOrEqual(0);

    const { signedSerializedPSBT: mobileKeySignedSerializedPSBT } =
      WalletOperations.internallySignVaultPSBT(
        vault,
        serializedPSBTEnvelops[mobileKeyEnvelopIndex].serializedPSBT,
        mobileKey
      );
    expect(mobileKeySignedSerializedPSBT).toBeDefined();
    serializedPSBTEnvelops[mobileKeyEnvelopIndex] = {
      ...serializedPSBTEnvelops[mobileKeyEnvelopIndex],
      serializedPSBT: mobileKeySignedSerializedPSBT,
    };

    // sign transaction w/ seed words - inheritance key
    const seedKeyEnvelopIndexes = [];
    serializedPSBTEnvelops.forEach((envelop, idx) => {
      if (envelop.signerType === SignerType.SEED_WORDS) {
        seedKeyEnvelopIndexes.push(idx);
      }
    });
    const seedKeyInheritanceIndex = seedKeyEnvelopIndexes[1]; // Inheritance Key
    expect(seedKeyInheritanceIndex).toBeGreaterThanOrEqual(0);

    const { xpub, xpriv } = generateSeedWordsKey(seedWordsInheritance, NetworkType.TESTNET, true);
    if (seedWordsKeyInheritance.xpub !== xpub) throw new Error('Invalid mnemonic; xpub mismatch');
    const { signedSerializedPSBT: seedKeySignedSerializedPSBT } =
      WalletOperations.internallySignVaultPSBT(
        vault,
        serializedPSBTEnvelops[seedKeyInheritanceIndex].serializedPSBT,
        { ...seedWordsKeyInheritance, xpriv }
      );

    expect(seedKeySignedSerializedPSBT).toBeDefined();
    serializedPSBTEnvelops[seedKeyInheritanceIndex] = {
      ...serializedPSBTEnvelops[seedKeyInheritanceIndex],
      serializedPSBT: seedKeySignedSerializedPSBT,
    };

    // broadcast transaction
    const broadcastSpy = jest
      .spyOn(WalletOperations, 'broadcastTransaction')
      .mockResolvedValue('87e91c91d0b663f83d416f1c5b39786cc27fe9a5a5da4c24d391926648b4a868'); // mocking transaction broadcast to avoid subsequent broadcast failure
    const { txid } = await WalletOperations.transferST3(
      vault,
      serializedPSBTEnvelops, // signature 2 of 3 (mobile + inheritance key)
      txPrerequisites,
      txnPriority,
      null,
      null,
      miniscriptTxElements
    );
    expect(txid).toEqual('87e91c91d0b663f83d416f1c5b39786cc27fe9a5a5da4c24d391926648b4a868');
    broadcastSpy.mockRestore();
  });
});

describe('Descriptor Parsing and Generation', () => {
  const generateVaultFromDescriptor = async (
    descriptor: string,
    networkType: NetworkType = NetworkType.TESTNET
  ) => {
    const parsed = parseTextforVaultConfig(descriptor);

    const vaultSigners: VaultSigner[] = [];
    const signers: Signer[] = [];
    parsed.signersDetails.forEach((config) => {
      const { signer, key } = generateSignerFromMetaData({
        xpub: config.xpub,
        derivationPath: config.path,
        masterFingerprint: config.masterFingerprint,
        signerType: SignerType.UNKOWN_SIGNER,
        storageType: SignerStorage.WARM,
        isMultisig: config.isMultisig,
      });
      vaultSigners.push(key);
      signers.push(signer);
    });

    const vaultInfo: NewVaultInfo = {
      vaultType: parsed.miniscriptElements
        ? VaultType.MINISCRIPT
        : parsed.scheme.n === 1
        ? VaultType.SINGE_SIG
        : VaultType.DEFAULT,
      vaultScheme: parsed.scheme,
      vaultSigners: vaultSigners,
      vaultDetails: {
        name: 'Impoted Vault',
        description: 'Imported Vault from descriptor',
      },
      miniscriptElements: parsed.miniscriptElements,
    };

    const vault = await generateVault({
      type: vaultInfo.vaultType,
      vaultName: vaultInfo.vaultDetails.name,
      vaultDescription: vaultInfo.vaultDetails.description,
      scheme: vaultInfo.vaultScheme,
      signers: vaultSigners,
      networkType,
    });

    return vault;
  };

  test('should parse a valid descriptor correctly', async () => {
    const descriptor =
      'wpkh([ED0DF249/84h/1h/13h]tpubDDFuHLb3bMZBQ4Y8PL2j8dUFqYZTp71C6JHo5tmGHuSr7oJ35C7HMNotFa7WpnghS7kdafgJWpL5zqxN7x1XKcpBpM3muMHRii1wLvCKoYT/<0;1>/*)#g0trtp5p';
    const parsed = parseTextforVaultConfig(descriptor);
    expect(parsed).toEqual({
      isMultisig: false,
      scheme: {
        m: 1,
        n: 1,
      },
      signersDetails: [
        {
          masterFingerprint: 'ED0DF249',
          path: "m/84'/1'/13'",
          xpub: 'tpubDDFuHLb3bMZBQ4Y8PL2j8dUFqYZTp71C6JHo5tmGHuSr7oJ35C7HMNotFa7WpnghS7kdafgJWpL5zqxN7x1XKcpBpM3muMHRii1wLvCKoYT',
        },
      ],
    });
  });

  test('should parse BSMS derivation paths in h and apostrophe notation', () => {
    const bsms =
      "[ABCD1234/48h/1h/0h/2h]tpubexample [EF567890/m/84'/1'/0']tpubexample2";

    expect(WalletUtilities.extractKeysFromBsms(bsms)).toEqual([
      {
        masterFingerprint: 'ABCD1234',
        derivationPath: "m/48'/1'/0'/2'",
        xpub: 'tpubexample',
      },
      {
        masterFingerprint: 'EF567890',
        derivationPath: "m/84'/1'/0'",
        xpub: 'tpubexample2',
      },
    ]);
  });

  test('should return null for an invalid descriptor', () => {
    const invalidDescriptor = 'wpkh([INVALID/84h/1h/13h]invalidxpub/<0;1>/*)#invalid';
    const parsed = parseTextforVaultConfig(invalidDescriptor);
    expect(parsed).toEqual({
      isMultisig: false,
      scheme: {
        m: 1,
        n: 1,
      },
      signersDetails: [null],
    });
  });

  test('should throw an error for unsupported descriptor formats', () => {
    expect(() => parseTextforVaultConfig('unsupported(descriptor)')).toThrow(
      'Data provided does not match supported formats'
    );
  });

  test('should create a single-sig vault using the descriptor and validate the 1st external address', async () => {
    const descriptor =
      'wpkh([ED0DF249/84h/1h/13h]tpubDDFuHLb3bMZBQ4Y8PL2j8dUFqYZTp71C6JHo5tmGHuSr7oJ35C7HMNotFa7WpnghS7kdafgJWpL5zqxN7x1XKcpBpM3muMHRii1wLvCKoYT/<0;1>/*)#g0trtp5p';

    const vault = await generateVaultFromDescriptor(descriptor);
    expect(vault.signers.length).toEqual(1);
    expect(vault.isMultiSig).toEqual(false);
    expect(vault.specs.receivingAddress).toBe('tb1qclvfyg5v9gahygk5la56afevcnpdxt203609gp');
    expect(generateOutputDescriptors(vault)).toBe(descriptor);
  });

  test('should create a multi-sig vault(2-of-3) using the descriptor and validate the 1st external address', async () => {
    const descriptor =
      'wsh(sortedmulti(2,[4192760B/48h/1h/0h/2h]tpubDFCfoi7h1QdAuVVCCBQ8hMdeqcxztV53EB9Qd6cRZ5Tdh94jCPknyhU1mcpCWPzLz2mAVHFdnK1uLKserS1h2sVSJrZvQyghGugQrUpnSrW/<0;1>/*,[AE6E3031/48h/1h/0h/2h]tpubDEbEY1b4Rkaieyi2xUstuVy9ur1be16edv8DrpXqGke2ABqjxoUvxJDLqcdUQmEHyBvgutLwBJ9ciiUijg7cC1A1jKEcxN43xk2W9pMGaCJ/<0;1>/*,[C7D9EAF5/48h/1h/0h/2h]tpubDEFf521xjx9TGwajRXBca5bBRNmr9iqa4xLAAytgZ6weCNKKgErF8qgXFGifgYJGF9zLHvPHK6hZHWxeJd4kMkmqcbBMQmCSfnJmUgeNqJ8/<0;1>/*))#g47ywxzw';

    const vault = await generateVaultFromDescriptor(descriptor);
    expect(vault.signers.length).toEqual(3);
    expect(vault.isMultiSig).toEqual(true);
    expect(vault.specs.receivingAddress).toBe(
      'tb1qfkv399k9knrjysqvfjt0s352c6pun9v4nmh9uxvacsz57m86cyfsz0runl'
    );
    expect(generateOutputDescriptors(vault)).toBe(descriptor);
  });

  test('should create a miniscript vault(2-of-3 + IK) using the descriptor and validate the 1st external address', async () => {
    const descriptor =
      'wsh(or_d(multi(2,[67DE5A35/48h/1h/0h/2h]tpubDFbgR5WkGxwREBbJ987KGmYErPuueGQ1uZnH4b3XthGo6ohwqfYe2uVt24KLewN4yJWMffXvnH5hZ6nPbwz2kWDT9CRidYamWXgXtD4UvrX/<0;1>/*,[C7D9EAF5/48h/1h/0h/2h]tpubDEFf521xjx9TGwajRXBca5bBRNmr9iqa4xLAAytgZ6weCNKKgErF8qgXFGifgYJGF9zLHvPHK6hZHWxeJd4kMkmqcbBMQmCSfnJmUgeNqJ8/<0;1>/*,[4192760B/48h/1h/0h/2h]tpubDFCfoi7h1QdAuVVCCBQ8hMdeqcxztV53EB9Qd6cRZ5Tdh94jCPknyhU1mcpCWPzLz2mAVHFdnK1uLKserS1h2sVSJrZvQyghGugQrUpnSrW/<0;1>/*),and_v(v:thresh(2,pkh([67DE5A35/48h/1h/0h/2h]tpubDFbgR5WkGxwREBbJ987KGmYErPuueGQ1uZnH4b3XthGo6ohwqfYe2uVt24KLewN4yJWMffXvnH5hZ6nPbwz2kWDT9CRidYamWXgXtD4UvrX/<2;3>/*),a:pkh([C7D9EAF5/48h/1h/0h/2h]tpubDEFf521xjx9TGwajRXBca5bBRNmr9iqa4xLAAytgZ6weCNKKgErF8qgXFGifgYJGF9zLHvPHK6hZHWxeJd4kMkmqcbBMQmCSfnJmUgeNqJ8/<2;3>/*),a:pkh([4192760B/48h/1h/0h/2h]tpubDFCfoi7h1QdAuVVCCBQ8hMdeqcxztV53EB9Qd6cRZ5Tdh94jCPknyhU1mcpCWPzLz2mAVHFdnK1uLKserS1h2sVSJrZvQyghGugQrUpnSrW/<2;3>/*),a:pkh([AE6E3031/48h/1h/0h/2h]tpubDEbEY1b4Rkaieyi2xUstuVy9ur1be16edv8DrpXqGke2ABqjxoUvxJDLqcdUQmEHyBvgutLwBJ9ciiUijg7cC1A1jKEcxN43xk2W9pMGaCJ/<0;1>/*)),after(85844))))#th8ln8u6';

    const vault = await generateVaultFromDescriptor(descriptor);
    expect(vault.signers.length).toEqual(4);
    expect(vault.isMultiSig).toEqual(true);
    expect(vault.specs.receivingAddress).toBe(
      'tb1q5p9p2dcnvnkarnv594j9cfh3es6s79lfenswef7smt5q273d267qglh94h'
    );
    expect(generateOutputDescriptors(vault)).toBe(descriptor);
  });

  test('should create a miniscript vault(2-of-3 + IK + EK) using the descriptor and validate the 1st external address', async () => {
    const descriptor =
      'wsh(or_d(multi(2,[4192760B/48h/1h/0h/2h]tpubDFCfoi7h1QdAuVVCCBQ8hMdeqcxztV53EB9Qd6cRZ5Tdh94jCPknyhU1mcpCWPzLz2mAVHFdnK1uLKserS1h2sVSJrZvQyghGugQrUpnSrW/<0;1>/*,[67DE5A35/48h/1h/0h/2h]tpubDFbgR5WkGxwREBbJ987KGmYErPuueGQ1uZnH4b3XthGo6ohwqfYe2uVt24KLewN4yJWMffXvnH5hZ6nPbwz2kWDT9CRidYamWXgXtD4UvrX/<0;1>/*,[CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<0;1>/*),or_i(and_v(v:pkh([C7D9EAF5/48h/1h/0h/2h]tpubDEFf521xjx9TGwajRXBca5bBRNmr9iqa4xLAAytgZ6weCNKKgErF8qgXFGifgYJGF9zLHvPHK6hZHWxeJd4kMkmqcbBMQmCSfnJmUgeNqJ8/<0;1>/*),after(85792)),and_v(v:thresh(2,pkh([4192760B/48h/1h/0h/2h]tpubDFCfoi7h1QdAuVVCCBQ8hMdeqcxztV53EB9Qd6cRZ5Tdh94jCPknyhU1mcpCWPzLz2mAVHFdnK1uLKserS1h2sVSJrZvQyghGugQrUpnSrW/<2;3>/*),a:pkh([67DE5A35/48h/1h/0h/2h]tpubDFbgR5WkGxwREBbJ987KGmYErPuueGQ1uZnH4b3XthGo6ohwqfYe2uVt24KLewN4yJWMffXvnH5hZ6nPbwz2kWDT9CRidYamWXgXtD4UvrX/<2;3>/*),a:pkh([CB6FE460/48h/1h/123h/2h]tpubDFJbyzFGfyGhwjc2CP7YHjD3hK53AoQWU2Q5eABX2VXcnEBxWVVHjtZhzg9PQLnoHe6iKjR3TamW3N9RVAY5WBbK5DBAs1D86wi2DEgMwpN/<2;3>/*),a:pkh([AE6E3031/48h/1h/0h/2h]tpubDEbEY1b4Rkaieyi2xUstuVy9ur1be16edv8DrpXqGke2ABqjxoUvxJDLqcdUQmEHyBvgutLwBJ9ciiUijg7cC1A1jKEcxN43xk2W9pMGaCJ/<0;1>/*)),after(85768)))))#04p4zsc7';

    const vault = await generateVaultFromDescriptor(descriptor);
    expect(vault.signers.length).toEqual(5);
    expect(vault.isMultiSig).toEqual(true);
    expect(vault.specs.receivingAddress).toBe(
      'tb1qe52qy39s7p7uu4zyhljqx56x4wpze63h5n2hc6xt33zp9fzfvptsw3eavt'
    );
    expect(generateOutputDescriptors(vault)).toBe(descriptor);
  });

  test('should create a multi-sig vault with mixed derivation paths (e.g. m/48 and m/84)', async () => {
    const mnemonics = [
      'result pink oyster iron journey social winter pattern cricket core leader behave',
      'frozen myself eternal matter attract frost slogan buffalo liberty another private twelve',
      'keen credit hold warfare nasty address poverty roast novel ranch system nasty',
      'absent beauty three bronze reduce runway oil girl decide juice point cruel',
      'galaxy wealth badge cloud educate inquiry member timber shaft promote symptom sting',
      'congress judge talent affair client lift dash canal utility among spin tube',
      'grass journey few toilet rhythm day provide decline position weapon pave monitor',
    ];
    const keyExpressions = mnemonics.map((mnemonic, index) => {
      const key = generateSeedWordsKey(
        mnemonic,
        NetworkType.TESTNET,
        index !== mnemonics.length - 1
      );
      return `[${key.masterFingerprint}/${key.derivationPath
        .substring(2)
        .replaceAll("'", 'h')}]${key.xpub}/<0;1>/*`;
    });
    const descriptor = `wsh(sortedmulti(4,${keyExpressions.join(',')}))`;

    const vault = await generateVaultFromDescriptor(descriptor);
    expect(vault.signers.length).toEqual(7);
    expect(vault.isMultiSig).toEqual(true);
    expect(vault.signers.some((signer) => signer.derivationPath === "m/84'/1'/0'")).toBe(true);
    expect(generateOutputDescriptors(vault, false, false)).toBe(descriptor);
  });

  test('should reject a non-standard derivation path for a single-sig vault', async () => {
    const key = generateSeedWordsKey(
      'midnight auction hello stereo such fault legal outdoor manual recycle derive like',
      NetworkType.TESTNET,
      false
    );

    await expect(
      generateVault({
        type: VaultType.SINGE_SIG,
        vaultName: 'Imported wallet',
        vaultDescription: 'Imported wallet',
        scheme: { m: 1, n: 1 },
        signers: [
          {
            ...key,
            xfp: key.masterFingerprint,
            derivationPath: "m/49'/1'/0'",
          },
        ],
        networkType: NetworkType.TESTNET,
      })
    ).rejects.toThrow('Invalid derivation path for signer');
  });
});
