import React from 'react';
import { Modal, View } from 'react-native';

export interface Props {
  visible: boolean;
  onSwipeComplete: Function;
  position?: string;
  children?: any;
}
function ModalWrapper(props: Props) {
  return (
    <Modal
      visible={props.visible}
      onRequestClose={() => props.onSwipeComplete}
      transparent={true}
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
          backgroundColor: '#00000043',
        }}
      >
        {props.children}
      </View>
    </Modal>
  );
}
export default ModalWrapper;
