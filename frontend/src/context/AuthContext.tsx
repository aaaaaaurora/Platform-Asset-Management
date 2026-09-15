import { createContext, useContext, useState, useEffect, ReactNode } from 'react';


export interface User {
  id: string;          // Mappato dal 'sub' del JWT
  role: string;        // 'GUEST', 'OPERATORE', 'AMMINISTRATORE' 
  campus_ids: string[];
  category_id: string | null;
  email?: string;
  name?: string;
  first_name?: string; 
  last_name?: string; 
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Funzione sicura per decodificare il JWT senza librerie esterne
const decodeJWT = (token: string) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error("Errore nella decodifica del token", error);
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  
  // 1. Inizializzazione Sincrona del Token
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('jwt_token'));
  
  // 2. Inizializzazione Sincrona dell'Utente (Previene il logout al refresh)
  const [user, setUser] = useState<User | null>(() => {
    const savedToken = localStorage.getItem('jwt_token');
    if (savedToken) {
      const decoded = decodeJWT(savedToken);
      if (decoded) {
        return {
          id: decoded.sub,
          role: decoded.role || 'UTENTE',
          campus_ids: decoded.campus_ids || [],
          category_id: decoded.category_id || null,
          email: decoded.email,
          name: decoded.name,
          first_name: decoded.first_name,
        };
      }
    }
    return null;
  });

  // L'useEffect gestisce i futuri aggiornamenti (es. login o scadenza token)
  useEffect(() => {

    const fetchUserProfile = async (validToken: string, decodedToken: any) => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/me`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${validToken}`
          }
        });

        if (response.ok) {
          const userData = await response.json();
          // Unisce i permessi del JWT con i dati anagrafici presi dal DB
          setUser({
            id: decodedToken.sub,
            role: decodedToken.role,
            campus_ids: decodedToken.campus_ids || [],
            category_id: decodedToken.category_id || null,
            first_name: userData.first_name,
            last_name: userData.last_name,
            email: userData.email
          });
        } else {
          // Se la richiesta fallisce (es. token revocato o utente inattivo dal DB), scarta la sessione
          console.error("Errore nel recupero del profilo dal server");
          logout();
        }
      } catch (error) {
        console.error("Errore di rete durante il recupero del profilo", error);
        // Evitiamo il logout in caso di momentanea assenza di rete, mantenendo i dati base del JWT
      }
    };

    if (token) {
      const decoded = decodeJWT(token);
      if (decoded) {
        setUser({
          id: decoded.sub,
          role: decoded.role || 'UTENTE',
          campus_ids: decoded.campus_ids || [],
          category_id: decoded.category_id || null,
          email: decoded.email,
          name: decoded.name,
          first_name: decoded.first_name,
        });
        
        localStorage.setItem('jwt_token', token);

        // Recupero in background dei dati anagrafici (nome, email)
        fetchUserProfile(token, decoded);

      } else {
        // Token corrotto, puliamo tutto
        setToken(null);
        setUser(null);
        localStorage.removeItem('jwt_token');
      }
    } else {
      setUser(null);
      localStorage.removeItem('jwt_token');
    }
  }, [token]);

  const login = (newToken: string) => {
    setToken(newToken);
  };
  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('jwt_token');
  };

  const isAuthenticated = Boolean(token && user);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve essere usato in un AuthProvider');
  }
  return context;
};