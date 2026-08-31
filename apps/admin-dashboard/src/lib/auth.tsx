import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient } from './api-client';

// The admin JWT is held in React state and mirrored to sessionStorage
// (survives a page refresh, cleared when the tab closes) — deliberately
// not localStorage, to limit how long an admin token can persist if the
// machine is shared. This is an internal ops tool; there is no refresh
// token or silent-renewal flow yet — the JWT's own expiry is the session
// length, same posture as every other JWT in this system.
const STORAGE_KEY = 'lybid_admin_token';

interface AuthContextValue {
  token: string | null;
  api: ApiClient;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem(STORAGE_KEY),
  );

  // getToken is a closure, not `token` captured by value, so ApiClient
  // always reads the current token even across a login/logout without
  // needing to be reconstructed.
  const api = useMemo(
    () => new ApiClient(() => sessionStorage.getItem(STORAGE_KEY)),
    [],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await api.login(email, password);
      sessionStorage.setItem(STORAGE_KEY, accessToken);
      setToken(accessToken);
    },
    [api],
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({ token, api, login, logout }),
    [token, api, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
