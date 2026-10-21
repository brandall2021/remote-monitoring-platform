import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { authAPI, User, refreshSession, setAccessToken, clearAccessToken } from "../services/api";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Al recargar, el access token en memoria se perdió. La sesión se rearma con la cookie HttpOnly:
  // se pide un access nuevo y recién después se lee el perfil.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await refreshSession();
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await authAPI.profile();
        if (!cancelled) setUser(res.data);
      } catch {
        clearAccessToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { data } = await authAPI.login(email, password);
      // accessToken en memoria; el refreshToken ni se ve: quedó en la cookie del navegador.
      setAccessToken(data.accessToken);
      setUser(data.user);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Error al iniciar sesión. Verifica tus credenciales.";
      setError(message);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    authAPI.logout().catch(() => {});
    clearAccessToken();
    setUser(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
        error,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
