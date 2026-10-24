import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import Colors from 'src/theme/Colors';
import TransactionPendingIcon from 'src/assets/images/transaction_pending.svg';
import moment from 'moment';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import IconArrow from 'src/assets/images/icon_arrow_grey.svg';
import IconArrowWhite from 'src/assets/images/icon_arrow_white.svg';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import { StatusEnum } from './Constant';
import SwapConfirmingIcon from '../../../../../../assets/images/swap-confirmint.svg';
import SwapProcessingIcon from '../../../../../../assets/images/swap-processing.svg';
import SwapSuccessIcon from '../../../../../../assets/images/swap-success.svg';
import SwapOverDueIcon from '../../../../../../assets/images/swap-overDue.svg';
import { CoinLogo } from './CoinLogo';
import SwapPriceArrow from 'src/assets/images/swap-price-arrow.svg';
import SwapPriceArrowWhite from 'src/assets/images/swap-price-arrow-white.svg';

type Props = {
  onPress?: () => void;
  history: any;
  status: string;
};

const SwapTransactionCard = ({ onPress = () => {}, history, status }: Props) => {
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';
  const formattedDate = moment(history?.created_at)?.format('DD MMM YY  .  HH:mm A');
  const viewAll_color = ThemedColor({ name: 'viewAll_color' });

  return (
    <TouchableOpacity onPress={onPress}>
      <Box style={[styles.container]} borderBottomColor={`${colorMode}.border`}>
        <Box style={styles.rowCenter}>
          <Box style={styles.circle}>
            {status === StatusEnum.Confirming && (
              <Box style={styles.transaction}>
                <TransactionPendingIcon width={wp(18)} height={wp(18)} />
              </Box>
            )}
            <CircleIconWrapper
              width={wp(30)}
              icon={
                status === StatusEnum.Confirming ? (
                  <SwapConfirmingIcon />
                ) : status === StatusEnum.Processing ? (
                  <SwapProcessingIcon />
                ) : status === StatusEnum.Success ? (
                  <SwapSuccessIcon />
                ) : (
                  <SwapOverDueIcon />
                )
              }
              backgroundColor={
                status === StatusEnum.Confirming
                  ? Colors.lightOrange
                  : status === StatusEnum.Processing
                  ? Colors.lightindigoblue
                  : status === StatusEnum.Success
                  ? Colors.PaleTropicalTeal
                  : Colors.lightRed
              }
            />
          </Box>

          <Box style={styles.transactionContainer}>
            <Text
              color={`${colorMode}.primaryText`}
              numberOfLines={1}
              style={styles.transactionIdText}
              medium
            >
              {history?.id}
            </Text>
            <Text color={viewAll_color} style={styles.transactionDate} numberOfLines={1}>
              {formattedDate}
            </Text>
          </Box>
        </Box>
        <Box style={styles.SecContainer}>
          <Box style={styles.priceRowContainer}>
            <Box style={styles.priceBox}>
              <Box style={styles.arrowContainer}>
                <CoinLogo
                  code={history.coin_from}
                  logoWidth={wp(7.5)}
                  logoHeight={wp(9.5)}
                  CircleWidth={wp(15)}
                />
                <Box>{isDark ? <SwapPriceArrowWhite /> : <SwapPriceArrow width={wp(11)} />}</Box>
              </Box>
              <Text
                style={styles.amountText}
                fontSize={12}
                medium
                color={isDark ? Colors.bodyText : Colors.DarkSlateGray}
              >
                {(() => {
                  const amount =
                    history.coin_from === 'BTC'
                      ? history.deposit_amount.toString()
                      : Number(history.deposit_amount).toFixed(2).toString();

                  return amount.length > 3 ? `${amount.slice(0, 6)}...` : amount;
                })()}
              </Text>
            </Box>

            <Box style={styles.priceBox}>
              <CoinLogo
                code={history.coin_to}
                logoWidth={wp(7.5)}
                logoHeight={wp(9.5)}
                CircleWidth={wp(15)}
              />
              <Text
                style={styles.amountText}
                fontSize={11}
                medium
                color={isDark ? Colors.bodyText : Colors.DarkSlateGray}
              >
                {(() => {
                  const amount =
                    history.coin_to === 'BTC'
                      ? history.withdrawal_amount?.toString()
                      : Number(history.withdrawal_amount).toFixed(2).toString();

                  return amount.length > 3 ? `${amount.slice(0, 6)}...` : amount;
                })()}
              </Text>
            </Box>
          </Box>

          <Box style={styles.arrowIconWrapper}>
            {colorMode === 'dark' ? <IconArrowWhite /> : <IconArrow />}
          </Box>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};

export default SwapTransactionCard;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 10,
    minHeight: hp(76),
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  rowCenter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: wp(5),
  },
  transactionContainer: {
    flexDirection: 'column',
    marginLeft: 8,
    gap: 2.5,
  },
  transactionDate: {
    fontSize: 11,
    width: wp(125),
    marginHorizontal: 3,
    lineHeight: 17,
  },
  transactionIdText: {
    marginHorizontal: 4,
    fontSize: 13,
    lineHeight: 20,
  },
  arrowIconWrapper: {
    paddingRight: wp(5),
    paddingTop: hp(2),
  },
  circle: {
    width: 30,
    borderRadius: 30 / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transaction: {
    position: 'absolute',
    top: -15,
    left: -4,
    zIndex: 1,
  },
  priceRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: wp(5),
    paddingVertical: hp(2),
    width: wp(145),
  },

  priceBox: {
    gap: 2,
    marginHorizontal: wp(3),
    width: wp(60),
  },

  amountText: {
    marginLeft: wp(2),
  },
  arrowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: wp(5),
  },
  SecContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
