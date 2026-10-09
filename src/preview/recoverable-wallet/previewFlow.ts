export const HARDWARE_CHOICES = [
  {
    id: 'TAPSIGNER',
    transport: 'NFC',
    verification: 'Inheritance Key unavailable; the card cannot verify the full delayed policy.',
  },
  {
    id: 'Satochip',
    transport: 'NFC',
    verification: 'Inheritance Key unavailable; the card cannot verify the full delayed policy.',
  },
  {
    id: 'Jade',
    transport: 'QR or Keeper Desktop USB',
    verification: 'Inheritance Key unavailable; full policy verification is not yet supported.',
  },
  {
    id: 'Coldcard',
    transport: 'QR, file, NFC, or Keeper Desktop USB',
    verification: 'Inheritance Key review candidate; full policy support remains unverified.',
  },
] as const;

export type PreviewHardware = (typeof HARDWARE_CHOICES)[number]['id'];
/** Matches the public policy draft's current inheritance capability gate. */
export const canPreviewInheritanceForHardware = (hardware: PreviewHardware | null): boolean =>
  hardware === 'Coldcard';
export type PreviewStage =
  | 'automatic'
  | 'hardware'
  | 'connect'
  | 'inheritance'
  | 'review'
  | 'complete';

export type PreviewDraft = {
  stage: PreviewStage;
  hardware: PreviewHardware | null;
  connectionAttempts: number;
  inheritanceEnabled: boolean;
};

export const initialPreviewDraft: PreviewDraft = {
  stage: 'automatic',
  hardware: null,
  connectionAttempts: 0,
  inheritanceEnabled: false,
};

export type PreviewAction =
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'SELECT_HARDWARE'; hardware: PreviewHardware }
  | { type: 'ATTEMPT_CONNECTION' }
  | { type: 'CONTINUE_SIMULATION' }
  | { type: 'SET_INHERITANCE'; enabled: boolean }
  | { type: 'CHANGE_HARDWARE' }
  | { type: 'RESET' };

export function reducePreviewDraft(draft: PreviewDraft, action: PreviewAction): PreviewDraft {
  switch (action.type) {
    case 'RESET':
      return initialPreviewDraft;
    case 'SELECT_HARDWARE':
      return draft.stage === 'hardware' && HARDWARE_CHOICES.some(({ id }) => id === action.hardware)
        ? { ...draft, hardware: action.hardware, connectionAttempts: 0, inheritanceEnabled: false }
        : draft;
    case 'ATTEMPT_CONNECTION':
      return draft.stage === 'connect'
        ? { ...draft, connectionAttempts: draft.connectionAttempts + 1 }
        : draft;
    case 'CONTINUE_SIMULATION':
      return draft.stage === 'connect' && draft.hardware
        ? { ...draft, stage: 'inheritance' }
        : draft;
    case 'SET_INHERITANCE':
      return draft.stage === 'inheritance' &&
        (!action.enabled || canPreviewInheritanceForHardware(draft.hardware))
        ? { ...draft, inheritanceEnabled: action.enabled }
        : draft;
    case 'CHANGE_HARDWARE':
      return draft.stage === 'inheritance'
        ? {
            ...draft,
            stage: 'hardware',
            hardware: null,
            connectionAttempts: 0,
            inheritanceEnabled: false,
          }
        : draft;
    case 'NEXT':
      if (draft.stage === 'automatic') return { ...draft, stage: 'hardware' };
      if (draft.stage === 'hardware' && draft.hardware) return { ...draft, stage: 'connect' };
      if (
        draft.stage === 'inheritance' &&
        draft.hardware &&
        (!draft.inheritanceEnabled || canPreviewInheritanceForHardware(draft.hardware))
      )
        return { ...draft, stage: 'review' };
      if (draft.stage === 'review' && draft.hardware) return { ...draft, stage: 'complete' };
      return draft;
    case 'BACK':
      if (draft.stage === 'hardware') return { ...draft, stage: 'automatic' };
      if (draft.stage === 'connect') return { ...draft, stage: 'hardware' };
      if (draft.stage === 'inheritance') return { ...draft, stage: 'connect' };
      if (draft.stage === 'review') return { ...draft, stage: 'inheritance' };
      return draft;
    default:
      return draft;
  }
}
