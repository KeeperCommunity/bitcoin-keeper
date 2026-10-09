export const RESET_REDUX_STORE = 'RESET_REDUX_STORE';
export const UPDATE_VERSION_HISTORY = 'UPDATE_VERSION_HISTORY';
export const MIGRATE_LABELS_329 = 'MIGRATE_LABELS_329';

export const updateVersionHistory = (previousVersion, newVersion, isRecovery = false, originAppId?: string) => ({
  type: UPDATE_VERSION_HISTORY,
  payload: { previousVersion, newVersion, isRecovery },
  originAppId,
});

export const migrateLabelsToBip329 = (originAppId?: string) => ({
  type: MIGRATE_LABELS_329,
  originAppId,
});
