import { NetworkType } from '../enums';

/** Logical namespace only. Native iCloud/Drive isolation remains to be implemented. */
export const RECOVERABLE_PREVIEW_CLOUD_NAMESPACE = 'recoverable-wallet-preview-v1' as const;

/** Product choice remains open; both modes are modeled without collecting a code. */
export type ContactRecoveryAssurance = 'cloud-and-contact' | 'cloud-contact-and-code';

/**
 * Metadata from a future encrypted cloud adapter. The reducer checks that a
 * downloaded object matches the bytes written. It does not verify encryption.
 */
export interface EncryptedCloudReadbackReceipt {
  kind: 'encrypted-mobile-key-readback-v1';
  network: NetworkType.TESTNET;
  namespace: typeof RECOVERABLE_PREVIEW_CLOUD_NAMESPACE;
  walletPolicyHash: string;
  objectId: string;
  writtenCiphertextSha256: string;
  readCiphertextSha256: string;
  checkedAt: number;
}

export interface ContactExchangeRequest {
  requestId: string;
  walletPolicyHash: string;
  contactCredentialId: string;
  replacementDeviceKeyId: string;
  expiresAt: number;
}

/** Opaque public metadata only. The encrypted envelope and proof are verified elsewhere. */
export interface ContactApprovalEnvelopeMetadata extends ContactExchangeRequest {
  kind: 'contact-approval-envelope-v1';
  ciphertextSha256: string;
}

export type EnrollmentStage =
  | 'idle'
  | 'awaiting-cloud-readback'
  | 'cloud-offline'
  | 'awaiting-contact-invitation'
  | 'waiting-for-contact'
  | 'awaiting-cryptographic-enrollment'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface ContactEnrollmentState {
  stage: EnrollmentStage;
  assurance: ContactRecoveryAssurance | null;
  walletPolicyHash: string | null;
  readback: EncryptedCloudReadbackReceipt | null;
  invitation: { id: string; expiresAt: number } | null;
  contactCredentialId: string | null;
}

export const initialContactEnrollment: ContactEnrollmentState = {
  stage: 'idle',
  assurance: null,
  walletPolicyHash: null,
  readback: null,
  invitation: null,
  contactCredentialId: null,
};

export type ContactEnrollmentAction =
  | { type: 'START'; assurance: ContactRecoveryAssurance; walletPolicyHash: string }
  | { type: 'CLOUD_OFFLINE' }
  | { type: 'RETRY_CLOUD' }
  | { type: 'CLOUD_READBACK'; receipt: EncryptedCloudReadbackReceipt }
  | { type: 'INVITE'; invitationId: string; expiresAt: number; now: number }
  | { type: 'CONTACT_ACCEPTED'; invitationId: string; contactCredentialId: string; now: number }
  | { type: 'CONTACT_DECLINED'; invitationId: string; now: number }
  | { type: 'EXPIRE'; now: number }
  | { type: 'CANCEL' };

export type RecoveryStage =
  | 'idle'
  | 'awaiting-cloud-readback'
  | 'cloud-offline'
  | 'awaiting-code-verification'
  | 'awaiting-contact-request'
  | 'waiting-for-contact'
  | 'awaiting-cryptographic-verification'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface ContactRecoveryState {
  stage: RecoveryStage;
  assurance: ContactRecoveryAssurance | null;
  walletPolicyHash: string | null;
  contactCredentialId: string | null;
  readback: EncryptedCloudReadbackReceipt | null;
  codeVerified: boolean;
  request: ContactExchangeRequest | null;
  approval: ContactApprovalEnvelopeMetadata | null;
}

export const initialContactRecovery: ContactRecoveryState = {
  stage: 'idle',
  assurance: null,
  walletPolicyHash: null,
  contactCredentialId: null,
  readback: null,
  codeVerified: false,
  request: null,
  approval: null,
};

export type ContactRecoveryAction =
  | {
      type: 'START';
      assurance: ContactRecoveryAssurance;
      walletPolicyHash: string;
      contactCredentialId: string;
    }
  | { type: 'CLOUD_OFFLINE' }
  | { type: 'RETRY_CLOUD' }
  | { type: 'CLOUD_READBACK'; receipt: EncryptedCloudReadbackReceipt }
  | { type: 'CODE_VERIFIED' }
  | { type: 'REQUEST_CONTACT'; request: ContactExchangeRequest; now: number }
  | { type: 'APPROVAL_RECEIVED'; envelope: ContactApprovalEnvelopeMetadata; now: number }
  | { type: 'CONTACT_DECLINED'; requestId: string; now: number }
  | { type: 'EXPIRE'; now: number }
  | { type: 'CANCEL' };

