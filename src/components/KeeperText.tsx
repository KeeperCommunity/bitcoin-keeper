import React from 'react';
import { TextProps } from 'react-native';
import { Text as NativeBaseText } from 'native-base';

interface KeeperTextProps extends TextProps {
  // eslint-disable-next-line react/require-default-props
  color?: string;
  fontSize?: number;
  bold?: boolean;
  light?: boolean;
  italic?: boolean;
  medium?: boolean;
  semiBold?: boolean;
  fontWeight?: string | number;
}

function Text(props: KeeperTextProps) {
  const {
    children,
    style,
    fontSize,
    medium,
    semiBold,
    bold = false,
    light = false,
    italic,
    fontWeight = undefined,
  } = props;

  let computedFontWeight: string | number = fontWeight || 400;

  if (!fontWeight) {
    if (bold) {
      computedFontWeight = 700;
    } else if (light) {
      computedFontWeight = 300;
    } else if (medium) {
      computedFontWeight = 500;
    } else if (semiBold) {
      computedFontWeight = 600;
    } else {
      computedFontWeight = 400;
    }
  }

  const updatedProps = {
    ...props,
    bold: undefined,
    light: undefined,
    medium: undefined,
    semiBold: undefined,
  };

  const passedStyles = Array.isArray(style) ? Object.assign({}, ...style) : style;
  const lineHeight = passedStyles?.lineHeight
    ? passedStyles?.lineHeight
    : fontSize
    ? fontSize * 1.5
    : passedStyles?.fontSize
    ? passedStyles?.fontSize * 1.5
    : undefined;

  return (
    <NativeBaseText
      allowFontScaling={false}
      {...updatedProps}
      fontStyle={italic ? 'italic' : undefined}
      style={[{ fontSize, fontWeight: computedFontWeight, lineHeight }, passedStyles]}
    >
      {children}
    </NativeBaseText>
  );
}


export default Text;
