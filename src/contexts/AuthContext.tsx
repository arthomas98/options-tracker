// Authentication Context
// Provides Google OAuth state to the React component tree

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { googleAuth, type AuthState } from '../services/googleAuth';
import { isGoogleConfigured } from '../config/google';

interface AuthContextValue extends AuthState {
  signIn: () => void;
  signOut: () => void;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [authState, setAuthState] = useState<AuthState>({
    isSignedIn: false,
    isLoading: true,
    accessToken: null,
    error: null,
  });

  const isConfigured = isGoogleConfigured();

  useEffect(() => {
    if (!isConfigured) {
      setAuthState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    // Subscribe to auth state changes
    const unsubscribe = googleAuth.subscribe(setAuthState);

    // Initialize Google Auth
    googleAuth.initialize().catch(console.error);

    return unsubscribe;
  }, [isConfigured]);

  const signIn = () => {
    if (!isConfigured) {
      console.warn('Google OAuth not configured. Set VITE_GOOGLE_CLIENT_ID environment variable.');
      return;
    }
    googleAuth.signIn();
  };

  const signOut = () => {
    googleAuth.signOut();
  };

  const value: AuthContextValue = {
    ...authState,
    signIn,
    signOut,
    isConfigured,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
