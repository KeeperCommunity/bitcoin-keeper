import { NetworkType } from 'src/services/wallets/enums';
import {
  ContactApprovalEnvelopeMetadata,
  ContactRecoveryFlowError,
  EncryptedCloudReadbackReceipt,
  RECOVERABLE_PREVIEW_CLOUD_NAMESPACE,
  decideContactRequest,
  initialContactEnrollment,
  initialContactRecovery,
  reduceContactEnrollment,
  reduceContactRecovery,
  reviewContactRequest,
} from 'src/services/wallets/recoverable/contactRecoveryFlow';

const NOW = 1_700_000_000;
const WALLET = 'ab'.repeat(32).toUpperCase();
const DIGEST = 'a'.repeat(64);

function readback(): EncryptedCloudReadbackReceipt {
  return {
    kind: 'encrypted-mobile-key-readback-v1',
    network: NetworkType.TESTNET,
    namespace: RECOVERABLE_PREVIEW_CLOUD_NAMESPACE,
    walletPolicyHash: WALLET,
    objectId: 'test-object-1',
    writtenCiphertextSha256: DIGEST,
    readCiphertextSha256: DIGEST,
    checkedAt: NOW,
  };
}

function request() {
  return {
    requestId: 'test-request-1',
    walletPolicyHash: WALLET,
    contactCredentialId: 'contact-key-1',
    replacementDeviceKeyId: 'new-device-key-1',
    expiresAt: NOW + 600,
  };
}

function expectCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ContactRecoveryFlowError);
    expect((error as ContactRecoveryFlowError).code).toBe(code);
  }
}