export class ContactRecoveryFlowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ContactRecoveryFlowError';
  }
}

function fail(code: string, message: string): never {
  throw new ContactRecoveryFlowError(code, message);
}

function requireStage(actual: string, allowed: readonly string[]): void {
  if (!allowed.includes(actual)) fail('INVALID_TRANSITION', `Action unavailable from ${actual}`);
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value)) {
    fail('INVALID_REFERENCE', `${field} must be a public opaque identifier`);
  }
  return value;
}

function requirePolicyHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(value)) {
    fail('INVALID_POLICY_HASH', 'Wallet policy hash must be 32 bytes in hexadecimal');
  }
  return value.toUpperCase();
}

function requireNow(now: number): void {
  if (!Number.isSafeInteger(now) || now <= 0)
    fail('INVALID_TIME', 'A valid current time is required');
}

function requireAssurance(mode: ContactRecoveryAssurance): ContactRecoveryAssurance {
  if (mode !== 'cloud-and-contact' && mode !== 'cloud-contact-and-code') {
    fail('INVALID_ASSURANCE', 'Unsupported Recovery Contact assurance mode');
  }
  return mode;
}

function validateReadback(
  receipt: EncryptedCloudReadbackReceipt,
  expectedWalletPolicyHash: string
): EncryptedCloudReadbackReceipt {
  if (
    !receipt ||
    receipt.kind !== 'encrypted-mobile-key-readback-v1' ||
    receipt.network !== NetworkType.TESTNET ||
    receipt.namespace !== RECOVERABLE_PREVIEW_CLOUD_NAMESPACE ||
    requirePolicyHash(receipt.walletPolicyHash) !== expectedWalletPolicyHash
  ) {
    fail('INVALID_READBACK', 'Readback does not belong to this testnet preview wallet');
  }
  const objectId = requireId(receipt.objectId, 'Cloud object');
  if (
    !/^[a-fA-F0-9]{64}$/.test(receipt.writtenCiphertextSha256) ||
    !/^[a-fA-F0-9]{64}$/.test(receipt.readCiphertextSha256) ||
    receipt.writtenCiphertextSha256.toLowerCase() !== receipt.readCiphertextSha256.toLowerCase() ||
    !Number.isSafeInteger(receipt.checkedAt) ||
    receipt.checkedAt <= 0
  ) {
    fail('READBACK_MISMATCH', 'Encrypted cloud payload was not read back unchanged');
  }
  return {
    kind: 'encrypted-mobile-key-readback-v1',
    network: NetworkType.TESTNET,
    namespace: RECOVERABLE_PREVIEW_CLOUD_NAMESPACE,
    walletPolicyHash: expectedWalletPolicyHash,
    objectId,
    writtenCiphertextSha256: receipt.writtenCiphertextSha256.toLowerCase(),
    readCiphertextSha256: receipt.readCiphertextSha256.toLowerCase(),
    checkedAt: receipt.checkedAt,
  };
}

function validateRequest(
  request: ContactExchangeRequest,
  walletPolicyHash: string,
  contactCredentialId: string,
  now: number
): ContactExchangeRequest {
  requireNow(now);
  if (
    !request ||
    requirePolicyHash(request.walletPolicyHash) !== walletPolicyHash ||
    requireId(request.contactCredentialId, 'Contact credential') !== contactCredentialId ||
    !Number.isSafeInteger(request.expiresAt) ||
    request.expiresAt <= now
  ) {
    fail('INVALID_REQUEST', 'Recovery Contact request does not match this wallet or has expired');
  }
  return {
    requestId: requireId(request.requestId, 'Request'),
    walletPolicyHash,
    contactCredentialId,
    replacementDeviceKeyId: requireId(request.replacementDeviceKeyId, 'Replacement device key'),
    expiresAt: request.expiresAt,
  };
}

