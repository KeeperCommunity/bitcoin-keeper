import React, { useContext, useState, useEffect, useMemo } from 'react';
import { FlatList, Box, useColorMode } from 'native-base';
import moment from 'moment';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { BackupHistoryItem, BackupType } from 'src/models/enums/BHR';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import ModalWrapper from 'src/components/Modal/ModalWrapper';
import {
  backupAllSignersAndVaults,
  seedBackedConfirmed,
  validateServerBackup,
} from 'src/store/sagaActions/bhr';
import {
  setAutomaticCloudBackup,
  setBackupAllFailure,
  setBackupAllSuccess,
  setSeedConfirmed,
} from 'src/store/reducers/bhr';
import { CommonActions, useIsFocused, useNavigation } from '@react-navigation/native';
import { useQuery } from '@realm/react';
import HealthCheck from 'src/assets/images/healthcheck_light.svg';
import AdvnaceOptions from 'src/assets/images/settings.svg';
import KeeperFooter from '../KeeperFooter';
import KeeperModal from '../KeeperModal';
import { Platform, StyleSheet } from 'react-native';
import SigningDeviceChecklist from 'src/screens/Vault/SigningDeviceChecklist';
import usePlan from 'src/hooks/usePlan';
import LoadingAnimation from 'src/components/Loader';
import ActivityIndicatorView from '../AppActivityIndicator/ActivityIndicatorView';
import Text from '../KeeperText';
import { hp } from 'src/constants/responsive';
import ThemedSvg from '../ThemedSvg.tsx/ThemedSvg';
import ConfirmSeedWord from '../SeedWordBackup/ConfirmSeedWord';
import { setRecoveryKeyBackedUp } from 'src/store/reducers/account';

const ContentType = {
  verifying: 'verifying',
  verificationFailed: 'verificationFailed',
  mismatch: 'mismatch',
  healthCheckSuccessful: 'healthCheckSuccessful',
};
function Content({ contentType, asbEnabled }: { contentType: string; asbEnabled: boolean }) {
  const { BackupWallet } = useContext(LocalizationContext).translations;
  const illustrations = {
    [ContentType.verifying]: (
      <Box marginBottom={hp(20)}>
        <LoadingAnimation />
      </Box>
    ),
    [ContentType.verificationFailed]: <ThemedSvg name={'BackupVerificationFailed'} />,
    [ContentType.mismatch]: <ThemedSvg name={'BackupMismatch'} />,
    [ContentType.healthCheckSuccessful]: <ThemedSvg name={'success_illustration'} />,
  };
  const descriptions = {
    [ContentType.verificationFailed]: BackupWallet.backupFailedModalDesc,

    [ContentType.mismatch]: BackupWallet.mismatchModalDesc,
  };

  return (
    <Box>
      <Box alignItems="center">{illustrations[contentType]}</Box>
      {descriptions[contentType] && <Text>{descriptions[contentType]}</Text>}
      {asbEnabled && <Text>{BackupWallet.assistedServerBackupEnabled}</Text>}
    </Box>
  );
}

