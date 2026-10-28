import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { StyleSheet, ScrollView } from 'react-native';
import React, { useContext } from 'react';

import { LocalizationContext } from 'src/context/Localization/LocContext';
import Switch from 'src/components/Switch/Switch';
import Text from 'src/components/KeeperText';
import { hp } from 'src/constants/responsive';
import KeeperTextInput from 'src/components/KeeperTextInput';
import WarningNote from 'src/components/WarningNote';

const AddNode = ({
  setHost,
  setPort,
  setUseSSL,
  host,
  port,
  useSSL,
  connectionError,
  tlsCa,
  setTlsCa,
}: {
  host: string;
  port: string;
  useSSL: boolean;
  setHost: (host: string) => void;
  setPort: (port: string) => void;
  setUseSSL: (useSSL: boolean) => void;
  connectionError?: string;
  tlsCa: string;
  setTlsCa: (ca: string) => void;
}) => {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { common, settings } = translations;

  return (
    <>
      <Box style={[styles.container, { backgroundColor: `${colorMode}.primaryBackground` }]}>
        <Box style={styles.box}>
          <Box style={styles.useSSL}>
            <Text color={`${colorMode}.primaryText`}>{settings.useSSL}</Text>
            <Switch value={useSSL} onValueChange={(value) => setUseSSL(value)} />
          </Box>
          <Box style={styles.inputArea}>
            <Box>
              <Text color={`${colorMode}.secondaryText`}>{common.URL}</Text>
              <KeeperTextInput
                testID="node-host"
                placeholder={settings.host}
                value={host}
                autoCorrect={false}
                autoComplete="off"
                onChangeText={(text) => setHost(text.toLowerCase())}
                inpuBorderColor={`${colorMode}.secondaryGrey`}
                inpuBackgroundColor={`${colorMode}.boxSecondaryBackground`}
              />
            </Box>
            <Box>
              <Text color={`${colorMode}.secondaryText`}>{common.portNumber}</Text>
              <KeeperTextInput
                testID="node-port"
                placeholder={settings.portNumberPlaceholder}
                keyboardType="number-pad"
                value={port}
                autoCorrect={false}
                autoComplete="off"
                onChangeText={(text) => setPort(text)}
                inpuBorderColor={`${colorMode}.secondaryGrey`}
                inpuBackgroundColor={`${colorMode}.boxSecondaryBackground`}
              />
            </Box>
            {useSSL && (
              <Box>
                <Text color={`${colorMode}.secondaryText`}>{settings.nodeCertificate}</Text>
                <Text color={`${colorMode}.secondaryText`}>{settings.nodeCertificateHelp}</Text>
                <KeeperTextInput
                  testID="node-ca"
                  placeholder="-----BEGIN CERTIFICATE-----"
                  value={tlsCa}
                  onChangeText={setTlsCa}
                  multiline
                  height={120}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={16384}
                  inpuBorderColor={`${colorMode}.secondaryGrey`}
                  inpuBackgroundColor={`${colorMode}.boxSecondaryBackground`}
                />
              </Box>
            )}
          </Box>
        </Box>
      </Box>
      <Box margin={hp(12)}>
        {connectionError && (
          <WarningNote noteText={'Error connecting to node:\n' + connectionError} />
        )}
      </Box>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    width: '95%',
    flexDirection: 'row',
  },
  box: {
    width: '100%',
  },
  inputArea: {
    paddingTop: hp(20),
    gap: 10,
  },
  saveButton: {
    alignSelf: 'flex-end',
  },
  useSSL: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: hp(15),
  },
  errorContainer: {
    marginTop: hp(10),
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: 'red', // or use a color from your theme
    fontSize: 14,
    textAlign: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: 'red',
    borderRadius: 5,
    backgroundColor: '#ffe6e6', // light red background for better visibility
  },
});

export default AddNode;
