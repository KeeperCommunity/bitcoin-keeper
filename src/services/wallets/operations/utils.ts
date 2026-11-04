/* eslint-disable prefer-destructuring */

import * as bip39 from 'bip39';
import * as bitcoinJS from 'bitcoinjs-lib';
import varuint from 'varuint-bitcoin';
import { PsbtInput } from 'bip174/src/lib/interfaces';

import { CryptoAccount, CryptoHDKey } from 'src/services/qr/bc-ur-registry';
import ECPairFactory, { ECPairInterface } from 'ecpair';

import bip21 from 'bip21';
import bs58check from 'bs58check';
import { isTestnet } from 'src/constants/Bitcoin';
import config from 'src/utils/service-utilities/config';
import BIP32Factory, { BIP32Interface } from 'bip32';
import RestClient from 'src/services/rest/RestClient';
import ElectrumClient from 'src/services/electrum/client';
import { AddressCache, AddressPubs, Wallet } from '../interfaces/wallet';
import { MiniscriptScheme, MultisigConfig, Signer, Vault } from '../interfaces/vault';
import {
  BIP48ScriptTypes,
  MultisigScriptType,
  DerivationPurpose,
  EntityKind,
  ImportedKeyType,
  NetworkType,
  PaymentInfoKind,
  ScriptTypes,
  XpubTypes,
} from '../enums';
import { OutputUTXOs } from '../interfaces';
import ecc from './taproot-utils/noble_ecc';
import { generateBitcoinScript } from './miniscript/miniscript';
import { store } from 'src/store/store';

bitcoinJS.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

export default class WalletUtilities {
  static getNetworkByType = (type: NetworkType) => {
    if (type === NetworkType.TESTNET) return bitcoinJS.networks.testnet;
    return bitcoinJS.networks.bitcoin;
  };

  static getFingerprintFromNode = (node) => {
    let fingerprintHex = node.fingerprint.toString('hex');
    while (fingerprintHex.length < 8) fingerprintHex = `0${fingerprintHex}`;
    return fingerprintHex.toUpperCase();
  };

  static getFingerprintFromSeed = (seed: Buffer) => {
    const root = bip32.fromSeed(seed);
    return WalletUtilities.getFingerprintFromNode(root);
  };

  static getMasterFingerprintFromMnemonic(mnemonic: string, passphrase?: string) {
    const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
    return WalletUtilities.getFingerprintFromSeed(seed);
  }

  static getMasterFingerprintForWallet(wallet: Wallet) {
    return wallet.id;
  }

  static getFingerprintFromExtendedKey = (
    extendedKey: string,
    network: bitcoinJS.networks.Network
  ) => {
    const node = bip32.fromBase58(extendedKey, network);
    return WalletUtilities.getFingerprintFromNode(node);
  };

  static getDerivationPath = (
    isMultisig: boolean,
    type: NetworkType,
    accountNumber: number = 0,
    purpose: DerivationPurpose = DerivationPurpose.BIP84,
    scriptType: BIP48ScriptTypes = BIP48ScriptTypes.NATIVE_SEGWIT // TODO: No call to the function passes scriptType, should consider to remove
  ): string => {
    const isTestnet = type === NetworkType.TESTNET ? 1 : 0;
    if (isMultisig) {
      const scriptNum = scriptType === BIP48ScriptTypes.NATIVE_SEGWIT ? 2 : 1;
      return `m/${DerivationPurpose.BIP48}'/${isTestnet}'/${accountNumber}'/${scriptNum}'`;
    }
    return `m/${purpose}'/${isTestnet}'/${accountNumber}'`;
  };

  static getPurpose = (derivationPath: string): DerivationPurpose => {
    const purpose = parseInt(derivationPath.split('/')[1], 10);
    switch (purpose) {
      case DerivationPurpose.BIP86:
        return DerivationPurpose.BIP86;

      case DerivationPurpose.BIP84:
        return DerivationPurpose.BIP84;

      case DerivationPurpose.BIP48:
        return DerivationPurpose.BIP48;

      default:
        throw new Error(`Unsupported derivation type, purpose: ${purpose}`);
    }
  };

  public static getSingleKeyDerivationPurpose(wallet: Wallet | Vault) {
    let purpose;
    if (wallet.entityKind === EntityKind.WALLET)
      purpose = WalletUtilities.getPurpose((wallet as Wallet)?.derivationDetails?.xDerivationPath);
    else if (wallet.entityKind === EntityKind.VAULT) {
      if ((wallet as Vault).isMultiSig || (wallet as Vault).signers.length !== 1) {
        throw Error(
          `Error getting single key wallet purpose. Expected single key but received multisig.`
        );
      }
      purpose = WalletUtilities.getPurpose((wallet as Vault).signers[0].derivationPath);
    }

    if (!purpose || purpose === DerivationPurpose.BIP48) {
      throw Error(`Error getting single key wallet purpose. Unsupported derivation.`);
    }
    return purpose;
  }

  static getVersionBytesFromPurpose = (
    purpose: DerivationPurpose,
    network: bitcoinJS.networks.Network
  ) => {
    switch (purpose) {
      case DerivationPurpose.BIP84:
      case DerivationPurpose.BIP86:
        return network === bitcoinJS.networks.bitcoin ? '04b24746' : '045f1cf6'; // zpub/vpub
      default:
        // ypub upub not supported
        throw new Error(`Unsupported derivation type, purpose: ${purpose}`);
    }
  };

  static toXOnly = (pubKey) => (pubKey.length === 32 ? pubKey : pubKey.slice(1, 33));

