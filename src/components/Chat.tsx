import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/src/lib/store';
import { auth, db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, doc, getDoc, limit, updateDoc } from 'firebase/firestore';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Video, Phone, MoreVertical, Paperclip, Send, Mic, Lock, ShieldCheck, MicOff, VideoOff, Smile, ArrowLeft, MonitorSmartphone } from 'lucide-react';
import { format } from 'date-fns';

const pcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function Chat() {
  const { user, activeChatId, setActiveChatId } = useAppStore();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatDetails, setChatDetails] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // WebRTC State
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'receiving' | 'connected'>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingOffer, setIncomingOffer] = useState<any>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  // Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callStatusRef = useRef(callStatus);
  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  useEffect(() => {
    if (!activeChatId || !user) {
      setMessages([]);
      setChatDetails(null);
      endCall(false);
      return;
    }

    const chatRef = doc(db, 'chats', activeChatId);
    const unsubChat = onSnapshot(chatRef, (docSnap) => {
      if (docSnap.exists()) {
        setChatDetails({ id: docSnap.id, ...docSnap.data() });
      }
    });

    const messagesRef = collection(db, 'chats', activeChatId, 'messages');
    const qMessages = query(messagesRef, orderBy('createdAt', 'asc'));
    
    const unsubMessages = onSnapshot(qMessages, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMessages(msgs);
      
      msgs.forEach(msg => {
        if (msg.senderId !== user?.uid && (!msg.readBy || !msg.readBy[user?.uid])) {
          try {
            updateDoc(doc(db, 'chats', activeChatId, 'messages', msg.id), {
              readBy: { ...(msg.readBy || {}), [user.uid]: new Date().toISOString() }
            });
          } catch(e) {
            console.error("Failed to mark as read", e);
          }
        }
      });

      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 100);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `chats/${activeChatId}/messages`));

    // WebRTC Signaling Listener
    const signalsRef = collection(db, 'chats', activeChatId, 'signals');
    const qSignals = query(signalsRef, orderBy('createdAt', 'desc'), limit(10));
    
    const unsubSignals = onSnapshot(qSignals, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.senderId === user.uid) return;
          
          const createdAt = data.createdAt?.toMillis() || Date.now();
          if (Date.now() - createdAt > 60000) return; // ignore old signals
          
          try {
             const signal = JSON.parse(data.signal);
             const currentStatus = callStatusRef.current;
             
             if (signal.type === 'offer' && currentStatus === 'idle') {
                setIncomingOffer(signal);
                setCallStatus('receiving');
             } else if (signal.type === 'answer' && peerConnectionRef.current) {
                peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(signal));
                setCallStatus('connected');
             } else if (signal.candidate && peerConnectionRef.current && currentStatus !== 'idle') {
                peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(signal));
             } else if (signal.type === 'end') {
                endCall(false);
             }
          } catch(e) {
             console.error("Signal parsing failed", e);
          }
        }
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, `chats/${activeChatId}/signals`));

    return () => {
      unsubChat();
      unsubMessages();
      unsubSignals();
      endCall(false);
    };
  }, [activeChatId, user]);

  const sendSignal = async (payload: any) => {
     if (!activeChatId || !user) return;
     try {
       await addDoc(collection(db, 'chats', activeChatId, 'signals'), {
          chatId: activeChatId,
          senderId: user.uid,
          signal: JSON.stringify(payload),
          createdAt: serverTimestamp()
       });
     } catch (e) {
       handleFirestoreError(e, OperationType.CREATE, `chats/${activeChatId}/signals`);
     }
  };

  const initializePC = () => {
    const pc = new RTCPeerConnection(pcConfig);
    peerConnectionRef.current = pc;
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(event.candidate.toJSON());
      }
    };
    
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };
    
    return pc;
  };

  const startCall = async (video: boolean) => {
     try {
       const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
       setLocalStream(stream);
       setIsAudioMuted(false);
       setIsVideoMuted(!video);
       setCallStatus('calling');
       
       const pc = initializePC();
       stream.getTracks().forEach(track => pc.addTrack(track, stream));
       
       const offer = await pc.createOffer();
       await pc.setLocalDescription(offer);
       
       sendSignal({ type: 'offer', sdp: offer.sdp });
     } catch (e) {
       console.error("Failed to start call", e);
       alert("Could not access camera/microphone.");
       setCallStatus('idle');
     }
  };
  
  const acceptCall = async () => {
     try {
       const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
       setLocalStream(stream);
       setIsAudioMuted(false);
       setIsVideoMuted(false);
       setCallStatus('connected');
       
       const pc = initializePC();
       stream.getTracks().forEach(track => pc.addTrack(track, stream));
       
       await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
       const answer = await pc.createAnswer();
       await pc.setLocalDescription(answer);
       
       sendSignal({ type: 'answer', sdp: answer.sdp });
     } catch (e) {
       console.error("Failed to accept call", e);
       endCall(true);
     }
  };

  const endCall = (broadcast = true) => {
     if (broadcast && callStatusRef.current !== 'idle') {
       sendSignal({ type: 'end' });
     }
     if (peerConnectionRef.current) {
       peerConnectionRef.current.close();
       peerConnectionRef.current = null;
     }
     if (localStream) {
       localStream.getTracks().forEach(t => t.stop());
     }
     setLocalStream(null);
     setRemoteStream(null);
     setCallStatus('idle');
     setIncomingOffer(null);
     setIsAudioMuted(false);
     setIsVideoMuted(false);
  };

  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsAudioMuted(!track.enabled);
      });
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
        setIsVideoMuted(!track.enabled);
      });
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing && localStream) {
         // Switch back to camera
         const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
         
         const oldVideoTrack = localStream.getVideoTracks()[0];
         const newVideoTrack = stream.getVideoTracks()[0];
         
         if (peerConnectionRef.current) {
            const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
               sender.replaceTrack(newVideoTrack);
            }
         }
         
         if (oldVideoTrack) {
           localStream.removeTrack(oldVideoTrack);
           oldVideoTrack.stop();
         }
         localStream.addTrack(newVideoTrack);
         // If they were sharing screen, we un-mute their camera when falling back
         newVideoTrack.enabled = true;
         setIsScreenSharing(false);
         setIsVideoMuted(false);
      } else {
         // Switch to screen share
         const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
         
         if (!localStream) return;
         
         const oldVideoTrack = localStream.getVideoTracks()[0];
         const newVideoTrack = stream.getVideoTracks()[0];
         
         newVideoTrack.onended = () => {
             // Revert to camera if user stops sharing via browser UI
             if (isScreenSharing) toggleScreenShare();
         };
         
         if (peerConnectionRef.current) {
            const sender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
               sender.replaceTrack(newVideoTrack);
            }
         }
         
         if (oldVideoTrack) {
           localStream.removeTrack(oldVideoTrack);
           oldVideoTrack.stop();
         }
         localStream.addTrack(newVideoTrack);
         setIsScreenSharing(true);
      }
    } catch (e) {
      console.error("Screen share failed", e);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !activeChatId) return;

    try {
      const text = newMessage;
      setNewMessage('');
      
      await addDoc(collection(db, 'chats', activeChatId, 'messages'), {
        chatId: activeChatId,
        senderId: user.uid,
        text,
        createdAt: serverTimestamp(),
      });

      // Update chat last updated time
      const chatRef = doc(db, 'chats', activeChatId);
      await updateDoc(chatRef, {
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `chats/${activeChatId}/messages`);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!user || !activeChatId) return;
    try {
      const messageRef = doc(db, 'chats', activeChatId, 'messages', messageId);
      const msgInfo = messages.find(m => m.id === messageId);
      if (!msgInfo) return;
      
      const currentReactions = msgInfo.reactions || {};
      const emojiUsers = currentReactions[emoji] || [];
      
      let newEmojiUsers: string[] = [];
      if (emojiUsers.includes(user.uid)) {
        newEmojiUsers = emojiUsers.filter((id: string) => id !== user.uid);
      } else {
        newEmojiUsers = [...emojiUsers, user.uid];
      }
      
      const newReactions = { ...currentReactions, [emoji]: newEmojiUsers };
      if (newEmojiUsers.length === 0) {
        delete newReactions[emoji];
      }
      
      await updateDoc(messageRef, { reactions: newReactions });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `chats/${activeChatId}/messages/${messageId}`);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      recordingChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordingChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        
        // Convert to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
           const base64AudioMessage = reader.result as string;
           
           if (!user || !activeChatId) return;
           try {
             await addDoc(collection(db, 'chats', activeChatId, 'messages'), {
                chatId: activeChatId,
                senderId: user.uid,
                audioData: base64AudioMessage,
                createdAt: serverTimestamp(),
             });
             
             await updateDoc(doc(db, 'chats', activeChatId), {
                updatedAt: serverTimestamp()
             });
           } catch (error) {
             handleFirestoreError(error, OperationType.CREATE, `chats/${activeChatId}/messages`);
           }
        };
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      
    } catch (e) {
      console.error("Microphone access denied", e);
      alert("Could not access microphone for voice message.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };
  
  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      // stop without sending, so we don't trigger the onstop we defined, or we can just empty chunks
      recordingChunksRef.current = [];
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!activeChatId) {
    return (
      <section className="flex-1 h-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl flex flex-col overflow-hidden items-center justify-center text-white/50">
        <ShieldCheck className="h-16 w-16 mb-6 opacity-20 text-indigo-500" />
        <h2 className="text-xl font-bold text-white mb-2">SPARE A DIME</h2>
        <p className="text-sm">End-to-end encrypted messaging and video calling.</p>
        <p className="text-sm mt-1">Select a chat to start messaging.</p>
      </section>
    );
  }

  const getChatName = () => {
    if (!chatDetails) return 'Loading...';
    if (chatDetails.type === 'group') return chatDetails.name;
    return "Direct Message";
  };

  return (
    <section className="flex-1 h-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl flex flex-col overflow-hidden relative">
      {/* WebRTC Overlay */}
      {callStatus !== 'idle' && (
        <div className="absolute inset-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-2xl flex flex-col items-center justify-center">
          {callStatus === 'receiving' && (
            <div className="text-center space-y-6">
              <div className="w-24 h-24 rounded-full bg-indigo-500/20 border border-indigo-500 flex items-center justify-center animate-pulse mx-auto">
                <Phone className="w-10 h-10 text-indigo-400 animate-bounce" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">Incoming Call</h3>
                <p className="text-white/50">from {getChatName()}</p>
              </div>
              <div className="flex gap-4 justify-center">
                <Button onClick={acceptCall} className="rounded-full h-14 w-14 bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20">
                  <Phone className="w-6 h-6" />
                </Button>
                <Button onClick={() => endCall(true)} className="rounded-full h-14 w-14 bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/20">
                  <Phone className="w-6 h-6 rotate-[135deg]" />
                </Button>
              </div>
            </div>
          )}
          {(callStatus === 'calling' || callStatus === 'connected') && (
            <div className="w-full h-full relative flex items-center justify-center p-4">
              {remoteStream ? (
                <video 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover rounded-3xl"
                  ref={(video) => { if (video) video.srcObject = remoteStream; }}
                />
              ) : (
                <div className="text-white/50 animate-pulse text-xl font-medium">Connecting...</div>
              )}
              
              {localStream && !isVideoMuted && (
                <div className="absolute top-6 right-6 w-32 h-44 bg-zinc-800 rounded-2xl overflow-hidden border-2 border-white/10 shadow-2xl">
                  <video 
                    autoPlay 
                    playsInline 
                    muted 
                    className={`w-full h-full object-cover ${!isScreenSharing ? 'transform -scale-x-100' : ''}`}
                    ref={(video) => { if (video) video.srcObject = localStream; }}
                  />
                </div>
              )}
              
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-xl px-6 py-4 rounded-3xl border border-white/10 flex gap-4 shadow-2xl items-center">
                <Button 
                  onClick={toggleAudio} 
                  variant="ghost" 
                  size="icon" 
                  className={`rounded-full w-12 h-12 transition-colors ${isAudioMuted ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-white/5 hover:bg-white/20 text-white'}`}
                >
                  {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </Button>
                <Button 
                  onClick={toggleVideo} 
                  variant="ghost" 
                  size="icon" 
                  className={`rounded-full w-12 h-12 transition-colors ${isVideoMuted ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-white/5 hover:bg-white/20 text-white'}`}
                >
                  {isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </Button>
                <Button 
                  onClick={toggleScreenShare} 
                  variant="ghost" 
                  size="icon" 
                  className={`rounded-full w-12 h-12 transition-colors ${isScreenSharing ? 'bg-indigo-500 hover:bg-indigo-600 text-white' : 'bg-white/5 hover:bg-white/20 text-white'}`}
                >
                  <MonitorSmartphone className="w-5 h-5" />
                </Button>
                <div className="w-px h-8 bg-white/20 mx-2" />
                <Button onClick={() => endCall(true)} className="rounded-full w-16 h-12 bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/20">
                  <Phone className="w-6 h-6 rotate-[135deg]" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <header className="p-4 flex items-center justify-between border-b border-white/10 bg-white/5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button className="md:hidden p-2 rounded-full hover:bg-white/10 transition-colors" onClick={() => setActiveChatId(null)}>
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <Avatar className="h-10 w-10 border border-white/10">
            <AvatarFallback className="bg-amber-400 font-bold text-yellow-950">DM</AvatarFallback>
          </Avatar>
          <div>
            <h2 className="font-bold text-white">{getChatName()}</h2>
            <div className="text-[10px] text-green-400 font-medium flex items-center gap-1">
              Active Now
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 transition-colors rounded-lg text-xs font-bold text-white flex items-center gap-1" onClick={() => startCall(true)}>
             <Video className="w-4 h-4" /> Video
          </button>
          <button className="px-3 py-1.5 bg-white/10 hover:bg-white/20 transition-colors rounded-lg text-xs font-bold flex items-center gap-1 text-white" onClick={() => startCall(false)}>
             <Phone className="w-4 h-4" /> Voice
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 custom-scrollbar" ref={scrollRef}>
        <div className="flex flex-col items-center justify-center py-6 text-white/50">
          <div className="bg-white/5 px-4 py-2 rounded-full text-xs flex items-center gap-2 mb-4 border border-white/10 shadow-sm font-medium">
            <Lock className="h-3 w-3 text-green-400" />
            Messages and calls are end-to-end encrypted. No one outside of this chat can read or listen to them.
          </div>
        </div>

        {messages.map((msg, idx) => {
          const isMine = msg.senderId === user?.uid;
          const showAvatar = !isMine && (idx === 0 || messages[idx - 1].senderId !== msg.senderId);

          return (
            <div key={msg.id} className={`flex ${isMine ? 'flex-row-reverse' : 'flex-row'} gap-3`}>
              {!isMine && (
                <div className="w-8 shrink-0">
                  {showAvatar && (
                    <div className="w-8 h-8 rounded-lg bg-emerald-500 mt-1 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white shadow-sm shadow-emerald-500/20">
                      U
                    </div>
                  )}
                </div>
              )}
              
              <div className={`max-w-[70%] space-y-1 ${isMine ? 'text-right' : 'text-left'}`}>
                {showAvatar && !isMine && (
                   <p className="text-[11px] opacity-40 font-bold ml-1 mb-1">User • {format(msg.createdAt?.toDate() || new Date(), 'h:mm a')}</p>
                )}
                <div className="relative group/msg">
                  <div 
                    className={`
                      p-3 
                      relative
                      ${isMine 
                        ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-none shadow-sm shadow-indigo-500/10' 
                        : 'bg-white/10 text-white rounded-2xl rounded-tl-none border border-white/5'
                      }
                    `}
                  >
                    {msg.audioData ? (
                      <audio controls src={msg.audioData} className="max-w-full h-10" />
                    ) : (
                      <p className="text-[14px] leading-relaxed break-words">{msg.text}</p>
                    )}
                  </div>
                  
                  {/* Reaction Menu */}
                  <div className={`absolute top-1/2 -translate-y-1/2 flex items-center bg-[#2d1b33] border border-white/10 rounded-full shadow-lg p-1 opacity-0 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto transition-opacity z-10 ${isMine ? 'right-full mr-2' : 'left-full ml-2'}`}>
                    {['👍', '❤️', '😂', '😮', '😢', '😡'].map(emoji => (
                      <button 
                        key={emoji}
                        type="button" 
                        className="hover:bg-white/10 rounded-full w-8 h-8 flex items-center justify-center text-sm transition-colors"
                        onClick={() => handleReaction(msg.id, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  {/* Render existing reactions */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                      {Object.entries(msg.reactions).map(([emoji, usersArr]: [string, any]) => (
                        <button 
                          key={emoji}
                          type="button" 
                          onClick={() => handleReaction(msg.id, emoji)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors ${usersArr.includes(user?.uid) ? 'bg-indigo-500/30 border-indigo-500/50 text-indigo-200' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`}
                        >
                          <span className="leading-none">{emoji}</span>
                          {usersArr.length > 1 && <span>{usersArr.length}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {msg.createdAt && isMine && (
                  <div className="flex items-center gap-1 justify-end text-[10px] text-white/40 font-bold mt-1 px-1">
                    <span>{format(msg.createdAt.toDate(), 'h:mm a')}</span>
                    {msg.readBy && Object.entries(msg.readBy).some(([id]) => id !== user?.uid) ? (
                       <span className="text-indigo-400 font-bold ml-1 flex items-center gap-1">
                         • Seen {format(new Date(Object.values(msg.readBy).filter((_, i, arr) => Object.keys(msg.readBy)[i] !== user?.uid)[0] as string), 'h:mm a')}
                       </span>
                    ) : (
                       <span className="ml-1">• Sent</span>
                    )}
                  </div>
                )}
                {msg.createdAt && !isMine && (
                  <div className="flex items-center justify-start text-[10px] text-white/40 font-bold mt-1 px-1">
                    <span>{format(msg.createdAt.toDate(), 'h:mm a')}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="p-4 bg-transparent border-t border-white/10 shrink-0">
        <form onSubmit={handleSendMessage} className="bg-white/5 rounded-2xl p-2 border border-white/10 flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-xl text-white/40 hover:text-white hover:bg-white/10 h-10 w-10">
            <Paperclip className="h-5 w-5" />
          </Button>
          {isRecording ? (
            <div className="flex-1 flex items-center justify-between px-4 bg-rose-500/10 rounded-xl border border-rose-500/20 h-10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-rose-400 font-medium text-sm tabular-nums">
                  {formatDuration(recordingDuration)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={cancelRecording} className="text-xs font-bold text-white/50 hover:text-white transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <Input 
              className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 text-white placeholder:text-white/40 text-sm h-10 px-2" 
              placeholder="Message..." 
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
            />
          )}

          {newMessage.trim() && !isRecording ? (
            <Button type="submit" size="icon" className="shrink-0 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white h-10 w-10 transition-all font-bold">
              <Send className="h-4 w-4 ml-1" />
            </Button>
          ) : isRecording ? (
            <Button type="button" onClick={stopRecording} size="icon" className="shrink-0 rounded-xl bg-rose-500 hover:bg-rose-400 text-white h-10 w-10 transition-all font-bold group">
              <Send className="h-4 w-4 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          ) : (
            <Button type="button" onClick={startRecording} size="icon" className="shrink-0 rounded-xl text-white/40 hover:text-white hover:bg-white/10 h-10 w-10">
              <Mic className="h-5 w-5" />
            </Button>
          )}
        </form>
      </div>
    </section>
  );
}

