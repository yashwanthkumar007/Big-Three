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
import ProtectedRoute from "@/routes/ProtectedRoute";
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
]);