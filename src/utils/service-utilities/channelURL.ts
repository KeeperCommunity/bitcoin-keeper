// The previous Heroku channel apps have been retired. Keep the known legacy
// overrides here because older private build environments still set them.
export const LIVE_CHANNEL_URL = 'https://channel.bitcoinkeeper.app/';

const RETIRED_CHANNEL_URLS = new Set([
  'https://keeper-channel.herokuapp.com',
  'https://keeper-channel-dev-8d01fa5233d0.herokuapp.com',
]);

export const resolveChannelURL = (configuredURL?: string): string => {
  const candidate = configuredURL?.trim();
  if (!candidate || RETIRED_CHANNEL_URLS.has(candidate.replace(/\/+$/, ''))) {
    return LIVE_CHANNEL_URL;
  }
  return candidate;
};
