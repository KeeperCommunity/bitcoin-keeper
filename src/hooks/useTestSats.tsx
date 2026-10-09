import React, { useContext, useEffect, useState } from 'react';
import { AppContext } from 'src/context/AppContext';
import { useAppSelector } from 'src/store/hooks';
import useToastMessage from 'src/hooks/useToastMessage';
import { useDispatch } from 'react-redux';
import TickIcon from 'src/assets/images/icon_tick.svg';
import {
  setTestCoinsFailed,
  setTestCoinsReceived,
  setTestCoinsQuotaReached,
  setTestCoinsPending,
} from 'src/store/reducers/wallets';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useNavigation } from '@react-navigation/native';
import { EntityKind, NetworkType } from 'src/services/wallets/enums';
import { testSatsRecieve } from 'src/store/sagaActions/wallets';
import SettingCard from 'src/screens/Home/components/Settings/Component/SettingCard';
import { useColorMode } from '@gluestack-ui/themed-native-base';
import KeeperModal from 'src/components/KeeperModal';

const useTestSats = ({ wallet }) => {
  const { setAppLoading, setLoadingContent } = useContext(AppContext);
  const { testCoinsReceived, testCoinsFailed, testCoinsQuotaReached, testCoinsPending } =
    useAppSelector((state) => state.wallet);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const { showToast } = useToastMessage();
  const dispatch = useDispatch();
  const { translations } = useContext(LocalizationContext);
  const { common, wallet: walletText, error: errorText } = translations;
  const navigation = useNavigation();
  const { colorMode } = useColorMode();
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [pendingModalKind, setPendingModalKind] = useState<typeof testCoinsPending>(null);

  useEffect(() => {
    if (testCoinsReceived) {
      setAppLoading(false);
      showToast(walletText.recievedSats, <TickIcon />);
      const timer = setTimeout(() => {
        dispatch(setTestCoinsReceived(false));
        navigation.goBack();
      }, 3000);
      return () => clearTimeout(timer);
    } else if (testCoinsFailed) {
      setAppLoading(false);
      showToast(errorText.processFailed);
      dispatch(setTestCoinsFailed(false));
    }
    return undefined;
  }, [testCoinsReceived, testCoinsFailed]);

  useEffect(() => {
    if (testCoinsPending) {
      setAppLoading(false);
      setPendingModalKind(testCoinsPending);
      dispatch(setTestCoinsPending(null));
    }
  }, [testCoinsPending]);

  useEffect(() => {
    if (testCoinsQuotaReached) {
      setAppLoading(false);
      setQuotaModalVisible(true);
      dispatch(setTestCoinsQuotaReached(false));
    }
  }, [testCoinsQuotaReached]);

  useEffect(() => {
    setLoadingContent({
      title: common.pleaseWait,
      subtitle: common.receiveTestSats,
      message: '',
    });

    return () => {
      setLoadingContent({
        title: '',
        subTitle: '',
        message: '',
      });
      setAppLoading(false);
    };
  }, []);

  if (bitcoinNetworkType !== NetworkType.TESTNET) return null;

  const entityLabel = wallet.entityKind === EntityKind.VAULT ? 'vault' : 'wallet';

  return (
    <>
      <SettingCard
        subtitleColor={`${colorMode}.balanceText`}
        backgroundColor={`${colorMode}.textInputBackground`}
        borderColor={`${colorMode}.separator`}
        items={[
          {
            title: walletText.recievedSatsTitle,
            description: `${walletText.faucetDailyLimitHint} ${walletText.recieveSatsDesc} ${entityLabel}`,
            icon: null,
            isDiamond: false,
            onPress: () => {
              setAppLoading(true);
              dispatch(testSatsRecieve(wallet));
            },
          },
        ]}
      />
      <KeeperModal
        visible={quotaModalVisible}
        close={() => setQuotaModalVisible(false)}
        title={walletText.faucetDailyLimitTitle}
        subTitle={walletText.faucetDailyLimitBody}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        buttonText={common.ok}
        buttonCallback={() => setQuotaModalVisible(false)}
      />
      <KeeperModal
        visible={!!pendingModalKind}
        close={() => setPendingModalKind(null)}
        title={walletText.faucetPendingTitle}
        subTitle={
          pendingModalKind === 'unknown'
            ? walletText.faucetOutcomeUnknown
            : pendingModalKind === 'sync'
            ? walletText.faucetSyncPending
            : walletText.faucetPropagationPending
        }
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        buttonText={common.ok}
        buttonCallback={() => setPendingModalKind(null)}
      />
    </>
  );
};

export default useTestSats;
