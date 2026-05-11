import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/src/lib/store';
import { auth, db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { GoogleAuthProvider, signInWithPopup, signInWithPhoneNumber, RecaptchaVerifier, ConfirmationResult } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, Mail } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function Auth() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    }
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await syncUserProfile(result.user);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const appVerifier = window.recaptchaVerifier;
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
      setConfirmationResult(confirmation);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationResult) return;
    try {
      setLoading(true);
      const result = await confirmationResult.confirm(verificationCode);
      await syncUserProfile(result.user);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const syncUserProfile = async (user: any) => {
    const userRef = doc(db, 'users', user.uid);
    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: user.displayName || user.phoneNumber || 'Anonymous User',
          photoURL: user.photoURL || '',
          phoneNumber: user.phoneNumber || '',
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1e1e2f] via-[#2d1b33] to-[#121212] font-sans text-white px-4">
      <div id="recaptcha-container"></div>
      <Card className="w-full max-w-md backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl text-white shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-black tracking-tighter text-indigo-300">SPARE A DIME</CardTitle>
          <CardDescription className="text-white/50">Connect securely with friends</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="google" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/10 rounded-xl p-1 mb-6">
              <TabsTrigger value="google" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white rounded-lg">Google</TabsTrigger>
              <TabsTrigger value="phone" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white rounded-lg">Phone</TabsTrigger>
            </TabsList>
            
            <TabsContent value="google" className="space-y-4">
              <Button 
                variant="outline" 
                className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 rounded-xl" 
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <img src="https://uidotdev.github.io/react-icons/assets/google.svg" className="w-5 h-5 mr-3" />
                Continue with Google
              </Button>
            </TabsContent>

            <TabsContent value="phone">
              {!confirmationResult ? (
                <form onSubmit={handlePhoneSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
                      <Input 
                        id="phone" 
                        placeholder="+1 234 567 8900" 
                        className="pl-9 bg-white/5 border-white/10 text-white rounded-xl placeholder:text-white/30 focus-visible:ring-0 focus-visible:border-indigo-500"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold" disabled={loading}>
                    Send Code
                  </Button>
                </form>
              ) : (
                <form onSubmit={verifyCode} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Verification Code</Label>
                    <Input 
                      id="code" 
                      placeholder="123456" 
                      className="bg-white/5 border-white/10 text-white rounded-xl placeholder:text-white/30 focus-visible:ring-0 focus-visible:border-indigo-500 text-center text-lg tracking-widest"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      required
                      maxLength={6}
                    />
                  </div>
                  <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold" disabled={loading}>
                    Verify & Login
                  </Button>
                  <Button type="button" variant="ghost" className="w-full mt-2 hover:bg-white/10 rounded-xl" onClick={() => setConfirmationResult(null)}>
                    Back
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="text-xs text-center text-white/30 justify-center">
          <p>End-to-end encrypted messaging.</p>
        </CardFooter>
      </Card>
    </div>
  );
}
