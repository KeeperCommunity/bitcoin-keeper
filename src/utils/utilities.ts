import config, { APP_STAGE } from 'src/utils/service-utilities/config';
import { Alert, Platform } from 'react-native';
import moment from 'moment';
import idx from 'idx';

import {
  NetworkType,
  SignerType,
  VaultType,
  WalletType,
  XpubTypes,
} from 'src/services/wallets/enums';

import { Signer, Vault, VaultSigner } from 'src/services/wallets/interfaces/vault';
import * as bitcoin from 'bitcoinjs-lib';
import { isTestnet } from 'src/constants/Bitcoin';

import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';
import BIP32Factory from 'bip32';
import { detectFileType, splitQRs } from 'src/services/qr/bbqr/split';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { RECOVERY_KEY_SIGNER_NAME } from 'src/constants/defaultData';
import _ from 'lodash';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { getRandomBytes } from './service-utilities/encryption';
import { createHash } from 'crypto';
const bip32 = BIP32Factory(ecc);
import ECPairFactory from 'ecpair';
const ECPair = ECPairFactory(ecc);

export const UsNumberFormat = (amount, decimalCount = 0, decimal = '.', thousands = ',') => {
  try {
    decimalCount = Math.abs(decimalCount);
    decimalCount = isNaN(decimalCount) ? 2 : decimalCount;
    const negativeSign = amount < 0 ? '-' : '';
    const i = parseInt(Math.abs(Number(amount) || 0).toFixed(decimalCount)).toString();
    const j = i.length > 3 ? i.length % 3 : 0;
    return (
      negativeSign +
      (j ? i.substring(0, j) + thousands : '') +
      i.substring(j).replace(/(\d{3})(?=\d)/g, `$1${thousands}`) +
      (decimalCount
        ? decimal +
          Math.abs(amount - i)
            .toFixed(decimalCount)
            .slice(2)
        : '')
    );
  } catch (e) {
    // console.log(e)
  }
};

export const timeConvert = (valueInMinutes) => {
  const num = valueInMinutes;
  const hours = Math.round(num / 60);
  const days = Math.round(hours / 24);
  if (valueInMinutes < 60) {
    return `${valueInMinutes} minutes`;
  }
  if (hours < 24) {
    return `${hours} hours`;
  }
  if (days > 0) {
    return days === 1 ? `${days} day` : `${days} days`;
  }
};

export const timeConvertNear30 = (valueInMinutes) => {
  if (valueInMinutes < 60) {
    return '.5 hours';
  }
  const num = Math.ceil(valueInMinutes / 30) * 30;
  const hours = num / 60;
  const rhours = Math.floor(hours);
  const minutes = (hours - rhours) * 60;
  const rminutes = Math.round(minutes);
  if (rhours > 0 && rminutes <= 0) {
    return `${rhours} hours`;
  }
  if (rhours > 0 && rminutes > 0) {
    return `${rhours}.5 hours`;
  }
  return `${rminutes} minutes`;
};

export const getVersions = (versionHistory, restoreVersions) => {
  let versions = [];
  const versionHistoryArray = [];
  const restoreVersionsArray = [];
  if (versionHistory) {
    for (const item of versionHistory) {
      versionHistoryArray.push(item);
    }
  }

  if (restoreVersions) {
    for (const item of restoreVersions) {
      restoreVersionsArray.push(item);
    }
  }

  if (versionHistoryArray.length && restoreVersionsArray.length) {
    versions = [...versionHistoryArray, ...restoreVersionsArray];
  } else if (versionHistoryArray.length) {
    versions = [...versionHistoryArray];
  } else if (restoreVersionsArray.length) {
    versions = [...restoreVersionsArray];
  }

  return versions;
};

// Health Modification and calculation methods

export const arrayChunks = (arr, size) =>
  Array.from(
    {
      length: Math.ceil(arr.length / size),
    },
    (v, i) => arr.slice(i * size, i * size + size)
  );

