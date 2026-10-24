// Development diagnostics only. Never forward an error object or credential value.
export type StartupFailurePhase =
  | 'ACCOUNT_STATE'
  | 'NATIVE_CREDENTIAL_READ'
  | 'CREDENTIAL_JSON'
  | 'NAVIGATION';
export type StartupFailureOutcome = 'THREW' | 'REJECTED';
export type StartupFailureReceipt = {
  phase: StartupFailurePhase;
  outcome: StartupFailureOutcome;
  errorName: string;
  nativeCode: number | null;
};
export type StartupFailureObserver = (receipt: StartupFailureReceipt) => void;

const NAMES = [
  'Error',
  'TypeError',
  'SyntaxError',
  'ReferenceError',
  'RangeError',
  'EvalError',
  'URIError',
  'AggregateError',
  'OTHER',
  'UNKNOWN',
];
const PHASES = ['ACCOUNT_STATE', 'NATIVE_CREDENTIAL_READ', 'CREDENTIAL_JSON', 'NAVIGATION'];

export const reportStartupFailure = (
  observer: StartupFailureObserver | undefined,
  phase: StartupFailurePhase,
  outcome: StartupFailureOutcome,
  error: unknown
) => {
  if (typeof observer !== 'function') return;
  try {
    if (
      !PHASES.includes(phase) ||
      !['THREW', 'REJECTED'].includes(outcome) ||
      (outcome === 'REJECTED' && phase !== 'NATIVE_CREDENTIAL_READ')
    )
      return;
    let errorName = 'UNKNOWN';
    let nativeCode: number | null = null;
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      try {
        const { name } = error as { name?: unknown };
        errorName = typeof name === 'string' ? (NAMES.includes(name) ? name : 'OTHER') : 'UNKNOWN';
      } catch {
        /* An error getter cannot affect the original failure. */
      }
      if (phase === 'NATIVE_CREDENTIAL_READ' && outcome === 'REJECTED') {
        try {
          const { code } = error as { code?: unknown };
          // RNKeychain10.0.0 rejects with an NSString decimal OSStatus. Do not
          // reinterpret other codes, numbers, whitespace or coercible objects.
          if (typeof code === 'string' && /^(?:0|-?[1-9][0-9]{0,9})$/.exec(code)?.[0] === code) {
            const numeric = Number(code);
            if (Number.isInteger(numeric) && numeric >= -2147483648 && numeric <= 2147483647) {
              nativeCode = numeric;
            }
          }
        } catch {
          /* No error message, stack or getter exception is inspected. */
        }
      }
    }
    observer({ phase, outcome, errorName, nativeCode });
  } catch {
    /* Diagnostics must never replace or mask an original result/error. */
  }
};

export const observeStartupFailure: StartupFailureObserver = (receipt) => {
  try {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    const hook = (global as unknown as { nativeLoggingHook?: unknown }).nativeLoggingHook;
    if (typeof hook !== 'function') return;
    const { phase, outcome, errorName, nativeCode } = receipt;
    if (
      !PHASES.includes(phase) ||
      !['THREW', 'REJECTED'].includes(outcome) ||
      !NAMES.includes(errorName) ||
      (outcome === 'REJECTED' && phase !== 'NATIVE_CREDENTIAL_READ') ||
      (nativeCode !== null &&
        (phase !== 'NATIVE_CREDENTIAL_READ' ||
          outcome !== 'REJECTED' ||
          !Number.isInteger(nativeCode) ||
          nativeCode < -2147483648 ||
          nativeCode > 2147483647))
    )
      return;
    const when = Date.now();
    if (!Number.isSafeInteger(when) || when < 0 || when > 100000000000000) return;
    const marker = `KEEPER_STARTUP_FAILURE_V1|${when}|${phase}|${outcome}|${errorName}|${
      nativeCode === null ? 'NONE' : nativeCode
    }`;
    // RN0.83.9's direct hook reaches the JS os_log Error sink at level3.
    // Bypass console.error's ExceptionsManager/LogBox wrapper. Hosted capture
    // remains unverified until this exact diagnostic source actually runs.
    hook(marker, 3);
  } catch {
    /* Missing hooks, clock/getter failures and observers are optional. */
  }
};