describe('Recovery Contact client-only flow', () => {
  test('enrollment needs cloud readback, handles offline, and stops before crypto enrollment', () => {
    let state = reduceContactEnrollment(initialContactEnrollment, {
      type: 'START',
      assurance: 'cloud-and-contact',
      walletPolicyHash: WALLET,
    });
    state = reduceContactEnrollment(state, { type: 'CLOUD_OFFLINE' });
    expect(state.stage).toBe('cloud-offline');
    expectCode(
      () =>
        reduceContactEnrollment(state, {
          type: 'INVITE',
          invitationId: 'invite-1',
          expiresAt: NOW + 60,
          now: NOW,
        }),
      'INVALID_TRANSITION'
    );
    state = reduceContactEnrollment(state, { type: 'RETRY_CLOUD' });
    state = reduceContactEnrollment(state, { type: 'CLOUD_READBACK', receipt: readback() });
    state = reduceContactEnrollment(state, {
      type: 'INVITE',
      invitationId: 'invite-1',
      expiresAt: NOW + 60,
      now: NOW,
    });
    state = reduceContactEnrollment(state, {
      type: 'CONTACT_ACCEPTED',
      invitationId: 'invite-1',
      contactCredentialId: 'contact-key-1',
      now: NOW + 1,
    });
    expect(state.stage).toBe('awaiting-cryptographic-enrollment');
    expect(state.contactCredentialId).toBe('contact-key-1');
    expect(JSON.stringify(state)).not.toMatch(/xpriv|mnemonic|recoveryCode/i);
  });

  test('a write receipt without matching preview readback cannot start enrollment', () => {
    const started = reduceContactEnrollment(initialContactEnrollment, {
      type: 'START',
      assurance: 'cloud-and-contact',
      walletPolicyHash: WALLET,
    });
    const wrongBytes = readback();
    wrongBytes.readCiphertextSha256 = 'b'.repeat(64);
    expectCode(
      () => reduceContactEnrollment(started, { type: 'CLOUD_READBACK', receipt: wrongBytes }),
      'READBACK_MISMATCH'
    );
    const wrongNamespace = readback();
    wrongNamespace.namespace = 'production' as any;
    expectCode(
      () => reduceContactEnrollment(started, { type: 'CLOUD_READBACK', receipt: wrongNamespace }),
      'INVALID_READBACK'
    );
    const wrongPolicy = readback();
    wrongPolicy.walletPolicyHash = 'cd'.repeat(32);
    expectCode(
      () => reduceContactEnrollment(started, { type: 'CLOUD_READBACK', receipt: wrongPolicy }),
      'INVALID_READBACK'
    );
    const shortFingerprint = readback();
    shortFingerprint.walletPolicyHash = 'ABCDEF12';
    expectCode(
      () => reduceContactEnrollment(started, { type: 'CLOUD_READBACK', receipt: shortFingerprint }),
      'INVALID_POLICY_HASH'
    );
  });

  test('contact can explicitly decline, and an invitation cannot be accepted after expiry', () => {
    let state = reduceContactEnrollment(initialContactEnrollment, {
      type: 'START',
      assurance: 'cloud-and-contact',
      walletPolicyHash: WALLET,
    });
    state = reduceContactEnrollment(state, { type: 'CLOUD_READBACK', receipt: readback() });
    state = reduceContactEnrollment(state, {
      type: 'INVITE',
      invitationId: 'invite-1',
      expiresAt: NOW + 5,
      now: NOW,
    });
    expectCode(
      () =>
        reduceContactEnrollment(state, {
          type: 'CONTACT_ACCEPTED',
          invitationId: 'invite-1',
          contactCredentialId: 'contact-key-1',
          now: NOW + 5,
        }),
      'REQUEST_EXPIRED'
    );
    expect(reduceContactEnrollment(state, { type: 'EXPIRE', now: NOW + 5 }).stage).toBe('expired');
    expect(
      reduceContactEnrollment(state, {
        type: 'CONTACT_DECLINED',
        invitationId: 'invite-1',
        now: NOW + 1,
      }).stage
    ).toBe('declined');
  });

  test('the stronger option requires a separate code check before contacting anyone', () => {
    let state = reduceContactRecovery(initialContactRecovery, {
      type: 'START',
      assurance: 'cloud-contact-and-code',
      walletPolicyHash: WALLET,
      contactCredentialId: 'contact-key-1',
    });
    state = reduceContactRecovery(state, { type: 'CLOUD_READBACK', receipt: readback() });
    expect(state.stage).toBe('awaiting-code-verification');
    expectCode(
      () => reduceContactRecovery(state, { type: 'REQUEST_CONTACT', request: request(), now: NOW }),
      'INVALID_TRANSITION'
    );
    state = reduceContactRecovery(state, { type: 'CODE_VERIFIED' });
    state = reduceContactRecovery(state, { type: 'REQUEST_CONTACT', request: request(), now: NOW });
    expect(state.codeVerified).toBe(true);
    expect(state.stage).toBe('waiting-for-contact');
    expect(JSON.stringify(state)).not.toContain('recoveryCode');
  });

  test('cloud and contact option can use an independent request after readback', () => {
    let state = reduceContactRecovery(initialContactRecovery, {
      type: 'START',
      assurance: 'cloud-and-contact',
      walletPolicyHash: WALLET,
      contactCredentialId: 'contact-key-1',
    });
    state = reduceContactRecovery(state, { type: 'CLOUD_OFFLINE' });
    expect(state.stage).toBe('cloud-offline');
    state = reduceContactRecovery(state, { type: 'RETRY_CLOUD' });
    state = reduceContactRecovery(state, { type: 'CLOUD_READBACK', receipt: readback() });
    expect(state.stage).toBe('awaiting-contact-request');
    state = reduceContactRecovery(state, { type: 'REQUEST_CONTACT', request: request(), now: NOW });
    expect(state.stage).toBe('waiting-for-contact');
  });

  test('approval metadata must bind to the active request and replacement device', () => {
    let state = reduceContactRecovery(initialContactRecovery, {
      type: 'START',
      assurance: 'cloud-and-contact',
      walletPolicyHash: WALLET,
      contactCredentialId: 'contact-key-1',
    });
    state = reduceContactRecovery(state, { type: 'CLOUD_READBACK', receipt: readback() });
    state = reduceContactRecovery(state, { type: 'REQUEST_CONTACT', request: request(), now: NOW });
    const envelope: ContactApprovalEnvelopeMetadata = {
      ...request(),
      kind: 'contact-approval-envelope-v1',
      ciphertextSha256: 'b'.repeat(64),
    };
    expectCode(
      () =>
        reduceContactRecovery(state, {
          type: 'APPROVAL_RECEIVED',
          envelope: { ...envelope, requestId: 'old-request' },
          now: NOW + 1,
        }),
      'REQUEST_MISMATCH'
    );
    expectCode(
      () =>
        reduceContactRecovery(state, {
          type: 'APPROVAL_RECEIVED',
          envelope: { ...envelope, replacementDeviceKeyId: 'attacker-device' },
          now: NOW + 1,
        }),
      'ENVELOPE_MISMATCH'
    );
    state = reduceContactRecovery(state, { type: 'APPROVAL_RECEIVED', envelope, now: NOW + 1 });
    expect(state.stage).toBe('awaiting-cryptographic-verification');
    expectCode(
      () => reduceContactRecovery(state, { type: 'APPROVAL_RECEIVED', envelope, now: NOW + 2 }),
      'INVALID_TRANSITION'
    );
  });

  test('recovery decline and timeout are terminal without a restored-key state', () => {
    let state = reduceContactRecovery(initialContactRecovery, {
      type: 'START',
      assurance: 'cloud-and-contact',
      walletPolicyHash: WALLET,
      contactCredentialId: 'contact-key-1',
    });
    state = reduceContactRecovery(state, { type: 'CLOUD_READBACK', receipt: readback() });
    state = reduceContactRecovery(state, { type: 'REQUEST_CONTACT', request: request(), now: NOW });
    expect(
      reduceContactRecovery(state, {
        type: 'CONTACT_DECLINED',
        requestId: 'test-request-1',
        now: NOW + 1,
      }).stage
    ).toBe('declined');
    expect(reduceContactRecovery(state, { type: 'EXPIRE', now: NOW + 600 }).stage).toBe('expired');
  });

  test('contact-side approval is intent only; expiry blocks it', () => {
    const pending = reviewContactRequest(request(), NOW);
    expect(decideContactRequest(pending, 'approve', NOW + 1).stage).toBe('approval-intent');
    expect(decideContactRequest(pending, 'decline', NOW + 1).stage).toBe('declined');
    expect(decideContactRequest(pending, 'approve', NOW + 600).stage).toBe('expired');
  });
});