function BackupHealthCheckList({ isUaiFlow }) {
  const { colorMode } = useColorMode();
  const navigtaion = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { BackupWallet, vault: vaultText, common } = translations;
  const dispatch = useAppDispatch();
  const { primaryMnemonic, backup, id } = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0];
  const {
    backupMethod,
    seedConfirmed,
    automaticCloudBackup,
    backupAllLoading,
    backupAllFailure,
    backupAllSuccess,
  } = useAppSelector((state) => state.bhr);
  const [healthCheckModal, setHealthCheckModal] = useState(false);
  const [showConfirmSeedModal, setShowConfirmSeedModal] = useState(isUaiFlow);
  const [verificationModal, setVerificationModal] = useState(false);
  const [failedVerificationModal, setFailedVerificationModal] = useState(false);
  const [backupMismatchModal, setBackupMismatchModal] = useState(false);
  const data = useQuery(RealmSchema.BackupHistory);
  const history: BackupHistoryItem[] = useMemo(() => data.sorted('date', true), [data]);
  const { isOnL2Above } = usePlan();
  const isFocused = useIsFocused();
  const [asbEnabled, setAsbEnabled] = useState(false);

  const onPressConfirm = () => {
    setShowConfirmSeedModal(true);
  };


  useEffect(() => {
    if (backupAllSuccess || backupAllFailure) {
      if (!automaticCloudBackup) setAsbEnabled(true);
      dispatch(setBackupAllSuccess(false));
      dispatch(setBackupAllFailure(false));
      dispatch(setAutomaticCloudBackup(true));
      setHealthCheckModal(true);
    }
  }, [backupAllSuccess, backupAllFailure]);

  useEffect(() => {
    if (seedConfirmed) {
      setShowConfirmSeedModal(false);
      dispatch(setRecoveryKeyBackedUp({ appId: id as string, status: true }));
      if (!automaticCloudBackup) dispatch(backupAllSignersAndVaults());
      else {
        setTimeout(() => {
          setHealthCheckModal(true);
        }, 100);
      }
    }
    return () => {
      dispatch(setSeedConfirmed(false));
    };
  }, [seedConfirmed]);

  useEffect(() => {
    if (backupAllFailure && isFocused) {
      dispatch(setBackupAllFailure(false));
    }
  }, [backupAllFailure]);

  useEffect(() => {
    if (backupAllSuccess && isFocused) {
      dispatch(setBackupAllSuccess(false));
      dispatch(seedBackedConfirmed(true));
    }
  }, [backupAllSuccess]);

  function FooterIcon({ Icon }) {
    return (
      <Box
        margin="1"
        width="12"
        height="12"
        borderRadius={30}
        backgroundColor={`${colorMode}.BrownNeedHelp`}
        justifyContent="center"
        alignItems="center"
      >
        <Icon />
      </Box>
    );
  }

  const footerItems = [
    {
      text: vaultText.healthCheck,
      Icon: () => <FooterIcon Icon={HealthCheck} />,
      onPress: () => {
        onPressConfirm();
      },
    },
    {
      text: common.settings,
      Icon: () => <FooterIcon Icon={AdvnaceOptions} />,
      onPress: () => {
        navigtaion.dispatch(CommonActions.navigate('AppBackupSettings', {}));
      },
    },
  ];

  const nextAction = async () => {
    if (backupMethod === BackupType.SEED) {
      setShowConfirmSeedModal(false);
      if (isOnL2Above && automaticCloudBackup) {
        setVerificationModal(true);
        dispatch(
          validateServerBackup((res) => {
            setVerificationModal(false);
            if (res?.error) {
              setFailedVerificationModal(true);
            } else if (res.status) {
              dispatch(seedBackedConfirmed(true));
            } else {
              setBackupMismatchModal(true);
            }
          })
        );
      } else {
        dispatch(seedBackedConfirmed(true));
      }
    }
  };

  return (
    <Box>
      <Box>
        <Box flex={1} style={styles.Wrapper}>
          <FlatList
            data={history}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <SigningDeviceChecklist
                status={item?.title}
                key={index.toString()}
                date={moment.unix(item?.date).toDate()}
              />
            )}
          />
        </Box>
        <KeeperFooter
          marginX={30}
          wrappedScreen={Platform.OS === 'ios' ? true : false}
          items={footerItems}
        />
      </Box>

      <ModalWrapper
        visible={showConfirmSeedModal}
        onSwipeComplete={() => setShowConfirmSeedModal(false)}
        position="center"
      >
        <ConfirmSeedWord
          closeBottomSheet={() => {
            setShowConfirmSeedModal(false);
            if (backupMethod === BackupType.SEED) dispatch(seedBackedConfirmed(false));
          }}
          words={(primaryMnemonic as string).split(' ')}
          confirmBtnPress={nextAction}
        />
      </ModalWrapper>

      <KeeperModal
        close={() => {}}
        dismissible={false}
        showCloseIcon={false}
        visible={verificationModal}
        title={BackupWallet.verifyModalTitle}
        subTitle={BackupWallet.verifyModalSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => <Content contentType={ContentType.verifying} />}
        closeOnOverlayClick={false}
      />

      <KeeperModal
        close={() => {}}
        dismissible={false}
        showCloseIcon={false}
        visible={failedVerificationModal}
        title={BackupWallet.backupFailedModalTitle}
        subTitle={BackupWallet.backupFailedModalSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => <Content contentType={ContentType.verificationFailed} />}
        closeOnOverlayClick={false}
        buttonText={BackupWallet.home}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonCallback={() => {
          navigtaion.dispatch(CommonActions.navigate('Home'));
        }}
      />
      <KeeperModal
        close={() => {}}
        dismissible={false}
        showCloseIcon={false}
        visible={backupMismatchModal}
        title={BackupWallet.mismatchModalTitle}
        subTitle={BackupWallet.mismatchModalSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => <Content contentType={ContentType.mismatch} />}
        closeOnOverlayClick={false}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonText={'Backup Now'}
        buttonCallback={() => {
          dispatch(backupAllSignersAndVaults());
          setBackupMismatchModal(false);
        }}
        secondaryButtonText="Home"
        secondaryCallback={() => {
          navigtaion.dispatch(CommonActions.navigate('Home'));
        }}
      />

      <KeeperModal
        close={() => setHealthCheckModal(false)}
        visible={healthCheckModal}
        title={BackupWallet.healthCheckSuccessTitle}
        subTitle={BackupWallet.healthCheckSuccessSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={BackupWallet.home}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonCallback={() => {
          navigtaion.navigate('Home');
        }}
        Content={() => (
          <Content contentType={ContentType.healthCheckSuccessful} asbEnabled={asbEnabled} />
        )}
        closeOnOverlayClick={true}
      />
      <ActivityIndicatorView visible={backupAllLoading} />
    </Box>
  );
}
export default BackupHealthCheckList;

const styles = StyleSheet.create({
  Wrapper: {
    marginHorizontal: 5,
  },
});
