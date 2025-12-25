import { AverageTxFeesByNetwork, SerializedPSBTEnvelop } from 'src/services/wallets/interfaces';
import { EntityKind, LabelRefType, TxPriority } from 'src/services/wallets/enums';
import { call, fork, put, select } from 'redux-saga/effects';

import { RealmSchema } from 'src/storage/realm/enum';
import Relay from 'src/services/backend/Relay';
import { Signer } from 'src/services/wallets/interfaces/vault';
import WalletOperations from 'src/services/wallets/operations';
import _ from 'lodash';
import idx from 'idx';
import ElectrumClient, {
  ELECTRUM_CLIENT,
  ELECTRUM_NOT_CONNECTED_ERR,
  ELECTRUM_NOT_CONNECTED_ERR_TOR,
} from 'src/services/electrum/client';
import dbManager from 'src/storage/realm/dbManager';
import { createWatcher } from '../utilities';
import {
  SendPhaseOneExecutedPayload,
  sendPhaseOneExecuted,
  sendPhaseThreeExecuted,
  sendPhaseTwoExecuted,
  setSendMaxFee,
  customFeeCalculated,
} from '../reducers/send_and_receive';
import { setAverageTxFee, setExchangeRates } from '../reducers/network';
import {
  CALCULATE_CUSTOM_FEE,
  CALCULATE_SEND_MAX_FEE,
  CalculateCustomFeeAction,
  CalculateSendMaxFeeAction,
  DISCARD_BROADCASTED_TNX,
  FETCH_EXCHANGE_RATES,
  FETCH_FEE_RATES,
  SEND_PHASE_ONE,
  SEND_PHASE_THREE,
  SEND_PHASE_TWO,
  SendPhaseOneAction,
  SendPhaseThreeAction,
  SendPhaseTwoAction,
} from '../sagaActions/send_and_receive';
import { addLabelsWorker, bulkUpdateLabelsWorker } from './utxos';
import { setElectrumNotConnectedErr } from '../reducers/login';
import { connectToNodeWorker } from './network';
import { getKeyUID, getOutputsFromPsbt } from 'src/utils/utilities';
import { dropTransactionSnapshot } from '../reducers/cachedTxn';
import * as bitcoin from 'bitcoinjs-lib';
import axios from 'axios';
const EX_RATE_API = 'https://api.coingecko.com/api/v3/exchange_rates';

export function* fetchFeeRatesWorker() {
  try {
    const averageTxFeeByNetwork = yield call(WalletOperations.calculateAverageTxFee);
    if (!averageTxFeeByNetwork) console.log('Failed to calculate current fee rates');
    else yield put(setAverageTxFee(averageTxFeeByNetwork));
  } catch (err) {
    console.log('Failed to calculate current fee rates', { err });
  }
}

export const fetchFeeRatesWatcher = createWatcher(fetchFeeRatesWorker, FETCH_FEE_RATES);

function* fetchExchangeRatesWorker() {
  try {
    const res = yield call(axios.get, EX_RATE_API);
    if (res.status === 200 && res.data?.rates) {
      const exchangeRates = reformatExchangeRates(res.data.rates);
      yield put(setExchangeRates({ exchangeRates }));
    } else console.log('Failed to fetch exchange rates');
    
  } catch (err) {
    console.log('Failed to fetch latest exchange rates', { err });
  }
}

export const fetchExchangeRatesWatcher = createWatcher(
  fetchExchangeRatesWorker,
  FETCH_EXCHANGE_RATES
);

function* sendPhaseOneWorker({ payload }: SendPhaseOneAction) {
  const { wallet, recipients, selectedUTXOs, miniscriptSelectedSatisfier } = payload;
  let averageTxFees: AverageTxFeesByNetwork = yield select((state) => state.network.averageTxFees);
  if (!averageTxFees) {
    averageTxFees = yield call(WalletOperations.calculateAverageTxFee);
    if (!averageTxFees) {
      console.log('Missing average TX fees...');
      return;
    }
  }

  const averageTxFeeByNetwork = averageTxFees[wallet.networkType];

  try {
    const { txRecipients, txPrerequisites } = yield call(
      WalletOperations.transferST1,
      wallet,
      recipients,
      averageTxFeeByNetwork,
      selectedUTXOs,
      miniscriptSelectedSatisfier
    );

    if (!txPrerequisites) throw new Error('Send failed: unable to generate tx pre-requisite');
    yield put(
      sendPhaseOneExecuted({
        successful: true,
        outputs: {
          txPrerequisites,
          txRecipients,
        },
      })
    );
  } catch (err) {
    yield put(
      sendPhaseOneExecuted({
        successful: false,
        err: err.message,
      })
    );
  }
}

