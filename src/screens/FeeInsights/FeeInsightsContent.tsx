import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import React, { useContext, useEffect, useState } from 'react';
import { windowWidth } from 'src/constants/responsive';
import Text from 'src/components/KeeperText';
import FeeDataStats from './FeeDataStats';
import Relay from 'src/services/backend/Relay';
import { useColorMode } from 'native-base';
import { generateFeeInsightStatement } from 'src/utils/feeInisghtUtil';
import FeeInsightCard from './FeeInsightCard';
import FeeDataSource from './FeeDataSource';
import { LocalizationContext } from 'src/context/Localization/LocContext';

const FeeInsightsContent = () => {
  const [oneWeekFeeRate, setOneWeekFreeRate] = useState([]);
  const [feeInsightStatement, setFeeInsightStatement] = useState({
    latestFee: '',
    dayComparisonText: '',
    oneDayAgoFee: '',
    weekComparisonText: '',
    oneWeekAgoFee: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { common, home } = translations;

  useEffect(() => {
    fetchOneWeekData();
  }, []);

  useEffect(() => {
    if (oneWeekFeeRate.length > 0) {
      const resultFeeInsight = generateFeeInsightStatement(oneWeekFeeRate);
      setFeeInsightStatement(resultFeeInsight);
      setIsLoading(false);
    }
  }, [oneWeekFeeRate]);

  const fetchOneWeekData = async () => {
    setIsLoading(true);
    const result = await Relay.fetchOneWeekHistoricalFee();
    if (result && result.length > 0) {
      setOneWeekFreeRate(result);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ minHeight: 400 }}>
        <View style={[styles.headerWrapper, { backgroundColor: `${colorMode}.seashellWhite` }]}>
          <Text style={styles.titleLabel} color={`${colorMode}.modalGreenTitle`}>
            {home.BTCTransactionFeeInsights}
          </Text>
        </View>
        {isLoading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="small" />
          </View>
        ) : (
          <>
            <View style={styles.cardWrapper}>
              <FeeInsightCard
                line1={common.Current}
                line2={common.average}
                suffix={common.satsPerByte}
                stats={feeInsightStatement.latestFee}
              />
              <FeeInsightCard
                line1={common.From}
                line2={common.yesterday}
                suffix={common.satsPerByte}
                stats={feeInsightStatement.oneDayAgoFee}
                showArrow={true}
                pointer={feeInsightStatement.dayComparisonText}
              />
              <FeeInsightCard
                line1={common.thisWeek}
                line2={common.average}
                suffix={common.satsPerByte}
                stats={feeInsightStatement.oneWeekAgoFee}
              />
            </View>
            <FeeDataStats />
            <FeeDataSource />
          </>
        )}
      </ScrollView>
    </View>
  );
};

export default FeeInsightsContent;

const styles = StyleSheet.create({
  container: {
    maxHeight: 400,
    width: windowWidth * 0.8,
  },
  headerWrapper: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleLabel: {
    fontSize: 19,
    letterSpacing: 1,
  },
  loaderContainer: {
    flex: 1,
    alignContent: 'center',
    justifyContent: 'center',
  },
  cardWrapper: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 7,
  },
});
