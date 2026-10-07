import { useColorMode } from '@gluestack-ui/themed-native-base';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import DeleteIcon from 'src/assets/images/deleteLight.svg';
import DeleteDarkIcon from 'src/assets/images/delete.svg';
import React from 'react';
import { heightPercentageToDP as hp } from 'react-native-responsive-screen';
import Text from 'src/components/KeeperText';
import KeyPadButton from './KeyPadButton';

export interface Props {
  onPressNumber;
  onDeletePressed;
  disabled?;
  enableDecimal?: boolean;
  keyColor?: string;
  ClearIcon?: JSX.Element;
  bubbleEffect?: boolean;
}

const KeyPadView: React.FC<Props> = ({
  onPressNumber,
  onDeletePressed,
  disabled = false,
  enableDecimal = false,
  keyColor = '#CDD8D6',
  ClearIcon = null,
  bubbleEffect = false,
}: Props) => {
  const { colorMode } = useColorMode();

  // Keep keypad rows native so digit targets mount consistently in the iOS renderer.
  return (
    <View collapsable={false} pointerEvents={disabled ? 'none' : 'auto'} style={styles.container}>
      <View collapsable={false} style={styles.keyWrapperView}>
        <KeyPadButton
          title="1"
          onPressNumber={() => onPressNumber('1')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
        <KeyPadButton
          title="2"
          onPressNumber={() => onPressNumber('2')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
        <KeyPadButton
          title="3"
          onPressNumber={() => onPressNumber('3')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
      </View>
      <View collapsable={false} style={styles.keyWrapperView}>
        <KeyPadButton
          title="4"
          onPressNumber={() => onPressNumber('4')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
        <KeyPadButton
          title="5"
          onPressNumber={() => onPressNumber('5')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
        <KeyPadButton
          title="6"
          onPressNumber={() => onPressNumber('6')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
      </View>
      <View collapsable={false} style={styles.keyWrapperView}>
        <KeyPadButton
          title="7"
          onPressNumber={() => onPressNumber('7')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
        <KeyPadButton
          title="8"
          onPressNumber={() => onPressNumber('8')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
        <KeyPadButton
          title="9"
          onPressNumber={() => onPressNumber('9')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
      </View>
      <View collapsable={false} style={styles.keyWrapperView}>
        <View collapsable={false} style={styles.emptyBtnView}>
          {enableDecimal ? (
            <TouchableOpacity
              onPress={() => onPressNumber('.')}
              activeOpacity={0.5}
              testID="btn-decimal"
              style={styles.decimalBtnView}
            >
              <Text fontSize={25} color={keyColor}>
                .
              </Text>
            </TouchableOpacity>
          ) : (
            <View collapsable={false} style={styles.emptyBtnView}>
              <Text style={{ padding: 15 }} />
            </View>
          )}
        </View>
        <KeyPadButton
          title="0"
          onPressNumber={() => onPressNumber('0')}
          keyColor={keyColor}
          bubbleEffect={bubbleEffect}
        />
        <TouchableOpacity
          onPress={() => onDeletePressed()}
          activeOpacity={0.5}
          testID="btn_clear"
          style={styles.keyPadElementTouchable}
        >
          {ClearIcon ? ClearIcon : colorMode === 'dark' ? <DeleteIcon /> : <DeleteDarkIcon />}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginTop: 'auto' },
  keyPadElementTouchable: {
    flex: 1,
    height: hp('8%'),
    fontSize: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyWrapperView: {
    flexDirection: 'row',
    height: hp('8%'),
  },
  emptyBtnView: {
    flex: 1,
    height: hp('8%'),
    fontSize: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  decimalBtnView: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default KeyPadView;
