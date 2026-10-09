/** Historical transfer states remain in stored USDT transactions. */
export enum GasFreeTransferStatus {
  WAITING = 'WAITING',
  INPROGRESS = 'INPROGRESS',
  CONFIRMING = 'CONFIRMING',
  // SUCCEED was also written for provider-reported results in older builds.
  SUCCEED = 'SUCCEED',
  UNVERIFIED = 'UNVERIFIED',
  CHAIN_CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}
