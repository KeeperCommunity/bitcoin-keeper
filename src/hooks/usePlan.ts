import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { useQuery } from '@realm/react';

export const SUBSCRIPTION_SCHEME_MAP = {
  [SubscriptionTier.L1.toUpperCase()]: {
    m: 1,
    n: 1,
  },
  [SubscriptionTier.L2.toUpperCase()]: {
    m: 2,
    n: 3,
  },
  [SubscriptionTier.L3.toUpperCase()]: {
    m: 3,
    n: 5,
  },
};

const usePlan = () => {
  const keeper: KeeperApp = useQuery(RealmSchema.KeeperApp).map(getJSONFromRealmObject)[0];
  // const plan = keeper.subscription.name.toUpperCase();
  const plan = SubscriptionTier.L3.toUpperCase();

  const isOnL1 = plan === SubscriptionTier.L1.toUpperCase();
  const isOnL2 = plan === SubscriptionTier.L2.toUpperCase();
  const isOnL3 = plan === SubscriptionTier.L3.toUpperCase();
  const isOnL4 = plan === SubscriptionTier.L4.toUpperCase();

  const isOnL2Above = isOnL2 || isOnL3 || isOnL4;
  const isOnL3Above = isOnL3 || isOnL4;

  return { plan, isOnL1, isOnL2, isOnL3, isOnL2Above, isOnL4, isOnL3Above };
};

export default usePlan;
