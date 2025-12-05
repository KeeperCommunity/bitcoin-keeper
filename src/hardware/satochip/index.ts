/* eslint-disable no-await-in-loop */
import {Platform} from 'react-native';
import {SatochipCard} from 'satochip-react-native';
import {captureError} from 'src/services/sentry';
import WalletUtilities from 'src/services/wallets/operations/utils';
import {ScriptTypes, XpubTypes} from 'src/services/wallets/enums';
import {VaultSigner, XpubDetailsType} from 'src/services/wallets/interfaces/vault';
import NFC from 'src/services/nfc';
import {xpubToTpub} from 'src/hardware';

// used to verify signatures
// import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';
// import ECPairFactory from 'ecpair';
// const ECPair = ECPairFactory(ecc);

const getScriptSpecificDetails = async (card, pin, isTestnet, isMultisig, account) => {

  const xpubDetails: XpubDetailsType = {};

  await card.verifyPIN(0, pin);

  // fetch P2WPKH details
  const singleSigPath = WalletUtilities.getDerivationForScriptType(ScriptTypes.P2WPKH, account);

  //const convertedSingleSigPath = singleSigPath.split("'").join('h');
  await card.verifyPIN(0, pin);
  const singleSigExtendedKey = await card.getExtendedKey(singleSigPath);

  let singleSigXpub = await card.getXpub(singleSigPath,'p2wpkh'); // using mainnet
  if (isTestnet) {
    singleSigXpub = xpubToTpub(singleSigXpub);
  }
  xpubDetails[XpubTypes.P2WPKH] = { xpub: singleSigXpub, derivationPath: singleSigPath };

  // fetch P2WSH details
  const multiSigPath = WalletUtilities.getDerivationForScriptType(ScriptTypes.P2WSH, account);

  const multiSigExtendedKey = await card.getExtendedKey(multiSigPath);

  let multiSigXpub = await card.getXpub(multiSigPath,'p2wsh', !isTestnet); // using mainnet
  if (isTestnet) {
    multiSigXpub = xpubToTpub(multiSigXpub);
  }
  xpubDetails[XpubTypes.P2WSH] = { xpub: multiSigXpub, derivationPath: multiSigPath };

  // fetch master fingerprint
  const xfp = await card.getMasterXfp();

  const xpub = isMultisig ? multiSigXpub : singleSigXpub;
  const derivationPath = isMultisig ? multiSigPath : singleSigPath;

  return {
    xpub,
    masterFingerprint: xfp.toUpperCase(),
    derivationPath,
    xpubDetails,
  };
};

export const getSatochipDetails = async (
  card: SatochipCard,
  pin: string,
  isTestnet: boolean,
  isMultisig: boolean,
  account: number
) => {
  const status = await card.getStatus();

  if (!status.setup_done) {
    throw Error("SATOCHIP not setup. Set a new PIN and seed in the setup options.");
  }

  if (!status.is_seeded) {
    throw Error("SATOCHIP not seeded. Import a seed in the setup options.");
  }

  // Verify PIN for operations
  await card.verifyPIN(0, pin);

  const { xpub, masterFingerprint, derivationPath, xpubDetails } = await getScriptSpecificDetails(card, pin, isTestnet, isMultisig, account);

  return { xpub, masterFingerprint, derivationPath, xpubDetails };
};

export const getCardInfo = async (card: SatochipCard, pin: string = null) => {
  const status = await card.getStatus();

  if (!status.setup_done){
    return {
      setupDone: false,
      isSeeded: false,
      isAuthentic: false,
      authenticityMsg: 'Card setup required!',
    };
  }

  // PIN required for authenticity check currently
  if (pin){
    await card.verifyPIN(0, pin);
  }

  // check authenticity
  let isAuthentic: boolean = null;
  let authenticityMsg: string = '';
  try {
    const resCertValid = await card.verifyCertificateChain();
    if (resCertValid.isValid){
      const resChalresp = await card.cardChallengeResponsePki();
      if (resChalresp.success){
        isAuthentic = true;
        authenticityMsg = "Card is authentic";
      } else {
        isAuthentic = false;
        authenticityMsg = resChalresp.error;
      }
    } else {
      isAuthentic = false;
      authenticityMsg = resCertValid.txtError;
    }
  } catch (error) {
    console.error('satochip/index getCardInfo Chain validation error: ', error);
    isAuthentic = false;
    authenticityMsg = error.message || error;
  }

  return {
    setupDone: status.setup_done,
    isSeeded: status.is_seeded,
    isAuthentic: isAuthentic,
    authenticityMsg,
  };
};

export const setupCard = async (card: SatochipCard, newPIN: string) => {
  // do setup
  await card.setup(newPIN, 5)
  return;
};

export const changePin = async (card: SatochipCard, oldPIN: string, newPIN: string) => {
  // Verify current PIN first
  await card.verifyPIN(0, oldPIN);

  // Change PIN
  await card.changePIN(0, oldPIN, newPIN);
  return;
};

export const importSeed = async (card: SatochipCard, pin: string, seedBytes: Buffer) => {
  // Verify current PIN first
  await card.verifyPIN(0, pin);
  // import seed
  await card.importSeed(seedBytes);
  return;
};

export const resetSeed = async (card: SatochipCard, pin: string) => {
  // Verify current PIN first
  await card.verifyPIN(0, pin);
  // reset seed
  await card.resetSeed(pin);
  return;
};

