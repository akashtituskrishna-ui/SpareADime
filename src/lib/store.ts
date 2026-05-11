import { create } from 'zustand';
import { User as FirebaseUser } from 'firebase/auth';

interface AppState {
  user: FirebaseUser | null;
  userProfile: any | null;
  authInitialized: boolean;
  activeChatId: string | null;
  sidebarOpen: boolean;
  setUser: (user: FirebaseUser | null) => void;
  setUserProfile: (profile: any | null) => void;
  setAuthInitialized: (val: boolean) => void;
  setActiveChatId: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  userProfile: null,
  authInitialized: false,
  activeChatId: null,
  sidebarOpen: true,
  setUser: (user) => set({ user }),
  setUserProfile: (profile) => set({ userProfile: profile }),
  setAuthInitialized: (authInitialized) => set({ authInitialized }),
  setActiveChatId: (id) => set({ activeChatId: id }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