function requireActiveInvitation(
  invitation: NonNullable<ContactEnrollmentState['invitation']>,
  invitationId: string,
  now: number
) {
  requireNow(now);
  if (invitation.id !== invitationId) fail('REQUEST_MISMATCH', 'Invitation does not match');
  if (now >= invitation.expiresAt) fail('REQUEST_EXPIRED', 'Invitation has expired');
}

function requireActiveRequest(request: ContactExchangeRequest, requestId: string, now: number) {
  requireNow(now);
  if (request.requestId !== requestId) fail('REQUEST_MISMATCH', 'Request does not match');
  if (now >= request.expiresAt) fail('REQUEST_EXPIRED', 'Request has expired');
}

/** State only; accepting a contact does not yet prove a wrapped key is usable. */
export function reduceContactEnrollment(
  state: ContactEnrollmentState,
  action: ContactEnrollmentAction
): ContactEnrollmentState {
  switch (action.type) {
    case 'START':
      requireStage(state.stage, ['idle', 'declined', 'expired', 'cancelled']);
      return {
        ...initialContactEnrollment,
        stage: 'awaiting-cloud-readback',
        assurance: requireAssurance(action.assurance),
        walletPolicyHash: requirePolicyHash(action.walletPolicyHash),
      };
    case 'CLOUD_OFFLINE':
      requireStage(state.stage, ['awaiting-cloud-readback']);
      return { ...state, stage: 'cloud-offline' };
    case 'RETRY_CLOUD':
      requireStage(state.stage, ['cloud-offline']);
      return { ...state, stage: 'awaiting-cloud-readback' };
    case 'CLOUD_READBACK':
      requireStage(state.stage, ['awaiting-cloud-readback']);
      return {
        ...state,
        stage: 'awaiting-contact-invitation',
        readback: validateReadback(action.receipt, state.walletPolicyHash!),
      };
    case 'INVITE':
      requireStage(state.stage, ['awaiting-contact-invitation']);
      requireNow(action.now);
      if (!Number.isSafeInteger(action.expiresAt) || action.expiresAt <= action.now) {
        fail('INVALID_TIME', 'Contact invitation must expire in the future');
      }
      return {
        ...state,
        stage: 'waiting-for-contact',
        invitation: {
          id: requireId(action.invitationId, 'Invitation'),
          expiresAt: action.expiresAt,
        },
      };
    case 'CONTACT_ACCEPTED':
      requireStage(state.stage, ['waiting-for-contact']);
      requireActiveInvitation(state.invitation!, action.invitationId, action.now);
      return {
        ...state,
        stage: 'awaiting-cryptographic-enrollment',
        contactCredentialId: requireId(action.contactCredentialId, 'Contact credential'),
      };
    case 'CONTACT_DECLINED':
      requireStage(state.stage, ['waiting-for-contact']);
      requireActiveInvitation(state.invitation!, action.invitationId, action.now);
      return { ...state, stage: 'declined' };
    case 'EXPIRE':
      requireStage(state.stage, ['waiting-for-contact']);
      requireNow(action.now);
      return action.now >= state.invitation!.expiresAt ? { ...state, stage: 'expired' } : state;
    case 'CANCEL':
      requireStage(state.stage, [
        'awaiting-cloud-readback',
        'cloud-offline',
        'awaiting-contact-invitation',
        'waiting-for-contact',
        'awaiting-cryptographic-enrollment',
      ]);
      return { ...state, stage: 'cancelled' };
  }
}

