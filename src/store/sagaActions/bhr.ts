import { Signer, Vault } from 'src/services/wallets/interfaces/vault';

export const UPDATE_APP_IMAGE = 'UPDATE_APP_IMAGE';
export const GET_APP_IMAGE = 'GET_APP_IMAGE';
export const SEED_BACKEDUP = 'SEED_BACKEDUP';
export const SEED_BACKEDUP_CONFIRMED = 'SEED_BACKEDUP_CONFIRMED';
export const UPADTE_HEALTH_CHECK_SIGNER = 'UPADTE_HEALTH_CHECK_SIGNER';
export const UPDATE_VAULT_IMAGE = 'UPDATE_VAULT_IMAGE';
export const BACKUP_BSMS_ON_CLOUD = 'BACKUP_BSMS_ON_CLOUD';
export const BSMS_CLOUD_HEALTH_CHECK = 'BSMS_CLOUD_HEALTH_CHECK';
export const DELETE_APP_IMAGE_ENTITY = 'DELETE_APP_IMAGE_ENTITY';
export const HEALTH_CHECK_STATUS_UPDATE = 'HEALTH_CHECK_STATUS_UPDATE';
export const BACKUP_ALL_SIGNERS_AND_VAULTS = 'BACKUP_ALL_SIGNERS_AND_VAULTS';
export const SET_AUTOMATIC_CLOUD_BACKUP = 'SET_AUTOMATIC_CLOUD_BACKUP';
export const DELETE_BACKUP = 'DELETE_BACKUP';
export const VALIDATE_SERVER_BACKUP = 'VALIDATE_SERVER_BACKUP';

export const updateAppImage = ({ wallets, signers, updateNodes }) => ({
  type: UPDATE_APP_IMAGE,
  payload: {
    wallets,
    signers,
    updateNodes,
  },
});

export const deleteAppImageEntity = ({
  walletIds,
  signerIds,
}: {
  walletIds?: string[];
  signerIds?: string[];
}) => ({
  type: DELETE_APP_IMAGE_ENTITY,
  payload: {
    walletIds,
    signerIds,
  },
});

export const updateVaultImage = (payload: {
  vault: Vault;
  archiveVaultId?: string;
  isUpdate?: boolean;
}) => ({
  type: UPDATE_VAULT_IMAGE,
  payload,
});

export const getAppImage = (primaryMnemonic: string, isForgot: boolean) => ({
  type: GET_APP_IMAGE,
  payload: {
    primaryMnemonic,
    isForgot,
  },
});

export const seedBackedUp = () => ({
  type: SEED_BACKEDUP,
});

export const seedBackedConfirmed = (confirmed: boolean) => ({
  type: SEED_BACKEDUP_CONFIRMED,
  payload: {
    confirmed,
  },
});

// HealthChecks

export const healthCheckSigner = (signers: Signer[]) => ({
  type: UPADTE_HEALTH_CHECK_SIGNER,
  payload: {
    signers,
  },
});

export const healthCheckStatusUpdate = (signerUpdates: { signerId: string; status: string }[]) => ({
  type: HEALTH_CHECK_STATUS_UPDATE,
  payload: {
    signerUpdates,
  },
});

export const backupBsmsOnCloud = () => ({
  type: BACKUP_BSMS_ON_CLOUD,
});

export const bsmsCloudHealthCheck = () => ({
  type: BSMS_CLOUD_HEALTH_CHECK,
});

export const backupAllSignersAndVaults = () => ({
  type: BACKUP_ALL_SIGNERS_AND_VAULTS,
});

export const setAutomaticCloudBackup = (payload) => ({
  type: SET_AUTOMATIC_CLOUD_BACKUP,
  payload,
});

export const deleteBackup = () => ({
  type: DELETE_BACKUP,
});

export const validateServerBackup = (callback) => ({
  type: VALIDATE_SERVER_BACKUP,
  callback,
});