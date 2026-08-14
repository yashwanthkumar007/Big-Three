import { Navigate } from "react-router-dom";

import { isSessionValid } from "@/shared/utils/auth";

type PublicRouteProps = {
  children: React.ReactNode;
};

export default function PublicRoute({ children }: PublicRouteProps) {
  const isLoggedIn = isSessionValid();

  if (isLoggedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}