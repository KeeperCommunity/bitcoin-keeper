import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import React, { useContext, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import Buttons from '../Buttons';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import HeartIcon from 'src/assets/images/heart.svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, useColorMode, useTheme } from 'native-base';
import Colors from 'src/theme/Colors';
import { hp, wp } from 'src/constants/responsive';
import Fonts from 'src/constants/Fonts';
import { setShowTipModal } from 'src/store/reducers/settings';
import Text from '../KeeperText';

type TipBottomSheetProps = {};

export const TipBottomSheet = (props: TipBottomSheetProps) => {
  const modalRef = useRef(null);
  const dispatch = useDispatch();
  const { showTipModal } = useAppSelector((state) => state.settings);
  const { settings } = useContext(LocalizationContext).translations;
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = getStyles(theme, insets);
  const { colorMode } = useColorMode();
  const isDarKMode = colorMode === 'dark';

  useEffect(() => {
    if (showTipModal) {
      requestAnimationFrame(() => modalRef.current?.present());
    } else {
      modalRef.current?.dismiss();
    }
  }, [showTipModal]);

  const onDismiss = () => dispatch(setShowTipModal(false));

  return (
    <BottomSheetModal
      ref={modalRef}
      index={0}
      onDismiss={onDismiss}
      backgroundStyle={{
        backgroundColor: isDarKMode ? Colors.SecondaryBlack : Colors.primaryCream,
      }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
          pressBehavior={'none'}
        />
      )}
    >
      <BottomSheetView>
        <Box style={styles.ctr}>
          <View style={styles.row}>
            <View style={styles.illustrationCtr}>
              <HeartIcon />
            </View>
            <View>
              <Text style={styles.titleTxt}>{settings.supportDeveloperTitle}</Text>
              <Text style={styles.subTitleTxt}>{settings.supportDeveloperSubTitle}</Text>
            </View>
          </View>
          <Buttons primaryText="Tip Now" secondaryText="Not Now" secondaryCallback={onDismiss} />
        </Box>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const getStyles = (theme, insets) =>
  StyleSheet.create({
    ctr: {
      flex: 1,
      padding: wp(20),
    },
    row: { flexDirection: 'row', gap: wp(10) },
    illustrationCtr: {
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: hp(50),
    },
    titleTxt: {
      fontSize: 18,
      marginBottom: hp(3),
      fontFamily: Fonts.InterBold,
    },
    subTitleTxt: {
      fontSize: 14,
      marginBottom: hp(3),
      fontFamily: Fonts.InterRegular,
      maxWidth: '99%',
    },
  });
