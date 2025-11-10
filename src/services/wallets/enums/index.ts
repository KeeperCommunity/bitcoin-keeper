export enum DerivationPurpose {
  BIP44 = 44, // P2PKH: legacy, single-sig
  BIP48 = 48, // P2TR & P2WSH & P2SH-P2WSH: taproot / native segwit / wrapped segwit - multi-sig
  BIP49 = 49, // P2SH-P2WPKH: wrapped segwit, single-sg
  BIP84 = 84, // P2WPKH: native segwit, single-sig
  BIP86 = 86, // P2TR: taproot, single-sig
}

export enum BIP48ScriptTypes {
  WRAPPED_SEGWIT = 'WRAPPED_SEGWIT',
  NATIVE_SEGWIT = 'NATIVE_SEGWIT',
}

export enum BIP85Languages {
  ENGLISH = 'english',
  JAPANESE = 'japanese',
  KOREAN = 'korean',
  SPANISH = 'spanish',
  CHINESE_SIMPLIFIED = 'chinese_simplified',
  CHINESE_TRADITIONAL = 'chinese_traditional',
  FRENCH = 'french',
  ITALIAN = 'italian',
  CZECH = 'czech',
}

export enum BIP85Words {
  TWELVE = 12,
  TWENTY_FOUR = 24,
}

export enum TransactionType {
  RECEIVED = 'Received',
  SENT = 'Sent',
}

export enum TxPriorityDefault {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum TxPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CUSTOM = 'custom',
}

export enum NetworkType {
  TESTNET = 'TESTNET',
  MAINNET = 'MAINNET',
}

export enum VisibilityType {
  DEFAULT = 'DEFAULT',
  HIDDEN = 'HIDDEN',
}

export enum EntityKind {
  WALLET = 'WALLET',
  VAULT = 'VAULT',
  USDT_WALLET = 'USDT_WALLET',
}

export enum WalletType {
  DEFAULT = 'DEFAULT',
  IMPORTED = 'IMPORTED',
  PRE_MIX = 'PRE_MIX', // DEPRECATED
  POST_MIX = 'POST_MIX', // DEPRECATED
  BAD_BANK = 'BAD_BANK', // DEPRECATED
}

export enum VaultType {
  DEFAULT = 'DEFAULT',
  COLLABORATIVE = 'COLLABORATIVE',
  ASSISTED = 'ASSISTED', // DEPRECATED
  TIMELOCKED = 'TIMELOCKED', // DEPRECATED
  INHERITANCE = 'INHERITANCE', // DEPRECATED
  CANARY = 'CANARY',
  SINGE_SIG = 'SINGE_SIG',
  MINISCRIPT = 'MINISCRIPT',
}

export enum MiniscriptTypes {
  ASSISTED = 'ASSISTED',
  TIMELOCKED = 'TIMELOCKED',
  INHERITANCE = 'INHERITANCE',
  EMERGENCY = 'EMERGENCY',
}

export enum SignerType {
  TAPSIGNER = 'TAPSIGNER',
  SATOCHIP = 'SATOCHIP',
  KEEPER = 'KEEPER',
  MY_KEEPER = 'MY_KEEPER',
  TREZOR = 'TREZOR',
  LEDGER = 'LEDGER',
  COLDCARD = 'COLDCARD',
  PASSPORT = 'PASSPORT',
  JADE = 'JADE',
  KEYSTONE = 'KEYSTONE',
  POLICY_SERVER = 'POLICY_SERVER',
  MOBILE_KEY = 'MOBILE_KEY',
  SEED_WORDS = 'SEED_WORDS',
  SEEDSIGNER = 'SEEDSIGNER',
  BITBOX02 = 'BITBOX02',
  OTHER_SD = 'OTHER_SD',
  INHERITANCEKEY = 'INHERITANCEKEY', // DEPRECATED
  UNKOWN_SIGNER = 'UNKNOWN_SIGNER',
  SPECTER = 'SPECTER',
  ADVISOR_KEY = 'ADVISOR_KEY',
  PORTAL = 'PORTAL',
  KRUX = 'KRUX',
}