export const sendPhaseOneWatcher = createWatcher(sendPhaseOneWorker, SEND_PHASE_ONE);

function* sendPhaseTwoWorker({ payload }: SendPhaseTwoAction) {
  if (!ELECTRUM_CLIENT.isClientConnected) {
    ElectrumClient.resetCurrentPeerIndex();
    yield call(connectToNodeWorker);
  }
  const sendPhaseOneResults: SendPhaseOneExecutedPayload = yield select(
    (state) => state.sendAndReceive.sendPhaseOne
  );
  const customSendPhaseOneResults = yield select(
    (state) => state.sendAndReceive.customPrioritySendPhaseOne
  );

  const { wallet, currentBlockHeight, txnPriority, miniscriptTxElements, note } = payload;
  const txPrerequisites = _.cloneDeep(idx(sendPhaseOneResults, (_) => _.outputs.txPrerequisites)); // cloning object(mutable) as reducer states are immutable
  const customTxPrerequisites = _.cloneDeep(
    idx(customSendPhaseOneResults, (_) => _.outputs.customTxPrerequisites)
  );

  const signerMap = {};
  if (wallet.entityKind === EntityKind.VAULT) {
    dbManager
      .getCollection(RealmSchema.Signer)
      .forEach((signer) => (signerMap[getKeyUID(signer as Signer)] = signer));
  }
  try {
    const { txid, serializedPSBTEnvelops, cachedTxid, finalOutputs, inputs } = yield call(
      WalletOperations.transferST2,
      wallet,
      currentBlockHeight,
      txPrerequisites,
      txnPriority,
      customTxPrerequisites,
      signerMap,
      miniscriptTxElements
    );

    switch (wallet.entityKind) {
      case EntityKind.WALLET:
        if (!txid) throw new Error('Send failed: unable to generate txid');
        if (note) {
          yield call(addLabelsWorker, {
            payload: {
              txId: txid,
              wallet,
              labels: [{ name: note, isSystem: false }],
              type: LabelRefType.TXN,
            },
          });
        }
        yield put(
          sendPhaseTwoExecuted({
            successful: true,
            txid,
          })
        );
        break;

      case EntityKind.VAULT:
        if (!serializedPSBTEnvelops.length) {
          throw new Error('Send failed: unable to generate serializedPSBTEnvelop');
        }
        yield put(
          sendPhaseTwoExecuted({
            successful: true,
            serializedPSBTEnvelops,
            cachedTxid,
            cachedTxPriority: txnPriority,
          })
        );
        break;

      default:
        throw new Error('Invalid Entity: not a vault/Wallet');
    }

    if (finalOutputs) {
      yield call(handleChangeOutputLabels, finalOutputs, inputs, wallet, txid);
    }
  } catch (err) {
    if ([ELECTRUM_NOT_CONNECTED_ERR, ELECTRUM_NOT_CONNECTED_ERR_TOR].includes(err?.message)) {
      yield put(setElectrumNotConnectedErr(err?.message));
    }

    yield put(
      sendPhaseTwoExecuted({
        successful: false,
        err: err.message,
      })
    );
  }
}

export const sendPhaseTwoWatcher = createWatcher(sendPhaseTwoWorker, SEND_PHASE_TWO);