/** State only; no action in this reducer decrypts or reconstructs a Mobile Key. */
export function reduceContactRecovery(
  state: ContactRecoveryState,
  action: ContactRecoveryAction
): ContactRecoveryState {
  switch (action.type) {
    case 'START':
      requireStage(state.stage, ['idle', 'declined', 'expired', 'cancelled']);
      return {
        ...initialContactRecovery,
        stage: 'awaiting-cloud-readback',
        assurance: requireAssurance(action.assurance),
        walletPolicyHash: requirePolicyHash(action.walletPolicyHash),
        contactCredentialId: requireId(action.contactCredentialId, 'Contact credential'),
      };
    case 'CLOUD_OFFLINE':
      requireStage(state.stage, ['awaiting-cloud-readback']);
      return { ...state, stage: 'cloud-offline' };
    case 'RETRY_CLOUD':
      requireStage(state.stage, ['cloud-offline']);
      return { ...state, stage: 'awaiting-cloud-readback' };
    case 'CLOUD_READBACK':
      requireStage(state.stage, ['awaiting-cloud-readback']);
      return {
        ...state,
        stage:
          state.assurance === 'cloud-contact-and-code'
            ? 'awaiting-code-verification'
            : 'awaiting-contact-request',
        readback: validateReadback(action.receipt, state.walletPolicyHash!),
      };
    case 'CODE_VERIFIED':
      requireStage(state.stage, ['awaiting-code-verification']);
      return { ...state, stage: 'awaiting-contact-request', codeVerified: true };
    case 'REQUEST_CONTACT':
      requireStage(state.stage, ['awaiting-contact-request']);
      if (
        !state.readback ||
        (state.assurance === 'cloud-contact-and-code' && !state.codeVerified)
      ) {
        fail('PREREQUISITE_MISSING', 'Cloud readback and required code check must finish first');
      }
      return {
        ...state,
        stage: 'waiting-for-contact',
        request: validateRequest(
          action.request,
          state.walletPolicyHash!,
          state.contactCredentialId!,
          action.now
        ),
      };
    case 'APPROVAL_RECEIVED': {
      requireStage(state.stage, ['waiting-for-contact']);
      const request = state.request!;
      requireActiveRequest(request, action.envelope?.requestId, action.now);
      if (
        action.envelope.kind !== 'contact-approval-envelope-v1' ||
        requirePolicyHash(action.envelope.walletPolicyHash) !== request.walletPolicyHash ||
        action.envelope.contactCredentialId !== request.contactCredentialId ||
        action.envelope.replacementDeviceKeyId !== request.replacementDeviceKeyId ||
        action.envelope.expiresAt !== request.expiresAt ||
        !/^[a-fA-F0-9]{64}$/.test(action.envelope.ciphertextSha256)
      ) {
        fail('ENVELOPE_MISMATCH', 'Contact response is not bound to this request and device');
      }
      return {
        ...state,
        stage: 'awaiting-cryptographic-verification',
        approval: {
          ...request,
          kind: 'contact-approval-envelope-v1',
          ciphertextSha256: action.envelope.ciphertextSha256.toLowerCase(),
        },
      };
    }
    case 'CONTACT_DECLINED':
      requireStage(state.stage, ['waiting-for-contact']);
      requireActiveRequest(state.request!, action.requestId, action.now);
      return { ...state, stage: 'declined' };
    case 'EXPIRE':
      requireStage(state.stage, ['waiting-for-contact']);
      requireNow(action.now);
      return action.now >= state.request!.expiresAt ? { ...state, stage: 'expired' } : state;
    case 'CANCEL':
      requireStage(state.stage, [
        'awaiting-cloud-readback',
        'cloud-offline',
        'awaiting-code-verification',
        'awaiting-contact-request',
        'waiting-for-contact',
        'awaiting-cryptographic-verification',
      ]);
      return { ...state, stage: 'cancelled' };
  }
}

export type ContactDecisionState =
  | { stage: 'pending'; request: ContactExchangeRequest }
  | { stage: 'approval-intent'; request: ContactExchangeRequest }
  | { stage: 'declined'; request: ContactExchangeRequest }
  | { stage: 'expired'; request: ContactExchangeRequest };

export function reviewContactRequest(
  request: ContactExchangeRequest,
  now: number
): ContactDecisionState {
  const validated = validateRequest(
    request,
    requirePolicyHash(request.walletPolicyHash),
    request.contactCredentialId,
    now
  );
  return { stage: 'pending', request: validated };
}

/** Approval intent still needs an independent, authenticated encryption channel. */
export function decideContactRequest(
  state: ContactDecisionState,
  decision: 'approve' | 'decline' | 'expire',
  now: number
): ContactDecisionState {
  requireStage(state.stage, ['pending']);
  requireNow(now);
  if (now >= state.request.expiresAt) return { ...state, stage: 'expired' };
  if (decision === 'approve') return { ...state, stage: 'approval-intent' };
  if (decision === 'decline') return { ...state, stage: 'declined' };
  if (decision === 'expire') return state;
  return fail('INVALID_DECISION', 'Unknown contact decision');
}
