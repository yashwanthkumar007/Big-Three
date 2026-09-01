import { Navigate } from "react-router-dom";

import { isSessionValid, getAccountType } from "@/shared/utils/auth";
import { roleHasPermission, type Role } from "@/shared/utils/permissions";

/** Maps an account type from the session to an RBAC role. */
const ACCOUNT_TYPE_TO_ROLE: Record<string, Role> = {
  "Tenant admin": "TENANT_ADMIN",
  "Administrator": "ADMIN",
  "Reviewer": "REVIEWER",
  "user": "USER",
  "User": "USER",
};

type AdminRouteProps = {
  children: React.ReactNode;
};

/**
 * Guards a route so only authenticated accounts with VIEW_SYSTEM_SETUP
 * permission (Admin / Tenant admin) can access it.
 * Regular users are redirected back to the dashboard.
 */
export default function AdminRoute({ children }: AdminRouteProps) {
  if (!isSessionValid()) {
    return <Navigate to="/login" replace />;
  }

  const role = ACCOUNT_TYPE_TO_ROLE[getAccountType() ?? ""];

  if (!roleHasPermission(role, "VIEW_SYSTEM_SETUP")) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
