import { Box, ScrollView, useColorMode } from 'native-base';
import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import { hp, wp } from 'src/constants/responsive';
import { useSettingKeeper } from 'src/hooks/useSettingKeeper';
import ArrowRightGreen from 'src/assets/images/right-green-icon.svg';
import ArrowDownGreen from 'src/assets/images/down-green-icon.svg';
import ArrowDownWhite from 'src/assets/images/down-white-icon.svg';
import ArrowRightWhite from 'src/assets/images/right-white-icon.svg';
import Text from 'src/components/KeeperText';
import PlanDetailsCards from './PlanDetailsCards';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import Buttons from 'src/components/Buttons';
import Colors from 'src/theme/Colors';
import { AppSubscriptionLevel, SubscriptionTier } from 'src/models/enums/SubscriptionTier';

const SubscriptionList: React.FC<{
  plans: any[];
  currentPosition: number;
  onChange?: any;
  primaryCallback?: any;
  isMonthly: boolean;
  getButtonText?: any;
  listFooterCta?: React.ReactNode;
  playServiceUnavailable?: boolean;
  listHeaderCta?: React.ReactNode;
}> = ({
  plans,
  currentPosition,
  onChange,
  primaryCallback,
  isMonthly,
  getButtonText,
  listFooterCta,
  playServiceUnavailable = false,
  listHeaderCta,
}) => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { planData } = useSettingKeeper();
  const { subscription }: KeeperApp = useQuery(RealmSchema.KeeperApp)[0];
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const [currentPositions, setCurrentPositions] = useState(
    currentPosition !== 0 ? currentPosition : subscription.level - 1
  );

  const getKeeperPrivateExpiryDate = () => {
    if (subscription.level == AppSubscriptionLevel.L4) {
      const receipt = JSON.parse(subscription.receipt);
      if (receipt.expirationTime) {
        const expires = new Date(receipt.expirationTime);
        return expires.toLocaleString('en-US', {
          month: 'long',
          year: 'numeric',
        });
      }
    }
    return null;
  };

  const _onSnapToItem = (index) => {
    setCurrentPositions(index);
    onChange(index);
  };

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.container}>
      {listHeaderCta}
      {planData.map((plan, index) => {
        const isExpanded = expandedIndex === index;
        const isActive = index === currentPositions;

        const matchedPlan = plans.find((p) => p.name.toLowerCase() === plan.title.toLowerCase());
        const isPleb = plan.title.toLowerCase() === 'pleb';
        const isKeeperPrivate = plan.title === SubscriptionTier.L4;

        const planDetails = isPleb
          ? 'Free'
          : isMonthly
          ? matchedPlan?.monthlyPlanDetails?.price
            ? matchedPlan.monthlyPlanDetails.price + '/'
            : ''
          : matchedPlan?.yearlyPlanDetails?.price
          ? matchedPlan.yearlyPlanDetails.price + '/'
          : '';

        const Trail = isMonthly
          ? matchedPlan?.monthlyPlanDetails?.trailPeriod
          : matchedPlan?.yearlyPlanDetails?.trailPeriod;

        const priceDisplay = (
          <Box style={styles.priceContainer}>
            <Text color={`${colorMode}.greenWhiteText`} style={styles.price}>
              {planDetails}{' '}
              {!isPleb && matchedPlan?.monthlyPlanDetails?.price && (
                <Text color={`${colorMode}.greenWhiteText`} style={styles.planPeriod}>
                  {isMonthly ? 'month' : 'yearly'}
                </Text>
              )}
            </Text>

            {!isPleb && matchedPlan?.monthlyPlanDetails?.trailPeriod && (
              <Box backgroundColor={`${colorMode}.BrownNeedHelp`} style={styles.trialContainer}>
                <Text fontSize={10} color={Colors.brightCream}>
                  {Trail}
                </Text>
              </Box>
            )}
          </Box>
        );
        return (
          <TouchableOpacity
            onPress={() => {
              _onSnapToItem(index);
              toggleExpand(index);
            }}
            style={styles.touchable}
            key={index}
          >
            <Box
              key={index}
              borderColor={
                isActive ? `${colorMode}.dashedButtonBorderColor` : `${colorMode}.separator`
              }
              borderWidth={isActive ? 2 : 1}
              backgroundColor={`${colorMode}.textInputBackground`}
              style={styles.card}
            >
              <View style={styles.header}>
                <Box style={styles.titleContainer}>
                  {isDarkMode ? plan.subDarkIcon : plan.sublightIcon}
                  <Box style={styles.textContainer}>
                    <Box style={styles.titleBox}>
                      <Text color={`${colorMode}.GreyText`} style={styles.title}>
                        {plan.title}
                      </Text>
                      <Text color={`${colorMode}.GreyText`} style={styles.level}>
                        ({plan.subtitle})
                      </Text>
                    </Box>
                    <Text color={`${colorMode}.modalWhiteContent`} style={styles.description}>
                      {plan.subDescription}
                    </Text>
                  </Box>
                </Box>
                <Box>
                  <CircleIconWrapper
                    icon={
                      isExpanded ? (
                        isDarkMode ? (
                          <ArrowDownWhite />
                        ) : (
                          <ArrowDownGreen />
                        )
                      ) : isDarkMode ? (
                        <ArrowRightWhite />
                      ) : (
                        <ArrowRightGreen />
                      )
                    }
                    backgroundColor={`${colorMode}.solidGreyBorder`}
                    width={wp(18)}
                  />
                </Box>
              </View>
              {isKeeperPrivate && !isExpanded
                ? null
                : (!playServiceUnavailable || isExpanded) && (
                    <Box style={styles.divider} backgroundColor={`${colorMode}.BrownNeedHelp`}>
                      {' '}
                    </Box>
                  )}

              {!isKeeperPrivate && isExpanded && (
                <>
                  <PlanDetailsCards plansData={plans} currentPosition={currentPosition} />
                  {!playServiceUnavailable && (
                    <Box style={styles.divider} backgroundColor={`${colorMode}.BrownNeedHelp`}>
                      {' '}
                    </Box>
                  )}
                </>
              )}

              {playServiceUnavailable ? null : isKeeperPrivate ? null : priceDisplay}

              {isExpanded && isKeeperPrivate && getKeeperPrivateExpiryDate() && (
                <Box style={styles.expireCtr}>
                  <Text color={`${colorMode}.GreyText`} semiBold fontSize={12}>
                    Expires:
                  </Text>
                  <Text fontSize={12}>{getKeeperPrivateExpiryDate()}</Text>
                </Box>
              )}

              {isExpanded && (
                <Box style={styles.btmCTR}>
                  <Buttons
                    primaryCallback={primaryCallback}
                    primaryText={getButtonText().text}
                    fullWidth
                    primaryDisable={getButtonText().disabled}
                  />
                </Box>
              )}
            </Box>
          </TouchableOpacity>
        );
      })}
      {listFooterCta}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 14,
    paddingBottom: 30,
    gap: 12,
  },
  card: {
    borderRadius: 15,
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trialContainer: {
    width: 78,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
  },

  touchable: {
    width: '100%',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
  },
  textContainer: {
    flexDirection: 'column',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  titleBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  level: {
    fontSize: 14,
    marginLeft: 4,
  },
  description: {
    fontSize: 14,
    marginTop: 8,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  divider: {
    height: 1,
    marginTop: hp(20),
    marginBottom: hp(10),
    opacity: 0.2,
  },
  price: {
    paddingTop: hp(10),
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 22 * 1.6,
  },
  planPeriod: {
    fontSize: 12,
    lineHeight: 12 * 1.6,
  },
  btmCTR: {
    marginTop: 15,
    marginBottom: 10,
  },
  expireCtr: {
    flexDirection: 'row',
    gap: wp(5),
  },
});

export default SubscriptionList;
