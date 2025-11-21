import { Box, useColorMode } from 'native-base';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
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
    <Box style={styles.containerWrapper}>
      <Box style={styles.contentContainer}>
        <SignerList navigation={navigation} handleModalOpen={handleModalOpen} />
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

      <KeyAddedModal visible={keyAddedModalVisible} close={closeAddKeyModal} signer={addedSigner} />
      {inProgress && <ActivityIndicatorView visible={inProgress} />}
    </Box>
  );
};

export default ManageKeys;

const styles = StyleSheet.create({
  containerWrapper: {
    paddingHorizontal: '4.5%',
  },
  contentContainer: {
    flexDirection: 'row',
  },
});
