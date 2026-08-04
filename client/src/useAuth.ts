import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicUserView } from '@24game/shared';
import { apiGet, apiPost, loadToken, saveToken } from './api.js';

export interface AuthApi {
  token: string | null;
  user: PublicUserView | null;
  /** True until the stored token has been checked against the server. */
  loading: boolean;
  /** Server has no database configured, so accounts are unavailable. */
  unavailable: boolean;
  register: (email: string, username: string, password: string) => Promise<string | null>;
  login: (identifier: string, password: string) => Promise<string | null>;
  logout: () => void;
  /** Replace the cached user, e.g. after a rated match moves the rating. */
  setUser: (user: PublicUserView | null) => void;
}

interface AuthResponse {
  token: string;
  user: PublicUserView;
}

export function useAuth(): AuthApi {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [user, setUser] = useState<PublicUserView | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  // Validate a stored token once on boot. An expired or revoked token clears
  // itself rather than leaving the UI in a half-signed-in state.
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      return;
    }
    void (async () => {
      const result = await apiGet<{ user: PublicUserView }>('/api/auth/me', token);
      if (cancelled) return;
      if (result.ok) {
        setUser(result.data.user);
      } else {
        if (result.status === 503) setUnavailable(true);
        else {
          saveToken(null);
          setToken(null);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const adopt = useCallback((data: AuthResponse) => {
    saveToken(data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const result = await apiPost<AuthResponse>('/api/auth/register', {
        email,
        username,
        password,
      });
      if (result.ok) {
        adopt(result.data);
        return null;
      }
      if (result.status === 503) setUnavailable(true);
      return result.error;
    },
    [adopt],
  );

  const login = useCallback(
    async (identifier: string, password: string) => {
      const result = await apiPost<AuthResponse>('/api/auth/login', { identifier, password });
      if (result.ok) {
        adopt(result.data);
        return null;
      }
      if (result.status === 503) setUnavailable(true);
      return result.error;
    },
    [adopt],
  );

  const logout = useCallback(() => {
    saveToken(null);
    setToken(null);
    setUser(null);
  }, []);

  return useMemo(
    () => ({ token, user, loading, unavailable, register, login, logout, setUser }),
    [token, user, loading, unavailable, register, login, logout],
  );
}
