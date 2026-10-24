import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { wp } from 'src/constants/responsive';
import Colors from 'src/theme/Colors';

interface FabProps {
  icon: React.ReactNode;
  onPress: () => void;
  containerStyle?: object;
  // eslint-disable-next-line react/require-default-props -- Omitted test selectors must stay absent from the native view.
  testID?: string;
}

const Fab = ({ icon, onPress, containerStyle, testID }: FabProps) => {
  return (
    <Pressable testID={testID} style={[styles.fab, containerStyle]} onPress={onPress}>
      {icon}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  fab: {
    height: wp(55),
    width: wp(55),
    borderRadius: wp(35),
    backgroundColor: Colors.primaryGreen,
    position: 'absolute',
    bottom: wp(35),
    right: wp(0),
    elevation: 20,
    alignItems: 'center',
    justifyContent: 'center',
    // ios
    shadowColor: 'black',
    shadowOffset: { width: 10, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    zIndex: 1,
  },
});

export default Fab;
