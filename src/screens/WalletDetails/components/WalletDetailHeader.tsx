import { Box } from '@gluestack-ui/themed-native-base';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import BackWhiteButton from 'src/assets/images/leftarrowCampainlight.svg';
import WhiteSettingIcon from 'src/assets/privateImages/setting_icon_white.svg';
import { useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import CardPill from 'src/components/CardPill';
import Text from 'src/components/KeeperText';
import BalanceComponent from 'src/screens/Home/components/BalanceComponent';
import Colors from 'src/theme/Colors';

interface Props {
  settingCallBack?: () => void;
  backgroundColor?: any;
  tags?: string[];
  setIsShowAmount?: any;
  isShowAmount?: boolean;
  title?: string;
  description?: string;
  totalBalance?: number;
  allowHideBalance?: boolean;
  wallet?: any;
}

const WalletDetailHeader = ({
  backgroundColor,
  settingCallBack,
  tags,
  setIsShowAmount,
  isShowAmount,
  title,
  description,
  totalBalance,
  allowHideBalance,
  wallet,
}: Props) => {
  const navigation = useNavigation();
  return (
    <LinearGradient colors={backgroundColor} start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 1 }}>
      <Box safeAreaTop style={styles.container}>
        {/* header  */}
        <Box style={styles.header}>
          <TouchableOpacity
            testID="wallet_details_back"
            onPress={() => {
              navigation.goBack();
            }}
            style={styles.backButton}
          >
            <BackWhiteButton />
          </TouchableOpacity>
          <TouchableOpacity
            testID="wallet_details_settings"
            style={styles.settingBtn}
            onPress={() => {
              settingCallBack();
            }}
          >
            <WhiteSettingIcon width={hp(24)} height={hp(24)} />
          </TouchableOpacity>
        </Box>
        {/* Tags  */}
        <Box style={styles.pillsContainer}>
          {tags?.map(({ tag, color }, index) => (
            <>
              <CardPill key={tag} heading={tag} backgroundColor={color} />
            </>
          ))}
        </Box>

        <Box style={styles.bottomContainer}>
          <Box>
            <Text color={Colors.headerWhite} style={styles.description}>
              {description}
            </Text>
            <Text semiBold color={Colors.headerWhite} style={styles.title}>
              {title}
            </Text>
          </Box>
          <Box style={styles.bottomRight}>
            <BalanceComponent
              setIsShowAmount={setIsShowAmount ? setIsShowAmount : () => {}}
              isShowAmount={allowHideBalance ? isShowAmount : true}
              balance={totalBalance}
              BalanceFontSize={22}
              wallet={wallet}
            />
          </Box>
        </Box>
      </Box>
    </LinearGradient>
  );
};

export default WalletDetailHeader;
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: wp(22),
    paddingTop: hp(40),
    paddingBottom: hp(90),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: hp(10),
  },
  backButton: {
    height: hp(44),
    width: wp(28),
    justifyContent: 'center',
  },
  settingBtn: {
    paddingHorizontal: 8,
    paddingVertical: 16,
  },
  pillsContainer: {
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    marginVertical: hp(20),
  },
  bottomContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
    marginTop: hp(10),
  },

  title: {
    fontSize: 16,
  },
  description: {
    fontSize: 14,
    marginBottom: hp(5),
  },
  bottomRight: {
    justifyContent: 'flex-end',
  },
  detailCards: {
    position: 'absolute',
    bottom: '-40%',
    zIndex: 100,
  },
});