function* sendPhaseThreeWorker({ payload }: SendPhaseThreeAction) {
  if (!ELECTRUM_CLIENT.isClientConnected) {
    ElectrumClient.resetCurrentPeerIndex();
    yield call(connectToNodeWorker);
  }

  const sendPhaseOneResults: SendPhaseOneExecutedPayload = yield select(
    (state) => state.sendAndReceive.sendPhaseOne
  );
  const customSendPhaseOneResults = yield select(
    (state) => state.sendAndReceive.customPrioritySendPhaseOne
  );
  const serializedPSBTEnvelops: SerializedPSBTEnvelop[] = yield select(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );

  const txPrerequisites = _.cloneDeep(idx(sendPhaseOneResults, (_) => _.outputs.txPrerequisites)); // cloning object(mutable) as reducer states are immutable
  const customTxPrerequisites = _.cloneDeep(
    idx(customSendPhaseOneResults, (_) => _.outputs.customTxPrerequisites)
  );

  const { wallet, txnPriority, miniscriptTxElements, note } = payload;

  try {
    let txHex;
    for (const serializedPSBTEnvelop of serializedPSBTEnvelops) {
      if (serializedPSBTEnvelop.txHex) {
        txHex = serializedPSBTEnvelop.txHex; // txHex is given out by COLDCARD, KEYSTONE and TREZOR post signing
      }
    }

    const { txid, finalOutputs, inputs } = yield call(
      WalletOperations.transferST3,
      wallet,
      serializedPSBTEnvelops,
      txPrerequisites,
      txnPriority,
      customTxPrerequisites,
      txHex,
      miniscriptTxElements
    );

    if (!txid) throw new Error('Send failed: unable to generate txid using the signed PSBT');

    yield put(
      sendPhaseThreeExecuted({
        successful: true,
        txid,
      })
    );

    if (note) {
      yield call(addLabelsWorker, {
        payload: {
          txId: txid,
          wallet,
          labels: [{ name: note, isSystem: false }],
          type: LabelRefType.TXN,
        },
      });
    }

    if (finalOutputs) {
      yield call(handleChangeOutputLabels, finalOutputs, inputs, wallet, txid);
    }
  } catch (err) {
    if ([ELECTRUM_NOT_CONNECTED_ERR, ELECTRUM_NOT_CONNECTED_ERR_TOR].includes(err?.message)) {
      yield put(setElectrumNotConnectedErr(err?.message));
    }

    yield put(
      sendPhaseThreeExecuted({
        successful: false,
        err: err.message,
      })
    );
  }
}

export const sendPhaseThreeWatcher = createWatcher(sendPhaseThreeWorker, SEND_PHASE_THREE);

function* handleChangeOutputLabels(finalOutputs, inputs, wallet, txid) {
  const changeOutputIndex = finalOutputs.findIndex((output) =>
    Object.values(wallet.specs.addresses.internal).includes(output.address)
  );

  const changeOutput = changeOutputIndex !== -1 ? finalOutputs[changeOutputIndex] : null;

  if (changeOutput) {
    let labels: { ref: string; label: string; isSystem: boolean }[] = yield call(
      dbManager.getCollection,
      RealmSchema.Tags
    );

    const labelChanges = {
      added: [],
      deleted: [],
    };

    const prevUTXOsLabels = labels.filter((label) =>
      inputs.map((input) => input.txId + ':' + input.vout).includes(label.ref)
    );
    labelChanges.added.push({
      name: 'Change',
      isSystem: false,
    });

    if (prevUTXOsLabels) {
      labelChanges.added.push(
        ...prevUTXOsLabels.map((label) => ({
          name: label.label,
          isSystem: label.isSystem,
        }))
      );
    }

    yield fork(bulkUpdateLabelsWorker, {
      payload: {
        labelChanges,
        UTXO: { txId: txid, vout: changeOutputIndex },
        wallet: wallet as any,
      },
    });
  }
}

function* calculateSendMaxFee({ payload }: CalculateSendMaxFeeAction) {
  const { recipients, wallet, selectedUTXOs, miniscriptSelectedSatisfier } = payload;
  const averageTxFees: AverageTxFeesByNetwork = yield select(
    (state) => state.network.averageTxFees
  );
  const averageTxFeeByNetwork = averageTxFees[wallet.networkType];
  const feePerByte = Number(
    payload.feePerByte ? payload.feePerByte : averageTxFeeByNetwork[TxPriority.LOW].feePerByte
  );

  const { fee } = WalletOperations.calculateSendMaxFee(
    wallet,
    recipients,
    feePerByte,
    selectedUTXOs,
    miniscriptSelectedSatisfier
  );

  yield put(setSendMaxFee(fee));
}