export enum SignerCategory {
  HARDWARE = 'HARDWARE',
  SOFTWARE = 'SOFTWARE',
  ASSISTED = 'ASSISTED',
}

export enum PaymentInfoKind {
  ADDRESS = 'address',
  PAYMENT_URI = 'paymentURI',
}

export enum SignerStorage {
  HOT = 'HOT',
  COLD = 'COLD',
  WARM = 'WARM',
}

export enum ScriptTypes {
  'P2PKH' = 'P2PKH', // legacy
  'P2SH-P2WSH' = 'P2SH-P2WSH', // multisig wrapped segwit
  'P2WSH' = 'P2WSH', // multisig native segwit
  'P2SH-P2WPKH' = 'P2SH-P2WPKH', // singlesig wrapped segwit
  'P2WPKH' = 'P2WPKH', // singlesig native segwit
  'P2TR' = 'P2TR', // Taproot
}

export enum XpubTypes {
  'P2PKH' = 'P2PKH',
  'P2SH-P2WSH' = 'P2SH-P2WSH',
  'P2WSH' = 'P2WSH',
  'P2SH-P2WPKH' = 'P2SH-P2WPKH',
  'P2WPKH' = 'P2WPKH',
  'P2TR' = 'P2TR',
  'AMF' = 'AMF',
}

export enum LabelType {
  SYSTEM = 'SYSTEM',
  USER = 'USER',
}

export enum LabelRefType {
  INPUT = 'INPUT',
  OUTPUT = 'OUTPUT',
  TXN = 'TXN',
  ADDR = 'ADDR',
  PUBKEY = 'PUBKEY',
  XPUB = 'XPUB',
}

export enum ImportedKeyType {
  MNEMONIC = 'mnemonic',

  // Extended Public Keys - MAINNET
  XPUB = 'xpub',
  YPUB = 'ypub',
  ZPUB = 'zpub',

  // Extended Private Keys - MAINNET
  XPRV = 'xprv',
  YPRV = 'yprv',
  ZPRV = 'zprv',

  // Extended Public Keys - TESTNET
  TPUB = 'tpub',
  UPUB = 'upub',
  VPUB = 'vpub',

  // Extended Private Keys - TESTNET
  TPRV = 'tprv',
  UPRV = 'uprv',
  VPRV = 'vprv',
}

export enum KeyGenerationMode {
  NEW = 'NEW',
  IMPORT = 'IMPORT',
  CREATE = 'CREATE',
  NFC = 'NFC',
  FILE = 'File',
  QR = 'QR',
  USB = 'USB',
}

export enum SigningMode {
  NFC = 'NFC',
  FILE = 'File',
  QR = 'QR',
  USB = 'USB',
}

export enum RKInteractionMode {
  SHARE_REMOTE_KEY = 'SHARE_REMOTE_KEY',
  SHARE_PSBT = 'SHARE_PSBT',
  SHARE_SIGNED_PSBT = 'SHARE_SIGNED_PSBT',
}

export enum MultisigScriptType {
  DEFAULT_MULTISIG = 'DEFAULT_MULTISIG',
  MINISCRIPT_MULTISIG = 'MINISCRIPT_MULTISIG',
}

export enum KeyValidationErrorCode {
  MISSING_XPUB = 'MISSING_XPUB',
  INSUFFICIENT_TOTAL_KEYS = 'INSUFFICIENT_TOTAL_KEYS',
  INSUFFICIENT_REQUIRED_KEYS = 'INSUFFICIENT_REQUIRED_KEYS',
  ALREADY_SELECTED = 'ALREADY_SELECTED',
  MOBILE_KEY_NOT_ALLOWED = 'MOBILE_KEY_NOT_ALLOWED',
  EXTERNAL_KEY_SINGLESIG = 'EXTERNAL_KEY_SINGLESIG',
}
