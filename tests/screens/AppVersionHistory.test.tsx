import React from 'react';
import renderer, { act } from 'react-test-renderer';

type HistoryRecord = { title: string; version: string; date: number };
type HistoryListProps = {
  data: HistoryRecord[];
  renderItem: (entry: { item: HistoryRecord }) => React.ReactNode;
  keyExtractor: (item: HistoryRecord) => string;
};

let mockNativeVersion = '2.6.4';
let mockNativeBuild = '620';
let mockHistory: HistoryRecord[] = [];
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getVersion: () => mockNativeVersion,
    getBuildNumber: () => mockNativeBuild,
  },
}));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: 'Box',
  ScrollView: 'ScrollView',
  FlatList: ({ data, renderItem, keyExtractor }: HistoryListProps) => (
    <>
      {data.map((item) =>
        require('react').createElement(
          require('react').Fragment,
          { key: keyExtractor(item) },
          renderItem({ item })
        )
      )}
    </>
  ),
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('@realm/react', () => ({ useQuery: () => mockHistory }));
jest.mock('src/storage/realm/utils', () => ({ getJSONFromRealmObject: (record) => record }));
jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: { getObjectByIndex: () => ({ publicId: 'disposable-fixture' }) },
}));
jest.mock('src/components/ScreenWrapper', () => 'Screen');
jest.mock('src/components/KeeperText', () => 'Text');
jest.mock('src/components/WalletHeader', () => 'Header');
jest.mock('src/components/DotView', () => 'Dot');
jest.mock('src/components/ThemedColor/ThemedColor', () => ({
  __esModule: true,
  default: () => '#000',
}));
jest.mock('src/constants/responsive', () => ({ hp: (value) => value, wp: (value) => value }));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: require('../../src/context/Localization/language/en.json'),
  }),
}));

const AppVersionHistory = require('../../src/screens/AppSettings/AppVersionHistoty').default;

let screen;
afterEach(() => act(() => screen?.unmount()));

test.each([
  ['2.6.4', '620', '2.6.3'],
  ['2.6.3', '619', '2.6.4'],
])(
  'installed app %s (%s) is shown independently of historical version %s',
  (nativeVersion, build, historyVersion) => {
    mockNativeVersion = nativeVersion;
    mockNativeBuild = build;
    mockHistory = [
      { title: 'Disposable historical upgrade', version: historyVersion, date: 1_792_454_400_000 },
    ];
    const originalHistory = JSON.stringify(mockHistory);
    act(() => {
      screen = renderer.create(<AppVersionHistory navigation={{ navigate: jest.fn() }} />);
    });
    expect(screen.root.findByProps({ testID: 'text_installedAppVersion' }).props.children).toBe(
      `${nativeVersion} (${build})`
    );
    expect(
      screen.root.findByProps({ testID: 'text_installedAppVersionLabel' }).props.children
    ).toBe('Installed app version');
    const historicalRows = screen.root.findAllByProps({ testID: 'view_versionHistory' });
    expect(historicalRows).toHaveLength(1);
    expect(
      historicalRows[0].findAllByType('Text').some((node) => node.props.children === historyVersion)
    ).toBe(true);
    expect(JSON.stringify(mockHistory)).toBe(originalHistory);
  }
);
