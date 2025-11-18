/* eslint-disable no-await-in-loop */
import {Platform} from 'react-native';
import {SatochipCard} from 'satochip-react-native';
import {captureError} from 'src/services/sentry';
import WalletUtilities from 'src/services/wallets/operations/utils';
import {ScriptTypes, XpubTypes} from 'src/services/wallets/enums';
import {VaultSigner, XpubDetailsType} from 'src/services/wallets/interfaces/vault';
import NFC from 'src/services/nfc';
import {xpubToTpub} from 'src/hardware';

const getScriptSpecificDetails = async (card, pin, isTestnet, isMultisig, account) => {
  console.log(`in satochip getScriptSpecificDetails`);

  const xpubDetails: XpubDetailsType = {};

  await card.verifyPIN(0, pin);

  // fetch P2WPKH details
  const singleSigPath = WalletUtilities.getDerivationForScriptType(ScriptTypes.P2WPKH, account);
  console.log(`in satochip getScriptSpecificDetails singleSigPath: ${singleSigPath}`);

  //const convertedSingleSigPath = singleSigPath.split("'").join('h');
  await card.verifyPIN(0, pin);
  const singleSigExtendedKey = await card.getExtendedKey(singleSigPath);
  console.log(`in satochip getScriptSpecificDetails pubkey: ${singleSigExtendedKey.pubkey.toString('hex')}`);
  console.log(`in satochip getScriptSpecificDetails chaincode: ${singleSigExtendedKey.chaincode.toString('hex')}`);

  let singleSigXpub = await card.getXpub(singleSigPath,'p2wpkh'); // using mainnet
  console.log(`in satochip getScriptSpecificDetails singleSigXpub: ${singleSigXpub}`);
  if (isTestnet) {
    singleSigXpub = xpubToTpub(singleSigXpub);
    console.log(`in satochip getScriptSpecificDetails singleSigXpub: ${singleSigXpub}`);
  }
  xpubDetails[XpubTypes.P2WPKH] = { xpub: singleSigXpub, derivationPath: singleSigPath };

  // fetch P2WSH details
  const multiSigPath = WalletUtilities.getDerivationForScriptType(ScriptTypes.P2WSH, account);
  console.log(`in satochip getScriptSpecificDetails singleSigPath: ${singleSigPath}`);

  const multiSigExtendedKey = await card.getExtendedKey(multiSigPath);
  console.log(`in satochip getScriptSpecificDetails pubkey: ${multiSigExtendedKey.pubkey.toString('hex')}`);
  console.log(`in satochip getScriptSpecificDetails chaincode: ${multiSigExtendedKey.chaincode.toString('hex')}`);

  let multiSigXpub = await card.getXpub(multiSigPath,'p2wsh', !isTestnet); // using mainnet
  console.log(`in satochip getScriptSpecificDetails multiSigXpub: ${multiSigXpub}`);
  if (isTestnet) {
    multiSigXpub = xpubToTpub(multiSigXpub);
    console.log(`in satochip getScriptSpecificDetails multiSigXpub: ${multiSigXpub}`);
  }
  xpubDetails[XpubTypes.P2WSH] = { xpub: multiSigXpub, derivationPath: multiSigPath };

  // fetch master fingerprint
  const xfp = await card.getMasterXfp();
  console.log(`in satochip getScriptSpecificDetails xfp: ${xfp}`);

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
  console.log(`in satochip getSatochipDetails status: ${status}`);

  if (!status.setup_done) {
    // If not set up, perform initial setup
    const maxTries = 5;
    await card.setup(pin, maxTries);
  }
  
  // Verify PIN for operations
  await card.verifyPIN(0, pin);

  const { xpub, masterFingerprint, derivationPath, xpubDetails } = await getScriptSpecificDetails(card, pin, isTestnet, isMultisig, account);

  return { xpub, masterFingerprint, derivationPath, xpubDetails };
};

