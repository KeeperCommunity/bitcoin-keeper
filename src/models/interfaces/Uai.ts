export interface UAI {
  id: string;
  uaiType: uaiType;
  entityId?: string;
  lastActioned?: Date;
  uaiDetails?: {
    heading?: string;
    body?: string;
    networkType?: string;
  };
  createdAt?: Date;
  seenAt?: Date;
}

export enum uaiType {
  // Locally Generated
  SECURE_VAULT = 'SECURE_VAULT',
  SIGNING_DEVICES_HEALTH_CHECK = 'SIGNING_DEVICES_HEALTH_CHECK',
  RECOVERY_PHRASE_HEALTH_CHECK = 'RECOVERY_PHRASE_HEALTH CHECK',
  FEE_INISGHT = 'FEE_INISGHT',
  CANARAY_WALLET = 'CANARY_WALLET',
  SIGNING_DELAY = 'SIGNING_DELAY',
  POLICY_DELAY = 'POLICY_DELAY',
  INCOMING_TRANSACTION = 'INCOMING_TRANSACTION',
  SERVER_BACKUP_FAILURE = 'SERVER_BACKUP_FAILURE',

  // Notifcation UAIs
  ZENDESK_TICKET = 'ZENDESK_TICKET',

  // No UAI support yet for these types
  DEFAULT = 'DEFAULT',
  RELEASE_MESSAGE = 'RELEASE_MESSAGE',
}
