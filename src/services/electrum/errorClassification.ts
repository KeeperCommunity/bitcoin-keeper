export type ElectrumConnectionErrorType = 'tls-certificate' | 'network' | 'unknown';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error ?? '');
  }
};

export const classifyElectrumConnectionError = (
  error: unknown
): ElectrumConnectionErrorType => {
  const message = getErrorMessage(error).toLowerCase();

  if (
    /(certpathvalidatorexception|trust anchor|certificate path|valid certification path|sslhandshakeexception|certificate verify|tls certificate|hostname.*(mismatch|verif))/.test(
      message
    )
  ) {
    return 'tls-certificate';
  }

  if (
    /(timeout|timed out|econn|enotfound|network|unreachable|unable to connect|failed to connect|socket.*closed)/.test(
      message
    )
  ) {
    return 'network';
  }

  return 'unknown';
};
