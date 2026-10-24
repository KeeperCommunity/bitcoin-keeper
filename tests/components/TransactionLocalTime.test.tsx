import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { EntityKind } from '../../src/services/wallets/enums';

jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: 'Box',
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('src/constants/responsive', () => ({ hp: (v) => v, wp: (v) => v }));
jest.mock('src/components/KeeperText', () => 'Text');
jest.mock('src/screens/Home/components/CurrencyInfo', () => 'CurrencyInfo');
jest.mock('src/hooks/useLabelsNew', () => ({ __esModule: true, default: () => ({ labels: [] }) }));
jest.mock('src/components/ThemedColor/ThemedColor', () => ({
  __esModule: true,
  default: () => '#000',
}));
[
  'icon_sent_red',
  'icon_recieved_red',
  'icon_recieved_dark',
  'transaction_pending',
  'cache_icon',
  'icon_arrow_grey',
  'icon_arrow_white',
].forEach((name) =>
  jest.doMock(require.resolve(`../../src/assets/images/${name}.svg`), () => () => null)
);
const TransactionElement = require('../../src/components/TransactionElement').default;

// Run this same production-component test in separate processes with TZ set.
// Changing TZ inside a Jest worker does not reliably change Date's timezone.
const hostZone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const zone = { 'Etc/UTC': 'UTC', 'Asia/Calcutta': 'Asia/Kolkata' }[hostZone] || hostZone;
const cases = {
  UTC: [
    ['2026-03-08T06:30:00Z', '08 Mar 26  .  06:30 AM'],
    ['2026-03-08T07:30:00Z', '08 Mar 26  .  07:30 AM'],
    ['2026-03-29T00:30:00Z', '29 Mar 26  .  00:30 AM'],
    ['2026-03-29T01:30:00Z', '29 Mar 26  .  01:30 AM'],
    ['2026-11-01T05:30:00Z', '01 Nov 26  .  05:30 AM'],
    ['2026-11-01T06:30:00Z', '01 Nov 26  .  06:30 AM'],
  ],
  'Asia/Kolkata': [
    ['2026-03-08T06:30:00Z', '08 Mar 26  .  12:00 PM'],
    ['2026-03-08T07:30:00Z', '08 Mar 26  .  13:00 PM'],
    ['2026-03-29T00:30:00Z', '29 Mar 26  .  06:00 AM'],
    ['2026-03-29T01:30:00Z', '29 Mar 26  .  07:00 AM'],
    ['2026-11-01T05:30:00Z', '01 Nov 26  .  11:00 AM'],
    ['2026-11-01T06:30:00Z', '01 Nov 26  .  12:00 PM'],
  ],
  'America/New_York': [
    ['2026-03-08T06:30:00Z', '08 Mar 26  .  01:30 AM'],
    ['2026-03-08T07:30:00Z', '08 Mar 26  .  03:30 AM'],
    ['2026-03-29T00:30:00Z', '28 Mar 26  .  20:30 PM'],
    ['2026-03-29T01:30:00Z', '28 Mar 26  .  21:30 PM'],
    ['2026-11-01T05:30:00Z', '01 Nov 26  .  01:30 AM'],
    ['2026-11-01T06:30:00Z', '01 Nov 26  .  01:30 AM'],
  ],
  'Europe/London': [
    ['2026-03-08T06:30:00Z', '08 Mar 26  .  06:30 AM'],
    ['2026-03-08T07:30:00Z', '08 Mar 26  .  07:30 AM'],
    ['2026-03-29T00:30:00Z', '29 Mar 26  .  00:30 AM'],
    ['2026-03-29T01:30:00Z', '29 Mar 26  .  02:30 AM'],
    ['2026-11-01T05:30:00Z', '01 Nov 26  .  05:30 AM'],
    ['2026-11-01T06:30:00Z', '01 Nov 26  .  06:30 AM'],
  ],
};

// Keep the normal full suite portable on developer machines in other zones.
// The four explicit investigation runs use the independent fixed vectors above.
const vectors =
  cases[zone] ||
  cases.UTC.map(([iso]) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(iso))
        .map(({ type, value }) => [type, value])
    );
    return [
      iso,
      `${parts.day} ${parts.month} ${parts.year}  .  ${parts.hour}:${parts.minute} ${
        Number(parts.hour) >= 12 ? 'PM' : 'AM'
      }`,
    ];
  });

describe.each(['confirmed', 'pending', 'cached'])('%s timestamps', (state) => {
  test.each(vectors)('%s renders as local time in ' + zone, (iso, expected) => {
    const transaction = {
      txid: 'public-synthetic-test',
      date: new Date(iso).toUTCString(),
      confirmations: state === 'confirmed' ? 6 : 0,
      amount: 1,
      transactionType: 'Received',
    };
    const original = JSON.stringify(transaction);
    let screen;
    act(() => {
      screen = renderer.create(
        <TransactionElement
          transaction={transaction}
          wallet={{ entityKind: EntityKind.WALLET }}
          isCached={state === 'cached'}
        />
      );
    });
    expect(screen.root.findAllByType('Text').map((text) => text.props.children)).toContain(
      expected
    );
    expect(JSON.stringify(transaction)).toBe(original);
    act(() => screen.unmount());
  });
});
