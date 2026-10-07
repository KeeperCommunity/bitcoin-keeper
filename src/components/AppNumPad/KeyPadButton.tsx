import { StyleSheet, TouchableOpacity, Animated, Text as NativeText } from 'react-native';
import React, { useState } from 'react';
import ScaleSpring from '../Animations/ScaleSpring';
import ThemedColor from '../ThemedColor/ThemedColor';

export interface Props {
  title: string;
  onPressNumber: (value: string) => void;
  keyColor: string;
  bubbleEffect?: boolean;
}

const KeyPadButton: React.FC<Props> = ({ title, onPressNumber, keyColor, bubbleEffect }: Props) => {
  const [pressed, setPressed] = useState(false);
  const keyPad_colors = ThemedColor({ name: 'keyPad_colors' });

  const handlePressIn = () => {
    setPressed(true);
  };

  const handlePressOut = () => {
    setPressed(false);
  };

  const button = (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={() => onPressNumber(title)}
      style={styles.keyPadElementTouchable}
      testID={`key_${title}`}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {bubbleEffect && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.circleEffect,
            pressed && styles.circleEffectActive,
            {
              backgroundColor: keyPad_colors,
            },
          ]}
        />
      )}

      <NativeText allowFontScaling={false} style={[styles.keyPadElementText, { color: keyColor }]}>
        {title}
      </NativeText>
    </TouchableOpacity>
  );

  // The passcode keypad already has press feedback; keep its touch target outside a second gesture.
  return bubbleEffect ? button : <ScaleSpring>{button}</ScaleSpring>;
};

const styles = StyleSheet.create({
  keyPadElementTouchable: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  keyPadElementText: {
    fontSize: 25,
    lineHeight: 30,
    zIndex: 1,
    opacity: 1,
  },
  circleEffect: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 30,
    opacity: 0,
    zIndex: 0,
  },
  circleEffectActive: {
    opacity: 1,
    transform: [{ scale: 2 }],
  },
});

export default KeyPadButton;
