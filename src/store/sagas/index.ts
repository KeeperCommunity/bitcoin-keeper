import { all, call, spawn } from 'redux-saga/effects';
import {
  addNewVaultWatcher,
  addNewWalletsWatcher,
  addSigningDeviceWatcher,
  deleteSigningDeviceWatcher,
  autoWalletsSyncWatcher,
  migrateVaultWatcher,
  refreshWalletsWatcher,
  testcoinsWatcher,
  updateSignerPolicyWatcher,
  updateWalletDetailWatcher,
  updateSignerDetails,
  updateKeyDetails,
  updateVaultDetailsWatcher,
  deleteVaultyWatcher,
  reinstateVaultWatcher,
  refillMobileKeyWatcher,
  refreshCanaryWalletsWatcher,
  mergeSimilarKeysWatcher,
  archiveSigningDeviceWatcher,
  generateNewExternalAddressWatcher,
  updateCollaborativeChannelWatcher,
  fetchCollaborativeChannelWatcher,
  updatedVaultSignerXprivWatcher,
} from './wallets';
import { addUaiStackWatcher, uaiActionedWatcher, uaiChecksWatcher, uaisSeenWatcher } from './uai';
import {
  changeAuthCredWatcher,
  changeLoginMethodWatcher,
  credentialStorageWatcher,
  credentialsAuthWatcher,
} from './login';
import {
  deleteAppImageEntityWatcher,
  getAppImageWatcher,
  healthCheckSignerWatcher,
  seedBackedUpWatcher,
  seedBackeupConfirmedWatcher,
  updateAppImageWatcher,
  updateVaultImageWatcher,
  backupBsmsOnCloudWatcher,
  bsmsCloudHealthCheckWatcher,
  healthCheckSatutsUpdateWatcher,
  backupAllSignersAndVaultsWatcher,
  deleteBackupWatcher,
  validateSeverBackupWatcher,
} from './bhr';
import {
  calculateCustomFeeWatcher,
  calculateSendMaxFeeWatcher,
  discardBroadcastedTnxWatcher,
  fetchExchangeRatesWatcher,
  fetchFeeRatesWatcher,
  sendPhaseOneWatcher,
  sendPhaseThreeWatcher,
  sendPhaseTwoWatcher,
} from './send_and_receive';
import { updateFCMTokensWatcher } from './notifications';

import {
  fetchDelayedPolicyUpdateWatcher,
  fetchSignedDelayedTransactionWatcher,
  setupKeeperAppWatcher,
} from './storage';
import { migrateLablesWatcher, updateVersionHistoryWatcher } from './upgrade';
import { addLabelsWatcher, bulkUpdateLabelWatcher, importLabelsWatcher } from './utxos';
import { connectToNodeWatcher } from './network';
import {
  loadConciergeUserWatcher,
  addTicketStatusUAIWatcher,
  scheduleOnboardingCallWatcher,
} from './concierge';
import { changeBitcoinNetworkWatcher, setSubscriptionWatcher } from './settings';
import { loadConciergeUserOnLoginWatcher, saveBackupMethodByAppIdWatcher } from './account';
import {
  createSwapTnxWatcher,
  getSwapQuoteWatcher,
  getTnxDetailsWatcher,
  loadCoinDetailsWatcher,
} from './swap';
import { getAdvisorWatcher } from './advisor';

const rootSaga = function* () {
  const sagas = [
    // login
    credentialsAuthWatcher,
    changeAuthCredWatcher,
    changeLoginMethodWatcher,
    credentialStorageWatcher,
    setupKeeperAppWatcher,

    // network
    connectToNodeWatcher,

    // notification
    updateFCMTokensWatcher,

    // wallet
    addNewWalletsWatcher,
    autoWalletsSyncWatcher,
    refreshWalletsWatcher,
    updateSignerPolicyWatcher,
    testcoinsWatcher,
    updateWalletDetailWatcher,
    generateNewExternalAddressWatcher,
    updatedVaultSignerXprivWatcher,

    // vaults
    addNewVaultWatcher,
    addSigningDeviceWatcher,
    deleteSigningDeviceWatcher,
    migrateVaultWatcher,
    updateVaultDetailsWatcher,
    updateSignerDetails,
    updateKeyDetails,
    deleteVaultyWatcher,
    reinstateVaultWatcher,
    refillMobileKeyWatcher,
    refreshCanaryWalletsWatcher,
    mergeSimilarKeysWatcher,
    archiveSigningDeviceWatcher,
    updateCollaborativeChannelWatcher,
    fetchCollaborativeChannelWatcher,

    // send and receive
    fetchExchangeRatesWatcher,
    fetchFeeRatesWatcher,
    sendPhaseOneWatcher,
    sendPhaseTwoWatcher,
    sendPhaseThreeWatcher,
    fetchSignedDelayedTransactionWatcher,
    fetchDelayedPolicyUpdateWatcher,
    calculateSendMaxFeeWatcher,
    calculateCustomFeeWatcher,
    discardBroadcastedTnxWatcher,

    // UAI
    uaiChecksWatcher,
    addUaiStackWatcher,
    uaiActionedWatcher,
    uaisSeenWatcher,

    // BHR
    updateAppImageWatcher,
    updateVaultImageWatcher,
    getAppImageWatcher,
    seedBackedUpWatcher,
    seedBackeupConfirmedWatcher,
    healthCheckSignerWatcher,
    healthCheckSatutsUpdateWatcher,
    backupBsmsOnCloudWatcher,
    bsmsCloudHealthCheckWatcher,
    deleteAppImageEntityWatcher,
    backupAllSignersAndVaultsWatcher,
    deleteBackupWatcher,
    validateSeverBackupWatcher,

    // upgrade
    updateVersionHistoryWatcher,
    migrateLablesWatcher,

    // utxos
    addLabelsWatcher,
    bulkUpdateLabelWatcher,
    importLabelsWatcher,
    // concierge
    loadConciergeUserWatcher,
    addTicketStatusUAIWatcher,
    scheduleOnboardingCallWatcher,
    // settings
    changeBitcoinNetworkWatcher,
    setSubscriptionWatcher,
    // account
    loadConciergeUserOnLoginWatcher,
    saveBackupMethodByAppIdWatcher,
    // swap
    loadCoinDetailsWatcher,
    getSwapQuoteWatcher,
    createSwapTnxWatcher,
    getTnxDetailsWatcher,
    // advisor
    getAdvisorWatcher,
  ];

  yield all(
    sagas.map((saga) =>
      spawn(function* () {
        while (true) {
          try {
            yield call(saga);
            break;
          } catch (err) {
            console.log(err);
          }
        }
      })
    )
  );
};

export default rootSaga;
