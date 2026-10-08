import moment from 'moment';
import { Box, ScrollView, useColorMode, VStack } from '@gluestack-ui/themed-native-base';
import React, { useCallback, useContext, useRef, useState } from 'react';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import IconRecieve from 'src/assets/images/icon_received_lg.svg';
import IconRecieveDark from 'src/assets/images/icon_received_dark_lg.svg';
import IconSend from 'src/assets/images/icon_send_lg.svg';
import IconSendDark from 'src/assets/images/icon_send_dark_lg.svg';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import KeeperModal from 'src/components/KeeperModal';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useLabelsNew from 'src/hooks/useLabelsNew';
import KeeperTextInput from 'src/components/KeeperTextInput';
import Edit from 'src/assets/images/edit.svg';
import EditDark from 'src/assets/images/edit-white.svg';
import { current } from '@reduxjs/toolkit';
import StatusContent from './components/StatusContent';
import {
  isHistoricalUnverifiedUSDTRequest,
  USDTTransaction,
} from 'src/services/wallets/operations/dollars/USDT';
import { USDTWallet } from 'src/services/wallets/factories/USDTWalletFactory';
import Link from 'src/assets/images/link.svg';
import LinkDark from 'src/assets/images/link-white.svg';
import openLink from 'src/utils/OpenLink';

export function EditNoteContent({ existingNote, noteRef }: { existingNote: string; noteRef }) {
  const updateNote = useCallback((text) => {
    noteRef.current = text;
  }, []);
  const { translations } = useContext(LocalizationContext);
  const { transactions } = translations;

  return (
    <VStack style={styles.noteContainer}>
      <KeeperTextInput
        defaultValue={existingNote}
        onChangeText={updateNote}
        placeholder={transactions.addTransactionNote}
        testID="tx_note"
      />
    </VStack>
  );
}

