const REMOTE_KEY_PATH = /^\/app\/(dev|prod)\/remote\/([0-9a-f]{24})\/?$/;

/** Return only links generated for this build's remote-key exchange. */
export function getRemoteKeyFromDeepLink(rawUrl: string, environment: string): string | null {
  const expectedStage = environment === 'PRODUCTION' ? 'prod' : environment === 'DEVELOPMENT' ? 'dev' : null;
  if (!expectedStage) return null;

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'https:' ||
      !['bitcoinkeeper.app', 'www.bitcoinkeeper.app'].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const match = REMOTE_KEY_PATH.exec(url.pathname);
    return match?.[1] === expectedStage ? match[2] : null;
  } catch {
    return null;
  }
}
