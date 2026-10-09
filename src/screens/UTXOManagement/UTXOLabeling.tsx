import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { StyleSheet, TouchableOpacity, View, ScrollView } from 'react-native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { hp, wp } from 'src/constants/responsive';
import { UTXO } from 'src/services/wallets/interfaces';
import { EntityKind, LabelRefType, NetworkType } from 'src/services/wallets/enums';
import { useDispatch } from 'react-redux';
import useWallets from 'src/hooks/useWallets';
import useVault from 'src/hooks/useVault';
import { addLabels, bulkUpdateLabels, markUTXOSpendability } from 'src/store/sagaActions/utxos';
import TickIcon from 'src/assets/images/icon_tick.svg';
import BtcBlack from 'src/assets/images/btc_black.svg';
import BtcWhite from 'src/assets/images/btc_white.svg';
import Text from 'src/components/KeeperText';
import openLink from 'src/utils/OpenLink';
import useCurrencyCode from 'src/store/hooks/state-selectors/useCurrencyCode';
import { useAppSelector } from 'src/store/hooks';
import useExchangeRates from 'src/hooks/useExchangeRates';
import { getAmt, getCurrencyImageByRegion, getUnit } from 'src/constants/Bitcoin';
import useToastMessage from 'src/hooks/useToastMessage';
import useLabelsNew from 'src/hooks/useLabelsNew';
import Link from 'src/assets/images/link.svg';
import LinkWhite from 'src/assets/images/link-white.svg';
import Edit from 'src/assets/images/edit.svg';
import EditWhite from 'src/assets/images/edit-white.svg';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { EditNoteContent } from '../ViewTransactions/TransactionDetails';
import KeeperModal from 'src/components/KeeperModal';
import LabelsEditor, { getLabelChanges } from './components/LabelsEditor';
import WalletHeader from 'src/components/WalletHeader';
import { useUTXOSpendability } from 'src/hooks/useUTXOSpendability';
import Colors from 'src/theme/Colors';

