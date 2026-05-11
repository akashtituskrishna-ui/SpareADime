import React, { useEffect } from 'react';
import { useAppStore } from './lib/store';
import { auth, db } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Auth } from './components/Auth';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';

export default function App() {
  const { user, authInitialized, setUser, setAuthInitialized, setUserProfile, activeChatId } = useAppStore();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthInitialized(true);
      if (firebaseUser) {
        // subscribe to user profile
        const unsubProfile = onSnapshot(doc(db, 'users', firebaseUser.uid), (docSnap) => {
          if (docSnap.exists()) {
            setUserProfile(docSnap.data());
          }
        });
        return () => unsubProfile();
      } else {
        setUserProfile(null);
      }
    });

    return () => unsub();
  }, [setUser, setAuthInitialized, setUserProfile]);

  if (!authInitialized) {
    return <div className="min-h-screen bg-gradient-to-br from-[#1e1e2f] via-[#2d1b33] to-[#121212] flex items-center justify-center text-white/50">Connecting...</div>;
  }

  if (!user) return <Auth />;

  return (
    <div className="flex h-[100dvh] bg-gradient-to-br from-[#1e1e2f] via-[#2d1b33] to-[#121212] font-sans text-white overflow-hidden p-0 md:p-3 md:gap-3">
      <div className={`w-full md:w-80 md:shrink-0 h-full ${activeChatId ? 'hidden md:block' : 'block'}`}>
        <Sidebar />
      </div>
      <main className={`flex-1 flex-col min-w-0 h-full bg-white/5 md:rounded-3xl border-white/10 border ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
        <Chat />
      </main>
    </div>
  );
}
