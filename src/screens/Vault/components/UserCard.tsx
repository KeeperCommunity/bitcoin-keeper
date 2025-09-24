import { Box, useColorMode } from 'native-base';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import Delete from 'src/assets/images/delete-icon.svg';
import Colors from 'src/theme/Colors';
import { getServerKeyPermittedActionLabelText } from './PermittedActionContent';

type Props = {
  data: any;
  setDeleteUser: any;
  setRemoveOptionId: any;
};

function UserCard({ data, setDeleteUser, setRemoveOptionId }: Props) {
  const { colorMode } = useColorMode();

  const getTagColor = (tag: string): string => {
    const tagColorMap: Record<string, string> = {
      'Transaction Signing': Colors.mintGreen,
      'Policy Updates': Colors.LabelDark3,
      'Backup Access': Colors.lightGreenTag,
      'Cancel Transaction': Colors.LabelDark1,
    };

    return tagColorMap[tag] ?? Colors.mintGreen;
  };

  return (
    <Box style={styles.cardContainer} backgroundColor={`${colorMode}.textInputBackground`}>
      {data?.map((item, index) => (
        <Box key={index}>
          <Box style={styles.cardData}>
            <Box>
              <Text color="black" semiBold fontSize={16}>
                {item.name}
              </Text>

              <Box style={styles.pillContainer}>
                {item?.tags?.map((tag, tagIndex) => (
                  <Box key={tagIndex} style={styles.pill} backgroundColor={getTagColor(tag)}>
                    <Text fontSize={13}>{getServerKeyPermittedActionLabelText(tag)}</Text>
                  </Box>
                ))}
              </Box>
            </Box>
            <TouchableOpacity
              onPress={() => {
                setDeleteUser(true);
                setRemoveOptionId(item.id);
              }}
            >
              <CircleIconWrapper
                width={wp(30)}
                icon={<Delete />}
                backgroundColor={`${colorMode}.greyBorder`}
              />
            </TouchableOpacity>
          </Box>

          {index !== data.length - 1 && <Box style={styles.divider} />}
        </Box>
      ))}
    </Box>
  );
}

export default UserCard;

const styles = StyleSheet.create({
  cardContainer: {
    width: '100%',
    padding: wp(20),
    borderRadius: 15,
    marginTop: hp(20),
  },
  divider: {
    height: 1,
    backgroundColor: '#ccc',
    marginVertical: hp(10),
  },
  cardData: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: hp(10),
  },
  pillContainer: {
    flexDirection: 'row',
    marginTop: hp(10),
  },

  pill: {
    paddingVertical: hp(5),
    paddingHorizontal: wp(10),
    borderRadius: 20,
    marginRight: wp(10),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
