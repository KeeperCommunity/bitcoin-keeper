import { Box, HStack, ScrollView, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext, useEffect, useState } from 'react';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { useDispatch } from 'react-redux';
import { getTnxDetails } from 'src/store/sagaActions/swap';
import { CoinLogo } from './component/CoinLogo';
import { StyleSheet } from 'react-native';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import { hp, wp } from 'src/constants/responsive';
import { getStatus, StatusEnum } from './component/Constant';
import Colors from 'src/theme/Colors';
import SwapConfirmingIcon from '../../../../../assets/images/swap-confirmint.svg';
import SwapProcessingIcon from '../../../../../assets/images/swap-processing.svg';
import SwapSuccessIcon from '../../../../../assets/images/swap-success.svg';
import SwapOverDueIcon from '../../../../../assets/images/swap-overDue.svg';
import SwapInfoCard from './component/SwapInfoCard';
import SwapStatusContent from './component/SwapStatusContent';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

export const SwapHistoryDetail = ({ navigation, route }) => {
  const { tnxId, createdAt } = route.params;
  const { colorMode } = useColorMode();
  const { showToast } = useToastMessage();
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const dispatch = useDispatch();
  const { translations } = useContext(LocalizationContext);
  const { buyBTC: buyBTCText, transactions: transactionsText } = translations;
  const viewAll_color = ThemedColor({ name: 'viewAll_color' });

  useEffect(() => {
    if (!tnxId) {
      showToast('Transaction id is missing', <ToastErrorIcon />);
      navigation.goBack();
      return;
    }

    setLoading(true);
    dispatch(
      getTnxDetails({
        tnxId,
        callback: ({ status, tnx, error }) => {
          setLoading(false);
          if (!status) {
            navigation.goBack();
            showToast(error, <ToastErrorIcon />);
          } else {
            setDetails(tnx);
          }
        },
      })
    );
  }, []);
  const transaction_status = getStatus(details?.status);

  return (
    <ScreenWrapper
      paddingHorizontal={0}
      barStyle="dark-content"
      backgroundcolor={`${colorMode}.primaryBackground`}
    >
      <Box style={styles.container}>
        <WalletHeader
          title={transactionsText.TransactionDetails}
          subTitle={transactionsText.TransactionDetailsSubTitle}
        />
        {details && (
          <Box style={styles.transactionContainer}>
            <CircleIconWrapper
              width={wp(35)}
              icon={
                transaction_status === StatusEnum.Confirming ? (
                  <SwapConfirmingIcon />
                ) : transaction_status === StatusEnum.Processing ? (
                  <SwapProcessingIcon />
                ) : transaction_status === StatusEnum.Success ? (
                  <SwapSuccessIcon />
                ) : (
                  <SwapOverDueIcon />
                )
              }
              backgroundColor={
                transaction_status === StatusEnum.Confirming
                  ? Colors.lightOrange
                  : transaction_status === StatusEnum.Processing
                  ? Colors.lightindigoblue
                  : transaction_status === StatusEnum.Success
                  ? Colors.PaleTropicalTeal
                  : Colors.lightRed
              }
            />
            <Box>
              <Text color={`${colorMode}.secondaryText`}>{details.transaction_id}</Text>
              <Text fontSize={12} color={`${colorMode}.secondaryText`}>
                {createdAt}
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      {details && (
        <Box style={styles.Wrapper} borderColor={`${colorMode}.separator`}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <HStack justifyContent={'space-between'} my={5}>
              <HStack mr={2}>
                <CoinLogo
                  code={details.coin_from}
                  CircleWidth={wp(30)}
                  logoWidth={wp(15)}
                  logoHeight={wp(19)}
                />
                <Box ml={4}>
                  <Text
                    fontSize={13}
                    color={viewAll_color}
                  >{`${details.coin_from_name} ${buyBTCText.Sent}`}</Text>
                  <Text fontSize={13} color={`${colorMode}.primaryText`}>
                    {details.coin_from === 'BTC'
                      ? details.deposit_amount
                      : Number(details.deposit_amount).toFixed(2)}{' '}
                    {details.coin_from}
                  </Text>
                </Box>
              </HStack>
              <HStack mr={2}>
                <CoinLogo
                  code={details.coin_to}
                  CircleWidth={wp(30)}
                  logoWidth={wp(15)}
                  logoHeight={wp(19)}
                />
                <Box ml={4}>
                  <Text
                    fontSize={13}
                    color={viewAll_color}
                  >{`${details.coin_to_name} ${buyBTCText.Received}`}</Text>
                  <Text fontSize={13} color={`${colorMode}.primaryText`}>
                    {details.coin_to === 'BTC'
                      ? details.withdrawal_amount
                      : Number(details.withdrawal_amount).toFixed(2)}{' '}
                    {details.coin_to}
                  </Text>
                </Box>
              </HStack>
            </HStack>
            <Box style={styles.horizontalDivider} backgroundColor={`${colorMode}.separator`} />
            <SwapInfoCard
              title={buyBTCText.status}
              showIcon={false}
              letterSpacing={2.4}
              Content={() => <SwapStatusContent status={transaction_status} />}
            />
            <SwapInfoCard
              title={buyBTCText.realDepositAmount}
              showIcon={false}
              letterSpacing={2.4}
              description={
                details.coin_from === 'BTC'
                  ? details.real_deposit_amount + ' ' + details.coin_from
                  : Number(details.real_deposit_amount).toFixed(2) + ' ' + details.coin_from
              }
            />
            <SwapInfoCard
              title={buyBTCText.realWithdrawalAmount}
              showIcon={false}
              letterSpacing={2.4}
              description={
                details.coin_to === 'BTC'
                  ? details.real_withdrawal_amount + ' ' + details.coin_to
                  : Number(details.real_withdrawal_amount).toFixed(2) + ' ' + details.coin_to
              }
            />
            <SwapInfoCard
              title={buyBTCText.depositAddress}
              showIcon={false}
              letterSpacing={2.4}
              description={details.deposit}
              numberOfLines={2}
            />
            <SwapInfoCard
              title={buyBTCText.receiptAddress}
              showIcon={false}
              letterSpacing={2.4}
              description={details.withdrawal}
              numberOfLines={2}
            />
          </ScrollView>
        </Box>
      )}
      <ActivityIndicatorView
        visible={loading && transaction_status !== StatusEnum.OverDue}
        showLoader
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: wp(20),
  },
  transactionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    marginTop: hp(20),
  },
  Wrapper: {
    flex: 1,
    paddingHorizontal: wp(20),
    borderWidth: 1,
    marginTop: hp(30),
    borderTopLeftRadius: wp(30),
    borderTopRightRadius: wp(30),
    borderBottomWidth: 0,
    paddingVertical: wp(15),
  },
  horizontalDivider: {
    height: 1,
    width: '100%',
    marginBottom: wp(15),
  },
});
