import {
  ActivityIndicator,
  Platform,
  Alert,
  Linking,
  StyleSheet,
  Dimensions,
  Pressable,
} from 'react-native';
import Text from 'src/components/KeeperText';
import { Box, useColorMode } from 'native-base';
import {
  getSubscriptions,
  purchaseErrorListener,
  purchaseUpdatedListener,
  getAvailablePurchases,
  SubscriptionPurchase,
  requestSubscription,
  finishTransaction,
} from 'react-native-iap';
import React, { useContext, useEffect, useState } from 'react';
import CircularGreenArrow from 'src/assets/images/DashedCircleArrow.svg';
import CircularWhiteArrow from 'src/assets/images/DashedCirculrarWhiteArrow.svg';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { RealmSchema } from 'src/storage/realm/enum';
import ScreenWrapper from 'src/components/ScreenWrapper';
import SubScription, { SubScriptionPlan } from 'src/models/interfaces/Subscription';
import dbManager from 'src/storage/realm/dbManager';
import { wp, hp } from 'src/constants/responsive';
import Relay from 'src/services/backend/Relay';
import moment from 'moment';
import { getBundleId } from 'react-native-device-info';
import { useDispatch } from 'react-redux';
import useToastMessage from 'src/hooks/useToastMessage';
import KeeperModal from 'src/components/KeeperModal';
import LoadingAnimation from 'src/components/Loader';
import { useQuery } from '@realm/react';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import MonthlyYearlySwitch from 'src/components/Switch/MonthlyYearlySwitch';
import TierUpgradeModal, { UPGRADE_TYPE } from './TierUpgradeModal';
import Buttons from 'src/components/Buttons';
import WalletHeader from 'src/components/WalletHeader';
import SubscriptionList from './components/SubscriptionList';
import usePlan from 'src/hooks/usePlan';
import { setSubscription } from 'src/store/sagaActions/settings';
import { setAutomaticCloudBackup } from 'src/store/reducers/bhr';
import { AppSubscriptionLevel, SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { BrownButton } from 'src/components/BrownButton';
import config from 'src/utils/service-utilities/config';
import { manipulateIosProdProductId } from 'src/utils/utilities';
import ChangeIntervalIllustration from 'src/assets/images/changeInterval.svg';
const { width } = Dimensions.get('window');

const OLD_SUBS_PRODUCT_ID = ['hodler.dev', 'diamond_hands.dev', 'diamond_hands', 'hodler'];

function ChoosePlan() {
  const route = useRoute();
  const navigation = useNavigation();
  const { initialPosition } = route.params?.planPosition || 0;

  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { translations } = useContext(LocalizationContext);
  const { choosePlan, common } = translations;
  const [currentPosition, setCurrentPosition] = useState(initialPosition);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const { showToast } = useToastMessage();
  const {
    id,
    publicId,
    subscription: appSubscription,
  }: KeeperApp = dbManager.getObjectByIndex(RealmSchema.KeeperApp);
  const [items, setItems] = useState<SubScriptionPlan[]>([]);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeType, setUpgradeType] = useState(null);
  const [isMonthly, setIsMonthly] = useState(false);
  const { subscription }: KeeperApp = useQuery(RealmSchema.KeeperApp)[0];
  const disptach = useDispatch();
  const [isServiceUnavailible, setIsServiceUnavailible] = useState(false);
  const { isOnL1, isOnL3Above } = usePlan();
  const [enableDesktopManagement, setEnableDesktopManagement] = useState(true);
  const [showChangeInterval, setShowChangeInterval] = useState(false);
  const [playServiceUnavailable, setPlayServiceUnavailable] = useState(false);

  useEffect(() => {
    const purchaseUpdateSubscription = purchaseUpdatedListener(async (purchase) => {
      processPurchase(purchase);
    });
    const purchaseErrorSubscription = purchaseErrorListener((error) => {
      console.log('purchaseErrorListener', error);
      setRequesting(false);
    });

    return () => {
      if (purchaseUpdateSubscription) {
        purchaseUpdateSubscription.remove();
      }
      if (purchaseErrorSubscription) {
        purchaseErrorSubscription.remove();
      }
    };
  }, [items]);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    setCurrentPosition(initialPosition !== 0 ? initialPosition : subscription.level - 1);
  }, []);

  useEffect(() => {
    if (!isOnL1 && !appSubscription?.isDesktopPurchase) {
      setEnableDesktopManagement(false);
      return;
    } else {
      if (appSubscription?.isDesktopPurchase) {
        const { expirationTime } = JSON.parse(appSubscription?.receipt ?? '{}');
        setEnableDesktopManagement(expirationTime - Date.now() <= config.RENEWAL_WINDOW);
        return;
      } else setEnableDesktopManagement(true);
    }
  }, [appSubscription]);

  async function init() {
    let data = [];
    try {
      const getPlansResponse = await Relay.getSubscriptionDetails(id, publicId);
      if (getPlansResponse.plans) {
        data = getPlansResponse.plans;
        const skus = [];
        getPlansResponse.plans.forEach((plan) => skus.push(...plan.productIds));
        const subscriptions = await getSubscriptions({ skus });
        if (!subscriptions.length) throw { message: 'Something went wrong, please try again!' };
        subscriptions.forEach((subscription: any, i) => {
          const index = data.findIndex((plan) => plan.productIds.includes(subscription.productId));
          const monthlyPlans = [];
          const yearlyPlans = [];
          if (Platform.OS === 'android') {
            subscription.subscriptionOfferDetails.forEach((offer) => {
              const monthly = offer.pricingPhases.pricingPhaseList.filter(
                (list) => list.billingPeriod === 'P1M' && list.formattedPrice !== 'Free'
              );
              const yearly = offer.pricingPhases.pricingPhaseList.filter(
                (list) => list.billingPeriod === 'P1Y' && list.formattedPrice !== 'Free'
              );
              if (monthly.length) monthlyPlans.push(offer);
              if (yearly.length) yearlyPlans.push(offer);
            });

            if (monthlyPlans.length > 0) {
              data[index].monthlyPlanDetails = {
                ...getPlanData(monthlyPlans),
                productId: subscription.productId,
                offers: monthlyPlans,
              };
            }
            if (yearlyPlans.length > 0) {
              data[index].yearlyPlanDetails = {
                ...getPlanData(yearlyPlans),
                productId: subscription.productId,
                offers: yearlyPlans,
              };
            }
          } else if (Platform.OS === 'ios') {
            const planDetails = {
              price: subscription.localizedPrice,
              currency: subscription.currency,
              offerToken: null,
              productId: subscription.productId,
              trailPeriod: `${
                subscription.introductoryPriceNumberOfPeriodsIOS
              } ${subscription.introductoryPriceSubscriptionPeriodIOS.toLowerCase()} free`,
            };
            if (subscription.subscriptionPeriodUnitIOS === 'MONTH') {
              data[index].monthlyPlanDetails = planDetails;
            } else if (subscription.subscriptionPeriodUnitIOS === 'YEAR') {
              data[index].yearlyPlanDetails = planDetails;
            }
          }
        });
        data[0].monthlyPlanDetails = { productId: data[0].productIds[0] };
        data[0].yearlyPlanDetails = { productId: data[0].productIds[0] };
        setItems(data);
        setLoading(false);
      }
    } catch (error) {
      console.log('error', error);
      if (error.message.includes('Billing is unavailable.')) {
        setItems(data);
        setLoading(false);
        showToast(error.message);
        setIsServiceUnavailible(true);
      } else {
        if (error.message.includes('Google Play Services are not available on this device')) {
          setItems(data);
          setLoading(false);
          showToast(error.message);
          setPlayServiceUnavailable(true);
        } else {
          showToast(error.message);
          navigation.goBack();
        }
      }
    }
  }

  const processPurchase = async (purchase: SubscriptionPurchase) => {
    setRequesting(true);
    try {
      let response;
      const receipt = purchase.transactionReceipt;
      let plan = items.filter((item) => item.productIds.includes(purchase.productId));
      if (!plan.length && OLD_SUBS_PRODUCT_ID.includes(purchase.productId)) {
        // For old subs restore, updating relay with new subs monthly plan of same tier.
        const newProductId = purchase.productId.split('.')[0] + '.monthly';
        plan = items.filter((item) => item.productIds.includes(newProductId));
        const updatedPurchase = {
          ...purchase,
          productId: newProductId,
          productIds: [newProductId],
        };
        response = await Relay.updateSubscription(id, publicId, updatedPurchase);
      } else {
        response = await Relay.updateSubscription(id, publicId, purchase);
      }
      setRequesting(false);
      if (response.updated) {
        const subscription: SubScription = {
          productId: purchase.productId,
          receipt,
          name: plan[0].name,
          level: response.level,
          icon: plan[0].icon,
        };
        calculateModalContent(response, appSubscription);
        dbManager.updateObjectById(RealmSchema.KeeperApp, id, {
          subscription,
        });
        disptach(setSubscription(subscription.name));
        setShowUpgradeModal(true);
        setLoading(true);
        init();
      } else if (response.error) {
        showToast(response.error);
      }
      if (receipt) await finishTransaction({ purchase, isConsumable: false });
    } catch (error) {
      setRequesting(false);
      console.log(error);
    }
  };

  function getPlanData(offers) {
    let offer;
    if (offers.length > 1) {
      offers.sort(
        (a, b) => a.pricingPhases.pricingPhaseList.length < b.pricingPhases.pricingPhaseList.length
      );
      offer = offers[0];
    } else if (offers.length === 0) {
      return null;
    } else {
      offer = offers[0];
    }
    const trailPlan = offer.pricingPhases.pricingPhaseList.filter(
      (list) => list.formattedPrice === 'Free'
    );
    const paidPlan = offer.pricingPhases.pricingPhaseList.filter(
      (list) => list.formattedPrice !== 'Free'
    );
    if (trailPlan.length) {
      return {
        currency: offer.pricingPhases.pricingPhaseList[0].priceCurrencyCode,
        offerToken: offer.offerToken,
        trailPeriod: `${moment.duration(trailPlan[0].billingPeriod).asMonths()} month${
          moment.duration(trailPlan[0].billingPeriod).asMonths() > 1 ? 's' : ''
        } free`,
        price: paidPlan[0].formattedPrice,
      };
    }
    return {
      currency: offer.pricingPhases.pricingPhaseList[0].priceCurrencyCode,
      offerToken: offer.offerToken,
      trailPeriod: '',
      price: paidPlan[0].formattedPrice,
    };
  }

  function manageSubscription(sku: string) {
    if (Platform.OS === 'ios') {
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    } else if (Platform.OS === 'android') {
      Linking.openURL(
        `https://play.google.com/store/account/subscriptions?package=${getBundleId()}&sku=${sku}`
      );
    }
  }

  async function processSubscription(subscription: SubScriptionPlan) {
    try {
      if (subscription.productType === 'free') {
        setRequesting(true);
        const response = await Relay.updateSubscription(id, publicId, {
          productId: subscription.productIds[0],
        });
        setRequesting(false);
        if (response.updated) {
          const updatedSubscription: SubScription = {
            productId: subscription.productIds[0],
            receipt: '',
            name: subscription.name,
            level: response.level,
            icon: subscription.icon,
          };
          calculateModalContent(response, appSubscription);
          dbManager.updateObjectById(RealmSchema.KeeperApp, id, {
            subscription: updatedSubscription,
          });
          // if (response.level === AppSubscriptionLevel.L1) disptach(setAutomaticCloudBackup(false));
          disptach(setSubscription(subscription.name));
          setShowUpgradeModal(true);
        } else {
          Alert.alert('', response.error, [
            {
              text: common.cancel,
              onPress: () => {},
              style: 'cancel',
            },
            !appSubscription?.isDesktopPurchase && {
              text: common.manage,
              onPress: () => manageSubscription(response.productId),
            },
          ]);
        }
      } else {
        if (isServiceUnavailible) {
          showToast(choosePlan.serviceUnavailableMesage);
          return;
        }
        setRequesting(true);
        const plan = isMonthly ? subscription.monthlyPlanDetails : subscription.yearlyPlanDetails;
        const sku = plan.productId;
        const { offerToken } = plan;
        let purchaseTokenAndroid = null;
        if (Platform.OS === 'android' && appSubscription.receipt) {
          purchaseTokenAndroid = JSON.parse(appSubscription.receipt).purchaseToken;
        }
        requestSubscription({
          sku,
          subscriptionOffers: [{ sku, offerToken }],
          purchaseTokenAndroid,
        });
      }
    } catch (err) {
      setRequesting(false);
      console.log(err);
    }
  }

  const calculateModalContent = (response, appSubscription) => {
    if (response.level === appSubscription.level) {
      if (appSubscription.productId.includes('yearly'))
        setUpgradeType(UPGRADE_TYPE.YEARLY_TO_MONTHLY);
      else setUpgradeType(UPGRADE_TYPE.MONTHLY_TO_YEARLY);
    } else if (response.level > appSubscription.level) setUpgradeType(UPGRADE_TYPE.UPGRADE);
    else setUpgradeType(UPGRADE_TYPE.DOWNGRADE);
  };

  const onPressModalBtn = () => {
    setShowUpgradeModal(false);
  };

  const restorePurchases = async () => {
    try {
      setRequesting(true);
      let purchases = [];
      try {
        purchases = await getAvailablePurchases();
      } catch (error) {
        console.log('🚀 ~ restorePurchases ~ error:', error);
      }
      if (purchases.length === 0) {
        const btcPurchase = await Relay.restoreBtcPurchase(id);
        if (btcPurchase) {
          const subscription: SubScription = {
            productId: manipulateIosProdProductId(btcPurchase.productId),
            receipt: btcPurchase.receipt,
            name: btcPurchase.name,
            level: btcPurchase.level,
            icon: btcPurchase.icon,
            isDesktopPurchase: true,
          };
          calculateModalContent(btcPurchase, appSubscription);
          dbManager.updateObjectById(RealmSchema.KeeperApp, id, {
            subscription,
          });
          disptach(setSubscription(subscription.name));
          setShowUpgradeModal(true);
          setRequesting(false);
          init();
          return;
        }
        setRequesting(false);
        showToast(choosePlan.noAvailablePurchaseMessage);
      } else {
        setRequesting(false);
        for (let i = 0; i < purchases.length; i++) {
          const purchase = purchases[i];
          if (purchase.productId === subscription.productId) {
            showToast(`${choosePlan.currentSubscriptionMessage} ${subscription.name}`);
          } else {
            const validPurchase = items.find(
              (item) =>
                item.productIds.includes(purchase.productId) ||
                OLD_SUBS_PRODUCT_ID.includes(purchase.productId)
            );
            if (validPurchase) {
              processPurchase(purchase);
              break;
            }
          }
        }
      }
    } catch (error) {
      setRequesting(false);
      console.log(error);
    }
  };

  function LoginModalContent() {
    const { colorMode } = useColorMode();
    return (
      <Box>
        <LoadingAnimation />
        <Text color={`${colorMode}.greenText`} style={styles.infoText}>
          {choosePlan.youCanChange}
        </Text>
      </Box>
    );
  }

  const getButtonState = () => {
    if (!items || loading) return { text: '', disabled: true };

    const currentItem = items[currentPosition];
    if (!currentItem) return { text: 'Get Started', disabled: false };

    const isPleb = currentItem.productIds.includes('pleb');
    const isKeeperPrivate = currentItem.productIds[0].includes('keeper_private');
    const isSubscribed =
      (!isPleb &&
        currentItem.productIds.includes(subscription.productId.toLowerCase()) &&
        subscription.productId.toLowerCase().includes(isMonthly ? 'monthly' : 'yearly')) ||
      (isPleb && subscription.productId.toLowerCase() === 'pleb');

    return {
      text: isSubscribed
        ? 'Current Plan'
        : isKeeperPrivate
        ? 'Get in Touch'
        : playServiceUnavailable
        ? ''
        : 'Get Started',
      disabled: isSubscribed,
    };
  };

  const changeIntervalContent = () => {
    return (
      <Box>
        <Box alignItems={'center'}>
          <ChangeIntervalIllustration />
        </Box>
        <Box alignItems={'flex-end'} mt={hp(20)}>
          <Buttons
            primaryText={common.proceed}
            primaryCallback={() => processSubscription(items[currentPosition])}
            secondaryText={common.cancel}
            secondaryCallback={() => setShowChangeInterval(false)}
          />
        </Box>
      </Box>
    );
  };

  const FooterCTA = () => {
    return (
      <>
        {enableDesktopManagement && (
          <BrownButton
            title="Desktop Subscription Management"
            onPress={() => navigation.dispatch(CommonActions.navigate('PurchaseWithChannel'))}
          />
        )}
      </>
    );
  };

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={choosePlan.choosePlantitle}
        rightComponent={
          isOnL1 && (
            <Pressable onPress={restorePurchases} testID="btn_restorePurchases">
              {isDarkMode ? (
                <CircularWhiteArrow width={22} height={22} />
              ) : (
                <CircularGreenArrow width={22} height={22} />
              )}
            </Pressable>
          )
        }
      />
      <MonthlyYearlySwitch
        title2="Monthly"
        title1="Yearly"
        value={isMonthly}
        onValueChange={() => setIsMonthly(!isMonthly)}
      />
      <KeeperModal
        visible={requesting}
        close={() => {}}
        title={choosePlan.confirming}
        subTitle={choosePlan.pleaseStay}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        buttonText={null}
        buttonCallback={() => {}}
        Content={LoginModalContent}
        subTitleWidth={wp(210)}
      />
      <KeeperModal
        visible={showChangeInterval}
        close={() => setShowChangeInterval(false)}
        title={choosePlan.changeIntervalTitle}
        subTitle={choosePlan.changeIntervalSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        Content={changeIntervalContent}
        subTitleWidth={width * 0.8}
      />
      <TierUpgradeModal
        visible={showUpgradeModal}
        close={() => setShowUpgradeModal(false)}
        onPress={onPressModalBtn}
        upgradeType={upgradeType}
        plan={subscription.name}
      />
      {loading ? (
        <ActivityIndicator style={{ height: '70%' }} size="large" />
      ) : (
        <Box flex={1}>
          <SubscriptionList
            playServiceUnavailable={playServiceUnavailable}
            plans={items}
            currentPosition={currentPosition}
            onChange={(item) => setCurrentPosition(item)}
            primaryCallback={() => {
              if (items[currentPosition].name === SubscriptionTier.L4) {
                Linking.openURL(`https://bitcoinkeeper.app/private`);
                return;
              } else if (!isOnL1 && appSubscription.isDesktopPurchase) {
                Alert.alert('', 'You already have an active BTC based subscription.');
                return;
              }
              // check if user moving from yearly to monthly
              if (isMonthly && appSubscription.productId.includes('yearly')) {
                setShowChangeInterval(true);
                return;
              }
              processSubscription(items[currentPosition]);
            }}
            isMonthly={isMonthly}
            getButtonText={getButtonState}
            listFooterCta={<FooterCTA />}
          />
        </Box>
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  restorePurchase: {
    fontSize: 13,
    letterSpacing: 0.24,
    textDecorationLine: 'underline',
  },
  infoText: {
    fontSize: 13,
    marginTop: hp(20),
  },
});
export default ChoosePlan;
