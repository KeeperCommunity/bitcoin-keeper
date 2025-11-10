import { SatochipCard } from 'satochip-react-native';
import { Platform } from 'react-native';
import { useState } from 'react';

const useSatochipModal = (card: SatochipCard) => {
  const [nfcVisible, setNfcVisible] = useState<boolean>(false);

  const withModal = (callback) =>
    Platform.select({
      android: async () => {
        setNfcVisible(true);
        const resp = await card.nfcWrapper(callback);
        setNfcVisible(false);
        return resp;
      },
      ios: async () => card.nfcWrapper(callback),
    });

  const closeNfc = () => setNfcVisible(false);

  return { nfcVisible, withModal, closeNfc };
};

export default useSatochipModal;
