import { LIVE_CHANNEL_URL, resolveChannelURL } from '../channelURL';

describe('Keeper Desktop channel endpoint', () => {
  it.each([
    undefined,
    '',
    'https://keeper-channel.herokuapp.com/',
    'https://keeper-channel-dev-8d01fa5233d0.herokuapp.com/',
  ])('uses the live channel for an absent or retired override (%s)', (value) => {
    expect(resolveChannelURL(value)).toBe(LIVE_CHANNEL_URL);
  });

  it('preserves an explicit local channel for isolated QA', () => {
    expect(resolveChannelURL(' http://127.0.0.1:3000/ ')).toBe('http://127.0.0.1:3000/');
  });
});
