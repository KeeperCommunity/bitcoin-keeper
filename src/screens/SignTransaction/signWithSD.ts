import { Platform } from 'react-native';
import WalletOperations from 'src/services/wallets/operations';
import { captureError } from 'src/services/sentry';
import config from 'src/utils/service-utilities/config';
import { generateSeedWordsKey } from 'src/services/wallets/factories/VaultFactory';
import idx from 'idx';
import { signWithTapsigner, readTapsigner } from 'src/hardware/tapsigner';
import { signWithSatochip, readSatochip } from 'src/hardware/satochip';
import { signWithColdCard } from 'src/hardware/coldcard';
import { isSignerAMF, getPsbtForHwi } from 'src/hardware';
import { EntityKind, XpubTypes } from 'src/services/wallets/enums';
import SigningServer from 'src/services/backend/SigningServer';
import { isTestnet } from 'src/constants/Bitcoin';
import * as PORTAL from 'src/hardware/portal';
import { getInputsFromPSBT } from 'src/utils/utilities';
import { generateOutputDescriptors } from 'src/utils/service-utilities/utils';
import { checkAndUnlock } from '../SigningDevices/SetupPortal';
import { store } from 'src/store/store';

export const signTransactionWithTapsigner = async ({
  setTapsignerModal,
  signingPayload,
  currentKey,
  withModal,
  defaultVault,
  serializedPSBT,
  card,
  cvc,
  signer,
}) => {
  setTapsignerModal(false);
  const { inputsToSign } = signingPayload[0];
  // AMF flow for signing
  if (isSignerAMF(signer)) {
    await withModal(() => readTapsigner(card, cvc))();
    const { xpriv } = currentKey;
    const inputs = idx(signingPayload, (_) => _[0].inputs);
    if (!inputs) throw new Error('Invalid signing payload, inputs missing');
    const { signedSerializedPSBT } = WalletOperations.internallySignVaultPSBT(
      defaultVault,
      serializedPSBT,
      { ...signer, xpriv }
    );
    return { signedSerializedPSBT, signingPayload: null };
  }
  return withModal(async () => {
    const signedInput = await signWithTapsigner(
      card,
      signer.masterFingerprint,
      inputsToSign,
      cvc,
      currentKey,
      isTestnet()
    );
    signingPayload.forEach((payload) => {
      payload.inputsToSign = signedInput;
    });
    return { signingPayload, signedSerializedPSBT: null };
  })();
};

export const signTransactionWithSatochip = async ({
 setSatochipModal,
 signingPayload,
 currentKey,
 withModal,
 defaultVault,
 serializedPSBT,
 card,
 pin,
 signer,
}) => {
  console.log(`signWithSD signTransactionWithSatochip pin: ${pin}`)
  setSatochipModal(false);
  const { inputsToSign } = signingPayload[0];
  // AMF flow for signing
  if (isSignerAMF(signer)) {
    await withModal(() => readSatochip(card, pin))();
    const { xpriv } = currentKey;
    const inputs = idx(signingPayload, (_) => _[0].inputs);
    if (!inputs) throw new Error('Invalid signing payload, inputs missing');
    const { signedSerializedPSBT } = WalletOperations.internallySignVaultPSBT(
      defaultVault,
      serializedPSBT,
      { ...signer, xpriv }
    );
    return { signedSerializedPSBT, signingPayload: null };
  }
  return withModal(async () => {
    console.log(`signWithSD signTransactionWithSatochip pin: ${pin}`)
    const signedInput = await signWithSatochip(
      card,
      signer.masterFingerprint,
      inputsToSign,
      pin,
      currentKey,
      isTestnet()
    );
    signingPayload.forEach((payload) => {
      payload.inputsToSign = signedInput;
    });
    return { signingPayload, signedSerializedPSBT: null };
  })();
};

export const signTransactionWithColdCard = async ({
  setColdCardModal,
  withNfcModal,
  serializedPSBTEnvelop,
  closeNfc,
}) => {
  try {
    setColdCardModal(false);
    await withNfcModal(async () => signWithColdCard(serializedPSBTEnvelop.serializedPSBT));
  } catch (error) {
    if (error.toString() === 'Error') {
      // ignore if nfc modal is dismissed
    } else {
      closeNfc();
      captureError(error);
    }
  }
};