  static deriveSingleKeyAddressFromKeyPair = (
    keyPair: ECPairInterface | BIP32Interface,
    network: bitcoinJS.Network,
    purpose: DerivationPurpose
  ): string => {
    if (purpose === DerivationPurpose.BIP86) {
      return bitcoinJS.payments.p2tr({
        internalPubkey: WalletUtilities.toXOnly(keyPair.publicKey),
        network,
      }).address;
    }
    if (purpose === DerivationPurpose.BIP84) {
      return bitcoinJS.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network,
      }).address;
    }

    throw new Error("Unsupported derivation purpose, can't derive address");
  };

  static fetchCurrentBlockHeight = async () => {
    const { bitcoinNetworkType } = store.getState().settings;
    try {
      const height = (await ElectrumClient.getBlockchainHeaders()).height;
      if (height) {
        return { currentBlockHeight: height };
      } else {
        console.error('Failed to fetch current block height');
        return { currentBlockHeight: null };
      }
    } catch {
      try {
        const endpoint =
          bitcoinNetworkType === NetworkType.MAINNET
            ? 'https://mempool.space/api/blocks/tip/height'
            : 'https://mempool.space/testnet4/api/blocks/tip/height';

        const res = await RestClient.get(endpoint);
        const currentBlockHeight = res.data;

        return { currentBlockHeight };
      } catch (error) {
        console.error('Failed to fetch current block height');
        return { currentBlockHeight: null };
      }
    }
  };

  static fetchCurrentMedianTime = async () => {
    const { bitcoinNetworkType } = store.getState().settings;

    try {
      const endpoint =
        bitcoinNetworkType === NetworkType.MAINNET
          ? 'https://mempool.space/api/blocks/tip'
          : 'https://mempool.space/testnet4/api/blocks/tip';

      const res = await RestClient.get(endpoint);
      const currentMedianTime = res.data[0].mediantime;

      return { currentMedianTime };
    } catch (error) {
      console.error('Failed to fetch current median time');
      return { currentMedianTime: Math.floor(Date.now() / 1000) };
    }
  };

  static generateCustomScript = (
    miniscriptScheme: MiniscriptScheme,
    isInternal: boolean,
    childIndex: number,
    network: bitcoinJS.networks.Network
  ): {
    script: Buffer;
    subPaths: {
      [xpub: string]: number[];
    };
    signerPubkeyMap: Map<string, Buffer>;
  } => {
    const subPaths = {};
    const signerPubkeyMap = new Map<string, Buffer>();

    const { miniscript, miniscriptElements, keyInfoMap } = miniscriptScheme;
    const { timelocks } = miniscriptElements;

    // generate asm from miniscript
    // eslint-disable-next-line prefer-const
    let { asm, issane } = generateBitcoinScript(miniscript);
    if (!issane) throw new Error('ASM is not sane - incorrect miniscript');

    // generate public keys to replace the key identifiers
    const identifiersToPublicKey = {};
    for (const keyIdentifier in keyInfoMap) {
      const fragments = keyInfoMap[keyIdentifier].split('/');
      const multipathIndex = fragments[5];
      const [_, xpub] = fragments[4].split(']');
      const multipathFragments = multipathIndex.split(';');
      const externalChainIndex = multipathFragments[0].slice(1);
      const internalChainIndex = multipathFragments[1].slice(0, -1);
      const subPath = [
        parseInt(isInternal ? internalChainIndex : externalChainIndex, 10),
        childIndex,
      ];
      const xKey = bip32.fromBase58(xpub, network);
      const childXKey = xKey.derive(subPath[0]).derive(subPath[1]);
      identifiersToPublicKey[keyIdentifier] = childXKey.publicKey;
      subPaths[xpub + multipathIndex] = subPath;
      signerPubkeyMap.set(xpub + multipathIndex, childXKey.publicKey);
    }

    // replace identifiers in the asm with actual public keys
    for (const keyIdentifier in identifiersToPublicKey) {
      const publicKey = identifiersToPublicKey[keyIdentifier];
      asm = asm.replace(`<${keyIdentifier}>`, publicKey.toString('hex'));
      asm = asm.replace(
        `<HASH160(${keyIdentifier})>`,
        bitcoinJS.crypto.hash160(publicKey).toString('hex')
      );
    }

    // prepare and enrich the time locks
    for (const tl of timelocks) {
      const encodedTL = bitcoinJS.script.number.encode(tl).toString('hex');
      asm = asm.replace(`<${encodedTL}>`, encodedTL);
    }

    // Convert small integers to OP codes
    asm = asm
      .split(' ')
      .map((token) => {
        if (token.length <= 2) {
          // prevents the code from attempting to parse longer strings(like public keys) as integers
          const num = parseInt(token);
          if (!isNaN(num) && num >= 0 && num <= 16) {
            return `OP_${num}`;
          }
        }
        return token;
      })
      .join(' ');

    const script = bitcoinJS.script.fromASM(asm);
    return { script, subPaths, signerPubkeyMap };
  };

  static getFinalScriptsForMyCustomScript(
    keysInfoMap: { [uniqueIdentifier: string]: string },
    scriptWitnesses: {
      asm: string;
      nLockTime?: number;
      nSequence?: number;
    }[],
    selectedWitness?: {
      asm: string;
      nLockTime?: number;
      nSequence?: number;
    }
  ): any {
    const finalScriptsFunc = (
      inputIndex: number,
      input: PsbtInput,
      script: Buffer,
      isSegwit: boolean,
      isP2SH: boolean,
      isP2WSH: boolean
    ): {
      finalScriptSig: Buffer | undefined;
      finalScriptWitness: Buffer | undefined;
    } => {
      // Step 1: Check to make sure the meaningful script matches what you expect.
      const decompiled = bitcoinJS.script.decompile(script);
      if (!decompiled) throw new Error(`Can not finalize input #${inputIndex}`);

      // const isMiniscriptBasedScript =
      //   decompiled[1] === bitcoinJS.opcodes.OP_CHECKSIG &&
      //   decompiled[2] === bitcoinJS.opcodes.OP_NOTIF &&
      //   decompiled[decompiled.length - 1] === bitcoinJS.opcodes.OP_ENDIF;
      // if (!isMiniscriptBasedScript) {
      //   throw new Error(`Can not finalize input #${inputIndex}, invalid script`);
      // }

      // Step 2: Map signatures and generate the witness stack for the given satisfier
      const keyInfo = {};
      for (const partialSig of input.partialSig) {
        const partialSigPubkey = partialSig.pubkey.toString('hex');
        for (const bip32Derivation of input.bip32Derivation) {
          const pubkeyHex = bip32Derivation.pubkey.toString('hex');
          if (!keyInfo[pubkeyHex]) keyInfo[pubkeyHex] = bip32Derivation;

          if (partialSigPubkey === pubkeyHex) {
            keyInfo[pubkeyHex] = {
              ...keyInfo[pubkeyHex],
              ...partialSig,
              hasPartialSig: true,
            };
          }
        }
      }

      const signatureIdentifier = {};
      const pubKeyIdentifier = {};
      for (const keyIdentifier in keysInfoMap) {
        const fragments = keysInfoMap[keyIdentifier].split('/');
        const masterFingerprint = fragments[0].slice(1);
        const multipathIndex = fragments[5];
        const multipathFragments = multipathIndex.split(';');
        const externalChainIndex = multipathFragments[0].slice(1);
        const internalChainIndex = multipathFragments[1].slice(0, -1);

        /* Note: for a stricter check, we can also derive pubkey from xpub to match w/ partial sig pub
         const [script_type, xpub] = fragments[4].split(']');
         const xpubPath = `m/${fragments[1]}/${fragments[2]}/${fragments[3]}/${script_type}`;
         */

        for (const key in keyInfo) {
          const info = keyInfo[key];
          if (info.masterFingerprint.toString('hex').toUpperCase() === masterFingerprint) {
            // signer identified (note: a signer can have multiple keys(multipath))
            const inputPath = info.path.split('/'); // external/internal chain index
            const chainIndex = inputPath[inputPath.length - 2];
            if (chainIndex === externalChainIndex || chainIndex === internalChainIndex) {
              if (info.hasPartialSig) signatureIdentifier[`<sig(${keyIdentifier})>`] = info;
              else pubKeyIdentifier[`<${keyIdentifier}>`] = info;
              break;
            }
          }
        }
      }

      // if selectedWitness is empty, find the appropriate witness(case: Timelock vault)
      if (!selectedWitness) {
        selectedWitness = scriptWitnesses.find((witness) => {
          const requiredSignatures = witness.asm.match(/<sig\([^)]+\)>/g) || [];
          return requiredSignatures.every((sig) => signatureIdentifier[sig]);
        });

        if (!selectedWitness) {
          throw new Error('No suitable witness found for the available signatures');
        }
      }

      const witnessScriptStack = [];
      for (const fragment of selectedWitness.asm.split(' ')) {
        if (fragment === '0') witnessScriptStack.push(bitcoinJS.opcodes.OP_0);
        else if (fragment === '1') witnessScriptStack.push(bitcoinJS.opcodes.OP_1);
        else {
          let found = false;
          for (const identifier in keysInfoMap) {
            if (fragment === `<sig(${identifier})>`) {
              witnessScriptStack.push(signatureIdentifier[`<sig(${identifier})>`].signature);
              found = true;
              break;
            }

            if (fragment === `<${identifier}>`) {
              witnessScriptStack.push(
                (signatureIdentifier[`<sig(${identifier})>`] || pubKeyIdentifier[`<${identifier}>`])
                  .pubkey
              );
              found = true;
              break;
            }
          }

          if (!found) throw new Error(`Invalid asm fragment ${fragment}`);
        }
      }

      // Step 3: Create final scripts
      const { bitcoinNetwork: network } = store.getState().settings;
      let payment: bitcoinJS.Payment = {
        network,
        output: script,
        // This logic should be more strict and make sure the pubkeys in the
        // meaningful script are the ones signing in the PSBT etc.
        input: bitcoinJS.script.compile(witnessScriptStack),
      };
      if (isP2WSH && isSegwit) {
        payment = bitcoinJS.payments.p2wsh({
          network,
          redeem: payment,
        });
      }
      if (isP2SH) {
        payment = bitcoinJS.payments.p2sh({
          network,
          redeem: payment,
        });
      }

      function witnessStackToScriptWitness(witness: Buffer[]): Buffer {
        let buffer = Buffer.allocUnsafe(0);

        function writeSlice(slice: Buffer): void {
          buffer = Buffer.concat([buffer, Buffer.from(slice)]);
        }

        function writeVarInt(i: number): void {
          const currentLen = buffer.length;
          const varintLen = varuint.encodingLength(i);

          buffer = Buffer.concat([buffer, Buffer.allocUnsafe(varintLen)]);
          varuint.encode(i, buffer, currentLen);
        }

        function writeVarSlice(slice: Buffer): void {
          writeVarInt(slice.length);
          writeSlice(slice);
        }

        function writeVector(vector: Buffer[]): void {
          writeVarInt(vector.length);
          vector.forEach(writeVarSlice);
        }

        writeVector(witness);

        return buffer;
      }

      return {
        finalScriptSig: payment.input,
        finalScriptWitness:
          payment.witness && payment.witness.length > 0
            ? witnessStackToScriptWitness(payment.witness)
            : undefined,
      };
    };

    return finalScriptsFunc;
  }

  static deriveMultiSig = (
    wallet: Vault,
    multisigConfig: MultisigConfig,
    network: bitcoinJS.Network,
    scriptType: BIP48ScriptTypes = BIP48ScriptTypes.NATIVE_SEGWIT
  ): {
    p2wsh: bitcoinJS.payments.Payment;
    p2sh: bitcoinJS.payments.Payment | undefined;
    subPaths: { [xpub: string]: number[] };
    signerPubkeyMap: Map<string, Buffer>;
    orderPreservedPubkeys?: string[];
  } => {
    if (multisigConfig.multisigScriptType === MultisigScriptType.DEFAULT_MULTISIG) {
      if (!multisigConfig.required) {
        throw new Error('Invalid multisig config');
      }

      const subPaths = {};
      const signerPubkeyMap = new Map<string, Buffer>();
      const { internal, childIndex } = multisigConfig;

      let orderPreservedPubkeys: string[] = []; // non-bip-67(original order)
      let pubkeys: Buffer[] = []; // bip-67 ordered

      const { xpubs } = wallet.specs;
      xpubs.forEach(
        (xpub) => (subPaths[xpub] = [internal ? 1 : 0, childIndex]) // same for all xpubs in default multisig
      );

      const addressCache: AddressCache = {
        external: wallet.specs.addresses?.external || {},
        internal: wallet.specs.addresses?.internal || {},
      };
      const addressPubs: AddressPubs = wallet.specs.addressPubs || {};

      const correspondingAddress = internal
        ? addressCache.internal[childIndex]
        : addressCache.external[childIndex];

      if (addressPubs[correspondingAddress]) {
        // using cached pubkeys to prepare multisig assets
        const cachedPubs = addressPubs[correspondingAddress].split('/'); // non bip-67 compatible(maintains xpub/signer order)
        orderPreservedPubkeys = cachedPubs;
        xpubs.forEach((xpub, i) => {
          signerPubkeyMap.set(xpub, Buffer.from(cachedPubs[i], 'hex'));
        });
        pubkeys = cachedPubs.sort((a, b) => (a > b ? 1 : -1)).map((pub) => Buffer.from(pub, 'hex')); // bip-67 compatible(cached ones are in hex)
      } else {
        // generating pubkeys to prepare multisig assets
        for (let i = 0; i < xpubs.length; i++) {
          const childExtendedKey = WalletUtilities.generateChildFromExtendedKey(
            xpubs[i],
            network,
            childIndex,
            internal
          );
          const xKey = bip32.fromBase58(childExtendedKey, network);
          orderPreservedPubkeys[i] = xKey.publicKey.toString('hex');
          pubkeys[i] = xKey.publicKey;
          signerPubkeyMap.set(xpubs[i], pubkeys[i]); // the order is currently preserved for pubkeys array(non bip-67)
        }
        pubkeys = pubkeys.sort((a, b) => (a.toString('hex') > b.toString('hex') ? 1 : -1)); // bip-67 compatible
      }

      const p2ms = bitcoinJS.payments.p2ms({
        m: multisigConfig.required,
        pubkeys,
        network,
      });

      const p2wsh = bitcoinJS.payments.p2wsh({
        redeem: p2ms,
        network,
      });

      let p2sh;
      if (scriptType === BIP48ScriptTypes.WRAPPED_SEGWIT) {
        // wrap native segwit
        p2sh = bitcoinJS.payments.p2sh({
          redeem: p2wsh,
          network,
        });
      }

      return { p2wsh, p2sh, subPaths, signerPubkeyMap, orderPreservedPubkeys };
    } else if (multisigConfig.multisigScriptType === MultisigScriptType.MINISCRIPT_MULTISIG) {
      if (!multisigConfig.miniscriptScheme) {
        throw new Error('Invalid multisig config - miniscript scheme missing');
      }

      const { internal, childIndex } = multisigConfig;
      const { script, subPaths, signerPubkeyMap } = WalletUtilities.generateCustomScript(
        multisigConfig.miniscriptScheme,
        internal,
        childIndex,
        network
      );

      const p2wsh = bitcoinJS.payments.p2wsh({
        redeem: {
          output: script,
          network,
        },
      });

      let p2sh;
      if (scriptType === BIP48ScriptTypes.WRAPPED_SEGWIT) {
        // wrap native segwit
        p2sh = bitcoinJS.payments.p2sh({
          redeem: p2wsh,
          network,
        });
      }

      return { p2wsh, p2sh, subPaths, signerPubkeyMap };
    } else throw new Error('Invalid multisig type');
  };

  static isValidAddress = (address: string, network: bitcoinJS.Network): boolean => {
    try {
      bitcoinJS.address.toOutputScript(address, network);
      return true;
    } catch (err) {
      return false;
    }
  };

  static getKeyPairByIndex = (
    xpriv: string,
    chainIndex: number,
    childIndex: number,
    network: bitcoinJS.networks.Network
  ): BIP32Interface => {
    const node = bip32.fromBase58(xpriv, network);
    const keyPair: BIP32Interface = node.derive(chainIndex).derive(childIndex);
    return keyPair;
  };

  static getPublicKeyByIndex = (
    xpub: string,
    chainIndex: number,
    childIndex: number,
    network: bitcoinJS.networks.Network
  ): { publicKey: Buffer; subPath: number[] } => {
    const node = bip32.fromBase58(xpub, network);
    const keyPair: BIP32Interface = node.derive(chainIndex).derive(childIndex);
    const { publicKey } = keyPair;
    return { publicKey, subPath: [chainIndex, childIndex] };
  };

  static getSingleKeyAddressByIndex = (
    xpub: string,
    internal: boolean,
    index: number,
    network: bitcoinJS.networks.Network,
    purpose?: DerivationPurpose
  ): string => {
    const node = bip32.fromBase58(xpub, network);
    const keyPair = node.derive(internal ? 1 : 0).derive(index);
    return WalletUtilities.deriveSingleKeyAddressFromKeyPair(keyPair, network, purpose);
  };

  static getAddressAndPubByIndex = (
    xpub: string,
    internal: boolean,
    index: number,
    network: bitcoinJS.networks.Network,
    purpose?: DerivationPurpose
  ): { address: string; pub: string } => {
    const node = bip32.fromBase58(xpub, network);
    const keyPair = node.derive(internal ? 1 : 0).derive(index);
    return {
      address: WalletUtilities.deriveSingleKeyAddressFromKeyPair(keyPair, network, purpose),
      pub: keyPair.publicKey.toString('hex'),
    };
  };

  static generateExtendedKey = (
    mnemonic: string,
    privateKey: boolean,
    network: bitcoinJS.networks.Network,
    derivationPath: string,
    passphrase?: string
  ) => {
    const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
    const root = bip32.fromSeed(seed, network);
    const child = privateKey
      ? root.derivePath(derivationPath)
      : root.derivePath(derivationPath).neutered();
    const xKey = child.toBase58();
    return xKey;
  };

  static generateExtendedKeyPairFromSeed = (
    seed: string,
    network: bitcoinJS.networks.Network,
    derivationPath: string
  ) => {
    const root = bip32.fromSeed(Buffer.from(seed, 'hex'), network);
    const raw_xPriv = root.derivePath(derivationPath);
    const raw_xPub = raw_xPriv.neutered();

    const xpriv = raw_xPriv.toBase58();
    const xpub = raw_xPub.toBase58();
    return {
      xpriv,
      xpub,
    };
  };

  static generateChildFromExtendedKey = (
    extendedKey: string,
    network: bitcoinJS.networks.Network,
    childIndex: number,
    internal: boolean,
    shouldNotDerive?: boolean
  ) => {
    const xKey = bip32.fromBase58(extendedKey, network);
    let childXKey;
    if (shouldNotDerive) childXKey = xKey.derive(childIndex);
    else childXKey = xKey.derive(internal ? 1 : 0).derive(childIndex);
    return childXKey.toBase58();
  };

  static getPublicExtendedKeyFromPriv = (extendedKey: string): string => {
    const { bitcoinNetwork } = store.getState().settings;
    const xKey = bip32.fromBase58(extendedKey, bitcoinNetwork);
    return xKey.neutered().toBase58();
  };

  static getXpubFromExtendedKey = (extendedKey: string, network: bitcoinJS.Network) => {
    // case: xpub corresponding to supplied ypub/zpub or tpub corresponding to supplied upub/vpub
    let data = bs58check.decode(extendedKey);
    const versionBytes = bitcoinJS.networks.bitcoin === network ? '0488b21e' : '043587cf';
    data = Buffer.concat([Buffer.from(versionBytes, 'hex'), data.slice(4)]);
    return bs58check.encode(data);
  };

  static getExtendedPubKeyFromXpub = (
    xpub: string,
    purpose: DerivationPurpose,
    network: bitcoinJS.Network
  ) => {
    // case: extended pub corresponding to supplied xpub(based on purpose)
    let data = bs58check.decode(xpub);
    const versionBytes = WalletUtilities.getVersionBytesFromPurpose(purpose, network);
    data = Buffer.concat([Buffer.from(versionBytes, 'hex'), data.slice(4)]);
    return bs58check.encode(data);
  };

  static getExtendedPubKeyFromWallet = (wallet: Wallet) => {
    const purpose = WalletUtilities.getPurpose(
      (wallet as Wallet).derivationDetails.xDerivationPath // exists even for imported wallet
    );

    const network = WalletUtilities.getNetworkByType(wallet.networkType);
    return WalletUtilities.getExtendedPubKeyFromXpub(wallet.specs.xpub, purpose, network);
  };

  static addressToPublicKey = (
    address: string,
    wallet: Wallet | Vault,
    externalChainIndex: number = 0,
    internalChainIndex: number = 1
  ): {
    publicKey: Buffer;
    subPath: number[];
  } => {
    const { networkType } = wallet;
    const { totalExternalAddresses, nextFreeChangeAddressIndex } = wallet.specs;
    let xpub = null;

    if (wallet.entityKind === EntityKind.VAULT) {
      if ((wallet as Vault).isMultiSig) throw new Error('MultiSig should use: addressToMultiSig');
      xpub = (wallet as Vault).specs.xpubs[0]; // xpub for vault(1-of-1)
    } else {
      xpub = (wallet as Wallet).specs.xpub;
    }

    const network = WalletUtilities.getNetworkByType(networkType);
    const addressCache: AddressCache = {
      external: wallet.specs.addresses?.external || {},
      internal: wallet.specs.addresses?.internal || {},
    };
    const addressPubs: AddressPubs = wallet.specs.addressPubs || {};

    const closingExtIndex = totalExternalAddresses - 1 + config.GAP_LIMIT;
    for (let itr = 0; itr <= totalExternalAddresses - 1 + closingExtIndex; itr++) {
      if (addressCache.external[itr] === address) {
        if (addressPubs[address]) {
          return {
            publicKey: Buffer.from(addressPubs[address], 'hex'),
            subPath: [0, itr],
          };
        } else return WalletUtilities.getPublicKeyByIndex(xpub, externalChainIndex, itr, network);
      }
    }

    const closingIntIndex = nextFreeChangeAddressIndex + config.GAP_LIMIT;
    for (let itr = 0; itr <= closingIntIndex; itr++) {
      if (addressCache.internal[itr] === address) {
        if (addressPubs[address]) {
          return {
            publicKey: Buffer.from(addressPubs[address], 'hex'),
            subPath: [1, itr],
          };
        } else return WalletUtilities.getPublicKeyByIndex(xpub, internalChainIndex, itr, network);
      }
    }

    throw new Error(`Could not find public key for: ${address}`);
  };

  static addressToKeyPair = (
    address: string,
    wallet: Wallet | Vault,
    externalChainIndex: number = 0,
    internalChainIndex: number = 1
  ): {
    keyPair: BIP32Interface;
  } => {
    const { networkType } = wallet;
    const { totalExternalAddresses, nextFreeChangeAddressIndex } = wallet.specs;
    const xpriv = (wallet as Wallet).specs.xpriv;

    const network = WalletUtilities.getNetworkByType(networkType);
    const addressCache: AddressCache = {
      external: wallet.specs.addresses?.external || {},
      internal: wallet.specs.addresses?.internal || {},
    };

    const closingExtIndex = totalExternalAddresses - 1 + config.GAP_LIMIT;
    for (let itr = 0; itr <= totalExternalAddresses - 1 + closingExtIndex; itr++) {
      if (addressCache.external[itr] === address) {
        return {
          keyPair: WalletUtilities.getKeyPairByIndex(xpriv, externalChainIndex, itr, network),
        };
      }
    }

    const closingIntIndex = nextFreeChangeAddressIndex + config.GAP_LIMIT;
    for (let itr = 0; itr <= closingIntIndex; itr++) {
      if (addressCache.internal[itr] === address) {
        return {
          keyPair: WalletUtilities.getKeyPairByIndex(xpriv, internalChainIndex, itr, network),
        };
      }
    }

    throw new Error(`Could not find public key for: ${address}`);
  };

  static createMultiSig = (
    wallet: Vault,
    childIndex: number,
    internal: boolean,
    scriptType: BIP48ScriptTypes = BIP48ScriptTypes.NATIVE_SEGWIT // TODO: No call to the function passes scriptType, should consider to remove
  ): {
    p2wsh: bitcoinJS.payments.Payment;
    p2sh: bitcoinJS.payments.Payment;
    address: string;
    subPaths: { [xpub: string]: number[] };
    signerPubkeyMap: Map<string, Buffer>;
    orderPreservedPubkeys?: string[];
  } => {
    let config: MultisigConfig;
    const network = WalletUtilities.getNetworkByType(wallet.networkType);
    const multisigScriptType =
      wallet.scheme.multisigScriptType || MultisigScriptType.DEFAULT_MULTISIG;

    if (multisigScriptType === MultisigScriptType.DEFAULT_MULTISIG) {
      config = {
        multisigScriptType,
        required: wallet.scheme.m,
        childIndex,
        internal,
      };
    } else if (multisigScriptType === MultisigScriptType.MINISCRIPT_MULTISIG) {
      const { miniscriptScheme } = wallet.scheme;
      if (!miniscriptScheme) throw new Error('Miniscript scheme missing');
      config = {
        multisigScriptType,
        miniscriptScheme,
        childIndex,
        internal,
      };
    } else throw new Error('Unsupported multisig script type');

    const { p2wsh, p2sh, subPaths, signerPubkeyMap, orderPreservedPubkeys } =
      WalletUtilities.deriveMultiSig(wallet, config, network, scriptType);
    const address = p2sh ? p2sh.address : p2wsh.address;

    return {
      p2wsh,
      p2sh,
      address,
      subPaths,
      signerPubkeyMap,
      orderPreservedPubkeys,
    };
  };

  static addressToMultiSig = (address: string, wallet: Vault) => {
    const { totalExternalAddresses, nextFreeChangeAddressIndex } = wallet.specs;
    const addressCache: AddressCache = {
      external: wallet.specs.addresses?.external || {},
      internal: wallet.specs.addresses?.internal || {},
    };

    const closingExtIndex = totalExternalAddresses - 1 + config.GAP_LIMIT;
    for (let itr = 0; itr <= totalExternalAddresses - 1 + closingExtIndex; itr++) {
      if (addressCache.external[itr] === address) {
        const multiSig = WalletUtilities.createMultiSig(wallet, itr, false);
        return multiSig;
      }
    }

    const closingIntIndex = nextFreeChangeAddressIndex + config.GAP_LIMIT;
    for (let itr = 0; itr <= closingIntIndex; itr++) {
      if (addressCache.internal[itr] === address) {
        const multiSig = WalletUtilities.createMultiSig(wallet, itr, true);
        return multiSig;
      }
    }

    throw new Error(`Could not find multisig for: ${address}`);
  };

  static generatePaymentURI = (
    address: string,
    options?: { amount: number; label?: string; message?: string }
  ): { paymentURI: string } => {
    if (options) {
      return {
        paymentURI: bip21.encode(address, options),
      };
    }
    return {
      paymentURI: bip21.encode(address),
    };
  };

  static decodePaymentURI = (
    paymentURI: string
  ): {
    address: string;
    options: {
      amount?: number;
      label?: string;
      message?: string;
    };
  } => bip21.decode(paymentURI);

  static isPaymentURI = (paymentURI: string): boolean => paymentURI.slice(0, 8) === 'bitcoin:';

  static addressDiff = (scannedStr: string, network: bitcoinJS.Network) => {
    scannedStr = scannedStr.replace('BITCOIN', 'bitcoin');
    if (WalletUtilities.isPaymentURI(scannedStr)) {
      const { address, options } = WalletUtilities.decodePaymentURI(scannedStr);
      if (WalletUtilities.isValidAddress(address, network)) {
        return {
          type: PaymentInfoKind.PAYMENT_URI,
          address,
          amount: options.amount,
          message: options.message,
        };
      }
    } else if (WalletUtilities.isValidAddress(scannedStr, network)) {
      return {
        type: PaymentInfoKind.ADDRESS,
        address: scannedStr,
      };
    }

    return {
      type: null,
    };
  };

  static generateChange = (
    wallet: Wallet | Vault,
    outputs: Array<OutputUTXOs>,
    nextFreeChangeAddressIndex: number,
    network: bitcoinJS.networks.Network
  ):
    | {
        outputs: OutputUTXOs[];
        changeMultisig: {
          p2wsh: bitcoinJS.payments.Payment;
          p2sh: bitcoinJS.payments.Payment;
          address: string;
          subPaths: {
            [xpub: string]: number[];
          };
          signerPubkeyMap: Map<string, Buffer>;
        };
        changeAddress?: string;
      }
    | {
        outputs: OutputUTXOs[];
        changeAddress: string;
        changeMultisig?: any;
      } => {
    let changeMultisig: {
      p2wsh: bitcoinJS.payments.Payment;
      p2sh: bitcoinJS.payments.Payment;
      address: string;
      subPaths: { [xpub: string]: number[] };
      signerPubkeyMap: Map<string, Buffer>;
    };
    if ((wallet as Vault).isMultiSig) {
      changeMultisig = WalletUtilities.createMultiSig(
        wallet as Vault,
        nextFreeChangeAddressIndex,
        true
      );
    }

    for (const output of outputs) {
      // case: change exists
      if (!output.address) {
        if ((wallet as Vault).isMultiSig) {
          output.address = changeMultisig.address;
          return { outputs, changeMultisig };
        }

        let xpub = null;
        if (wallet.entityKind === EntityKind.VAULT) {
          xpub = (wallet as Vault).specs.xpubs[0];
        } else xpub = (wallet as Wallet).specs.xpub;

        let purpose = WalletUtilities.getSingleKeyDerivationPurpose(wallet);

        output.address = WalletUtilities.getSingleKeyAddressByIndex(
          xpub,
          true,
          nextFreeChangeAddressIndex,
          network,
          purpose
        );
        return { outputs, changeAddress: output.address };
      }
    }

    // case: no change
    return { outputs, changeAddress: '' };
  };

  static generateXpubFromMetaData = (cryptoAccount: CryptoAccount) => {
    const version = Buffer.from('02aa7ed3', 'hex');
    const hdKey = cryptoAccount.getOutputDescriptors()[0].getCryptoKey() as CryptoHDKey;
    const depth = hdKey.getOrigin().getDepth();
    const depthBuf = Buffer.alloc(1);
    depthBuf.writeUInt8(depth);
    const parentFingerprint = hdKey.getParentFingerprint();
    const components = hdKey.getOrigin().getComponents();
    const lastComponents = components[components.length - 1];
    const index = lastComponents.isHardened()
      ? lastComponents.getIndex() + 0x80000000
      : lastComponents.getIndex();
    const indexBuf = Buffer.alloc(4);
    indexBuf.writeUInt32BE(index);
    const chainCode = hdKey.getChainCode();
    const key = hdKey.getKey();
    const derivationPath = `m/${hdKey.getOrigin().getPath()}`;
    const xPubBuf = Buffer.concat([version, depthBuf, parentFingerprint, indexBuf, chainCode, key]);
    const xPub = bs58check.encode(xPubBuf);
    const mfp = cryptoAccount.getMasterFingerprint().toString('hex');
    return { xPub, derivationPath, mfp };
  };

  static getSignerPurposeFromPath = (path: string) => {
    const branches = path.split('/');
    const purpose = branches.length > 1 ? branches[1].match(/(\d+)/) : null;
    if (purpose) {
      return purpose[0];
    }
    return null;
  };

  // TODO: This is not correct for taproot multisig, as for P2TR multisig BIP48 should be used
  static getDerivationForScriptType = (scriptType: ScriptTypes, account = 0) => {
    const testnet = isTestnet();
    const networkType = testnet ? 1 : 0;
    switch (scriptType) {
      case ScriptTypes.P2WSH: // multisig native segwit
        return `m/48'/${networkType}'/${account}'/2'`; // bip48 m/purpose'/coin_type'/account'/script_type'/change/address_index
      case ScriptTypes.P2WPKH: // singlesig native segwit
        return `m/84'/${networkType}'/${account}'`;
      case ScriptTypes['P2SH-P2WPKH']: // singlesig wrapped segwit
        return `m/49'/${networkType}'/${account}'`;
      case ScriptTypes['P2SH-P2WSH']: // multisig wrapped segwit
        return `m/48'/${networkType}'/${account}'/1'`;
      case ScriptTypes.P2TR: // Taproot
        return `m/86'/${networkType}'/${account}'`;
      default: // multisig wrapped segwit
        return `m/48'/${networkType}'/${account}'/2'`;
    }
  };

  static getSingleKeyScriptTypeFromPurpose = (purpose: DerivationPurpose) => {
    switch (purpose) {
      case DerivationPurpose.BIP86:
        return ScriptTypes.P2TR;
      case DerivationPurpose.BIP84:
        return ScriptTypes.P2WPKH;
      default:
        throw new Error(`Purpose:${purpose} not supported`);
    }
  };

  static getScriptTypeFromDerivationPath = (derivationPath: string): XpubTypes => {
    const purpose = WalletUtilities.getPurpose(derivationPath);
    switch (purpose) {
      case DerivationPurpose.BIP48:
        return XpubTypes.P2WSH;
      case DerivationPurpose.BIP84:
        return XpubTypes.P2WPKH;
      case DerivationPurpose.BIP86:
        return XpubTypes.P2TR;
      default:
        throw Error('Unsupported derivation');
    }
  };

  static isExtendedPubKey = (keyType: ImportedKeyType) => {
    const { bitcoinNetwork } = store.getState().settings;
    if (bitcoinNetwork === bitcoinJS.networks.bitcoin) {
      return [ImportedKeyType.XPUB, ImportedKeyType.YPUB, ImportedKeyType.ZPUB].includes(keyType);
    } else {
      return [ImportedKeyType.TPUB, ImportedKeyType.UPUB, ImportedKeyType.VPUB].includes(keyType);
    }
  };

  static getImportedKeyType = (input: string): ImportedKeyType => {
    try {
      const { bitcoinNetwork } = store.getState().settings;
      // case: extended keys
      bs58check.decode(input);

      // attempt to create an extended key from the input
      if (bitcoinNetwork === bitcoinJS.networks.bitcoin) {
        // extended public keys (mainnet)
        if (input.startsWith(ImportedKeyType.XPUB)) {
          return ImportedKeyType.XPUB;
        }
        if (input.startsWith(ImportedKeyType.ZPUB)) {
          return ImportedKeyType.ZPUB;
        }
      } else {
        // extended public keys (testnet)
        if (input.startsWith(ImportedKeyType.TPUB)) {
          return ImportedKeyType.TPUB;
        }
        if (input.startsWith(ImportedKeyType.VPUB)) {
          return ImportedKeyType.VPUB;
        }
      }
    } catch (err) {
      throw new Error('Invalid Import Key');
    }
    throw new Error('Key does not match supported formats');
  };

  static getNetworkFromPrefix = (prefix) => {
    switch (prefix) {
      case 'xpub': // 0x0488b21e
      case 'ypub': // 0x049d7cb2
      case 'Ypub': // 0x0295b43f
      case 'zpub': // 0x04b24746
      case 'Zpub': // 0x02aa7ed3
        return NetworkType.MAINNET;
      case 'tpub': // 0x043587cf
      case 'upub': // 0x044a5262
      case 'Upub': // 0x024289ef
      case 'vpub': // 0x045f1cf6
      case 'Vpub': // 0x02575483
        return NetworkType.TESTNET;
      default:
        return null;
    }
  };

  static getInstanceNumberForSigners = (signers: Signer[]) => {
    const instanceNumbers = signers
      .map((signer) => signer.extraData?.instanceNumber)
      .filter(Number.isInteger);

    instanceNumbers.sort((a, b) => a - b);
    let instanceNumber = 0;
    for (const num of instanceNumbers) {
      if (num === instanceNumber + 1) {
        instanceNumber++;
      } else {
        break;
      }
    }
    return instanceNumber;
  };

  static getKeyForScheme = (isMultisig, signer, msXpub, ssXpub, amfXpub) => {
    const { bitcoinNetworkType } = store.getState().settings;
    if (amfXpub) {
      return {
        ...amfXpub,
        masterFingerprint: signer.masterFingerprint,
        xfp: this.getFingerprintFromExtendedKey(
          amfXpub.xpub,
          this.getNetworkByType(bitcoinNetworkType)
        ),
      };
    }
    if (isMultisig) {
      return {
        ...msXpub,
        masterFingerprint: signer.masterFingerprint,
        xfp: this.getFingerprintFromExtendedKey(
          msXpub.xpub,
          this.getNetworkByType(bitcoinNetworkType)
        ),
      };
    } else {
      return {
        ...ssXpub,
        masterFingerprint: signer.masterFingerprint,
        xfp: this.getFingerprintFromExtendedKey(
          ssXpub.xpub,
          this.getNetworkByType(bitcoinNetworkType)
        ),
      };
    }
  };

  static extractKeysFromBsms = (
    bsms: string
  ): { xpub: string; masterFingerprint: string; derivationPath: string }[] => {
    const regex = /\[(\w+)\/([mMhH/\d']+)]([tpub\w]+)/g;
    let match;
    const result = [];

    while ((match = regex.exec(bsms)) !== null) {
      const path = match[2].replace(/[hH]/g, "'");
      result.push({
        masterFingerprint: match[1],
        derivationPath: path.match(/^m\//i) ? path : `m/${path}`,
        xpub: match[3],
      });
    }
    return result;
  };
}
