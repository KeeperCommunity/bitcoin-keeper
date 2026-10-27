import { call } from 'redux-saga/effects';
import { healthCheckSatutsUpdateWorker, updateAppImageWorker } from 'src/store/sagas/bhr';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { RealmSchema } from 'src/storage/realm/enum';
import dbManager from 'src/storage/realm/dbManager';
import { SignerType } from 'src/services/wallets/enums';

jest.mock('src/storage/realm/dbManager', () => ({
  getObjectById: jest.fn(),
  updateObjectById: jest.fn(),
}));
jest.mock('src/storage/realm/utils', () => ({ getJSONFromRealmObject: (object) => object }));
jest.mock('src/store/utilities', () => ({ createWatcher: jest.fn() }));
jest.mock('src/store/sagas/wallets', () => ({}));
jest.mock('src/store/sagas/upgrade', () => ({}));
jest.mock('src/store/sagas/uai', () => ({}));
jest.mock('src/services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('src/services/backend/Relay', () => ({}));
jest.mock('src/utils/service-utilities/config', () => ({}));
jest.mock('src/utils/service-utilities/encryption', () => ({}));
jest.mock('src/services/wallets/operations/BIP85', () => ({}));
jest.mock('src/services/wallets/operations/utils', () => ({}));
jest.mock('src/hardware', () => ({}));
jest.mock('src/hardware/signerSetup', () => ({}));
jest.mock('src/nativemodules/CloudBackup', () => ({}));
jest.mock('src/utils/service-utilities/utils', () => ({}));
jest.mock('src/utils/utilities', () => ({}));
jest.mock('src/services/wallets/factories/USDTWalletFactory', () => ({}));

const stored = {
  id: 'fingerprint-account-network',
  type: SignerType.ONEKEY,
  masterFingerprint: '1234ABCD',
  extraData: { bleConnectId: 'old-pro' },
  signerDescription: 'Pro',
  healthCheckDetails: [],
};
const action = (onComplete) => ({
  payload: {
    signerUpdates: [
      {
        signerId: stored.masterFingerprint,
        keyId: stored.id,
        status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
        oneKeyDevice: { serialNo: 'PRO2-SERIAL', bleConnectId: 'pro2', name: 'Pro 2 DDE0' },
      },
    ],
  },
  onComplete,
});

test('saves serial binding and device-specific health result to the selected key only', () => {
  const onComplete = jest.fn();
  const worker = healthCheckSatutsUpdateWorker(action(onComplete));
  expect(worker.next().value).toEqual(call(dbManager.getObjectById, RealmSchema.Signer, stored.id));
  const backup = worker.next(stored).value as ReturnType<typeof call>;
  expect(backup.payload.fn).toBe(updateAppImageWorker);
  const backedUp = backup.payload.args[0].payload.signers[0];
  expect(backedUp.extraData.oneKeyDevices).toHaveLength(2);
  expect(backedUp.extraData.oneKeyDevices[0].bleConnectId).toBe('old-pro');
  expect(backedUp.extraData.oneKeyDevices[1]).toMatchObject({
    serialNo: 'PRO2-SERIAL',
    lastHealthCheck: expect.any(String),
  });
  expect(backedUp.healthCheckDetails[0].extraData.serialNo).toBe('PRO2-SERIAL');
  const write = worker.next({ updated: true }).value as ReturnType<typeof call>;
  expect(write.payload.fn).toBe(dbManager.updateObjectById);
  expect(write.payload.args.slice(0, 2)).toEqual([RealmSchema.Signer, stored.id]);
  expect(onComplete).not.toHaveBeenCalled();
  worker.next(true); // UAI update, after local persistence.
  worker.next();
  expect(onComplete).toHaveBeenCalledWith();
  expect(stored.extraData).toEqual({ bleConnectId: 'old-pro' });
});

test.each(['backup', 'local'])(
  'reports a %s persistence failure instead of health check success',
  (failure) => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const onComplete = jest.fn();
    const worker = healthCheckSatutsUpdateWorker(action(onComplete));
    worker.next();
    worker.next(stored);
    if (failure === 'backup') worker.next({ updated: false });
    else {
      worker.next({ updated: true });
      worker.next(false);
    }
    expect(onComplete).toHaveBeenCalledWith(expect.stringContaining('Could not save'));
    log.mockRestore();
  }
);