const UsdtTransactionDetail = ({ route }) => {
  const { transaction, wallet }: { transaction: USDTTransaction; wallet: USDTWallet } =
    route.params;

  const transactionId = transaction.txId || transaction.traceId;
  const date = transaction.timestamp;
  const amount = parseFloat(transaction.amount);
  // A trace without a chain transaction ID is a historical provider request.
  // Its final result cannot be established after the provider was retired.
  const legacyRequest = isHistoricalUnverifiedUSDTRequest(transaction);
  const status = transaction.status;
  let transactionType: string;
  if (transaction.to === wallet.accountStatus.gasFreeAddress) {
    transactionType = 'Received';
  } else transactionType = 'Sent';

  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { common, transactions, usdtWalletText } = translations;
  const { labels } = useLabelsNew({ txid: transactionId });
  const noteRef = useRef();
  const [visible, setVisible] = useState(false);
  const [updatingLabel, setUpdatingLabel] = useState(false);
  const close = () => setVisible(false);

  function InfoCard({
    title,
    describtion = '',
    width = 340,
    showIcon = false,
    letterSpacing = 1,
    numberOfLines = 1,
    Icon = null,
    Content = null,
  }) {
    return (
      <Box width={wp(width)} style={styles.infoCardContainer}>
        <Box style={[showIcon && { flexDirection: 'row', width: '100%', alignItems: 'center' }]}>
          <Box width={showIcon ? '92%' : '100%'}>
            <Box style={styles.titleWrapper}>
              <Text color={`${colorMode}.greenText`} style={styles.titleText} numberOfLines={1}>
                {title}
              </Text>
              {showIcon && Icon}
            </Box>
            {Content ? (
              <Content />
            ) : (
              <Text
                style={styles.descText}
                color={`${colorMode}.greenishGreyText`}
                width="85%"
                numberOfLines={numberOfLines}
              >
                {describtion}
              </Text>
            )}
          </Box>
        </Box>
        <Box style={styles.divider} backgroundColor={`${colorMode}.border`} />
      </Box>
    );
  }

  const MemoisedContent = React.useCallback(
    () => <EditNoteContent existingNote={noteRef.current} noteRef={noteRef} />,
    [transaction, labels]
  );

  const redirectToBlockExplorer = (txId: string) => {
    openLink(`https://tronscan.org/#/transaction/${txId}`);
  };

  return (
    <ScreenWrapper paddingHorizontal={0} backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box style={styles.headerContainer}>
        <WalletHeader
          title={usdtWalletText.transactionDetails}
          subTitle={usdtWalletText.transactionDetailsSubTitle}
        />
        <Box style={styles.transViewWrapper}>
          <Box style={styles.transViewIcon}>
            {transactionType === 'Received' ? (
              colorMode === 'dark' ? (
                <IconRecieveDark />
              ) : (
                <IconRecieve />
              )
            ) : colorMode === 'dark' ? (
              <IconSendDark />
            ) : (
              <IconSend />
            )}
            <Box style={styles.transView}>
              <Text color={`${colorMode}.GreyText`} numberOfLines={1} style={styles.transIDText}>
                {transactionId}
              </Text>
              <Text style={styles.transDateText} color={`${colorMode}.GreyText`}>
                {moment(date).format('DD MMM YY • HH:mm A')}
              </Text>
            </Box>
          </Box>
          <Box style={styles.amountWrapper}>
            <Text style={styles.amountText} semiBold>
              {amount} <Text style={styles.unitText}>USDT</Text>
            </Text>
          </Box>
        </Box>
      </Box>
      <Box
        style={styles.bottomSection}
        borderColor={`${colorMode}.separator`}
        backgroundColor={`${colorMode}.prsimaryBackground`}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <Box>
            <Box style={styles.infoCardsWrapper}>
              {/* <TouchableOpacity testID="btn_transactionNote" onPress={() => setVisible(true)}>
                <InfoCard
                  title={common.note}
                  describtion={
                    noteRef.current ||
                    common.addNote.charAt(0) + common.addNote.slice(1).toLowerCase()
                  }
                  showIcon
                  letterSpacing={2.4}
                  Icon={
                    updatingLabel ? (
                      <ActivityIndicator />
                    ) : colorMode === 'dark' ? (
                      <EditDark width={18} height={18} />
                    ) : (
                      <Edit width={18} height={18} />
                    )
                  }
                />
              </TouchableOpacity> */}
              <TouchableOpacity
                testID="btn_transactionId"
                disabled={!transaction.txId}
                onPress={() => {
                  if (transaction.txId) {
                    redirectToBlockExplorer(transaction.txId);
                  }
                }}
              >
                <InfoCard
                  title={transaction.txId ? transactions.transactionID : 'Trace ID'}
                  describtion={transaction.txId ? transaction.txId : transaction.traceId}
                  showIcon
                  letterSpacing={2.4}
                  Icon={
                    transaction.txId ? (
                      colorMode === 'dark' ? (
                        <LinkDark width={18} height={18} />
                      ) : (
                        <Link width={18} height={18} />
                      )
                    ) : null
                  }
                />
              </TouchableOpacity>
              <InfoCard
                title={usdtWalletText.status}
                showIcon={false}
                letterSpacing={2.4}
                Content={() => <StatusContent status={status} unavailable={legacyRequest} />}
              />
              {legacyRequest && (
                <InfoCard
                  title={usdtWalletText.legacyRequestTitle}
                  describtion={usdtWalletText.legacyRequestNotice}
                  numberOfLines={0}
                />
              )}
              {transactionType === 'Sent' && (
                <InfoCard
                  title={usdtWalletText.recipientAddress}
                  showIcon={false}
                  letterSpacing={2.4}
                  describtion={transaction?.to}
                />
              )}

              <InfoCard
                title={
                  transactionType === 'Received'
                    ? usdtWalletText.recievedAmount
                    : legacyRequest
                    ? usdtWalletText.requestedAmount
                    : usdtWalletText.sendingAmount
                }
                describtion={`${amount} USDT`}
                showIcon={false}
                letterSpacing={2.4}
              />
              {transaction.transferFee || transaction.fee ? (
                <InfoCard
                  title={'Transaction Fee'}
                  describtion={`${transaction.transferFee || transaction.fee} USDT`}
                  showIcon={false}
                  letterSpacing={2.4}
                />
              ) : null}
              {transaction.activateFee ? (
                <InfoCard
                  title={'Activation Fee'}
                  describtion={`${transaction.activateFee} USDT`}
                  showIcon={false}
                  letterSpacing={2.4}
                />
              ) : null}
            </Box>
          </Box>
          <KeeperModal
            visible={visible}
            modalBackground={`${colorMode}.modalWhiteBackground`}
            textColor={`${colorMode}.textGreen`}
            subTitleColor={`${colorMode}.modalSubtitleBlack`}
            close={close}
            title={common.addNote}
            subTitle={transactions.updateLabelSubTitle}
            buttonText={common.save}
            justifyContent="center"
            Content={MemoisedContent}
            buttonCallback={() => {
              setUpdatingLabel(false);
              close();
            }}
          />
        </ScrollView>
      </Box>
    </ScreenWrapper>
  );
};

export default UsdtTransactionDetail;

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  topSection: {
    paddingTop: hp(17),
  },
  bottomSection: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    flex: 1,
    paddingTop: hp(10),
    borderWidth: 1,
  },
  Container: {
    flex: 1,
  },
  transViewWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: hp(30),
    width: wp(320),
    justifyContent: 'space-between',
    paddingBottom: hp(25),
  },
  transView: {
    marginLeft: wp(10),
    width: wp(120),
  },
  transViewIcon: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoCardContainer: {
    justifyContent: 'center',
    paddingLeft: wp(8),
    paddingHorizontal: 3,
    paddingBottom: hp(10),
  },
  infoCardsWrapper: {
    alignItems: 'center',
    marginTop: hp(20),
    justifyContent: 'center',
  },
  titleWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleText: {
    fontSize: 15,
    width: '100%',
  },
  descText: {
    marginTop: hp(5),
    fontSize: 14,
  },
  transDateText: {
    fontSize: 11,
  },
  transIDText: {
    fontSize: 14,
  },

  noteContainer: {
    width: windowWidth * 0.8,
  },
  divider: {
    marginTop: hp(15),
    height: 1,
    width: windowWidth * 0.835,
  },

  amountWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  amountText: {
    fontSize: 18,
  },

  unitText: {
    fontSize: 14,
    fontWeight: '400',
  },
  headerContainer: {
    paddingHorizontal: wp(20),
  },
});
