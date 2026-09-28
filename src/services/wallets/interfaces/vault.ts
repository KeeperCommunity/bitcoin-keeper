import { SignerPolicy } from 'src/models/interfaces/AssistedKeys';
import { BIP85Config, Balances, Transaction, UTXO } from '.';
import {
  EntityKind,
  MiniscriptTypes,
  MultisigScriptType,
  NetworkType,
  ScriptTypes,
  SignerStorage,
  SignerType,
  VaultType,
  XpubTypes,
} from '../enums';

import { AddressCache, AddressPubs, WalletPresentationData } from './wallet';
import { KeyInfo, KeyInfoMap, Path, Phase } from '../operations/miniscript/policy-generator';

export interface VaultPresentationData extends WalletPresentationData {}

export interface VaultSpecs {
  xpubs: string[]; // signers' xpubs
  nextFreeAddressIndex: number; // external-chain free address marker
  nextFreeChangeAddressIndex: number; // internal-chain free address marker
  totalExternalAddresses: number; // total number of external addresses the user generated (starts at 1)
  receivingAddress?: string; // current receiving address(external chain)
  addresses?: AddressCache; // cached addresses
  addressPubs?: AddressPubs; // cached pubs
  confirmedUTXOs: UTXO[]; // utxo set available for use
  unconfirmedUTXOs: UTXO[]; // utxos to arrive
  balances: Balances; // confirmed/unconfirmed balances
  transactions: Transaction[]; // transactions belonging to this wallet
  hasNewUpdates: boolean; // spec vars have a new update?
  lastSynched: number; // vault's last sync timestamp
}

export interface MiniscriptElements {
  keysInfo: KeyInfo[]; // identifier and key descriptor
  timelocks: number[]; // timelocks
  phases: Phase[]; // structure for generating miniscript policy
  signerFingerprints: { [identifier: string]: string }; // miniscript signer key_identifier <> MFP
}

export interface MiniscriptTxSelectedSatisfier {
  selectedPhase: Phase;
  selectedPaths: Path[];
  selectedScriptWitness: {
    asm: string;
    nLockTime?: number;
    nSequence?: number;
  };
  selectedScriptWitnesses?: {
    asm: string;
    nLockTime?: number;
    nSequence?: number;
  }[];
}

export interface MiniscriptScheme {
  miniscriptElements: MiniscriptElements;
  keyInfoMap: KeyInfoMap;
  miniscriptPolicy: string; // miniscript policy
  miniscript: string; // miniscript
  usedMiniscriptTypes: MiniscriptTypes[];
}

export interface VaultScheme {
  m: number; // threshold number of signatures required
  n: number; // total number of xpubs
  multisigScriptType?: MultisigScriptType; // multisig script type(allows for more complex and flexible vaults)
  miniscriptScheme?: MiniscriptScheme;
}

export type XpubDetailsType = {
  [key in XpubTypes as string]: { xpub: string; derivationPath: string; xpriv?: string };
};

export type signerXpubs = {
  [key in XpubTypes as string]: { xpub: string; derivationPath: string; xpriv?: string }[];
};

export type SignerExtraData = {
  instanceNumber?: number;
  givenName?: string;
  familyName?: string;
  recordID?: string;
  thumbnailPath?: string;
  bleConnectId?: string; // OneKey BLE connectId for direct reconnection
};

export interface HealthCheckDetails {
  type: string;
  actionDate: Date;
  extraData?: object;
}

export interface Signer {
  // Represents a h/w or s/w wallet(Signer)
  // Rel: Signer hosts multiple VaultSigners(key), diff derivation paths
  id: string;
  type: SignerType;
  storageType: SignerStorage;
  isMock?: boolean;
  masterFingerprint: string;
  signerXpubs: signerXpubs;
  signerName?: string;
  signerDescription?: string;
  healthCheckDetails: HealthCheckDetails[];
  lastHealthCheck: Date;
  addedOn: Date;
  bip85Config?: BIP85Config;
  isBIP85?: boolean; // Assisted Keys+ identifier
  signerPolicy?: SignerPolicy; // Server Key's Signer Policy
  hidden: boolean;
  extraData?: SignerExtraData;
  archived?: boolean;
  isExternal?: boolean;
  linkedViaSecondary?: boolean; // if true, Server Key is relinked using secondary verification
  networkType: NetworkType;
}

export type RegisteredVaultInfo = {
  vaultId: string;
  registered: boolean;
  registrationInfo?: string;
  hmac?: string;
};

export interface VaultSigner {
  // Represents xpub(Extended Key) belonging to one of the Signers,
  // Rel: VaultSigner(Extended Key) could only belong to one Signer, and is an active part of a Vault(s)
  masterFingerprint: string;
  xpub: string;
  xpriv?: string;
  xfp: string;
  derivationPath: string;
  registeredVaults?: RegisteredVaultInfo[];
}

export interface Vault {
  // Represents a Vault
  // Rel: Created using multiple VaultSigners(Extended Keys)
  id: string; // vault identifier(derived from xpub)
  entityKind: EntityKind; // Vault vs Wallet identifier
  type: VaultType; // type of vault
  networkType: NetworkType; // testnet/mainnet
  isMultiSig: boolean; // true
  scheme: VaultScheme; // scheme of vault(m of n)
  signers: VaultSigner[]; // signers of the vault
  presentationData: VaultPresentationData;
  specs: VaultSpecs;
  archived: boolean;
  isMigrating?: boolean;
  archivedId?: string;
  scriptType: ScriptTypes;
  receivingAddress?: string;
}

export interface MultisigConfig {
  multisigScriptType: MultisigScriptType;
  childIndex: number;
  internal: boolean;
  required?: number;
  miniscriptScheme?: MiniscriptScheme;
}
