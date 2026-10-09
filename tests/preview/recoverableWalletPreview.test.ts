import {
  getPreviewRuntime,
  PREVIEW_BUNDLE_IDS,
} from '../../src/preview/recoverable-wallet/previewRuntime';
import {
  HARDWARE_CHOICES,
  initialPreviewDraft,
  reducePreviewDraft,
} from '../../src/preview/recoverable-wallet/previewFlow';

describe('Recoverable Wallet preview isolation', () => {
  test.each(PREVIEW_BUNDLE_IDS)(
    'permits only the matching testnet preview build: %s',
    (bundleId) => {
      expect(getPreviewRuntime('true', bundleId, 'true')).toBe('preview');
      expect(getPreviewRuntime(undefined, bundleId, 'true')).toBe('misconfigured');
      expect(getPreviewRuntime('true', bundleId, undefined)).toBe('misconfigured');
    }
  );

  test('does not expose preview in the regular app or an accidentally flagged regular build', () => {
    expect(getPreviewRuntime(undefined, 'io.hexawallet.keeper', undefined)).toBe('production');
    expect(getPreviewRuntime('true', 'io.hexawallet.keeper', 'true')).toBe('misconfigured');
    expect(
      getPreviewRuntime(undefined, 'io.hexawallet.someapp.recoverablepreview', undefined)
    ).toBe('misconfigured');
    expect(getPreviewRuntime(undefined, 'io.hexawallet.keeper', 'true')).toBe('misconfigured');
  });
});

describe('Recoverable Wallet walkthrough', () => {
  test.each(HARDWARE_CHOICES)('requires a selected $id before final review', ({ id }) => {
    const hardwareStage = reducePreviewDraft(initialPreviewDraft, { type: 'NEXT' });
    expect(reducePreviewDraft(hardwareStage, { type: 'NEXT' })).toEqual(hardwareStage);

    const selected = reducePreviewDraft(hardwareStage, { type: 'SELECT_HARDWARE', hardware: id });
    const connectStage = reducePreviewDraft(selected, { type: 'NEXT' });
    expect(connectStage.stage).toBe('connect');
    expect(connectStage.hardware).toBe(id);
    expect(
      reducePreviewDraft(connectStage, { type: 'ATTEMPT_CONNECTION' }).connectionAttempts
    ).toBe(1);

    const inheritanceStage = reducePreviewDraft(connectStage, { type: 'CONTINUE_SIMULATION' });
    const reviewStage = reducePreviewDraft(inheritanceStage, { type: 'NEXT' });
    expect(reviewStage.stage).toBe('review');
    expect(reviewStage.hardware).toBe(id);
    expect(reviewStage.inheritanceEnabled).toBe(false);
    expect(reducePreviewDraft(reviewStage, { type: 'NEXT' }).stage).toBe('complete');
  });

  test('Coldcard inheritance remains an unverified proposal before one final review', () => {
    let draft = reducePreviewDraft(initialPreviewDraft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'SELECT_HARDWARE', hardware: 'Coldcard' });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'CONTINUE_SIMULATION' });
    draft = reducePreviewDraft(draft, { type: 'SET_INHERITANCE', enabled: true });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    expect(draft).toMatchObject({
      stage: 'review',
      hardware: 'Coldcard',
      inheritanceEnabled: true,
    });

    draft = reducePreviewDraft(draft, { type: 'BACK' });
    draft = reducePreviewDraft(draft, { type: 'SET_INHERITANCE', enabled: false });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    expect(draft).toMatchObject({ stage: 'review', inheritanceEnabled: false });
  });

  test.each(['TAPSIGNER', 'Satochip', 'Jade'] as const)(
    '%s cannot enter the inheritance proposal but can review base 2-of-3',
    (hardware) => {
      let draft = reducePreviewDraft(initialPreviewDraft, { type: 'NEXT' });
      draft = reducePreviewDraft(draft, { type: 'SELECT_HARDWARE', hardware });
      draft = reducePreviewDraft(draft, { type: 'NEXT' });
      draft = reducePreviewDraft(draft, { type: 'CONTINUE_SIMULATION' });
      expect(reducePreviewDraft(draft, { type: 'SET_INHERITANCE', enabled: true })).toEqual(draft);
      draft = reducePreviewDraft(draft, { type: 'NEXT' });
      expect(draft).toMatchObject({ stage: 'review', hardware, inheritanceEnabled: false });
      expect(
        reducePreviewDraft(
          { ...draft, stage: 'inheritance', inheritanceEnabled: true },
          { type: 'NEXT' }
        ).stage
      ).toBe('inheritance');
    }
  );

  test('changing away from Coldcard discards the old inheritance choice', () => {
    let draft = reducePreviewDraft(initialPreviewDraft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'SELECT_HARDWARE', hardware: 'Coldcard' });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'CONTINUE_SIMULATION' });
    draft = reducePreviewDraft(draft, { type: 'SET_INHERITANCE', enabled: true });
    draft = reducePreviewDraft(draft, { type: 'CHANGE_HARDWARE' });
    expect(draft).toMatchObject({
      stage: 'hardware',
      hardware: null,
      inheritanceEnabled: false,
    });
    draft = reducePreviewDraft(draft, { type: 'SELECT_HARDWARE', hardware: 'Jade' });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'CONTINUE_SIMULATION' });
    expect(reducePreviewDraft(draft, { type: 'SET_INHERITANCE', enabled: true })).toEqual(draft);
  });

  test('a connection attempt never marks hardware connected and a reset discards the draft', () => {
    let draft = reducePreviewDraft(initialPreviewDraft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'SELECT_HARDWARE', hardware: 'TAPSIGNER' });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'ATTEMPT_CONNECTION' });
    draft = reducePreviewDraft(draft, { type: 'ATTEMPT_CONNECTION' });
    expect(draft).toEqual({
      stage: 'connect',
      hardware: 'TAPSIGNER',
      connectionAttempts: 2,
      inheritanceEnabled: false,
    });
    expect(reducePreviewDraft(draft, { type: 'RESET' })).toEqual(initialPreviewDraft);
  });
});