export function numberWithCommas(x: string) {
  const parts = x.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export const getPlaceholder = (index: number) => {
  const mainIndex = index + 1;
  if (mainIndex === 1) return `${mainIndex}st`;
  if (mainIndex === 2) return `${mainIndex}nd`;
  if (mainIndex === 3) return `${mainIndex}rd`;
  return `${mainIndex}th`;
};

export const getPlaceholderSuperScripted = (index: number) => {
  const mainIndex = index + 1;
  if (mainIndex === 1) return `${mainIndex}ˢᵗ`;
  if (mainIndex === 2) return `${mainIndex}ⁿᵈ`;
  if (mainIndex === 3) return `${mainIndex}ʳᵈ`;
  return `${mainIndex}ᵗʰ`;
};

/**
 * handles inter-Keeper interactions
 * @param  {} error
 * @returns string
 */
export const crossInteractionHandler = (error): string => {
  // check via UAI whether the app is on latest version or not and alert accordingly
  Alert.alert('Something went wrong', 'Please ensure that you & KSD are on the latest version');
  return error.message;
};

export const getBackupDuration = () =>
  config.ENVIRONMENT === APP_STAGE.PRODUCTION ? 1.555e7 : 1800;

export const emailCheck = (email) => {
  const reg = /^\w+([.\-+]?\w+)*@\w+([\.-]?\w+)*(\.\w\w+)+$/;
  return reg.test(email);
};

export function numberToOrdinal(cardinal) {
  const ordinals = [
    'Zeroth',
    'First',
    'Second',
    'Third',
    'Fourth',
    'Fifth',
    'Sixth',
    'Seventh',
    'Eighth',
    'Ninth',
    'Tenth',
    'Eleventh',
    'Twelfth',
    'Thirteenth',
    'Fourteenth',
    'Fifteenth',
    'Sixteenth',
    'Seventeenth',
    'Eighteenth',
    'Nineteenth',
    'Twentieth',
  ];

  if (cardinal < 0 || cardinal >= ordinals.length) {
    return '';
  }

  return ordinals[cardinal];
}

export function calculateMonthlyCost(yearlyPrice) {
  const numericValue = parseFloat(yearlyPrice.replace(/[^0-9.]/g, ''));
  if (isNaN(numericValue)) {
    throw new Error('Invalid yearly price format');
  }
  const monthlyCost = numericValue / 12;
  const currencySymbol = yearlyPrice.match(/^\D+/)?.[0]?.trim() || '';
  const formattedMonthlyCost = `${currencySymbol} ${monthlyCost.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return formattedMonthlyCost;
}

// Format number with comma
// Example: 1000000 => 1,000,000
export const formatNumber = (value: string) =>
  value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const isOdd = (num: number) => num % 2 !== 0;

export const getTimeDifferenceInWords = (pastTime) => {
  const timeDifference = moment(pastTime).fromNow();
  if (timeDifference === 'Invalid date' || pastTime === undefined) {
    return 'Never accessed';
  } else {
    return timeDifference.charAt(0).toUpperCase() + timeDifference.slice(1);
  }
};

export const getWalletTags = (walletType) => {
  if (walletType === VaultType.COLLABORATIVE) {
    return ['Collaborative', '2 of 3'];
  } else if (walletType === VaultType.ASSISTED) {
    return ['Assisted', '2 of 3'];
  } else {
    let walletKind;
    if (walletType === WalletType.DEFAULT) walletKind = 'Hot Wallet';
    else if (walletType === WalletType.IMPORTED) {
      const isWatchOnly = !idx(walletType, (_) => _.specs.xpriv);
      if (isWatchOnly) walletKind = 'Watch Only';
      else walletKind = 'Imported Wallet';
    }

    return [walletKind, 'Single-Key'];
  }
};

export const trimCWDefaultName = (wallet) => {
  // To convert "Collaborative Wallet" to "Collab. Wallet" when editing
  if (wallet.presentationData.name.length > 18) {
    const tempWallet = JSON.parse(JSON.stringify(wallet));
    tempWallet.presentationData.name = tempWallet.presentationData.name.replace(
      'Collaborative Wallet',
      'Collab. Wallet'
    );
    return tempWallet;
  }
  return wallet;
};

export const throttle = (func, limit) => {
  let lastFunc;
  let lastRan;
  return function (...args) {
    const context = this;
    if (!lastRan) {
      func.apply(context, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function () {
        if (Date.now() - lastRan >= limit) {
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  };
};
export const calculateTimeLeft = (createdAt: string) => {
  const targetTime = new Date(new Date(createdAt).getTime() + 5 * 60000); // Add 5 minutes
  const currentTime = new Date();
  // @ts-ignore
  return Math.max(0, Math.floor((targetTime - currentTime) / 1000));
};

export const capitalizeEachWord = (text: string): string => {
  return text
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

export const timeFromTimeStamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  const today = new Date();

  const inputYear = date.getFullYear();
  const inputMonth = date.toLocaleString('default', { month: 'long' });
  const inputDay = date.getDate();

  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDay = today.getDate();

  if (inputYear === todayYear && date.getMonth() === todayMonth && inputDay === todayDay) {
    const hours = date.getHours() % 12 || 12; // Handle 12-hour format
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
    return `${hours}:${minutes} ${ampm}`;
  }

  if (inputYear === todayYear) {
    return `${inputDay} ${inputMonth}`;
  }

  return `${inputDay} ${inputMonth} ${inputYear}`;
};

export const generateDataFromPSBT = (base64Str: string, signer: Signer) => {
  try {
    const psbt = bitcoin.Psbt.fromBase64(base64Str);
    let vBytes = null;
    try {
      vBytes = estimateVByteFromPSBT(base64Str);
    } catch {
      // TODO: Need to support for Miniscript
      console.log('Failed to estimate transaction size');
    }
    const signersList = [];
    let signerMatched = false;

    const changeAddressIndex = psbt?.data?.outputs
      ?.find((output) => output?.bip32Derivation?.[0]?.path)
      ?.bip32Derivation?.[0]?.path?.split('/')
      ?.pop();

    psbt.data.inputs.forEach((input) => {
      if (input.bip32Derivation) {
        // Loop through all derivations (in case there are multiple keys)
        input.bip32Derivation.forEach((derivation) => {
          const data = {
            derivationPath: derivation.path,
            masterFingerprint: derivation.masterFingerprint.toString('hex'),
            pubKey: derivation.pubkey.toString('hex'),
          };
          signersList.push(data);
          if (data.masterFingerprint.toLowerCase() === signer.masterFingerprint.toLowerCase()) {
            // validating further by matching public key
            const xPub = signer.signerXpubs[XpubTypes.P2WSH][0].xpub; // to enable for taproot in future
            const pubkey = getPubKeyFromXpub(xPub, data.derivationPath);
            if (data.pubKey == pubkey) signerMatched = true;
          }
        });
      }
    });
    const inputs = psbt.data.inputs.map((input) => {
      const p2wsh = bitcoin.payments.p2wsh({
        redeem: { output: Buffer.from(input.witnessScript) },
        network: isTestnet() ? bitcoin.networks.testnet : bitcoin.networks.bitcoin,
      });
      return {
        address: p2wsh.address,
        amount: input.witnessUtxo.value,
        path: input.bip32Derivation[0].path,
      };
    });

    // Extract outputs (receiver information)
    const outputs = getOutputsFromPsbt(psbt);

    // Calculate the total input and output amounts
    let totalInput = 0;
    let totalOutput = 0;

    psbt.data.inputs.forEach((input, index) => {
      if (input.witnessUtxo) {
        totalInput += input.witnessUtxo.value;
      } else if (input.nonWitnessUtxo) {
        const tx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
        const voutIndex = psbt.txInputs[index].index;
        totalInput += tx.outs[voutIndex].value;
      }
    });

    outputs.forEach((output) => {
      totalOutput += output.amount;
    });

    // Calculate transaction fees
    const fees = totalInput - totalOutput;
    let feeRate = null;
    if (vBytes) {
      feeRate = (fees / vBytes).toFixed(2);
    }
    return {
      senderAddresses: inputs,
      receiverAddresses: outputs,
      fees,
      sendAmount: totalOutput,
      signerMatched,
      feeRate,
      vBytes,
      signersList,
      changeAddressIndex,
    };
  } catch (error) {
    console.log('🚀 ~ dataFromPSBT ~ error:', error);
    throw new Error(error?.message ?? 'Something went wrong');
  }
};

export const getPubKeyFromXpub = (xPub: string, derivationPath: string) => {
  const node = bip32.fromBase58(
    xPub,
    isTestnet() ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
  );
  const receiveAddPath = derivationPath.split('/').slice(-2).join('/');
  const childNode = node.derivePath(receiveAddPath);
  const pubkey = childNode.publicKey.toString('hex');
  return pubkey;
};

export const estimateVByteFromPSBT = (base64Str: string) => {
  const psbt = bitcoin.Psbt.fromBase64(base64Str);
  const unsignedTxHex =
    psbt.txInputs.length > 0 && psbt.txOutputs.length > 0 ? psbt.__CACHE.__TX.toHex() : null;
  if (!unsignedTxHex) {
    throw new Error('Invalid PSBT: No inputs or outputs.');
  }
  const tx = bitcoin.Transaction.fromHex(unsignedTxHex);
  // Base size (transaction size without witness data)
  const baseSize = tx.toBuffer().length;
  // Initialize total size with base size
  let totalSize = baseSize;
  // Iterate through inputs to calculate witness size
  psbt.data.inputs.forEach((input) => {
    if (!input.witnessScript) {
      throw new Error('Input is missing witness script for P2WSH.');
    }
    // Decode the witness script (redeem script)
    const witnessScript = bitcoin.script.decompile(input.witnessScript);
    if (!witnessScript) {
      throw new Error('Invalid witness script.');
    }
    // Determine `m` from the script
    const m = witnessScript[0] - bitcoin.opcodes.OP_1 + 1; // OP_m
    // Placeholder (1 byte) for null signature
    const nullPlaceholderSize = 1;
    // Each signature: 73 bytes (1-byte opcode + ~72-byte DER-encoded signature)
    const signaturesSize = m * (1 + 72);
    // Redeem script size (serialized size of the witness script)
    const redeemScriptSize = input.witnessScript.length;
    // Push opcode size for redeem script (1 byte if script < 76 bytes)
    const redeemScriptPushSize = 1;
    // Total witness size for this input
    const witnessSize =
      nullPlaceholderSize + signaturesSize + redeemScriptPushSize + redeemScriptSize;
    // Add witness size to total transaction size
    totalSize += witnessSize;
  });
  // Calculate vBytes using the formula
  const vBytes = Math.ceil((baseSize * 3 + totalSize) / 4);
  return vBytes;
};

export const getInputsFromPSBT = (base64Str: string) => {
  try {
    const psbt = bitcoin.Psbt.fromBase64(base64Str);
    return psbt.data.inputs;
  } catch (error) {
    console.log('🚀 ~ getInputsFromPSBT ~ error:', error);
    throw `Something went wrong ${error.message}`;
  }
};

export const getInputsToSignFromPSBT = (base64Str: string, signer: Signer) => {
  const psbtObject = bitcoin.Psbt.fromBase64(base64Str);
  const ips = psbtObject.data.inputs;
  const inputsToSign = [];
  ips.forEach((input, inputIndex) => {
    input.bip32Derivation.forEach((derivation) => {
      const masterFingerprint = derivation.masterFingerprint.toString('hex');
      if (masterFingerprint.toLowerCase() === signer.masterFingerprint.toLowerCase()) {
        const publicKey = derivation.pubkey;
        const subPath = derivation.path.split('/').slice(-2).join('/');
        const { hash, sighashType } = psbtObject.getDigestToSign(inputIndex, publicKey);
        inputsToSign.push({
          digest: hash.toString('hex'),
          subPath,
          inputIndex,
          sighashType,
          publicKey: publicKey.toString('hex'),
        });
      }
    });
  });
  return inputsToSign;
};

export const calculateTicketsLeft = (tickets, planDetails) => {
  const PLEB_RESTRICTION = 1;
  const HODLER_RESTRICTION = 3;

  const { isOnL1, isOnL2, isOnL3 } = planDetails;
  if (isOnL1) {
    // Pleb - once for life time
    return tickets.length < PLEB_RESTRICTION;
  }
  if (isOnL2) {
    if (config.ENVIRONMENT === APP_STAGE.DEVELOPMENT) {
      const oneHourAgo = Date.now() - 60 * 60 * 1000; // 1 hour in milliseconds
      const ticketsInLastHour = tickets.filter((ticket) => {
        const ticketTimestamp = new Date(ticket.created_at).getTime();
        return ticketTimestamp >= oneHourAgo;
      });
      return ticketsInLastHour.length < HODLER_RESTRICTION;
    }
    // PROD
    // Hodler 3 per month
    const currentMonth = new Date().getMonth();
    const monthlyTickets = tickets.filter((ticket) => {
      const ticketMonth = new Date(ticket.created_at).getMonth();
      return ticketMonth === currentMonth;
    });
    return monthlyTickets.length < HODLER_RESTRICTION;
  }
  if (isOnL3) return true;
};

export const getAccountFromSigner = (signer: Signer | VaultSigner): number | null => {
  if ('derivationPath' in signer) {
    // VaultSigner case
    return parseInt(signer.derivationPath.replace(/[h']/g, '').split('/')[3]) ?? null;
  }

  // Regular Signer case
  for (const type of Object.values(XpubTypes)) {
    const xpubs = signer.signerXpubs[type];
    if (xpubs?.[0]?.derivationPath) {
      return parseInt(xpubs[0].derivationPath.replace(/[h']/g, '').split('/')[3]) ?? null;
    }
  }

  return null;
};

export const getKeyUID = (signer: Signer | VaultSigner | null): string => {
  if (!signer) {
    return '';
  }

  let chainIdentifier = null;

  // for SigningServer, since xpub is not present
  if ((signer as Signer)?.type === SignerType.POLICY_SERVER) {
    chainIdentifier = (signer as Signer)?.networkType === NetworkType.MAINNET ? 'M' : 'T';
  } else if ((signer as VaultSigner)?.derivationPath) {
    chainIdentifier =
      parseInt((signer as VaultSigner)?.derivationPath.replace(/[']/g, '').split('/')[2]) == 0
        ? 'M'
        : 'T';
  } else {
    const xpubs = Object.values((signer as Signer)?.signerXpubs).length
      ? Object.values((signer as Signer)?.signerXpubs)
      : Object.values(getJSONFromRealmObject(signer).signerXpubs);
    for (const xPubObject of xpubs) {
      if (xPubObject[0]?.derivationPath) {
        chainIdentifier =
          parseInt(xPubObject[0]?.derivationPath?.replace(/[']/g, '').split('/')[2]) == 0
            ? 'M'
            : 'T';
        break;
      }
    }
  }
  return signer.masterFingerprint + (getAccountFromSigner(signer) ?? '') + (chainIdentifier ?? '');
};

export const checkSignerAccountsMatch = (signer: Signer): boolean => {
  const accountNumbers = Object.values(signer.signerXpubs).flatMap((xpubs) =>
    xpubs.map((x) => parseInt(x.derivationPath.replace(/[h']/g, '').split('/')[3]))
  );

  if (!accountNumbers.length) return true;

  const firstAccount = accountNumbers[0];
  return accountNumbers.every((num) => num === firstAccount);
};

export const extractBBQRIndex = (data) => {
  if (!data.startsWith('B$')) {
    throw new Error("Invalid string format. Must start with 'B$'.");
  }
  const total = data.substring(4, 6);
  if (isNaN(total)) {
    throw new Error('Invalid total. Must be numeric.');
  }
  const index = data.substring(6, 8);
  if (isNaN(index)) {
    throw new Error('Invalid index. Must be numeric.');
  }
  return {
    total: parseInt(total, 10),
    index: parseInt(index, 10),
  };
};

export const psbtToBBQR = async (psbt, min = 1, max = 4) => {
  try {
    const { raw, fileType } = await detectFileType(psbt); // requires uint8array
    const qrData = splitQRs(raw, fileType, { encoding: 'Z', minSplit: min, maxSplit: max });
    return qrData.parts;
  } catch (error) {
    console.log('🚀 ~ psbtToBBQR ~ error:', error);
    return [''];
  }
};

export function isHexadecimal(str) {
  return /^[0-9a-fA-F]+$/.test(str);
}

export function interpolateBBQR(input) {
  const points = [
    { x: 10, y: 4 },
    { x: 50, y: 3 },
    { x: 150, y: 2 },
    { x: 200, y: 1 },
  ];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (input >= p1.x && input <= p2.x) {
      const t = (input - p1.x) / (p2.x - p1.x);
      const interpolatedValue = p1.y + t * (p2.y - p1.y);
      return Math.round(interpolatedValue);
    }
  }
  if (input < points[0].x) return points[0].y;
  if (input > points[points.length - 1].x) return points[points.length - 1].y;
}

export const sanitizeFileName = (fileName: string) => {
  const sanitized = fileName.trim().replace(/[^a-zA-Z0-9]/g, '-');
  return sanitized.replace(/^-+|-+$/g, '').length === 0 ? 'untitled' : sanitized;
};

export function formatDateTime(timestamp) {
  const dateObj = new Date(timestamp);

  const formattedDate = dateObj.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });

  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return `${formattedDate} . ${formattedTime}`;
}

export function formatRemainingTime(milliseconds) {
  if (milliseconds <= 0) return '0s';

  const minutes = Math.floor(milliseconds / (1000 * 60));
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const days = Math.floor(milliseconds / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months >= 1) return `${months} Month${months > 1 ? 's' : ''}`;
  if (weeks >= 1) return `${weeks} Week${weeks > 1 ? 's' : ''}`;
  if (days >= 1) return `${days} Day${days > 1 ? 's' : ''}`;
  if (hours >= 1) return `${hours} Hour${hours > 1 ? 's' : ''}`;
  return `${minutes} Minute${minutes > 1 ? 's' : ''}`;
}

export const manipulateIosProdProductId = (productId: string) => {
  if (Platform.OS === 'ios' && !config.isDevMode()) return productId.replace('.', '_'); // Replace "." with "_"
  return productId;
};

export const getLocalizedDiscountedPrice = (price, localizedPrice, discount) => {
  const originalPrice = parseFloat(price);
  const discountAmount = originalPrice * (discount / 100);
  const finalPrice = originalPrice - discountAmount;
  const symbolMatch = localizedPrice.match(/^[^\d.,\s]+/);
  const currencySymbol = symbolMatch ? symbolMatch[0] : '';
  return `${currencySymbol}${finalPrice.toFixed(2)}`;
};

export const sanitizeSeedKeyForBackup = (signer: Signer) => {
  // Remove xpriv from seed words if stored already
  if (signer.type === SignerType.SEED_WORDS && signer.signerName !== RECOVERY_KEY_SIGNER_NAME) {
    const updatedSigner = _.cloneDeep(signer);
    updatedSigner.signerXpubs = Object.fromEntries(
      Object.entries(updatedSigner.signerXpubs).map(([key, items]) => {
        if (Array.isArray(items) && items.length > 0) {
          const sanitizedItems = items.map((item) => ({
            ...item,
            xpriv: null,
          }));
          return [key, sanitizedItems];
        }
        return [key, items];
      })
    );
    return updatedSigner;
  }
  return signer;
};

export const sanitizeVaultSignersForSeedKeyBackup = (vault: Vault) => {
  let updatedVault = _.cloneDeep(vault);
  let signer = dbManager.getCollection(RealmSchema.Signer);
  updatedVault.signers = updatedVault.signers.map((vaultSigner) => {
    const selectedSigner = signer.find(
      (signer) => signer.masterFingerprint === vaultSigner.masterFingerprint
    );
    if (
      selectedSigner.type === SignerType.SEED_WORDS &&
      selectedSigner.signerName !== RECOVERY_KEY_SIGNER_NAME
    ) {
      return {
        ...vaultSigner,
        xpriv: null,
      };
    }
    return vaultSigner;
  });
  return updatedVault;
};

export const generateAccountIdentifier = (noOfAccounts) => {
  if (!noOfAccounts) return '';
  return getRandomBytes(3);
};

export const areSetsEqual = (setA: Set<any>, setB: Set<any>) => {
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
};

export const getDayForGraph = (timestamp: number, hideDate = false, hideDay = false) => {
  const date = new Date(timestamp);
  const dayNo = date.getDay();
  let day = '';
  switch (dayNo) {
    case 0:
      day = `Sun`;
      break;
    case 1:
      day = `Mon`;
      break;
    case 2:
      day = `Tue`;
      break;
    case 3:
      day = `Wed`;
      break;
    case 4:
      day = `Thu`;
      break;
    case 5:
      day = `Fri`;
      break;
    case 6:
      day = `Sat`;
      break;
  }
  return `${hideDate ? null : `${date.getDate()}\n`}${hideDay ? '' : day}`;
};

export const isPsbtFullySigned = (psbt) => {
  try {
    psbt = bitcoin.Psbt.fromBase64(psbt);
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  } catch (error) {
    return null;
  }
};

export const getTnxIdFromCachedTnx = (tnx) => {
  const psbt = tnx.snapshot.state.sendPhaseTwo.serializedPSBTEnvelops[0].serializedPSBT;
  const psbtObject = bitcoin.Psbt.fromBase64(psbt);
  const tx = psbtObject.data.globalMap.unsignedTx;
  const txBuffer = tx.toBuffer();
  const hash = createHash('sha256').update(txBuffer).digest();
  return createHash('sha256').update(hash).digest().reverse().toString('hex');
};

export const getOutputsFromPsbt = (psbt) => {
  const outputs = psbt.txOutputs.map((output) => {
    return {
      address: bitcoin.address.fromOutputScript(
        output.script,
        isTestnet() ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
      ), // Receiver address
      amount: output.value, // Amount in satoshis
      isChange: false,
    };
  });
  return outputs;
};

export const manipulateBitcoinPrices = (data) => {
  const seenDates = new Set(); // To track unique dates
  const dailyPrice = [];

  let latestTimestamp = 0;
  let latestPrice = null;

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  let high24h = -Infinity;
  let low24h = Infinity;
  let yesterday;

  // Temporary object to help pick the latest entry per day
  const dateToEntry = {};

  for (const [timestamp, price] of data) {
    const dateObject = new Date(timestamp);
    const date = dateObject.getMonth() + '/' + dateObject.getDate();

    // Track the latest timestamp for each date
    if (!dateToEntry[date] || timestamp > dateToEntry[date].timestamp) {
      dateToEntry[date] = { timestamp, price };
    }

    // Track overall latest price
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latestPrice = price;
    }

    // 24h high and low
    if (timestamp >= dayAgo) {
      if (!yesterday) yesterday = price;
      if (price > high24h) high24h = price;
      if (price < low24h) low24h = price;
    }
  }

  // Convert to array and use Set to ensure one entry per date
  for (const date in dateToEntry) {
    const { timestamp, price } = dateToEntry[date];
    if (!seenDates.has(date)) {
      seenDates.add(date);
      dailyPrice.push({
        label: dailyPrice.length === 0 ? null : getDayForGraph(timestamp, false, true),
        value: price,
      });
    }
  }

  const valueChange = Math.round(latestPrice - yesterday);
  const percentChange = ((valueChange / yesterday) * 100).toFixed(2);

  return { dailyPrice, latestPrice, high24h, low24h, percentChange, valueChange };
};

export const validatePSBT = (unsigned, signed, signer, errorText) => {
  if (
    [SignerType.TAPSIGNER, SignerType.SATOCHIP, SignerType.SPECTER, SignerType.SEEDSIGNER, SignerType.KRUX].includes(
      signer.type
    )
  )
    return;
  const unsignedHex = bitcoin.Psbt.fromBase64(unsigned).__CACHE.__TX.toHex();
  const signedPsbtObj = bitcoin.Psbt.fromBase64(signed);
  const signedHex = signedPsbtObj.__CACHE.__TX.toHex();
  if (signedHex !== unsignedHex) {
    throw new Error(errorText.psbtNotMatch);
  }
  let signerPublicKey;
  signerPublicKey = getInputsToSignFromPSBT(unsigned, signer).map((data) => data.publicKey)[0];
  let isSigned = false;
  const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean =>
    ECPair.fromPublicKey(pubkey).verify(msghash, signature);
  for (const [_, input] of signedPsbtObj.data.inputs.entries()) {
    if (input.partialSig) {
      for (const sig of input.partialSig) {
        if (sig.pubkey.toString('hex') === signerPublicKey) {
          isSigned = signedPsbtObj.validateSignaturesOfAllInputs(validator);
          break;
        }
      }
    }
  }
  if (!isSigned) {
    throw new Error(errorText.psbtMissingSignature);
  }
};
