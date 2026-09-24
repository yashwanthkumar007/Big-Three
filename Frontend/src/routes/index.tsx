import { createBrowserRouter, Navigate } from "react-router-dom";

import LoginPage from "@/features/authentication/pages/LoginPage";
import MainLayout from "@/layouts/MainLayout";
import DashboardPage from "@/features/dashboard/pages/DashboardPage";
import TextInspectionPage from "@/features/workspace/text/TextInspectionPage";
import GraphicsInspectionPage from "@/features/workspace/graphics/GraphicsInspectionPage";
import SpellingInspectionPage from "@/features/workspace/spelling/SpellingInspectionPage";
import BrailleInspectionPage from "@/features/workspace/braille/BrailleInspectionPage";
import BarcodeInspectionPage from "@/features/workspace/barcode/BarcodeInspectionPage";
import NotesInspectionPage from "@/features/workspace/notes/NotesInspectionPage";
import WorkspacePage from "@/features/workspace/WorkspacePage";
import DifferenceListPage from "@/features/workspace/components/DifferenceListPage";
import InspectionResultPage from "@/features/workspace/components/InspectionResultPage";
import ProfilePage from "@/features/profile/pages/ProfilePage";
import AdminPage from "@/features/admin/pages/AdminPage";
import SystemSetupPage from "@/features/admin/pages/SystemSetupPage";
import UserManagementPage from "@/features/admin/pages/UserManagementPage";
import LoggedInUsersPage from "@/features/admin/pages/LoggedInUsersPage";
import AuditTrailPage from "@/features/admin/pages/AuditTrailPage";
import LevelsCommentsPage from "@/features/admin/pages/LevelsCommentsPage";
import UserDictionaryPage from "@/features/admin/pages/UserDictionaryPage";
import ProfilesPage from "@/features/admin/pages/ProfilesPage";
import ProtectedRoute from "@/routes/ProtectedRoute";
import AdminRoute from "@/routes/AdminRoute";
import PublicRoute from "@/routes/PublicRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />,
  },
  {
    path: "/login",
    element: (
      <PublicRoute>
        <LoginPage />
      </PublicRoute>
    ),
  },
  {
    path: "/dashboard",
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
    ],
  },
  {
    path: "/profile",
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <ProfilePage />,
      },
    ],
  },
  {
    path: "/admin",
    element: (
      <AdminRoute>
        <MainLayout />
      </AdminRoute>
    ),
    children: [
      {
        index: true,
        element: <AdminPage />,
      },
    ],
  },
  {
    path: "/settings",
    element: (
      <AdminRoute>
        <MainLayout />
      </AdminRoute>
    ),
    children: [
      { index: true, element: <SystemSetupPage /> },
      { path: "system", element: <SystemSetupPage /> },
      { path: "users", element: <UserManagementPage /> },
      { path: "logged-in-users", element: <LoggedInUsersPage /> },
      { path: "audit-trail", element: <AuditTrailPage /> },
      { path: "levels-comments", element: <LevelsCommentsPage /> },
      { path: "user-dictionary", element: <UserDictionaryPage /> },
      { path: "profiles/text", element: <ProfilesPage type="text" /> },
      { path: "profiles/graphics", element: <ProfilesPage type="graphics" /> },
      { path: "profiles/barcode", element: <ProfilesPage type="barcode" /> },
    ],
  },
  {
    path: "/workspace",
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: "text/upload",
        element: <TextInspectionPage />,
      },
      {
        path: "graphics",
        element: <GraphicsInspectionPage />,
      },
      {
        path: "spelling",
        element: <SpellingInspectionPage />,
      },
      {
        path: "braille",
        element: <BrailleInspectionPage />,
      },
      {
        path: "barcode",
        element: <BarcodeInspectionPage />,
      },
      {
        path: "notes",
        element: <NotesInspectionPage />,
      },
      {
        path: ":inspectionType",
        element: <WorkspacePage />,
      },
    ],
  },
  {
    path: "/inspection-result",
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: ":inspectionId",
        element: <InspectionResultPage />,
      },
    ],
  },
  {
    path: "/inspection/differences",
    element: (
      <ProtectedRoute>
        <DifferenceListPage />
      </ProtectedRoute>
    ),
  },
]);
