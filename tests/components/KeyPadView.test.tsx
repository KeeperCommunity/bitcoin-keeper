import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';

jest.mock(
  'src/components/Animations/ScaleSpring',
  () =>
    ({ children }: React.PropsWithChildren) =>
      children
);
jest.mock('src/components/ThemedColor/ThemedColor', () => jest.fn(() => '#ffffff'));

describe('authentication keypad', () => {
  it('renders all ten digits and delivers digit and delete taps', () => {
    const onPressNumber = jest.fn();
    const onDeletePressed = jest.fn();
    const { getByText, getByTestId } = render(
      <KeyPadView
        onPressNumber={onPressNumber}
        onDeletePressed={onDeletePressed}
        bubbleEffect
        ClearIcon={<View />}
      />
    );

    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].forEach((digit) => {
      expect(getByText(digit)).toBeTruthy();
    });
    fireEvent.press(getByTestId('key_1'));
    fireEvent.press(getByTestId('key_0'));
    fireEvent.press(getByTestId('btn_clear'));

    expect(onPressNumber).toHaveBeenNthCalledWith(1, '1');
    expect(onPressNumber).toHaveBeenNthCalledWith(2, '0');
    expect(onDeletePressed).toHaveBeenCalledTimes(1);
  });
});