function UTXOLabeling() {
  const { showToast } = useToastMessage();
  const navigation = useNavigation();

  const {
    params: { utxo, wallet },
  } = useRoute() as { params: { utxo: UTXO; wallet: any } };
  const { labels: txNoteLabels } = useLabelsNew({ txid: utxo.txId });

  const currencyCode = useCurrencyCode();
  const currentCurrency = useAppSelector((state) => state.settings.currencyKind);
  const exchangeRates = useExchangeRates();
  const { satsEnabled, bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const [txNoteModalVisible, setTxNoteModalVisible] = useState(false);
  const [updatingTxNote, setUpdatingTxNote] = useState(false);
  const noteRef = useRef();
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { transactions: txTranslations, wallet: walletTranslations, common } = translations;

  const dispatch = useDispatch();
  const activeAppId = useAppSelector((state) => state.storage.appId);
  const originAppId = useRef(activeAppId).current;
  // Live reactive wallet from Realm so spendability updates immediately after saga writes
  const liveWalletResult = useWallets({ walletIds: [wallet.id] }).wallets[0];
  const liveVaultResult = useVault({ vaultId: wallet.id }).activeVault;
  const liveWallet =
    wallet.entityKind === EntityKind.VAULT ? liveVaultResult : liveWalletResult;
  const { getSpendability } = useUTXOSpendability(liveWallet ?? null);
  const currentSpendability = getSpendability(utxo.txId, utxo.vout);
  const isDoNotSpend = currentSpendability === 'doNotSpend';
  const isManualOverride = !!(utxo as any).isManualOverride;
  const dustReason: 'initial' | 'descendant' | 'adjacent' | undefined = (utxo as any).dustReason;

  const dustReasonLabel = isManualOverride
    ? 'Marked manually'
    : dustReason === 'adjacent'
    ? 'Linked to potential dust payment'
    : dustReason === 'descendant'
    ? 'Linked to potential dust spend'
    : 'Potential dust payment';

  function InfoCard({
    title,
    description = '',
    descComponent = null,
    showIcon = false,
    numberOfLines = 1,
    Icon = null,
    Content = null,
    onIconPress = () => {},
  }) {
    return (
      <Box style={styles.infoCardContainer} borderBottomColor={`${colorMode}.separator`}>
        <Box style={[showIcon && { flexDirection: 'row', width: '100%', alignItems: 'center' }]}>
          <Box width={showIcon ? '90%' : '100%'}>
            <Text color={`${colorMode}.textGreen`} style={styles.titleText} numberOfLines={1}>
              {title}
            </Text>
            {Content ? (
              <Content />
            ) : descComponent ? (
              descComponent
            ) : (
              <Text
                style={[styles.descText, { width: showIcon ? '60%' : '90%' }]}
                color={`${colorMode}.GreyText`}
                numberOfLines={numberOfLines}
              >
                {description}
              </Text>
            )}
          </Box>
          {showIcon && (
            <TouchableOpacity style={{ padding: 10 }} onPress={onIconPress}>
              {Icon}
            </TouchableOpacity>
          )}
        </Box>
      </Box>
    );
  }

  useEffect(() => {
    if (txNoteLabels[utxo.txId][0] && noteRef.current) {
      if (txNoteLabels[utxo.txId][0].name === noteRef.current) setUpdatingTxNote(false);
    }
    if (!txNoteLabels[utxo.txId][0] && !noteRef.current) setUpdatingTxNote(false);
  }, [txNoteLabels]);

  useEffect(() => {
    if (updatingTxNote) {
      if (noteRef.current) {
        const finalLabels = [{ name: noteRef.current, isSystem: false }];
        if (txNoteLabels[utxo.txId][0]?.name) {
          const labelChanges = getLabelChanges(txNoteLabels[utxo.txId], finalLabels);
          dispatch(bulkUpdateLabels({ labelChanges, txId: utxo.txId, wallet }, originAppId));
        } else {
          dispatch(
            addLabels({
              labels: finalLabels,
              txId: utxo.txId,
              wallet,
              type: LabelRefType.TXN,
            }, originAppId)
          );
        }
      } else {
        if (txNoteLabels[utxo.txId][0]?.name) {
          const labelChanges = getLabelChanges(txNoteLabels[utxo.txId], []);
          dispatch(bulkUpdateLabels({ labelChanges, txId: utxo.txId, wallet }, originAppId));
        }
      }
    }
  }, [updatingTxNote]);

  const EditTxNoteContent = React.useCallback(
    () => (
      <EditNoteContent existingNote={txNoteLabels[utxo.txId][0]?.name || ''} noteRef={noteRef} />
    ),
    [utxo, txNoteLabels]
  );

  const redirectToBlockExplorer = (type: 'address' | 'tx') => {
    openLink(
      `https://mempool.space${
        bitcoinNetworkType === NetworkType.TESTNET ? '/testnet4' : ''
      }/${type}/${type == 'tx' ? utxo.txId : utxo.address}`
    );
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={walletTranslations.UTXODetails}
        subTitle={walletTranslations.UTXODetailsSubtitle}
      />
      <ScrollView
        style={styles.scrollViewWrapper}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        <LabelsEditor
          utxo={utxo}
          wallet={wallet}
          readOnlyLabels={
            isDoNotSpend ? [{ name: 'Do Not Spend', isSystem: true }] : []
          }
          onLabelsSaved={() => {
            showToast(walletTranslations.LabelsSavedSuccessfully, <TickIcon />);
            navigation.goBack();
          }}
        />
        <Box style={styles.detailsBox}>
          <Box>
            <InfoCard
              title={walletTranslations.UTXOValue}
              descComponent={
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Box style={{ marginHorizontal: 5, marginBottom: hp(7) }}>
                    {getCurrencyImageByRegion(
                      currencyCode,
                      colorMode === 'light' ? 'green' : 'light',
                      currentCurrency,
                      colorMode === 'light' ? BtcBlack : BtcWhite
                    )}
                  </Box>
                  <Text
                    style={styles.subHeaderValue}
                    color={`${colorMode}.secondaryText`}
                    numberOfLines={1}
                  >
                    {getAmt(utxo.value, exchangeRates, currencyCode, currentCurrency, satsEnabled)}
                    <Box width={wp(2)}></Box>
                    <Text color={`${colorMode}.secondaryText`} style={styles.unitText}>
                      {getUnit(currentCurrency, satsEnabled)}
                    </Text>
                  </Text>
                </View>
              }
              showIcon={false}
            />
            <InfoCard
              title={common.Address}
              description={utxo.address}
              showIcon={true}
              Icon={colorMode === 'light' ? <Link /> : <LinkWhite />}
              onIconPress={() => redirectToBlockExplorer('address')}
            />
            <InfoCard
              title={txTranslations.transactionNote}
              description={
                txNoteLabels[utxo.txId]?.[0]?.name ||
                common.addNote.charAt(0) + common.addNote.slice(1).toLowerCase()
              }
              showIcon={true}
              Icon={colorMode === 'light' ? <Edit /> : <EditWhite />}
              onIconPress={() => setTxNoteModalVisible(true)}
            />
            <InfoCard
              title={txTranslations.transactionID}
              description={utxo.txId}
              showIcon={true}
              Icon={colorMode === 'light' ? <Link /> : <LinkWhite />}
              onIconPress={() => redirectToBlockExplorer('tx')}
            />
          </Box>
          {/* Spendability section */}
          <Box style={styles.spendabilitySection} borderTopColor={`${colorMode}.separator`}>
            {isDoNotSpend ? (
              <>
                <Text style={styles.spendabilityReasonText} color="rgba(217, 44, 44, 1)">
                  {dustReasonLabel}
                </Text>
                <Text style={styles.spendabilityExplainText} color={`${colorMode}.GreyText`}>
                  Keeper marked this coin Do Not Spend to help protect wallet privacy.
                </Text>
                <TouchableOpacity
                  style={[styles.spendabilityCta, { backgroundColor: Colors.CyanGreen }]}
                  onPress={() => {
                    dispatch(markUTXOSpendability({ wallet, txId: utxo.txId, vout: utxo.vout, spendability: 'spendable' }, originAppId));
                    showToast('Coin marked spendable', <TickIcon />);
                  }}
                >
                  <Text color={Colors.headerWhite} style={styles.spendabilityCtaText}>
                    Mark Spendable
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.spendabilityCta, { backgroundColor: Colors.CrimsonRed }]}
                onPress={() => {
                  dispatch(markUTXOSpendability({ wallet, txId: utxo.txId, vout: utxo.vout, spendability: 'doNotSpend' }, originAppId));
                  showToast('Coin marked Do Not Spend', <TickIcon />);
                }}
              >
                <Text color={Colors.headerWhite} style={styles.spendabilityCtaText}>
                  Mark Do Not Spend
                </Text>
              </TouchableOpacity>
            )}
          </Box>
        </Box>
      </ScrollView>
      <KeeperModal
        visible={txNoteModalVisible}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        close={() => setTxNoteModalVisible(false)}
        title={common.addNote}
        subTitle={txTranslations.updateLabelSubTitle}
        buttonText={common.save}
        justifyContent="center"
        Content={EditTxNoteContent}
        buttonCallback={() => {
          setUpdatingTxNote(true);
          setTxNoteModalVisible(false);
        }}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollViewWrapper: {
    marginTop: hp(15),
    flex: 1,
  },
  ctaBtnWrapper: {
    marginTop: wp(20),
    marginHorizontal: wp(5),
  },
  inputLabeWrapper: {
    flexDirection: 'row',
    height: hp(40),
    width: '98%',
    alignItems: 'center',
    borderRadius: 10,
    paddingLeft: wp(5),
    borderWidth: 1,
  },
  inputLabelBox: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 13,
  },
  addBtnWrapper: {
    width: wp(32),
    height: hp(32),
    alignItems: 'center',
    marginRight: 3,
  },
  unitText: {
    letterSpacing: 0.6,
    fontSize: 13,
  },
  subHeader: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 38,
  },
  subHeaderTitle: {
    fontSize: 14,
    marginEnd: 5,
  },
  subHeaderValue: {
    fontSize: 14,
    marginEnd: 5,
    letterSpacing: 2,
    marginBottom: hp(7),
  },
  listHeader: {
    flex: 1,
    fontSize: 14,
  },
  listContainer: {
    marginTop: 18,
    marginHorizontal: 5,
    paddingHorizontal: 15,
    paddingTop: hp(26),
    paddingBottom: hp(21),
    borderRadius: 10,
  },
  listSubContainer: {
    flexWrap: 'wrap',
    marginTop: hp(15),
    marginBottom: hp(5),
    flexDirection: 'row',
  },
  detailsBox: {
    height: '100%',
    marginTop: hp(30),
    paddingHorizontal: wp(15),
  },
  infoCardContainer: {
    marginVertical: hp(7),
    justifyContent: 'center',
    paddingVertical: hp(5),
    borderBottomWidth: 1,
  },
  titleText: {
    fontSize: 14,
    letterSpacing: 1.12,
    width: '90%',
    marginBottom: hp(5),
  },
  descText: {
    fontSize: 12,
    marginBottom: hp(7),
  },
  spendabilitySection: {
    marginTop: hp(20),
    paddingTop: hp(16),
    borderTopWidth: 1,
    paddingHorizontal: wp(5),
  },
  spendabilityReasonText: {
    fontSize: 13,
    marginBottom: hp(6),
  },
  spendabilityExplainText: {
    fontSize: 12,
    marginBottom: hp(16),
  },
  spendabilityCta: {
    paddingVertical: hp(14),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: hp(4),
  },
  spendabilityCtaText: {
    fontSize: 14,
  },
});

export default UTXOLabeling;
