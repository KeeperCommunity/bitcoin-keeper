import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import { StyleSheet, Pressable } from 'react-native';
import Text from 'src/components/KeeperText';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';

import KeeperModal from 'src/components/KeeperModal';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import SignerContent from './SignerContent';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import SignerList from './SignerList';
import KeyAddedModal from 'src/components/KeyAddedModal';

import { useDispatch } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import { resetSignersUpdateState } from 'src/store/reducers/bhr';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { SignerType } from 'src/services/wallets/enums';
import { setShowTipModal } from 'src/store/reducers/settings';
import config from 'src/utils/service-utilities/config';
import Fab from 'src/components/Fab';
import AddIcon from 'src/assets/images/add_white.svg';
import { hp, wp } from 'src/constants/responsive';

const ManageKeys = ({ addedSigner }) => {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { vault: vaultText } = translations;
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();

  const [modalVisible, setModalVisible] = useState(false);
  const [keyAddedModalVisible, setKeyAddedModalVisible] = useState(false);
  const [inProgress, setInProgress] = useState(false);

  const {
    realySignersUpdateErrorMessage,
    relaySignersUpdate,
    relaySignersUpdateLoading,
    realySignersAdded,
  } = useAppSelector((state) => state.bhr);

  const handleModalOpen = () => {
    setModalVisible(true);
  };

  const handleModalClose = () => {
    setModalVisible(false);
  };
  const closeAddKeyModal = () => {
    setKeyAddedModalVisible(false);
    if (addedSigner.type == SignerType.POLICY_SERVER) {
      dispatch(setShowTipModal({ status: true, address: config.ADDRESS.serverKey }));
    }
  };

  useEffect(() => {
    setInProgress(relaySignersUpdateLoading);
  }, [relaySignersUpdateLoading]);

  useEffect(() => {
    if (realySignersUpdateErrorMessage) {
      setInProgress(false);
      showToast(
        realySignersUpdateErrorMessage,
        <ToastErrorIcon />,
        IToastCategory.SIGNING_DEVICE,
        5000
      );
      dispatch(resetSignersUpdateState());
    }
    return () => {
      dispatch(resetSignersUpdateState());
    };
  }, [realySignersUpdateErrorMessage]);

  useFocusEffect(
    useCallback(() => {
      if (relaySignersUpdate) {
        setInProgress(false);
        if (realySignersAdded && navigation.isFocused()) {
          setTimeout(() => setKeyAddedModalVisible(true), 500);
        }
        dispatch(resetSignersUpdateState());
      }
    }, [relaySignersUpdate])
  );

  useEffect(() => {
    if (addedSigner) {
      setKeyAddedModalVisible(true);
    }
    return () => {
      if (addedSigner) {
        navigation.setParams({ addedSigner: null });
      }
    };
  }, []);

  return (
    <>
      <Box style={styles.containerWrapper}>
        <Fab
          icon={<AddIcon height={hp(22)} width={wp(22)} />}
          onPress={handleModalOpen}
          containerStyle={{ right: wp(22.5) }}
        />
        <Pressable
          accessibilityRole="button"
          testID="manage_keys_actions"
          onPress={() => navigation.navigate('DeleteKeys')}
          style={{ paddingVertical: hp(12) }}
        >
          <Text color={`${colorMode}.textGreen`}>{translations.signer.manageKeys}</Text>
        </Pressable>
        <Box style={styles.contentContainer}>
          <SignerList navigation={navigation} />
        </Box>
        <KeeperModal
          visible={modalVisible}
          close={handleModalClose}
          title={vaultText.Addsigner}
          subTitle={vaultText.SelectSignerSubtitle}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          Content={() => (
            <SignerContent navigation={navigation} handleModalClose={handleModalClose} />
          )}
        />

        <KeyAddedModal
          visible={keyAddedModalVisible}
          close={closeAddKeyModal}
          signer={addedSigner}
        />
        {inProgress && <ActivityIndicatorView visible={inProgress} />}
      </Box>
    </>
  );
};

export default ManageKeys;

const styles = StyleSheet.create({
  containerWrapper: {
    paddingHorizontal: '4.5%',
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
  },
});
