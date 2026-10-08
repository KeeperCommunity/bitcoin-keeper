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

  test('inheritance is chosen before one final review and remains editable when going back', () => {
    let draft = reducePreviewDraft(initialPreviewDraft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'SELECT_HARDWARE', hardware: 'Satochip' });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    draft = reducePreviewDraft(draft, { type: 'CONTINUE_SIMULATION' });
    draft = reducePreviewDraft(draft, { type: 'SET_INHERITANCE', enabled: true });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    expect(draft).toMatchObject({
      stage: 'review',
      hardware: 'Satochip',
      inheritanceEnabled: true,
    });

    draft = reducePreviewDraft(draft, { type: 'BACK' });
    draft = reducePreviewDraft(draft, { type: 'SET_INHERITANCE', enabled: false });
    draft = reducePreviewDraft(draft, { type: 'NEXT' });
    expect(draft).toMatchObject({ stage: 'review', inheritanceEnabled: false });
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
