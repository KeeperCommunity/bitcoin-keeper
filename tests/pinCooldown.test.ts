import { formatPinCooldown, getRemainingPinCooldown } from 'src/utils/pinCooldown';

describe('PIN cooldown display', () => {
  const lastFailure = 1000000;

  test('does not show a cooldown before any failed attempts', () => {
    expect(getRemainingPinCooldown(0, null, lastFailure)).toBe(0);
    expect(getRemainingPinCooldown(0, lastFailure, lastFailure)).toBe(0);
  });

  test('does not show a countdown without a recorded failure time', () => {
    expect(getRemainingPinCooldown(1, null, lastFailure)).toBe(0);
  });

  test.each([
    [1, 300],
    [2, 900],
    [3, 3600],
    [4, 7200],
  ])('uses the existing duration for cooldown level %s', (attempts, duration) => {
    expect(getRemainingPinCooldown(attempts, lastFailure, lastFailure)).toBe(duration);
  });

  test('shows elapsed time rather than restarting the full countdown', () => {
    expect(getRemainingPinCooldown(1, lastFailure, lastFailure + 28000)).toBe(272);
  });

  test('rounds up a partial second so the display does not expire early', () => {
    expect(getRemainingPinCooldown(1, lastFailure, lastFailure + 299001)).toBe(1);
  });

  test('returns zero at expiry and after expiry', () => {
    expect(getRemainingPinCooldown(1, lastFailure, lastFailure + 300000)).toBe(0);
    expect(getRemainingPinCooldown(1, lastFailure, lastFailure + 600000)).toBe(0);
  });

  test.each([
    [0, '0:00'],
    [9, '0:09'],
    [60, '1:00'],
    [272, '4:32'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
  ])('formats %s remaining seconds as %s', (seconds, expected) => {
    expect(formatPinCooldown(seconds)).toBe(expected);
  });
});
