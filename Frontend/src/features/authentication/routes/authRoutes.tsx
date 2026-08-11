import { Navigate, type RouteObject } from "react-router-dom";

import LoginPage from "../pages/LoginPage";

export const authRoutes: RouteObject[] = [
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "*",
    element: <Navigate to="/login" replace />,
  },
];