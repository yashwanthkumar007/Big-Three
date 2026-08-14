import { Navigate } from "react-router-dom";

import { isSessionValid } from "@/shared/utils/auth";

type ProtectedRouteProps = {
  children: React.ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isLoggedIn = isSessionValid();

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}