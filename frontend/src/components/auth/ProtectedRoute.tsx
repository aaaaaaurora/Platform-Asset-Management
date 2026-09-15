import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface ProtectedRouteProps {
  allowedRoles?: string[]; // Array opzionale: es. ['AMMINISTRATORE', 'OPERATORE']
}

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, isAuthenticated } = useAuth();

  // 1. Controllo Autenticazione Base
  // Se l'utente non ha il token (non è loggato), viene reindirizzato forzatamente al Login
  if (!isAuthenticated || !user) {
    return <Navigate to="/signin" replace />;
  }

  // 2. Controllo Ruoli (RBAC)
  // Se la rotta richiede ruoli specifici e l'utente non ha quel ruolo, lo blocchiamo
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />; // Lo rimandiamo alla dashboard (o a una pagina "Accesso Negato")
  }

  // 3. Accesso Consentito
  // L'Outlet è un componente speciale di React Router che dice: "Sei autorizzato, renderizza la pagina richiesta!"
  return <Outlet />;
}