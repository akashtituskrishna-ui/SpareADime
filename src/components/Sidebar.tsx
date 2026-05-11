import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/src/lib/store';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MessageSquare, Phone, Plus, Search, Users, Video, Compass, Settings, LogOut, Disc } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, orderBy, limit, updateDoc, doc } from 'firebase/firestore';

export function Sidebar() {
  const { userProfile, activeChatId, setActiveChatId, user } = useAppStore();
  const [chats, setChats] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts' | 'discover'>('chats');
  const [contacts, setContacts] = useState<any[]>([]);
  const [editName, setEditName] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 800000) {
         alert("Image too large. Please select a smaller image.");
         return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (userProfile) {
      setEditName(userProfile.displayName || '');
      setEditPhoto(userProfile.photoURL || '');
    }
  }, [userProfile]);

  useEffect(() => {
    if (activeTab !== 'contacts') return;
    const fetchContacts = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        const usersData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        const others = usersData.filter(u => u.id !== user?.uid);
        others.sort((a, b) => (a.displayName || a.phoneNumber || '').localeCompare(b.displayName || b.phoneNumber || ''));
        setContacts(others);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'users');
      }
    };
    fetchContacts();
  }, [activeTab, user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: editName,
        photoURL: editPhoto
      });
      setIsProfileOpen(false);
    } catch(error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'chats'),
      where('participantIds', 'array-contains', user.uid)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const chatsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setChats(chatsData.sort((a, b) => b.updatedAt?.toMillis() - a.updatedAt?.toMillis()));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'chats'));
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (activeTab !== 'discover') return;
    const q = query(collection(db, 'posts'), limit(20));
    const unsub = onSnapshot(q, (snapshot) => {
      const postsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setPosts(postsData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'posts'));
    return () => unsub();
  }, [activeTab]);

  const handleCreateChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      // Find user by phone number
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('phoneNumber', '==', newChatPhone));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert("User with this phone number not found.");
        return;
      }
      
      const otherUser = querySnapshot.docs[0];
      const otherUserId = otherUser.data().uid;

      if (otherUserId === user.uid) {
        alert("You cannot chat with yourself.");
        return;
      }

      // Check if direct chat already exists
      const existingChat = chats.find(c => c.type === 'direct' && c.participantIds.includes(otherUserId));
      if (existingChat) {
        setActiveChatId(existingChat.id);
        setIsNewChatOpen(false);
        return;
      }

      // Create new chat
      const chatRef = await addDoc(collection(db, 'chats'), {
        type: 'direct',
        participantIds: [user.uid, otherUserId],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        voiceChannelActive: false
      });
      
      setActiveChatId(chatRef.id);
      setIsNewChatOpen(false);
      setNewChatPhone('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chats');
    }
  };

  const getChatName = (chat: any) => {
    if (chat.type === 'group') return chat.name;
    // For MVP, we don't have the other user's name materialized here unless we fetch it.
    // In a real app we'd denormalize participant details or query them.
    return "Direct Message";
  };

  return (
    <div className="w-80 flex flex-col h-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl overflow-hidden shrink-0">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 border border-white/10">
            <AvatarImage src={userProfile?.photoURL} />
            <AvatarFallback className="bg-indigo-600 text-white font-bold">{userProfile?.displayName?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-bold text-sm text-white">{userProfile?.displayName}</div>
            <div className="text-[10px] text-green-400 font-medium">Online</div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="text-white/50 hover:text-white hover:bg-white/10 rounded-full" onClick={() => setIsProfileOpen(true)}>
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-white/50 hover:text-white hover:bg-white/10 rounded-full" onClick={() => auth.signOut()}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex px-4 py-3 gap-2 border-b border-white/10">
        <Button 
          variant={activeTab === 'chats' ? 'secondary' : 'ghost'} 
          className={`flex-1 justify-center rounded-xl font-bold transition-colors text-xs ${activeTab === 'chats' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
          onClick={() => setActiveTab('chats')}
        >
          <MessageSquare className="h-4 w-4 xl:mr-2" />
          <span className="hidden xl:block">Chats</span>
        </Button>
        <Button 
          variant={activeTab === 'contacts' ? 'secondary' : 'ghost'} 
          className={`flex-1 justify-center rounded-xl font-bold transition-colors text-xs ${activeTab === 'contacts' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
          onClick={() => setActiveTab('contacts')}
        >
          <Users className="h-4 w-4 xl:mr-2" />
          <span className="hidden xl:block">Contacts</span>
        </Button>
        <Button 
          variant={activeTab === 'discover' ? 'secondary' : 'ghost'} 
          className={`flex-1 justify-center rounded-xl font-bold transition-colors text-xs ${activeTab === 'discover' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
          onClick={() => setActiveTab('discover')}
        >
          <Compass className="h-4 w-4 xl:mr-2" />
          <span className="hidden xl:block">Discover</span>
        </Button>
      </div>

      {activeTab === 'chats' && (
        <>
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
              <Input 
                placeholder="Search chats..." 
                className="pl-9 bg-white/5 border-white/10 text-white rounded-xl placeholder:text-white/30 focus-visible:ring-0 focus-visible:border-indigo-500 h-9 text-sm"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <ScrollArea className="flex-1 px-2">
            <div className="space-y-1">
              {chats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-colors ${activeChatId === chat.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
                >
                  <Avatar className="h-10 w-10 border border-white/10">
                    <AvatarFallback className={chat.type === 'group' ? 'bg-amber-400 font-bold' : 'bg-emerald-400 font-bold'}>
                      {chat.type === 'group' ? <Users className="h-4 w-4 text-amber-950" /> : <MessageSquare className="h-4 w-4 text-emerald-950"/>}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left overflow-hidden">
                    <div className="font-bold text-sm text-white truncate">{getChatName(chat)}</div>
                    <div className="text-[10px] text-white/50 truncate flex items-center">
                      <span className="truncate">Encrypted message</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>

          <div className="p-4 pt-2">
            <Dialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen}>
              <DialogTrigger render={<Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold" />}>
                <Plus className="h-4 w-4 mr-2" /> New Chat
              </DialogTrigger>
              <DialogContent className="backdrop-blur-xl bg-[#1e1e2f]/95 border border-white/10 text-white rounded-3xl p-6">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold">Start a new chat</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateChat} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold opacity-70">User Phone Number</label>
                    <Input 
                      placeholder="+1 234 567 8900" 
                      className="bg-white/5 border-white/10 text-white rounded-xl placeholder:text-white/30 focus-visible:ring-0 focus-visible:border-indigo-500"
                      value={newChatPhone}
                      onChange={e => setNewChatPhone(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold">Start Chat</Button>
                </form>
              </DialogContent>
            </Dialog>
            <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
              <DialogContent className="backdrop-blur-xl bg-[#1e1e2f]/95 border border-white/10 text-white rounded-3xl p-6">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold">Edit Profile</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleUpdateProfile} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold opacity-70">Display Name</label>
                    <Input 
                      placeholder="Your Name" 
                      className="bg-white/5 border-white/10 text-white rounded-xl placeholder:text-white/30 focus-visible:ring-0 focus-visible:border-indigo-500"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold opacity-70">Profile Picture</label>
                    <div className="flex gap-4 items-center">
                      <Avatar className="h-16 w-16 border border-white/10">
                        <AvatarImage src={editPhoto} />
                        <AvatarFallback className="bg-indigo-600 text-white font-bold">{editName?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col gap-2 flex-1">
                        <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handlePhotoUpload} />
                        <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="text-xs w-full bg-white/10 hover:bg-white/20 text-white">
                          Choose from Gallery
                        </Button>
                        <Input 
                          placeholder="Or paste URL here..." 
                          className="bg-white/5 border-white/10 text-white rounded-xl placeholder:text-white/30 focus-visible:ring-0 focus-visible:border-indigo-500 h-8 text-xs"
                          value={editPhoto}
                          onChange={e => setEditPhoto(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold">Save Changes</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </>
      )}

      {activeTab === 'contacts' && (
        <ScrollArea className="flex-1 px-2 mt-4">
          <div className="space-y-1">
            {contacts.map(contact => (
              <button
                key={contact.id}
                onClick={async () => {
                  const existingChat = chats.find(c => c.type === 'direct' && c.participantIds.includes(contact.id));
                  if (existingChat) {
                    setActiveChatId(existingChat.id);
                  } else {
                    if (!user) return;
                    try {
                      const chatRef = await addDoc(collection(db, 'chats'), {
                        type: 'direct',
                        participantIds: [user.uid, contact.id],
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        voiceChannelActive: false
                      });
                      setActiveChatId(chatRef.id);
                    } catch (error) {
                      handleFirestoreError(error, OperationType.CREATE, 'chats');
                    }
                  }
                  setActiveTab('chats');
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-colors hover:bg-white/5`}
              >
                <Avatar className="h-10 w-10 border border-white/10">
                  <AvatarImage src={contact.photoURL} />
                  <AvatarFallback className="bg-emerald-400 font-bold text-emerald-950">
                    {contact.displayName ? contact.displayName.charAt(0) : <Users className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left overflow-hidden">
                  <div className="font-bold text-sm text-white truncate">{contact.displayName || contact.phoneNumber || 'Unknown user'}</div>
                  <div className="text-[10px] text-white/50 truncate flex items-center">
                    <span className="truncate">{contact.bio || contact.phoneNumber || 'Available'}</span>
                  </div>
                </div>
              </button>
            ))}
            {contacts.length === 0 && (
              <div className="text-center text-white/30 text-sm py-8">
                No contacts found.
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {activeTab === 'discover' && (
        <div className="flex-1 flex flex-col bg-transparent overflow-hidden">
          <div className="p-4 border-b border-white/10">
             <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                <div className="flex flex-col items-center gap-1 min-w-[70px]">
                  <div className="w-14 h-14 rounded-full border-2 border-indigo-500 p-0.5 bg-gradient-to-tr from-indigo-500 to-rose-400 shrink-0">
                    <div className="w-full h-full bg-slate-800 rounded-full flex items-center justify-center text-white/50">
                     <Plus className="w-5 h-5" />
                    </div>
                  </div>
                  <span className="text-[10px] text-white/60 font-semibold mt-1">Your Story</span>
                </div>
                <div className="flex flex-col items-center gap-1 min-w-[70px]">
                  <div className="w-14 h-14 rounded-full border-2 border-indigo-500 p-0.5 shrink-0">
                    <div className="w-full h-full bg-white/10 rounded-full flex items-center justify-center">
                     <Video className="w-4 h-4 text-white/50" />
                    </div>
                  </div>
                  <span className="text-[10px] text-white/60 font-semibold mt-1">Global</span>
                </div>
             </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-[10px] uppercase font-black text-white/40">Latest Posts</h3>
                <Button size="sm" variant="ghost" onClick={async () => {
                   if (!user) return;
                   await addDoc(collection(db, 'posts'), { authorId: user.uid, caption: "Post test " + Math.random(), createdAt: serverTimestamp() }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'posts'));
                }} className="h-6 px-2 text-[10px] text-indigo-400 font-bold bg-indigo-500/10 hover:bg-indigo-500/20 rounded-lg">Post update</Button>
              </div>
              {posts.map(post => (
                <div key={post.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Avatar className="h-6 w-6 border border-white/10">
                      <AvatarFallback className="bg-indigo-600 font-bold text-[10px]">U</AvatarFallback>
                    </Avatar>
                    <span className="text-[10px] text-white/60 font-bold">User ID: {post.authorId.slice(0, 5)}...</span>
                  </div>
                  <p className="text-sm text-white/90 leading-relaxed">{post.caption}</p>
                </div>
              ))}
              {posts.length === 0 && (
                <div className="text-center text-white/30 text-sm py-8">
                  <Disc className="w-8 h-8 opacity-20 mx-auto mb-2" />
                  No posts yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
