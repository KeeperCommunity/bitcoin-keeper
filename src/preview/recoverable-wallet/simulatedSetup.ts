/** UI-only walkthrough state. None of these transitions create or verify a key. */
export type SimulatedSetupState =
  | 'adding-mobile'
  | 'mobile-failed'
  | 'adding-server'
  | 'server-failed'
  | 'ready';

export type SimulatedSetupAction =
  | 'COMPLETE_STEP'
  | 'SIMULATE_FAILURE'
  | 'SHOW_SERVER_FAILURE'
  | 'RETRY';

export const initialSimulatedSetupState: SimulatedSetupState = 'adding-mobile';

export function reduceSimulatedSetup(
  state: SimulatedSetupState,
  action: SimulatedSetupAction
): SimulatedSetupState {
  switch (action) {
    case 'COMPLETE_STEP':
      if (state === 'adding-mobile') return 'adding-server';
      if (state === 'adding-server') return 'ready';
      return state;
    case 'SIMULATE_FAILURE':
      if (state === 'adding-mobile') return 'mobile-failed';
      if (state === 'adding-server') return 'server-failed';
      return state;
    case 'SHOW_SERVER_FAILURE':
      return state === 'ready' ? 'server-failed' : state;
    case 'RETRY':
      if (state === 'mobile-failed') return 'adding-mobile';
      if (state === 'server-failed') return 'adding-server';
      return state;
    default:
      return state;
  }
}