export const calculateSendMaxFeeWatcher = createWatcher(
  calculateSendMaxFee,
  CALCULATE_SEND_MAX_FEE
);

function* calculateCustomFee({ payload }: CalculateCustomFeeAction) {
  try {
    if (parseInt(payload.feePerByte, 10) < 1) {
      yield put(
        customFeeCalculated({
          successful: false,
          err: 'Minimum custom fee: 1 sat/byte',
        })
      );
      return;
    }

    const {
      wallet,
      recipients,
      feePerByte,
      customEstimatedBlocks,
      selectedUTXOs,
      miniscriptSelectedSatisfier,
    } = payload;

    let outputs;
    if (recipients && recipients.length) {
      // process recipients & generate outputs (normally handled by transfer ST1 saga)
      const outputsArray = [];
      for (const recipient of recipients) {
        outputsArray.push({
          address: recipient.address,
          value: Math.round(recipient.amount),
        });
      }
      outputs = outputsArray;
    }

    if (!outputs) {
      yield put(
        customFeeCalculated({
          successful: false,
          err: 'Transaction recipients not provided',
        })
      );
    }

    const { txPrerequisites: customTxPrerequisites, txRecipients: customTxRecipients } =
      WalletOperations.prepareCustomTransactionPrerequisites(
        wallet,
        outputs,
        parseInt(feePerByte, 10),
        selectedUTXOs,
        miniscriptSelectedSatisfier
      );

    if (customTxPrerequisites[TxPriority.CUSTOM]?.inputs) {
      customTxPrerequisites[TxPriority.CUSTOM].estimatedBlocks = parseInt(
        customEstimatedBlocks,
        10
      );

      yield put(
        customFeeCalculated({
          successful: true,
          outputs: {
            customTxPrerequisites,
            customTxRecipients,
          },
          err: null,
        })
      );
    } else {
      yield put(
        customFeeCalculated({
          successful: false,
          err: 'Fee is too high for your balance, please select another option',
        })
      );
    }
  } catch (err) {
    yield put(
      customFeeCalculated({
        successful: false,
        err,
      })
    );
  }
}

export const calculateCustomFeeWatcher = createWatcher(calculateCustomFee, CALCULATE_CUSTOM_FEE);

function* discardBroadcastedTnxWorker({ payload }) {
  const { cachedTxid, vault } = payload;
  const snapshots = yield select((state) => state.cachedTxn.snapshots);
  if (snapshots[cachedTxid]) {
    const psbt = snapshots[cachedTxid].state.sendPhaseTwo.serializedPSBTEnvelops[0].serializedPSBT;
    const psbtObject = bitcoin.Psbt.fromBase64(psbt);
    const finalOutputs = getOutputsFromPsbt(psbtObject);
    const inputs = Object.keys(psbtObject.__CACHE.__TX_IN_CACHE).map((key) => {
      const [txId, vout] = key.split(':');
      return { txId, vout };
    });
    const potentialTxId = snapshots[cachedTxid].potentialTxId;
    const note = snapshots[cachedTxid].routeParams.note;
    yield call(handleChangeOutputLabels, finalOutputs, inputs, vault, potentialTxId);
    if (note.length) {
      yield call(addLabelsWorker, {
        payload: {
          txId: potentialTxId,
          wallet: vault,
          labels: [{ name: note, isSystem: false }],
          type: LabelRefType.TXN,
        },
      });
    }
    yield put(dropTransactionSnapshot({ cachedTxid }));
  }
}

export const discardBroadcastedTnxWatcher = createWatcher(
  discardBroadcastedTnxWorker,
  DISCARD_BROADCASTED_TNX
);

const reformatExchangeRates = (rawExchangeRates) => {
  const formattedExchangeRates = {};
  Object.keys(rawExchangeRates).forEach((key) => {
    const value = rawExchangeRates[key];
    if (value.type === 'fiat') {
      const fiatData = {
        '15m': value.value,
        last: value.value,
        buy: value.value,
        sell: value.value,
        symbol: value.unit,
      };
      formattedExchangeRates[key.toUpperCase()] = fiatData;
    }
  });
  return formattedExchangeRates;
};