import { UAI, uaiType } from 'src/models/interfaces/Uai';
import { useEffect, useState } from 'react';
import { RealmSchema } from 'src/storage/realm/enum';
import { useAppSelector } from 'src/store/hooks';
import { useQuery } from '@realm/react';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';

interface UAIPriorityMap {
  [entityKind: string]: number;
}

export const uaiPriorityMap: UAIPriorityMap = {
  [uaiType.CANARAY_WALLET]: 100,
  [uaiType.ZENDESK_TICKET]: 100,
  [uaiType.SERVER_BACKUP_FAILURE]: 90,
  [uaiType.SIGNING_DEVICES_HEALTH_CHECK]: 90,
  [uaiType.RECOVERY_PHRASE_HEALTH_CHECK]: 90,
  [uaiType.SECURE_VAULT]: 70,
  [uaiType.FEE_INISGHT]: 60,
  [uaiType.SIGNING_DELAY]: 100,
  [uaiType.POLICY_DELAY]: 90,
  [uaiType.INCOMING_TRANSACTION]: 100,
};

const useUaiStack = (): { uaiStack: UAI[]; isLoading: boolean } => {
  const [uaiStack, setUaiStack] = useState<UAI[]>([]); // Sorted UAI for UI consumption
  const [isLoading, setIsLoading] = useState(true);
  const UAIcollection: UAI[] = useQuery(RealmSchema.UAI).map(getJSONFromRealmObject);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const filteredUaiStack = UAIcollection.filter((uai) => {
    if (uai?.uaiDetails?.networkType) {
      return uai.uaiDetails.networkType === bitcoinNetworkType;
    }
    return true;
  });
  const refreshUai = useAppSelector((state) => state.uai.refreshUai);
  const uaiActionMap = useAppSelector((state) => state.uai.uaiActionMap);

  const nonActionedUais = filteredUaiStack.filter(
    (uai) => !uaiActionMap[uai.id] && !uai.lastActioned
  );

  const sortUAIsByPriorityAndLastActioned = (uaisArray: UAI[]): UAI[] => {
    return uaisArray.sort((a, b) => {
      const priorityDiff = uaiPriorityMap[b.uaiType] - uaiPriorityMap[a.uaiType];
      if (priorityDiff === 0) {
        if (!a.lastActioned && !b.lastActioned) return 0;
        if (!a.lastActioned) return -1;
        if (!b.lastActioned) return 1;
        return a.lastActioned.getTime() - b.lastActioned.getTime();
      } else {
        return priorityDiff;
      }
    });
  };

  useEffect(() => {
    setIsLoading(true);

    const sortedStack = sortUAIsByPriorityAndLastActioned(nonActionedUais);
    setUaiStack(sortedStack);

    setIsLoading(false);
  }, [refreshUai]);

  return { uaiStack, isLoading };
};

export default useUaiStack;
