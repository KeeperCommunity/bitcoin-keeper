/** Historical transfer states remain in stored USDT transactions. */
export enum GasFreeTransferStatus {
  WAITING = 'WAITING',
  INPROGRESS = 'INPROGRESS',
  CONFIRMING = 'CONFIRMING',
  SUCCEED = 'SUCCEED',
  FAILED = 'FAILED',
}
