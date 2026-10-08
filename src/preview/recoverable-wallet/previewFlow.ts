export const HARDWARE_CHOICES = [
  {
    id: 'TAPSIGNER',
    transport: 'NFC',
    verification: 'Signing device; full wallet policy cannot be verified on the card.',
  },
  {
    id: 'Satochip',
    transport: 'NFC',
    verification: 'Signing device; full wallet policy cannot be verified on the card.',
  },
  {
    id: 'Jade',
    transport: 'QR or Keeper Desktop USB',
    verification: 'Full Recoverable Wallet policy compatibility is not yet verified.',
  },
  {
    id: 'Coldcard',
    transport: 'QR, file, NFC, or Keeper Desktop USB',
    verification: 'Full Recoverable Wallet policy compatibility is not yet verified.',
  },
] as const;

export type PreviewHardware = (typeof HARDWARE_CHOICES)[number]['id'];
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
  | { type: 'RESET' };

export function reducePreviewDraft(draft: PreviewDraft, action: PreviewAction): PreviewDraft {
  switch (action.type) {
    case 'RESET':
      return initialPreviewDraft;
    case 'SELECT_HARDWARE':
      return draft.stage === 'hardware' && HARDWARE_CHOICES.some(({ id }) => id === action.hardware)
        ? { ...draft, hardware: action.hardware, connectionAttempts: 0 }
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
      return draft.stage === 'inheritance'
        ? { ...draft, inheritanceEnabled: action.enabled }
        : draft;
    case 'NEXT':
      if (draft.stage === 'automatic') return { ...draft, stage: 'hardware' };
      if (draft.stage === 'hardware' && draft.hardware) return { ...draft, stage: 'connect' };
      if (draft.stage === 'inheritance' && draft.hardware) return { ...draft, stage: 'review' };
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
