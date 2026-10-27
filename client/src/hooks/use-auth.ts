import { useState, useEffect, useCallback } from 'react';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  botId: string | null;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    botId: null,
  });

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          botId: data.botId,
        });
        return true;
      } else {
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          botId: null,
        });
        return false;
      }
    } catch (error) {
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        botId: null,
      });
      return false;
    }
  }, []);

  useEffect(() => {
    // Purge credentials saved by older versions, including for already-authenticated users.
    localStorage.removeItem("discord_bot_token");
    // Check session once on mount
    checkSession();
  }, [checkSession]);

  const login = async (token: string) => {
    try {
      const res = await fetch('/api/auth/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (data.success && res.ok) {
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          botId: data.bot.id,
        });

        return { success: true, bot: data.bot };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/disconnect', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      // Continue with logout even if API call fails
    }
    
    setAuthState({
      isAuthenticated: false,
      isLoading: false,
      botId: null,
    });
  };

  return {
    ...authState,
    login,
    logout,
    checkSession,
  };
}
