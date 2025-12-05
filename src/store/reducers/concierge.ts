import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { persistReducer } from 'redux-persist';
import { reduxStorage } from 'src/storage';

export type conciergeUser = {
  id: string;
  name: string;
  userExternalId: string;
};

export type commentsCounter = {
  [tickedId: string]: number;
};

export type AccountManager = {
  links: Links;
  fullName: string;
  image: string;
};

type Links = {
  email: string;
  whatsapp?: string;
  calendly?: string;
  phone?: string;
  telegram?: string;
};

const initialState: {
  onboardingModal: boolean;
  tags: string[];
  tickets: any[];
  conciergeUser: conciergeUser;
  conciergeUserFailed: boolean;
  conciergeUserSuccess: boolean;
  conciergeLoading: boolean;
  commentsCounter: commentsCounter;
  onboardCallSuccess: boolean;
  onboardCallFailed: boolean;
  onboardCallScheduled: boolean;
  accountManagerDetails: AccountManager;
} = {
  onboardingModal: false,
  tags: [],
  tickets: [],
  conciergeUser: null,
  conciergeLoading: false,
  conciergeUserFailed: false,
  conciergeUserSuccess: false,
  commentsCounter: {},
  onboardCallSuccess: false,
  onboardCallFailed: false,
  onboardCallScheduled: false,
  accountManagerDetails: null,
};

const conciergeSlice = createSlice({
  name: 'concierge',
  initialState,
  reducers: {
    showOnboarding: (state) => {
      state.onboardingModal = true;
    },
    hideOnboarding: (state) => {
      state.onboardingModal = false;
    },
    setConciergTags: (state, action: PayloadAction<string[]>) => {
      state.tags = action.payload;
    },
    loadConciergeTickets: (state, action: PayloadAction<any[]>) => {
      state.tickets = action.payload;
    },
    loadConciergeUser: (state, action: PayloadAction<conciergeUser | null>) => {
      state.conciergeUser = action.payload;
    },
    setConciergeLoading: (state, action: PayloadAction<boolean>) => {
      state.conciergeLoading = action.payload;
    },
    setConciergeUserFailed: (state, action: PayloadAction<boolean>) => {
      state.conciergeUserFailed = action.payload;
    },
    setConciergeUserSuccess: (state, action: PayloadAction<boolean>) => {
      state.conciergeUserSuccess = action.payload;
    },
    updateTicketCommentsCount: (state, action: PayloadAction<commentsCounter>) => {
      state.commentsCounter = { ...state.commentsCounter, ...action.payload };
    },
    setOnboardCallFailed: (state, action: PayloadAction<boolean>) => {
      state.onboardCallFailed = action.payload;
    },
    setOnboardCallSuccess: (state, action: PayloadAction<boolean>) => {
      state.onboardCallSuccess = action.payload;
    },
    setOnboardCallScheduled: (state, action: PayloadAction<boolean>) => {
      state.onboardCallScheduled = action.payload;
    },
    setAccountManagerDetails: (state, action: PayloadAction<AccountManager>) => {
      state.accountManagerDetails = action.payload;
    },
  },
});

export const {
  showOnboarding,
  hideOnboarding,
  setConciergTags,
  loadConciergeTickets,
  loadConciergeUser,
  setConciergeLoading,
  setConciergeUserFailed,
  setConciergeUserSuccess,
  updateTicketCommentsCount,
  setOnboardCallFailed,
  setOnboardCallSuccess,
  setOnboardCallScheduled,
  setAccountManagerDetails,
} = conciergeSlice.actions;

const conciergePersistConfig = {
  key: 'concierge',
  storage: reduxStorage,
  blacklist: ['onboardingModal'],
};

export default persistReducer(conciergePersistConfig, conciergeSlice.reducer);
