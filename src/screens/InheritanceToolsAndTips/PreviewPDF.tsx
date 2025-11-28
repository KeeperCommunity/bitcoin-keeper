import { Dimensions, Platform, StyleSheet, TouchableOpacity } from 'react-native';
import React, { useContext, useEffect } from 'react';
import Pdf from 'react-native-pdf';
import { Box, useColorMode } from 'native-base';
import Share from 'react-native-share';

import DownloadIcon from 'src/assets/images/download.svg';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Text from 'src/components/KeeperText';
import WalletHeader from 'src/components/WalletHeader';
import { hp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { setShowTipModal } from 'src/store/reducers/settings';
import { useDispatch } from 'react-redux';
import config from 'src/utils/service-utilities/config';

function PreviewPDF({ route }: any) {
  const { colorMode } = useColorMode();
  const { source } = route.params;
  const { translations } = useContext(LocalizationContext);
  const { common } = translations;
  const dispatch = useDispatch();
  const DownloadPDF = () => {
    Share.open({
      url: Platform.OS === 'ios' ? source : `file://${source}`,
      excludedActivityTypes: [
        'copyToPasteBoard',
        'markupAsPDF',
        'addToReadingList',
        'assignToContact',
        'mail',
        'default',
        'message',
        'postToFacebook',
        'print',
        'saveToCameraRoll',
      ],
    });
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      dispatch(setShowTipModal({ status: true, address: config.ADDRESS.inheritanceDoc }));
    }, 1000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        rightComponent={
          <TouchableOpacity
            onPress={() => DownloadPDF()}
            style={{ alignSelf: 'flex-end', marginBottom: 5 }}
          >
            <Box style={styles.downloadBtn} backgroundColor={`${colorMode}.DarkSlateGray`}>
              <DownloadIcon />
              <Text style={styles.downloadBtnText} color={`${colorMode}.secondaryCreamWhite`}>
                &nbsp;&nbsp;{common.Download}
              </Text>
            </Box>
          </TouchableOpacity>
        }
      />

      <Box style={styles.container}>
        <Pdf trustAllCerts={false} source={{ uri: source }} style={styles.pdf} />
      </Box>
    </ScreenWrapper>
  );
}
const styles = StyleSheet.create({
  container: {
    marginTop: hp(20),
    flex: 1,
    alignItems: 'center',
  },
  pdf: {
    flex: 1,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  downloadBtn: {
    flexDirection: 'row',
    padding: 5,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  downloadBtnText: {
    fontSize: 14,
  },
});

export default PreviewPDF;