export const signWithSatochip = async (
  card: SatochipCard,
  cardMfp: string,
  inputsToSign: {
    digest: string;
    subPath: string;
    inputIndex: number;
    sighashType: number;
    publicKey: string;
    signature?: string;
  }[],
  pin,
  signer: VaultSigner,
  isTestnet: boolean
) => {
  // select applet
  await card.selectApplet();
  // Verify PIN first
  await card.verifyPIN(0, pin);

  // Verify we're using the correct card
  if (cardMfp) {
    // fetch master fingerprint
    const xfp = await card.getMasterXfp();
    if (xfp.toUpperCase() !== cardMfp.toUpperCase()) {
      throw Error(
        'Wrong SATOCHIP used, please ensure you use the same one selected for signing.'
      );
    }
  }

  try {
    for (const input of inputsToSign) {

      let keypath = "";
      if (signer.derivationPath.endsWith("/") || input.subPath.startsWith("/")){
        keypath = signer.derivationPath + input.subPath;
      } else {
        keypath = signer.derivationPath + "/" + input.subPath;
      }
      validateBip32Path(keypath);

      // derive extended key
      const {pubkey, chaincode} = await card.getExtendedKey(keypath);

      // Sign the digest using Satochip
      const digest = Buffer.from(input.digest, 'hex');
      const dersigBytes =  await card.signTransactionHash(0xff, digest);

      // //DEBUG: verify DER signature
      // const isVerified = ECPair.fromPublicKey(pubkey).verify(digest, dersigBytes);
      // console.log(`index signWithSatochip isVerified: ${isVerified}`);

      // convert DER signature to compact signature
      const sigBytes = converDerSignatureTo64bytesSignature(dersigBytes);

      // //DEBUG: verify converted signature against bitcoinjs-lib expectations
      // const isConvertedSigVerified = ECPair.fromPublicKey(pubkey).verify(digest, sigBytes);
      // console.log(`index signWithSatochip isConvertedSigVerified: ${isConvertedSigVerified}`);

      input.signature = sigBytes.toString('hex');
    }

    return inputsToSign;
  } catch (e) {
    captureError(e);
    throw e;
  }
};

// For test purposes only
export const readSatochip = async (card: SatochipCard, pin: string) => {
  await card.verifyPIN(0, pin);
  const status = await card.getStatus();
  return status;
};

export const handleSatochipError = (error, navigation) => {
  let errorMessage = error.toString();

  if (errorMessage) {
    if (Platform.OS === 'ios') NFC.showiOSErrorMessage(errorMessage);
  } else {
    errorMessage = 'Something went wrong, please try again!';
    if (Platform.OS === 'ios') NFC.showiOSErrorMessage(errorMessage);
  }

  return errorMessage;
};

/**
 * convert a DER-encoded signature to 64-byte signature (r,s)
 *
 * @param sigin - the signature in DER format (70-72 bytes)
 * @returns Buffer containing the compact signature (64-byte format)
 */
const converDerSignatureTo64bytesSignature = (sigin: Buffer) => {

  // Validate DER format
  if (sigin[0] !== 0x30) {
    throw new Error("converDerSignatureTo64bytesSignature: wrong first byte!");
  }

  // Extract r component
  if (sigin[2] !== 0x02) {
    throw new Error("converDerSignatureTo64bytesSignature: r should start with 0x02");
  }

  const rLength = sigin[3];

  // Extract r bytes manually to avoid Buffer compatibility issues
  const rBytes = Buffer.alloc(32);
  const rStart = 4;

  // Handle leading zero in r if present
  let rDataStart = rStart;
  let rDataLength = rLength;
  if (rLength === 33 && sigin[rStart] === 0x00) {
    rDataStart = rStart + 1;
    rDataLength = 32;
  }

  // Copy r data, right-aligned in 32-byte buffer
  const rOffset = 32 - rDataLength;
  for (let i = 0; i < rDataLength; i++) {
    rBytes[rOffset + i] = sigin[rDataStart + i];
  }

  // Extract s component
  const sOffset = 4 + rLength;
  if (sigin[sOffset] !== 0x02) {
    throw new Error("converDerSignatureTo64bytesSignature: s should start with 0x02");
  }

  const sLength = sigin[sOffset + 1];

  // Extract s bytes manually
  const sRawBytes = Buffer.alloc(32);
  const sStart = sOffset + 2;

  // Handle leading zero in s if present
  let sDataStart = sStart;
  let sDataLength = sLength;
  if (sLength === 33 && sigin[sStart] === 0x00) {
    sDataStart = sStart + 1;
    sDataLength = 32;
  }

  // Copy s data, right-aligned in 32-byte buffer
  const sOffsetInBuffer = 32 - sDataLength;
  for (let i = 0; i < sDataLength; i++) {
    sRawBytes[sOffsetInBuffer + i] = sigin[sDataStart + i];
  }

  // Apply BIP62 low-S rule
  const sBytes = enforceLowS(sRawBytes);

  return Buffer.concat([rBytes, sBytes]);
};

const CURVE_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

function enforceLowS(sBytes: Buffer): Buffer {
  let s = BigInt('0x' + sBytes.toString('hex'));

  if (s > HALF_CURVE_ORDER) {
    s = CURVE_ORDER - s;
  }

  const hex = s.toString(16).padStart(64, '0');

  return Buffer.from(hex, 'hex');
}

// validate bip32path
function validateBip32Path(path: string): void {
  // Complete pattern matching the entire structure
  const regex = /^m\/(\d+'?\/)*(\d+'?\/?)?$/;

  // Breaking down the pattern:
  //   ^ - Start of string
  // m\/ - Literal "m/" (required)
  // (\d+'?\/)* - Zero or more occurrences of: digits, optional quote, slash
  // (\d+'?\/?)? - Optional last segment with digits, optional quote, optional slash
  // $ - End of string

  if (!regex.test(path)) {
    throw new Error(`Invalid format: "${path}" - must match regex: [m/]<digits>[']/<digits>[']/...`);
  }
}