export const getCardInfo = async (card: SatochipCard, pin: string = null) => {
  const status = await card.getStatus();
  console.log(`index getCardInfo status: ${status}`);

  // DEBUG: PIN required for authenticity check currently
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
    console.log(`getCardInfo error: ${error}`);
  }

  return {
    setupDone: status.setup_done,
    isSeeded: status.is_seeded,
    isAuthentic: isAuthentic,
    authenticityMsg,
  };
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
  console.log(`index signWithSatochip select applet`);
  await card.selectApplet();
  // Verify PIN first
  console.log(`index signWithSatochip pin: ${pin}`);
  await card.verifyPIN(0, pin);
  console.log(`index signWithSatochip pin verified!`);

  // Verify we're using the correct card
  if (cardMfp) {
    console.log(`index signWithSatochip cardMfp: ${cardMfp}`);

    // fetch master fingerprint
    const xfp = await card.getMasterXfp();
    console.log(`index signWithSatochip xfp: ${xfp}`);

    // const authentikey = await card.getAuthentikey();
    // const cardFingerprint = authentikey.fingerprint.toString('hex').toUpperCase();

    if (xfp.toUpperCase() !== cardMfp.toUpperCase()) {
      throw Error(
        'Wrong SATOCHIP used, please ensure you use the same one selected for signing.'
      );
    }
  }

  console.log(`index signWithSatochip after xfp check`);
  try {
    for (const input of inputsToSign) {
      const digest = Buffer.from(input.digest, 'hex');
      const keypath = signer.derivationPath + input.subPath;
      console.log(`index signWithSatochip digest: ${digest.toString('hex')}`);

      // derive extended key
      const {pubkey, chaincode} = await card.getExtendedKey(keypath);
      console.log(`index signWithSatochip pubkey: ${pubkey.toString('hex')}`);
      console.log(`index signWithSatochip chaincode: ${chaincode.toString('hex')}`);

      // Sign the digest using Satochip
      const dersigBytes =  await card.signTransactionHash(0xff, digest);
      console.log(`index signWithSatochip dersigBytes: ${dersigBytes.toString('hex')}`);

      // convert DER signature to compact signature
      const sigBytes = converDerSignatureTo64bytesSignature(dersigBytes);
      console.log(`index signWithSatochip sigBytes: ${sigBytes.toString('hex')}`);

      //const signature = await card.signDigest(keypath, digest, input.sighashType);
      input.signature = sigBytes.toString('hex');

      console.log(`index signWithSatochip input: ${input}`);
      console.log(JSON.stringify(input, null, 2));
    }

    console.log(`index signWithSatochip inputsToSign: ${inputsToSign}`);
    console.log(JSON.stringify(inputsToSign, null, 2));

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
  console.log(`index handleSatochipError error: ${error}`);
  let errorMessage = error.toString();

  if (errorMessage) {
    if (Platform.OS === 'ios') NFC.showiOSErrorMessage(errorMessage);
  } else {
    errorMessage = 'Something went wrong, please try again!';
    if (Platform.OS === 'ios') NFC.showiOSErrorMessage(errorMessage);
  }

  console.log(`index handleSatochipError errorMessage: ${errorMessage}`);

  return errorMessage;
};

/**
 * convert a DER-encoded signature to 64-byte signature (r,s)
 *
 * @param sigin - the signature in DER format (70-72 bytes)
 * @returns Buffer containing the compact signature (65-byte format)
 */
const converDerSignatureTo64bytesSignature = (sigin: Buffer) => {

    console.log(`In parser converDerSignatureTo64bytesSignature`);

    // Parse input
    const first = sigin[0];
    if (first !== 0x30) {
      throw new Error("converDerSignatureTo64bytesSignature: wrong first byte!");
    }

    const lt = sigin[1];
    const check = sigin[2];
    if (check !== 0x02) {
      throw new Error("converDerSignatureTo64bytesSignature: check byte should be 0x02");
    }

    // Extract r
    const rBytes = Buffer.alloc(32);
    const lr = sigin[3];
    for (let i = 0; i < 32; i++) {
      const tmp = sigin[4 + lr - 1 - i];
      if (lr >= (i + 1)) {
        rBytes[31 - i] = tmp;
      } else {
        rBytes[31 - i] = 0;
      }
    }

    // Extract s
    const check2 = sigin[4 + lr];
    if (check2 !== 0x02) {
      throw new Error("converDerSignatureTo64bytesSignature: second check byte should be 0x02");
    }

    const ls = sigin[5 + lr];
    if (lt !== (lr + ls + 4)) {
      throw new Error("converDerSignatureTo64bytesSignature: wrong lt value");
    }

    const sBytes = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      const tmp = sigin[5 + lr + ls - i];
      if (ls >= (i + 1)) {
        sBytes[31 - i] = tmp;
      } else {
        sBytes[31 - i] = 0;
      }
    }

    const sBytesNormalized = enforceLowS(sBytes);

  return Buffer.concat([rBytes, sBytesNormalized]);
};


const CURVE_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

function enforceLowS(sBytes: Buffer): Buffer {
  let s = BigInt('0x' + sBytes.toString('hex'));

  if (s > HALF_CURVE_ORDER) {
    console.log(`Enforce low s (BIP62) sBytes: ${sBytes.toString('hex')}`)
    s = CURVE_ORDER - s;
    console.log(`Enforce low s (BIP62) sBytesNormalized: ${s.toString(16).padStart(64, '0')}`)
  }

  const hex = s.toString(16).padStart(64, '0');

  return Buffer.from(hex, 'hex');
}
