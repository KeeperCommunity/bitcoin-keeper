/**
 * @format
 */

import { decode } from 'base-64';
global.atob = decode;
import 'react-native-reanimated';
import 'react-native-gesture-handler';
import './shim';
import './src/services/backup/encoding';
import { AppRegistry, Text as NativeText } from 'react-native';
import 'react-native-get-random-values';
import { Text, Input } from '@gluestack-ui/themed-native-base';
import { Svg } from 'react-native-svg';
import App from './App';
import { name as appName } from './app.json';
import { enableAndroidFontFix } from './AndroidFontFix';
import { initSentrySDK } from 'src/services/sentry';

initSentrySDK();
enableAndroidFontFix();

Input.defaultProps = Input.defaultProps || {};
Input.defaultProps.allowFontScaling = false;
NativeText.defaultProps = NativeText.defaultProps || {};
NativeText.defaultProps.allowFontScaling = false;

// Ensure SVG nodes don't capture taps meant for parent Pressable/Touchable wrappers.
Svg.defaultProps = Svg.defaultProps || {};
Svg.defaultProps.pointerEvents = 'none';

AppRegistry.registerComponent(appName, () => App);