export const signTransactionWithMobileKey = async ({
  setPasswordModal,
  signingPayload,
  defaultVault,
  serializedPSBT,
  xfp,
}) => {
  setPasswordModal(false);
  const inputs = idx(signingPayload, (_) => _[0].inputs);
  if (!inputs) throw new Error('Invalid signing payload, inputs missing');
  const [signer] = defaultVault.signers.filter((signer) => signer.xfp === xfp);
  const { signedSerializedPSBT } = WalletOperations.internallySignVaultPSBT(
    defaultVault,
    serializedPSBT,
    signer
  );
  return { signedSerializedPSBT };
};

export const signTransactionWithSigningServer = async ({
  xfp,
  vault,
  signingPayload,
  signingServerOTP,
  serializedPSBT,
  showOTPModal,
  showToast,
  fcmToken,
}) => {
  try {
    showOTPModal(false);
    const change = idx(signingPayload, (_) => _[0].change);
    const changeIndex = idx(signingPayload, (_) => _[0].changeIndex);

    if (!signingServerOTP) throw new Error('Verification token is missing');

    const verificationToken = Number(signingServerOTP);
    const descriptor = generateOutputDescriptors(vault);

    const { signedPSBT, delayed, delayedTransaction } = await SigningServer.signPSBT(
      xfp,
      serializedPSBT,
      verificationToken,
      { address: change, index: changeIndex },
      descriptor,
      fcmToken
    );

    if (delayed) {
      return { delayed, delayedTransaction };
    } else {
      if (!signedPSBT) throw new Error('Server Key: failed to sign');
      return { signedSerializedPSBT: signedPSBT };
    }
  } catch (error) {
    captureError(error);
    showToast(`${error.message}`);
    return { signedSerializedPSBT: null };
  }
};

export const signTransactionWithSeedWords = async ({
  signingPayload,
  defaultVault,
  seedBasedSingerMnemonic,
  serializedPSBT,
  xfp,
  isMultisig,
  isRemoteKey = false,
}) => {
  try {
    const { bitcoinNetworkType: networkType } = store.getState().settings;

    const inputs = isRemoteKey
      ? getInputsFromPSBT(serializedPSBT)
      : idx(signingPayload, (_) => _[0].inputs);

    if (!inputs) throw new Error('Invalid signing payload, inputs missing');
    const [signer] = isRemoteKey
      ? [defaultVault.signers[0]]
      : defaultVault.signers.filter((signer) => signer.xfp === xfp);
    // we need this to generate xpriv that's not stored
    const { xpub, xpriv } = generateSeedWordsKey(seedBasedSingerMnemonic, networkType, isMultisig);

    const signerXpub = isRemoteKey ? signer.signerXpubs[XpubTypes.P2WSH][0].xpub : signer.xpub;

    if (signerXpub !== xpub) throw new Error('Invalid mnemonic; xpub mismatch');
    const { signedSerializedPSBT } = WalletOperations.internallySignVaultPSBT(
      defaultVault,
      serializedPSBT,
      { ...signer, xpriv }
    );
    return { signedSerializedPSBT };
  } catch (err) {
    throw err.message;
  }
};

export const signTransactionWithPortal = async ({
  setPortalModal,
  withNfcModal,
  serializedPSBTEnvelop,
  closeNfc,
  vault,
  portalCVC,
}) => {
  const signPsbtPortal = async (psbt) => {
    await PORTAL.startReading();
    await checkAndUnlock(portalCVC, () => {});
    const signedRes = await PORTAL.signPSBT(psbt);
    // Check if psbt and signed psbt are same, if yes then vault registration is required.
    if (psbt == signedRes) {
      throw new Error('Please register the vault before signing.');
    }
    await PORTAL.stopReading();
    return { signedSerializedPSBT: signedRes };
  };

  try {
    const psbtForPortal = await getPsbtForHwi(serializedPSBTEnvelop.serializedPSBT, vault); // portal requires non-witness utxo also.
    setPortalModal(false);
    if (Platform.OS === 'android') {
      return await withNfcModal(async () => await signPsbtPortal(psbtForPortal.serializedPSBT));
    } else {
      // modal not required for ios// created by portal utility
      return signPsbtPortal(psbtForPortal.serializedPSBT);
    }
  } catch (error) {
    closeNfc();
    throw error;
  }
};
