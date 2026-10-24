import { Platform } from 'react-native';

type OnboardingBoundaryStage =
  | 'ONBOARDING_EFFECT'
  | 'SKIP_PRESS'
  | 'SKIP_RESET_RETURNED'
  | 'SKIP_RESET_THROWN'
  | 'NEW_KEEPER_EFFECT';

const STAGES = [
  'ONBOARDING_EFFECT',
  'SKIP_PRESS',
  'SKIP_RESET_RETURNED',
  'SKIP_RESET_THROWN',
  'NEW_KEEPER_EFFECT',
];
const counts: Partial<Record<OnboardingBoundaryStage, number>> = {};

// Fixed development observations only. No route, state, event or error payload.
export const observeOnboardingBoundary = (stage: OnboardingBoundaryStage) => {
  try {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    if (Platform.OS !== 'android' || !STAGES.includes(stage) || (counts[stage] || 0) >= 4) return;
    const hook = (global as unknown as { nativeLoggingHook?: unknown }).nativeLoggingHook;
    if (typeof hook !== 'function') return;
    counts[stage] = (counts[stage] || 0) + 1;
    // RN0.83.9's direct native hook maps level3 to ReactNativeJS Error on
    // Android. This bypasses console/LogBox and does not create an exception.
    hook(`KEEPER_ONBOARDING_BOUNDARY|v1|${stage}`, 3);
  } catch {
    /* Observation is optional and cannot replace navigation results. */
  }
};
