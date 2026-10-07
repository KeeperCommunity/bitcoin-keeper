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
      fireEvent.press(getByTestId(`key_${digit}`));
    });
    fireEvent.press(getByTestId('btn_clear'));

    expect(onPressNumber.mock.calls.map(([digit]) => digit)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '0',
    ]);
    expect(onDeletePressed).toHaveBeenCalledTimes(1);
  });

  it('preserves decimal amount entry and delete when passcode feedback is disabled', () => {
    const onPressNumber = jest.fn();
    const onDeletePressed = jest.fn();
    const { getByTestId, queryByTestId, rerender } = render(
      <KeyPadView
        onPressNumber={onPressNumber}
        onDeletePressed={onDeletePressed}
        enableDecimal
        ClearIcon={<View />}
      />
    );
    fireEvent.press(getByTestId('key_1'));
    fireEvent.press(getByTestId('btn-decimal'));
    fireEvent.press(getByTestId('key_0'));
    fireEvent.press(getByTestId('btn_clear'));
    expect(onPressNumber.mock.calls.map(([value]) => value)).toEqual(['1', '.', '0']);
    expect(onDeletePressed).toHaveBeenCalledTimes(1);
    rerender(
      <KeyPadView
        onPressNumber={onPressNumber}
        onDeletePressed={onDeletePressed}
        ClearIcon={<View />}
      />
    );
    expect(queryByTestId('btn-decimal')).toBeNull();
  });
});
