# MedInspect AI — Frontend

React + TypeScript single-page application for the **MedInspect AI Text Inspection**
platform. It provides the login screen, dashboard, inspection workspace (Master/Sample
PDF upload, side-by-side viewer, findings review), admin console (users, audit trail,
setup levels, dictionary, system setup), user profile, and client-side PDF report
generation. It talks to the Flask backend over REST (`axios`) and manages auth/session
state with `zustand` + `localStorage`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Quick Start](#3-quick-start)
4. [Environment Variables](#4-environment-variables)
5. [Complete File Structure](#5-complete-file-structure)
6. [File-by-File Explanation](#6-file-by-file-explanation)
7. [Routes & Navigation](#7-routes--navigation)
8. [State, API & Auth Flow](#8-state-api--auth-flow)
9. [Workspace & Inspection Flow](#9-workspace--inspection-flow)
10. [Styling & i18n](#10-styling--i18n)
11. [Build & Lint](#11-build--lint)

---

## 1. Overview

The frontend is a Vite + React 18 SPA with feature-folder organisation:

- **Authentication** — login form, route guards, session token storage.
- **Dashboard** — landing page with inspection-type cards.
- **Workspace** — the core Text Inspection UI: upload Master/Sample, run inspection,
  review differences, view PDFs, generate reports.
- **Admin** — user management, audit trail, setup levels & comments, logged-in users,
  profiles, user dictionary, system setup.
- **Profile** — own account, password change, email verification.
- **Shared** — API clients, config, hooks, utilities, report generator.
- **Layouts / Routes / Store** — app shell, router tables, global upload store.

Design principles:

- **Feature folders.** Each domain (`authentication`, `dashboard`, `workspace`,
  `admin`, `profile`) owns its pages, components, services and API calls.
- **Thin pages, reusable components.** Pages compose feature components; shared UI
  lives under `workspace/components` and `layouts`.
- **Centralised API layer.** All HTTP goes through `shared/api/` (`axios`
  instances with auth headers) — never ad-hoc `fetch`.
- **Token in localStorage.** Backend session token + user object persist across
  reloads; route guards read them.
- **Zustand for upload/inspection state.** The workspace upload store survives
  navigation between workspace sub-pages.

---

## 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| UI framework | React 18 + TypeScript |
| Build / dev server | Vite 8 |
| Routing | `react-router-dom` v7 |
| UI kit | MUI v9 (`@mui/material`, `@mui/icons-material`), Emotion |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` |
| Data fetching | `axios`, `@tanstack/react-query` (+ devtools) |
| State | `zustand` (upload store), localStorage (auth) |
| PDF rendering | `react-pdf`, `konva`, `fabric` |
| PDF generation | `jspdf` + `jspdf-autotable` |
| Animation | `framer-motion`, `lucide-react` icons |
| Dates | `dayjs` |
| i18n | `i18next` + `react-i18next` |
| Lint / format | ESLint, Prettier, `typescript-eslint` |

Declared in `package.json`; exact locked versions in `package-lock.json`.

---

## 3. Quick Start

```bash
cd Frontend
npm install        # install dependencies
npm run dev        # start Vite dev server (http://localhost:5173)
npm run build      # type-check (tsc -b) + production build to dist/
npm run preview    # preview the production build locally
npm run lint       # ESLint over the whole project
```

The dev server proxies `/api/*` to the Flask backend (see `vite.config.ts`
and `.env.development`). The backend must be running (`python web_app.py`
in `Backend/`) for login, inspection and admin calls to work.

---

## 4. Environment Variables

Vite exposes only `VITE_`-prefixed variables (`import.meta.env.*`):

| Variable | File | Purpose |
|----------|------|---------|
| `VITE_API_BASE_URL` | `.env.development` / `.env.production` | Backend base URL the axios clients target (dev points at `http://localhost:5000`, production at the deployed API). |
| `VITE_*` (any other) | — | Add new client-side knobs here; never put secrets in `VITE_` vars — they ship to the browser. |

Backend selection logic lives in `shared/api/*` and `shared/config/inspectionConfig.ts`.

---


```
Frontend/
├── index.html                      # Vite HTML entry; mounts #root, sets title/meta
├── package.json                    # deps + npm scripts (dev/build/preview/lint)
├── package-lock.json               # locked dependency tree
├── vite.config.ts                  # Vite config: React plugin, /api proxy, path alias
├── tsconfig*.json                  # TypeScript project config (tsc -b on build)
├── eslint.config.js                # ESLint flat config
├── .env.development                # dev backend URL (localhost:5000)
├── .env.production                 # production backend URL
└── src/
    ├── main.tsx                    # React bootstrap: providers, router, CSS
    ├── vite-env.d.ts               # Vite client type declarations
    ├── app/
    │   └── App.tsx                 # top-level app shell (renders route tree)
    ├── routes/
    │   ├── index.tsx               # central route table (public/protected/admin)
    │   ├── ProtectedRoute.tsx      # guard: requires auth token
    │   ├── PublicRoute.tsx         # guard: redirects logged-in users away
    │   └── AdminRoute.tsx          # guard: requires administrator role
    ├── layouts/
    │   ├── AuthLayout/             # centered layout for the login screen
    │   ├── DashboardLayout/        # layout for the dashboard landing page
    │   └── MainLayout/             # authenticated app shell (header + outlet)
    │       ├── MainLayout.tsx
    │       ├── Header.tsx          # top nav, user menu, logout
    │       ├── BarcodeIcon.tsx     # custom nav icon
    │       ├── BrailleDotsIcon.tsx # custom nav icon
    │       └── index.ts            # barrel export
    ├── features/
    │   ├── authentication/
    │   │   ├── pages/LoginPage.tsx
    │   │   ├── components/LoginHeader|LoginForm|LoginFooter|SSOButton.tsx
    │   │   ├── routes/authRoutes.tsx
    │   │   ├── services/authservice.ts
    │   │   └── index.ts
    │   ├── dashboard/
    │   │   └── pages/DashboardPage.tsx
    │   ├── workspace/
    │   │   ├── WorkspacePage.tsx
    │   │   ├── text/TextInspectionPage.tsx
    │   │   ├── spelling|barcode|braille|graphics|notes/*InspectionPage.tsx
    │   │   └── components/         # UploadCard, PdfViewer, InspectionResults, ...
    │   ├── admin/
    │   │   ├── pages/              # UserManagement, AuditTrail, LevelsComments, ...
    │   │   ├── components/adminUi.tsx + adminUtils.ts
    │   │   └── systemApi.ts
    │   └── profile/
    │       ├── pages/ProfilePage.tsx
    │       └── profileApi.ts
    ├── shared/
    │   ├── api/inspectionApi.ts    # inspection endpoints client
    │   ├── api/backendCrudApi.ts   # generic resource CRUD client
    │   ├── config/inspectionConfig.ts
    │   ├── hooks/useInspectionLoading.ts + useSetupConfig.ts
    │   └── utils/                  # auth, permissions, fileValidation, ...
    ├── store/
    │   └── uploadStore.ts          # zustand upload/inspection state
    ├── assets/logos/               # Viatris logo, app icon
    └── mocks/                      # local mock fixtures for development
```

---
