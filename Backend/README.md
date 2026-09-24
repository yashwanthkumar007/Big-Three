# MedInspect AI — Backend

Flask + Python backend for the **MedInspect AI Text Inspection** platform. It exposes the
REST API consumed by the React frontend, runs the PDF comparison engine (PyMuPDF, with
optional Azure AI Document Intelligence gap-fill and Tesseract OCR fallback), persists
metadata in **Azure Cosmos DB** and binary artifacts in **Azure Blob Storage** (both
reached through an **Azure API Management (APIM)** gateway), and additionally handles
authentication and session management, email verification, PDF report emailing, the
audit trail, and administrator-configurable Setup Levels & Comments.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Quick Start](#3-quick-start)
4. [Environment Variables](#4-environment-variables)
5. [Complete File Structure](#5-complete-file-structure)
6. [File-by-File Explanation](#6-file-by-file-explanation)
7. [REST API Reference](#7-rest-api-reference)
8. [Data Model & Cosmos Containers](#8-data-model--cosmos-containers)
9. [Inspection Registry (Adding a New Inspection Type)](#9-inspection-registry-adding-a-new-inspection-type)
10. [Text Inspection Pipeline — How It Works](#10-text-inspection-pipeline--how-it-works)
11. [Email, Verification & Audit](#11-email-verification--audit)
12. [Testing](#12-testing)
13. [Known Limitations](#13-known-limitations)
14. [Runtime-Generated Artifacts](#14-runtime-generated-artifacts)

---

## 1. Overview

The backend has **three entry points**:

| Entry point | Purpose |
|-------------|---------|
| `web_app.py` | The production surface — the Flask HTTP server implementing the whole REST API, serving rendered inspection page images under `/images/...`, and rendering the email-verification landing pages. |
| `application.py` | Offline CLI — run a Master/Sample comparison and write CSV reports to disk. No web server, no database. |
| `seed_users.py` | One-off provisioning script — inserts the two default users into Cosmos DB. |

The single-sentence summary of what the web app does:
**upload two PDFs → extract text/spans → match blocks → run checkers → render annotated
page images → return findings as JSON → persist inspection + audit records.**

Design principles that show up everywhere in this codebase:

- **No hard-coded secrets.** Every credential comes from the environment; `src/config.py`
  loads `Backend/.env` at import time without any third-party dependency.
- **One client per process.** Cosmos/Blob clients are created once and reused, never
  per-request.
- **Master is the source of truth.** Every checker compares Sample against Master.
- **Detection logic is separated from transport.** Checkers/pipelines know nothing about
  Flask; `web_app.py` knows nothing about PDF geometry.
- **The registry is the only switch.** Which pipeline runs for a given `inspection_type`
  is decided in exactly one file (`src/inspection_registry.py`).

---

## 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| Web framework | Flask (Python 3.11) |
| PDF parsing / rendering | PyMuPDF (`fitz`) |
| OCR fallback | Tesseract via `pytesseract` (opt-in) |
| Azure AI | Azure AI Document Intelligence (opt-in gap-fill) |
| Numerics / imaging | NumPy, SciPy, scikit-image, OpenCV, Pillow |
| Data / tabular | pandas, openpyxl |
| Fuzzy text matching | RapidFuzz, `difflib.SequenceMatcher` |
| Cloud persistence | `azure-cosmos`, `azure-storage-blob`, `azure-identity` |
| Transport | `requests` (APIM REST) + Azure SDK fallback |
| Password hashing | `werkzeug.security` (scrypt / pbkdf2) |
| Email | Python standard library `smtplib` (SMTP, TLS/STARTTLS) |
| Testing | `unittest` (pytest-compatible) |

Dependencies are declared in `requirements.txt`; package metadata for `pip install -e .`
lives in `setup.py`.

---

## 3. Quick Start

### 3.1 Prerequisites

- **Python 3.11+**
- Network access to the APIM gateway host used by `AZURE_COSMOS_API_BASE_URL`
- (Optional) The **Tesseract** binary on `PATH` — only needed for the OCR fallback;
  set `TESSERACT_CMD` if it is installed somewhere unusual
- (Optional) Outbound **TCP 587 / 465** to your SMTP host — only needed to send
  verification and report emails

### 3.2 Install

```powershell
cd "Text Inspection full stack\Backend"

python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

### 3.3 Configure

```powershell
Copy-Item .env.example .env
# then edit .env and fill in the Azure APIM URLs/keys and the SMTP settings
```

See [§4 Environment Variables](#4-environment-variables) for the full list. `.env` is
git-ignored; `.env.example` is the committed template.

### 3.4 Seed the default users (first run only)

```powershell
python seed_users.py
```

### 3.5 Run the API server

```powershell
python web_app.py
# -> http://127.0.0.1:5000
```

Verify it is alive:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

### 3.6 Run the offline CLI instead (no server, no database)

```powershell
python application.py --master "Data\Master\file.pdf" --sample "Data\Sample\file.pdf"
```

### 3.7 Run the tests

```powershell
python -m unittest discover -s tests -v
# or
python -m pytest tests -v
```

---

## 4. Environment Variables

All configuration is read from the process environment. `.env` files are loaded
automatically at import time by `src/config.py` and `src/email_service.py` through a tiny
built-in loader (`_load_local_dotenv()`), so `python-dotenv` is **not** a dependency.
Candidate paths, in order: `src/.env` → `Backend/.env` → `./.env`. Because the loader uses
`os.environ.setdefault`, **real environment variables always win** over the file.

### 4.1 Azure / APIM

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AZURE_COSMOS_API_BASE_URL` | ✅ | — | Cosmos REST base, e.g. `https://<apim>.azure-api.net/cosmos/docs`. Alias: `AZURE_COSMOS_ENDPOINT`. |
| `AZURE_COSMOS_SUBSCRIPTION_KEY` | ✅ | — | APIM `Ocp-Apim-Subscription-Key` for Cosmos. Alias: `AZURE_COSMOS_ACCOUNT_KEY`. |
| `AZURE_COSMOS_DATABASE_NAME` | — | `medinspect-app-db` | Application database. |
| `AZURE_COSMOS_RESULTS_DATABASE_NAME` | — | `medinspect-results-db` | Results database. |
| `AZURE_STORAGE_API_BASE_URL` | ✅ | — | Storage REST template containing the `{custom_folder_name}` and `{file_name}` placeholders. Alias: `AZURE_STORAGE_ENDPOINT`. |
| `AZURE_STORAGE_SUBSCRIPTION_KEY` | ✅ | — | APIM key for Blob Storage. |
| `AZURE_STORAGE_ACCOUNT_NAME` | — | `""` | Storage account name — used to synthesise a direct `blob.core.windows.net` endpoint when no APIM URL is set. |
| `AZURE_STORAGE_CONTAINER_PREFIX` | — | `medinspect` | Prefix for blob container names. |
| `AZURE_STORAGE_ENDPOINT_SUFFIX` | — | `core.windows.net` | Sovereign-cloud suffix override. |
| `AZURE_MANAGED_IDENTITY_CLIENT_ID` | — | — | If set, `DefaultAzureCredential` is scoped to this user-assigned identity. |

The sentinel value `<set-me>` is treated as "not configured" by
`AzureSettings.has_secret_values()`, so a half-filled template fails loudly instead of
silently using a bogus key.

### 4.2 Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | — | `5000` | HTTP port bound by `web_app.py`. |
| `FLASK_DEBUG` | — | `false` | Enables Flask debug/reload. Never enable in production. |
| `APP_BASE_URL` | — | request origin | Base URL used to build the verification links inside emails. |

### 4.3 Email (SMTP)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_HOST` | ✅ | — | SMTP host, e.g. `smtp.gmail.com`. |
| `EMAIL_PORT` | — | `587` | `465` ⇒ implicit TLS (`SMTP_SSL`); anything else ⇒ `SMTP` + `STARTTLS` when `EMAIL_USE_TLS` is true. |
| `EMAIL_USER` | ✅ | — | SMTP username. |
| `EMAIL_PASSWORD` | ✅ | — | SMTP password / **app password**. Prefer a provider app password over the account password. |
| `EMAIL_FROM` | — | `EMAIL_USER` | From address. |
| `EMAIL_FROM_NAME` | — | `MedInspect` | Display name on the From header. |
| `EMAIL_USE_TLS` | — | `true` | `1/true/yes/on` enables STARTTLS. |

### 4.4 Verification tokens

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | — | `24` | Verification token lifetime in hours. |
| `EMAIL_VERIFICATION_RESEND_COOLDOWN` | — | `60` | Minimum seconds between verification emails for the same user (anti-flood). |

### 4.5 Pipeline feature flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENABLE_DI_GAPFILL` | — | `false` | Enable Azure AI Document Intelligence gap-fill for vector-outlined text PyMuPDF cannot see. |
| `DOC_INTEL_ENDPOINT` | — | — | Required only when `ENABLE_DI_GAPFILL=true`. |
| `DOC_INTEL_KEY` | — | — | Required only when `ENABLE_DI_GAPFILL=true`. |
| `TESSERACT_CMD` | — | `PATH` lookup | Explicit path to the Tesseract executable. |

---


## 5. Complete File Structure

```
Backend/
│
├── web_app.py                          # ★ Main Flask REST API server (~2,930 lines)
├── application.py                      # Offline CLI: Master vs Sample -> CSV reports
├── seed_users.py                       # Provisions the two default users in Cosmos DB
├── setup.py                            # setuptools package metadata
├── requirements.txt                    # Python dependencies
├── README.md                           # This file
├── project_structure.MD                # Historical POC layout notes
├── .env                                # Local runtime config (git-ignored, never commit)
├── .env.example                        # Committed template with placeholders
├── .gitignore
│
├── src/                                # Application package (all reusable logic)
│   ├── __init__.py
│   ├── config.py                       # Env loading + AzureSettings dataclass
│   ├── azure_service.py                # Cosmos + Blob access via APIM REST (SDK fallback)
│   ├── inspection_registry.py          # Maps inspection_type -> pipeline function
│   ├── resource_models.py              # Canonical document models + seed payloads
│   ├── resource_schema.py              # Field validation / normalization per resource
│   ├── password_utils.py               # Werkzeug hash / verify (legacy plaintext upgrade)
│   ├── email_service.py                # SMTP verification + report emails (PDF attached)
│   ├── email_verification_service.py   # Single-use token issue/consume + cooldown
│   ├── audit_constants.py              # Central audit event / module / status strings
│   ├── audit_service.py                # Audit record writer (identity from backend session)
│   ├── difference_comment_service.py   # Per-difference user comments
│   ├── setup_config_service.py         # Admin Setup Levels & Comments configuration
│   ├── logger.py                       # Per-run timestamped file + stderr logging
│   ├── exception.py                    # PipelineException hierarchy
│   ├── utils.py                        # Shared tuning thresholds and weights
│   │
│   ├── database/
│   │   ├── __init__.py                 # Public re-exports of repositories
│   │   └── repositories.py             # Repository layer over azure_service
│   │
│   ├── checkers/                       # One module per inspection rule
│   │   ├── __init__.py
│   │   ├── content.py                  # Change (same place, different wording)
│   │   ├── formatting.py               # Font / Mixed Font / Bold / Italic / Underline / Color
│   │   ├── position.py                 # Location (identical text, moved)
│   │   ├── structure.py                # Deletion / Insertion
│   │   ├── table_structure_v2.py        # Table cell / row structure
│   │   └── whitespace.py               # Case / Hyphen / Space (legacy, disabled by default)
│   │
│   ├── components/                     # Reusable engine parts
│   │   ├── matcher.py                  # Block pairing (text + geometry scoring)
│   │   ├── text_comparator.py          # Standalone string/position similarity helpers
│   │   ├── pdf_loader.py               # Thin PyMuPDF open wrapper
│   │   ├── cache/
│   │   │   └── inspection_cache.py     # Disk-backed extraction cache (pickle)
│   │   └── extractors/
│   │       ├── pdf_extractor.py        # PyMuPDF line / span / table extraction
│   │       ├── di_gapfill.py           # Azure AI Document Intelligence gap-fill
│   │       └── ocr_fallback.py         # Tesseract OCR fallback
│   │
│   ├── pipelines/
│   │   ├── __init__.py
│   │   ├── comparison_pipeline.py      # Full Text Inspection orchestration
│   │   ├── report_builder.py           # PDF points -> rendered image pixel coordinates
│   │   └── crop_text_inspection/
│   │       └── crop_text_inspection_pipeline.py   # Region-scoped (Crop Compare) inspection
│   │
│   └── review/
│       ├── __init__.py
│       └── grouping.py                 # Dominant-shift suppression for Location noise
│
├── tests/
│   ├── test_azure_infrastructure.py    # APIM URL/header building + settings loading
│   ├── test_resource_models.py         # Resource model examples and indexes
│   └── test_resource_schema.py         # Payload validation and normalisation
│
├── artifacts/
│   └── logs/                           # One timestamped .log file per process start
│
├── debug_output/                       # debug.py text / gap-fill dumps (dev only)
├── cache/
│   └── extractions/                    # Pickled extraction cache (safe to delete)
├── Data/                               # Sample Master/Sample PDFs for CLI testing
│
└── webapp_uploads/ , webapp_outputs/   # Both live in the repository root, see §14

# Development-only helper scripts (not part of the API surface)
├── debug.py                            # Extraction inspector + debug PNG renderer
├── test_APIM.py                        # Manual APIM connectivity probe
├── test_doc_intel.py                   # Manual Document Intelligence probe
├── test_email.py                       # Manual SMTP send test
├── test_email_services.py              # Reachability probe for email API providers
└── _test_inspections.py                # Hits the running API to exercise endpoints
```

> `webapp_uploads/`, `webapp_outputs/` and `node_modules/` sit at the repository root
> (one level above `Backend/`), because the frontend dev server and the backend share the
> same working directory in development.

---


## 6. File-by-File Explanation

### 6.1 Root-level files

| File | Lines | What it does |
|------|-------|--------------|
| **`web_app.py`** | ~2,930 | The entire REST API surface in one Flask module. Holds the in-memory `SESSION_STORE`, the `@app.before_request` auth guard, every `/api/...` route, the admin CRUD endpoints, the inspection endpoints (full + crop), the PDF/CSV report generators, the email-verification landing-page routes, and the static `/images/<path>` server for rendered page PNGs. Also contains `_get_user_by_id()` (used by every authenticated route) and `_send_verification_email_or_error()`, which turns email failures into friendly 500 JSON. |
| **`application.py`** | 51 | Headless CLI entry point. Parses `--master` / `--sample`, calls `run_text_inspection()`, then `save_report()` to write CSV output. Contains **no** Flask, Cosmos or email code — useful for isolating pipeline bugs from infrastructure bugs. |
| **`seed_users.py`** | 113 | Idempotent provisioning script. Inserts `admin@viatris.com` (Administrator) and `user@viatris.com` (User) into the `users` container with **hashed** passwords via `src.password_utils.hash_password`. Safe to re-run; it upserts by id. |
| **`setup.py`** | 16 | `setuptools` metadata (`globalvision-replace`, v0.1.0) so the project can be installed with `pip install -e .`. |
| **`requirements.txt`** | 14 | Runtime dependencies: `opencv-python`, `numpy`, `scikit-image`, `PyMuPDF`, `matplotlib`, `pandas`, `openpyxl`, `rapidfuzz`, `Pillow`, `scipy`, `pytesseract`, `azure-cosmos`, `azure-storage-blob`, `azure-identity`. |
| **`.env`** | 29 | **Local only, never committed.** Real APIM URLs/keys, SMTP credentials, `APP_BASE_URL` and feature flags. Read at import time by `src/config.py` and `src/email_service.py`. |
| **`.env.example`** | 14 | Committed template with placeholders (`<set-at-deployment-time>`) documenting every Azure variable. Copy to `.env` to start. |
| **`project_structure.MD`** | — | Historical POC layout notes from the first iteration. Superseded by this README; kept for context only. |


### 6.2 `src/` — core modules

| File | Lines | What it does |
|------|-------|--------------|
| **`src/__init__.py`** | 0 | Marks `src` as a package. |
| **`src/config.py`** | 117 | Owns all Azure configuration. Defines `_load_local_dotenv()` (import-time `.env` reader using `os.environ.setdefault`, so real environment variables win), the frozen `AzureSettings` dataclass (with derived `cosmos_endpoint` / `storage_endpoint` properties and `has_secret_values()`), `get_azure_settings()` and `get_azure_env_overrides()`. Accepts legacy aliases (`AZURE_COSMOS_ENDPOINT`, `AZURE_COSMOS_ACCOUNT_KEY`, `AZURE_STORAGE_ENDPOINT`, …) so older deployments keep working. |
| **`src/azure_service.py`** | 322 | **The only module that talks to Azure.** Builds APIM URLs (`_get_cosmos_url`, `_get_storage_url`) and headers (`_get_subscription_headers` adds `Ocp-Apim-Subscription-Key`, plus `x-ms-date` / `x-ms-version` for the Cosmos SQL REST API and `x-ms-documentdb-partitionkey` when a partition key is supplied — a missing `x-ms-version` is a classic cause of APIM 400s). Public API: `cosmos_upsert_document`, `cosmos_read_document`, `cosmos_get_document`, `cosmos_query_documents`, `cosmos_delete_document`, `blob_upload_blob`, `blob_download_blob`, `blob_delete_blob`. `_request_with_apim_fallback()` retries once with `verify=False` on `SSLError` to survive corporate TLS-inspection proxies. A `DefaultAzureCredential` path supports managed-identity / direct-SDK deployments. |
| **`src/inspection_registry.py`** | 96 | The single dispatch table. `_INSPECTION_REGISTRY` maps `"text"` → `InspectionConfig(pipeline=run_text_inspection, label="Text Inspection")`. `get_inspection_config(type)` falls back to `"text"` for `None` and raises `ValueError` (listing available types) for anything unknown; `get_available_inspection_types()` enumerates them. Adding an inspection type = adding one dict entry. |
| **`src/resource_models.py`** | 195 | Canonical document models for each Cosmos resource (`users`, `projects`, `documents`, `results`, …): `resource`, `description`, `key_fields`, declared `indexes`, and a realistic `example` document. `get_resource_model()` / `get_seed_payload()` (deep-copy + injected id) back the admin CRUD API and the unit tests. |
| **`src/resource_schema.py`** | 198 | Validation and normalization for the same resources: per-resource `required` / `optional` field lists plus a `types` map. `normalize_resource_payload()` coerces types, stamps `createdAt`/`updatedAt` and generates ids; `validate_resource_payload()` raises `ValueError` naming the offending field. Admin create/update routes use these so a malformed document can never reach Cosmos. |
| **`src/password_utils.py`** | 46 | `hash_password()` (werkzeug `generate_password_hash`), `is_password_hashed()` (prefix sniff on `pbkdf2:` / `scrypt:`) and `verify_password()` → `(ok, needs_rehash)`. The `needs_rehash=True` flag lets login transparently upgrade **legacy plaintext** passwords to hashes on the first successful sign-in. |



| **`src/email_service.py`** | 325 | SMTP-only email delivery. Helpers: `_load_local_dotenv()`, `_get_env_bool()`, `_smtp_settings()` (reads `EMAIL_*`, raising `ValueError` that names only the missing **variables** — never echoing secrets), `_deliver_via_smtp()` (**port 465 → `SMTP_SSL`; anything else → `SMTP` + optional STARTTLS**, 30-second timeout), and body builders (`_build_verification_text_body`, `_build_verification_html_body`, `_build_inspection_report_text_body`, `_build_inspection_report_html_body`). Two public functions: `send_email_verification_email(...)` and `send_inspection_report_email(...)`, the latter attaching the PDF as `application/pdf` inside a `multipart/mixed` message. Errors are logged through `src.logger` and re-raised so `web_app.py` can translate them into HTTP responses. |
| **`src/email_verification_service.py`** | 184 | The verification state machine, shared by admin-triggered and self-service verification. Stores `email_verified` (bool) and `emailVerifiedAt` on the user document and keeps tokens in its own `email-verification-tokens` container. Raw tokens are `secrets.token_urlsafe(32)` (~256 bits); **only the SHA-256 hash is persisted**, so the raw token exists solely inside the emailed link. `create_verification()` invalidates all previous unused tokens for that user (only the newest link works) and enforces `RESEND_COOLDOWN_SECONDS`; `consume_verification()` is single-use and enforces `TOKEN_TTL_HOURS`. Users lacking the field are treated as **Unverified** — login behaviour is unchanged. |
| **`src/audit_constants.py`** | 92 | Every audit string in one place: event names (`LOGIN_SUCCESS`, `INSPECTION_COMPLETED`, `DIFFERENCE_COMMENT_ADDED`, `SETUP_LEVELS_UPDATED`, …), module names (`MODULE_TEXT_INSPECTION`, `MODULE_SYSTEM_SETUP`, …), `APPLICATION_MEDINSPECT` and status values (`STATUS_SUCCESS` / `STATUS_FAILED` / `STATUS_WARNING`). Import these instead of typing literals so the audit trail stays consistent and queryable. |
| **`src/audit_service.py`** | 199 | Writes GxP-style audit records into the `audit-logs` Cosmos container. `_get_client_ip()` resolves the caller from `X-Forwarded-For` → `X-Real-Ip` → `remote_addr`. `log_from_authenticated_user(...)` **derives the actor identity from the backend session, never from frontend-supplied values** — that is the entire reason all audit writes are routed through this service. |

### 6.3 Checkers (`src/checkers/`)

| File | Lines | What it does |
|------|-------|--------------|
| **`src/checkers/__init__.py`** | — | Registry loop: runs every registered checker over `matched_pairs` and aggregates findings. `structure.py` is intentionally kept out of this loop (it works on unmatched blocks, see below). |
| **`src/checkers/content.py`** | 29 | **Change** detector. For each Master/Sample pair matched by position/identity, normalises whitespace and reports when wording differs. This is the core "did the text change" check. |
| **`src/checkers/formatting.py`** | ~1,018 | Span-level formatting checks using extractor metadata with Master as truth: **Font Type, Mixed Font, Bold, Italic, Underline, Color**. Uses `difflib.SequenceMatcher` to align text before comparing formatting runs. Only runs on successfully aligned text. |
| **`src/checkers/position.py`** | 49 | **Location** detector. Fires when text is identical but the box moved beyond `POSITION_SHIFT_THRESHOLD` (`src/utils.py`, 0.5 pt scaled). Skips pairs without real page geometry (`has_real_position` fallback) to avoid false shifts. |
| **`src/checkers/structure.py`** | 72 | **Deletion / Insertion** detector. Operates on `unmatched_master` / `unmatched_sample` from `match_blocks()`, not on pairs. Includes narrow line-wrap suppression: an unmatched fragment whose exact text is contained in a same-page matched counterpart is not reported (prevents false Insertion/Deletion from re-wrapped lines). |
| **`src/checkers/table_structure_v2.py`** | 337 | Table-row checker using the PDF's own black-fill rectangles as real cell boundaries (geometry-based, not inferred from colour/spacing). `extract_table_rows()` / `check_table_rows_v2()` accept optional `extra_lines` from DI gap-fill so vector-outlined labels PyMuPDF cannot see are still attached to their row. |
| **`src/checkers/whitespace.py`** | 87 | Legacy whitespace checks (Space / Case / Hyphen family). Currently **disabled** in `comparison_pipeline.py` — kept for reference and possible re-enablement. |

### 6.4 Extraction / matching components (`src/components/`)

| **`src/difference_comment_service.py`** | 97 | Persists per-difference reviewer comments in the `difference-comments` container, keyed `"<inspectionId>__<differenceId>"`, storing `configuredComment` (the admin-configured placeholder such as `Comment1`) next to `userComment`. Enforces `MAX_COMMENT_LENGTH = 500` and logs `DIFFERENCE_COMMENT_ADDED` / `DIFFERENCE_COMMENT_UPDATED`. It **never** mutates the global Setup Levels & Comments configuration. |
| **`src/setup_config_service.py`** | 175 | Reads and writes the administrator Setup Levels & Comments document (`system-settings` container, id `setup-levels-comments`) holding `levels`, `comments`, `version`, `updatedAt` and `updatedBy`. Default Level 1 / Level 2 and Default Comment 1 are **immutable and enforced server-side** no matter what the payload contains. Logs `SETUP_LEVELS_COMMENTS_UPDATED`. This document is the single source of truth for both the Inspection Result UI and the generated PDF report. |

| File | Lines | What it does |
|------|-------|--------------|
| **`src/components/pdf_loader.py`** | 24 | Thin PyMuPDF opener: validates the path, opens the document, raises `PDFLoadError` on failure. Keeps open/close logic in one place. |
| **`src/components/extractors/pdf_extractor.py`** | 410 | Primary extractor. `extract_lines()` walks every page's text layer producing line records: text, page number, PDF-point bbox, span formatting (font/bold/italic/underline/colour). Source of the `has_real_position` flag consumed by `position.py`. |
| **`src/components/extractors/di_gapfill.py`** | 195 | Optional Azure AI Document Intelligence gap-fill (`ENABLE_DI_GAPFILL`). Recovers vector-outlined labels PyMuPDF has zero record of (overlap check prevents duplicates) and feeds them to `table_structure_v2.py` as `extra_lines`. |
| **`src/components/extractors/ocr_fallback.py`** | 173 | Optional Tesseract OCR fallback for scanned pages with no live text layer. Rasterises at `DEFAULT_DPI` and merges recognised lines; findings carry `source: ocr_fallback`. |
| **`src/components/cache/inspection_cache.py`** | — | Disk-backed, fingerprint-validated cache (`Backend/cache/extractions/`, plain pickles). Fingerprint = absolute path + size + mtime; kinds are `lines` (extracted DataFrame) and `table_rows_<page>`. Any cache failure degrades to "cache empty" — extraction correctness is never affected. |
| **`src/components/matcher.py`** | 365 | `match_blocks()` pairs Master lines to Sample lines using the combined score `0.7 × text similarity + 0.3 × position similarity` (`TEXT_WEIGHT`/`POSITION_WEIGHT`, `MATCH_SCORE_THRESHOLD = 0.3`, `POSITION_MAX_DISTANCE = 600` from `src/utils.py`). Returns `matched_pairs` plus `unmatched_master` / `unmatched_sample`. |
| **`src/components/text_comparator.py`** | 147 | Low-level string comparison helpers (normalisation, similarity scoring) shared by the matcher and the content checker. |

### 6.5 Pipelines and report (`src/pipelines/`, `src/review/`)


| File | Lines | What it does |
|------|-------|--------------|
| **`src/pipelines/__init__.py`** | 0 | Package marker. |
| **`src/pipelines/comparison_pipeline.py`** | 605 | `run_text_inspection(master_path, sample_path, filters=None)` — the single real entry point for a full Text Inspection: extraction → matching → checkers → Location grouping → combined findings. Enabled detections: Change, Deletion, Insertion, Location, formatting family (Font/Bold/Italic/Underline/Colour), table rows. Legacy Case/Hyphen/Space detections are disabled here. Master is the source of truth. |
| **`src/pipelines/crop_text_inspection/crop_text_inspection_pipeline.py`** | 217 | Same text-inspection logic scoped to one user-selected region of one page, for speed. **Imports from (never edits)** the shared modules; reimplements the sequence on filtered lines instead of running full-page then filtering. Powers `POST /api/crop_inspect`. |
| **`src/pipelines/report_builder.py`** | 118 | Bridges pipeline findings (PDF-point coordinates) to the web frontend (pixel-space coordinates matching a rendered image at `REPORT_DPI = 150`). Renders pages in parallel (`ThreadPoolExecutor`, one `fitz` Document per thread) and passes the `source` field (`pymupdf` / `doc_intelligence` / `ocr_fallback`) through to every finding. |
| **`src/review/__init__.py`** | 0 | Package marker. |
| **`src/review/grouping.py`** | 95 | `group_location_findings()`. Suppresses the **dominant shift** (the displacement shared by the most elements — a global page realignment from a different export/crop offset, not a defect) entirely, using 5 pt buckets tolerant to font-metric noise. Only shifts that **deviate** from the dominant pattern are reported as genuine Location findings. |

### 6.6 Database layer (`src/database/`)

| File | Lines | What it does |
|------|-------|--------------|
| **`src/database/__init__.py`** | 41 | Public facade: re-exports every repository plus `get_repository()` so callers write `from src.database import UserRepository`. Documents the logical containers and the two roles (`user`, `administrator`). |
| **`src/database/repositories.py`** | 171 | Thin repository classes over `src.azure_service` (shared singleton per container via `get_repository()`; unknown names raise `RepositoryError`). Declares the `CONTAINERS` map and `BLOB_FOLDERS` (blob paths always embed their folder so identifiers cannot collide). |

### 6.7 Tests (`tests/`)

| File | Lines | What it does |
|------|-------|--------------|
| **`tests/test_azure_infrastructure.py`** | 68 | Verifies APIM URL construction, subscription-header building, and settings loading with demo keys — no live Azure needed. |
| **`tests/test_resource_models.py`** | 16 | Verifies resource-model examples and index declarations. |
| **`tests/test_resource_schema.py`** | 57 | Verifies payload validation and normalisation (required fields, type coercion, id/timestamp stamping). |

---

| **`src/logger.py`** | 36 | Builds the process-wide `logger` (`"GlobalVisionReplace"`): a timestamped `artifacts/logs/%Y-%m-%d_%H-%M-%S.log` file handler **plus** a `stderr` console handler, both at INFO. Built at import time, hence **one log file per process start**. |
| **`src/exception.py`** | 41 | `PipelineException` captures the originating **file name and line number** from `sys.exc_info()` and prints them in `__str__`; subclasses are `PDFLoadError`, `ExtractionError`, `ComparisonError`. Gives pipeline failures diagnosable context and feeds the future audit trail. |

## 7. REST API Reference

Authentication: all `/api/...` routes except `/api/health`, `/api/azure/health`,
`POST /api/auth/login` and `GET /verify-email/<token>` require a session token in the
`Authorization: Bearer <token>` header (checked by `@app.before_request` via
`_get_user_by_id()`). Administrator-only routes additionally require
`accountType == "Administrator"`.

### 7.1 Health & generic resources

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `GET /` | — | Serves the legacy single-file inspection UI embedded in `web_app.py` (includes Crop Compare). |
| `GET /api/health` | — | Liveness probe (`{"status": "ok", ...}`). |
| `GET /api/azure/health` | — | Azure/APIM reachability probe (safe — reports configured/not-configured, no secrets). |
| `GET /api/<resource>` | token | List documents of a whitelisted resource (`ALLOWED_RESOURCE_TYPES`). |
| `POST /api/<resource>` | token | Create a document (payload validated via `resource_schema`). |
| `GET /api/<resource>/<id>` | token | Read one document. |
| `PUT /api/<resource>/<id>` | token | Update one document (validated). |
| `DELETE /api/<resource>/<id>` | token | Delete one document. |

### 7.2 Auth, sessions & current user

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `POST /api/auth/login` | — | Validates credentials against the `users` container (`password_utils.verify_password`, transparent legacy-plaintext upgrade), creates a session, writes `LOGIN_SUCCESS` / `LOGIN_FAILED` audit. |
| `POST /api/auth/logout` | token | Deletes the **current** session. |
| `GET /api/sessions` | admin | Lists active login sessions. |
| `DELETE /api/sessions/<id>` | admin | Terminates another user's session. |
| `GET /api/users/me` | token | Returns the caller's profile from Cosmos DB. |
| `PUT /api/users/me/password` | token | Changes the caller's password (verifies current, hashes new). |
| `PUT /api/users/me/preferences` | token | Updates the caller's preferences. |

### 7.3 Email verification

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `POST /api/users/<id>/send-verification` | token (self or admin) | `_send_verification_email_or_error()`: enforces resend cooldown, creates a token, builds `{APP_BASE_URL}/verify-email/<token>`, sends mail, returns friendly 500 JSON on SMTP failure. |
| `GET /verify-email/<token>` | — | Consumes the token (single-use, TTL-checked) and renders a success/expired/invalid landing page while flipping `email_verified`. |
| `GET /api/users/me/verification-status` | token | Lightweight `{verified, email}` check for the Profile page. |

### 7.4 Inspections & files

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `POST /api/upload` | token | Stores Master/Sample PDFs under `webapp_uploads/<session_id>/` (also mirrored to Blob Storage). |
| `POST /api/inspect` | token | Runs the registered pipeline for `inspection_type` (registry lookup), renders annotated PNGs to `webapp_outputs/<session_id>/`, persists the `inspections` document, writes `INSPECTION_COMPLETED` audit. |
| `GET /api/inspections` | token | Lists the caller's inspections. |
| `POST /api/inspections` | token | Creates an inspection record. |
| `GET /api/inspections/<id>` | token (owner) | Retrieves one inspection. |
| `DELETE /api/inspections/<id>` | token (owner) | Deletes one inspection. |
| `GET /api/inspections/<id>/file` | token (owner) | Streams the Master/Sample file. |
| `GET /api/inspections/<id>/comments` | token (owner) | Returns persisted per-difference user comments. |
| `PUT /api/inspections/<id>/differences/<n>/comment` | token (owner) | Persists a reviewer comment (`difference-comments` container, ≤500 chars; never touches global setup config). |
| `POST /api/inspection/share` | token | Emails the PDF report as an attachment via `send_inspection_report_email()`. |
| `POST /api/crop_inspect` | token | Runs the crop-scoped pipeline on a user-selected region (fast path reusing the extraction cache). |
| `GET /api/crop_logs/<session_id>` | token | Lists per-session crop query CSVs, newest first. |
| `POST /api/storage/upload` | token | Direct Blob Storage upload (`folder_name` + file). |
| `GET /api/storage/download` | token | Direct Blob Storage download. |
| `GET /images/<session_id>/<file>` | — | Static server for rendered page PNGs consumed by the frontend viewer. |

### 7.5 Setup, audit & system

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `GET /api/settings/system-information` | token | App info shown on the System Setup page. |
| `GET /api/setup/levels-comments` | token | Current Setup Levels & Comments config (source of truth for result UI + PDF report). |
| `PUT /api/setup/levels-comments` | admin | Updates setup config; Level 1 / Level 2 and Default Comment 1 are immutable and enforced server-side. |
| `GET /api/audit-logs` | admin | Paginated + filtered audit log retrieval. |
| `GET /api/audit-logs/<id>` | admin | Single audit record. |
| `POST /api/audit/events` | token | Records a frontend-initiated activity event (actor taken from the session). |

---

| **`src/utils.py`** | 21 | Pipeline tuning constants: `MATCH_SCORE_THRESHOLD = 0.3` (below this a block counts as "no match" → Missing/Extra), `POSITION_MAX_DISTANCE = 600`, `TEXT_WEIGHT = 0.7` and `POSITION_WEIGHT = 0.3` (combined score = 0.7·text + 0.3·position), `POSITION_SHIFT_THRESHOLD = 0.5`, `DEFAULT_DPI = 150`. |

### 6.3 `src/database/` — repository layer
## 7. REST API Reference

Authentication: all `/api/...` routes except `/api/health`, `/api/azure/health`,
`POST /api/auth/login` and `GET /verify-email/<token>` require a session token in the
`Authorization: Bearer <token>` header (checked by `@app.before_request` via
`_get_user_by_id()`). Administrator-only routes additionally require
`accountType == "Administrator"`.

### 7.1 Health & generic resources

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `GET /` | — | Serves the legacy single-file inspection UI embedded in `web_app.py` (includes Crop Compare). |
| `GET /api/health` | — | Liveness probe (`{"status": "ok", ...}`). |
| `GET /api/azure/health` | — | Azure/APIM reachability probe (reports configured/not-configured, no secrets). |
| `GET /api/<resource>` | token | List documents of a whitelisted resource (`ALLOWED_RESOURCE_TYPES`). |
| `POST /api/<resource>` | token | Create a document (payload validated via `resource_schema`). |
| `GET /api/<resource>/<id>` | token | Read one document. |
| `PUT /api/<resource>/<id>` | token | Update one document (validated). |
| `DELETE /api/<resource>/<id>` | token | Delete one document. |

### 7.2 Auth, sessions & current user

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `POST /api/auth/login` | — | Validates credentials (`password_utils.verify_password`, transparent legacy-plaintext upgrade), creates a session, writes `LOGIN_SUCCESS` / `LOGIN_FAILED` audit. |
| `POST /api/auth/logout` | token | Deletes the **current** session. |
| `GET /api/sessions` | admin | Lists active login sessions. |
| `DELETE /api/sessions/<id>` | admin | Terminates another user's session. |
| `GET /api/users/me` | token | Returns the caller's profile from Cosmos DB. |
| `PUT /api/users/me/password` | token | Changes the caller's password (verifies current, hashes new). |
| `PUT /api/users/me/preferences` | token | Updates the caller's preferences. |

### 7.3 Email verification

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `POST /api/users/<id>/send-verification` | token (self or admin) | Cooldown check, token creation, `{APP_BASE_URL}/verify-email/<token>` mail send; friendly 500 JSON on SMTP failure. |
| `GET /verify-email/<token>` | — | Consumes the token (single-use, TTL-checked), renders success/expired/invalid page, flips `email_verified`. |
| `GET /api/users/me/verification-status` | token | Lightweight `{verified, email}` check for the Profile page. |


| File | Lines | What it does |
|------|-------|--------------|
| **`src/database/__init__.py`** | 41 | Public façade. Re-exports `AuditRepository`, `CoordinateRepository`, `DocumentRepository`, `InspectionRepository`, `ProjectRepository`, `ResultRepository`, `ReviewStatusRepository`, `UserRepository`, `ViolationRepository`, `RepositoryError` and the `get_repository()` factory, so callers write `from src.database import UserRepository` instead of reaching into the submodule. |

### 7.4 Inspections & files

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `POST /api/upload` | token | Stores Master/Sample PDFs under `webapp_uploads/<session_id>/` (also mirrored to Blob Storage). |
| `POST /api/inspect` | token | Runs the registered pipeline for `inspection_type`, renders annotated PNGs to `webapp_outputs/<session_id>/`, persists the `inspections` document, writes `INSPECTION_COMPLETED` audit. |
| `GET /api/inspections` | token | Lists the caller's inspections. |
| `POST /api/inspections` | token | Creates an inspection record. |
| `GET /api/inspections/<id>` | token (owner) | Retrieves one inspection. |
| `DELETE /api/inspections/<id>` | token (owner) | Deletes one inspection. |
| `GET /api/inspections/<id>/file` | token (owner) | Streams the Master/Sample file. |
| `GET /api/inspections/<id>/comments` | token (owner) | Returns persisted per-difference user comments. |
| `PUT /api/inspections/<id>/differences/<n>/comment` | token (owner) | Persists a reviewer comment (`difference-comments`, max 500 chars; never touches global setup config). |
| `POST /api/inspection/share` | token | Emails the PDF report as an attachment via `send_inspection_report_email()`. |
| `POST /api/crop_inspect` | token | Crop-scoped pipeline on a user-selected region (fast path reusing the extraction cache). |
| `GET /api/crop_logs/<session_id>` | token | Lists per-session crop query CSVs, newest first. |
| `POST /api/storage/upload` | token | Direct Blob Storage upload (`folder_name` + file). |
| `GET /api/storage/download` | token | Direct Blob Storage download. |
| `GET /images/<session_id>/<file>` | — | Static server for rendered page PNGs consumed by the frontend viewer. |

### 7.5 Setup, audit & system

| Method & path | Auth | What it does |
|---------------|------|--------------|
| `GET /api/settings/system-information` | token | App info shown on the System Setup page. |
| `GET /api/setup/levels-comments` | token | Current Setup Levels & Comments config (truth for result UI + PDF report). |
| `PUT /api/setup/levels-comments` | admin | Updates setup config; Level 1/2 and Default Comment 1 are immutable server-side. |
| `GET /api/audit-logs` | admin | Paginated + filtered audit log retrieval. |
| `GET /api/audit-logs/<id>` | admin | Single audit record. |
| `POST /api/audit/events` | token | Records a frontend-initiated activity event (actor taken from the session). |


## 8. Data Model & Cosmos Containers

Logical containers (created lazily by the APIM/SDK layer on first use):

| Container | What lives there |
|-----------|------------------|
| `users` | Users and role assignments (`id`, `username`, `email`, `accountType`, `accountStatus`, `email_verified`, ...). See `resource_models.py` for the canonical example. |
| `email-verification-tokens` | Single-use tokens — **SHA-256 hash only**, plus `userId`, `expiresAt`, `used` flag. |
| `inspections` | One document per run (`INSPECTIONS_CONTAINER` in `web_app.py`): session id, file refs, findings summary, owner, timestamps. |
| `difference-comments` | One document per `(inspectionId, differenceId)`: reviewer comment, original placeholder, updater, timestamp. |
| `system-settings` | System config docs; id `setup-levels-comments` holds the Setup Levels & Comments. |
| `audit-logs` | GxP-style audit records written by `audit_service`. |
| `projects`, `documents`, `results`, `violations`, `coordinates`, `reviewstatus`, `audit` | Repository-layer containers in the `CONTAINERS` map backing the generic `/api/<resource>` CRUD API. |
| `medinspect-app-db` / `medinspect-results-db` | The two Cosmos databases (application vs. results). |

Blob Storage folders (`BLOB_FOLDERS`): `master`, `sample`, `ai`, `documents`,
`rendered-pages`, `difference-images` — identifiers are always embedded in the blob
path to prevent collisions.

---

## 9. Inspection Registry (Adding a New Inspection Type)

`src/inspection_registry.py` is the **only** place that decides which pipeline runs
for a given `inspection_type` from `POST /api/inspect`. Today it holds one entry:

```python
_INSPECTION_REGISTRY = {
    "text": InspectionConfig(pipeline=run_text_inspection, label="Text Inspection"),
}
```

To add a new inspection type:

1. Implement `pipeline(master_path, sample_path, filters=None) -> dict` returning at
   least `{"findings": [...], "match_stats": {...}}` so `build_report` can process it.
2. Add one `_INSPECTION_REGISTRY` entry (e.g. `"barcode": InspectionConfig(...)`).
3. Nothing else changes — `web_app.py` looks the type up and returns HTTP 400 (listing
   available types) for anything unknown. `None` falls back to `"text"`.

---

---

| **`src/database/repositories.py`** | 171 | Thin, reusable repository classes over `src.azure_service`. Declares `VALID_ROLES = ("user", "administrator")`, the `CONTAINERS` map (`users`, `projects`, `documents`, `inspections`, `results`, `violations`, `coordinates`, `reviewstatus`, `audit`) and `BLOB_FOLDERS` (`master`, `sample`, `ai`, `documents`, `rendered-pages`, `difference-images`, …) — blob paths always embed their folder so identifiers can never collide. `RepositoryError` is raised whenever the Cosmos/Blob layer cannot complete an operation. |



### 6.4 `src/checkers/` — one module per inspection rule

Every checker takes the matcher's `matched_pairs` (except `structure.py`, see below) and
returns a list of finding dicts with the common shape
`{page, master, sample, master_bbox, sample_bbox, comment, type}`.
`comment` is the human-readable string shown in the UI and written into the PDF report.

| File | Lines | What it does |
|------|-------|--------------|

### 6.5 `src/components/` — reusable engine parts

| File | Lines | What it does |
|------|-------|--------------|
| **`src/components/pdf_loader.py`** | 28 | `load_pdf(pdf_path)` — the smallest possible PyMuPDF wrapper. Raises `PDFLoadError` when the file is missing or unreadable and logs the page count on success. Kept separate from extraction so the extraction logic is not tied to *how* the file was obtained (local path today, Blob Storage later). |
| **`src/components/matcher.py`** | 365 | **Block matching — the heart of the comparison.** Pairs Master blocks with Sample blocks using a combined score (`0.7 × text similarity + 0.3 × position similarity`) resolved by the **Hungarian algorithm** (`scipy.optimize.linear_sum_assignment`) for a globally optimal assignment rather than greedy matching. Returns `matched_pairs` plus `unmatched_master` / `unmatched_sample`. Position scoring **degrades gracefully**: when either side lacks real page geometry (`has_real_position = False`) it falls back to text-only scoring instead of computing a meaningless synthetic distance. `_is_generic_text()` detects short, digit-heavy strings (codes, dates, IDs) and downsamples text similarity while upsampling position — fixing real crossed pairings such as `1134819`/`3113215` vs `1137986`/`3454894` on a rotated carton side panel. Always runs regardless of which diff filters the user selects, because every checker consumes its output. |
| **`src/components/text_comparator.py`** | 147 | The original standalone comparison helpers: block matching via the same combined-score + Hungarian approach, whitespace normalization (which prevents false positives from tab-vs-space differences, confirmed on leaflet testing) and Location-change detection. `matcher.py` is the version the pipeline uses; this module retains the reference implementation and helpers. |
| **`src/components/cache/inspection_cache.py`** | ~200 | Disk-backed, fingerprint-validated cache so the same PDF is parsed **once** per workflow (initial inspection, then subsequent Crop Compare requests). Entries live in `<Backend>/cache/extractions/` as plain pickles, one per *(pdf fingerprint, payload kind)*. A fingerprint is built from the PDF's absolute path + file size + modification time, so a changed PDF never reads a stale entry. Payload kinds: `"lines"` (the `extract_lines()` DataFrame) and `"table_rows_<page>"` (per-page `extract_table_rows()` output). Sessions map to `webapp_uploads/<session_id>/master.pdf|sample.pdf`, so Master and Sample cache independently. Any read/write failure transparently behaves as a cache miss — extraction correctness is never at risk. |

#### `src/components/extractors/`

| File | Lines | What it does |
|------|-------|--------------|
| **`src/components/extractors/pdf_extractor.py`** | 410 | Primary extraction engine. `extract_lines()` returns a DataFrame with one row per text block carrying `page`, `text`, `bbox`, span-level formatting metadata (font, size, bold/italic/underline, colour) and a `source` tag of `pymupdf`. Also produces the per-page table-row candidate data consumed by `table_structure_v2.py`. |
| **`src/components/extractors/di_gapfill.py`** | 195 | Optional **Azure AI Document Intelligence** gap-fill (enabled with `ENABLE_DI_GAPFILL`). Recovers text PyMuPDF's text layer never saw — typically vector-outlined or rasterized labels. Runs an **overlap check** first so it can only *add* lines that PyMuPDF had zero record of; it can never duplicate or override existing text. Recovered lines are tagged `source = doc_intelligence`. |
| **`src/components/extractors/ocr_fallback.py`** | 173 | Optional **Tesseract OCR** fallback (enabled with `ENABLE_OCR_FALLBACK`) for pages with no usable text layer. Renders the page to an image and OCRs it, tagging results `source = ocr_fallback`, so the UI and CSV can show which engine produced each finding. |

| **`src/checkers/__init__.py`** | 0 | Package marker; the pipeline imports each checker module explicitly. |
| **`src/checkers/content.py`** | 29 | **Change.** Fires when a matched Master/Sample pair occupies the same approximate position (that is *why* the matcher paired them) but the normalized text differs — the core "the wording changed" rule. Exposes `normalize_whitespace()` and `check_change(matched_pairs)`. |
| **`src/checkers/formatting.py`** | 1,018 | **Font Type, Mixed Font, Bold, Italic, Underline, Color.** Operates on span-level formatting metadata produced by `pdf_extractor.py`; Master is the source of truth; only Master/Sample text that aligns successfully is compared. This is the largest checker because each formatting attribute needs its own span-alignment and tolerance logic. |
| **`src/checkers/position.py`** | 49 | **Location.** Fires only when a matched pair's text is **identical** but its position moved beyond `POSITION_SHIFT_THRESHOLD` — if the text also changed, that belongs to *Change*, not here. Skips pairs where either side lacks real page geometry (`has_real_position = False`), because a "shift" would be meaningless and would produce false positives. |
| **`src/checkers/structure.py`** | 72 | **Deletion / Insertion.** Uniquely, these do **not** consume `matched_pairs` — they consume the matcher's `unmatched_master` / `unmatched_sample` lists (a block with no counterpart). Called directly by the pipeline rather than through the registry loop. `check_insertions()` / `check_deletions()` optionally accept `matched_pairs` purely to **suppress** false findings caused by Master/Sample line-wrapping differences (e.g. Master holds one line where Sample wraps the same content across three, producing a stray "56" fragment). The suppression is deliberately narrow: it only fires when the unmatched fragment's exact text already appears inside a matched pair's counterpart text on the same page. |
| **`src/checkers/table_structure_v2.py`** | 337 | **Table structure.** Uses the PDF's own **black-fill rectangles** as true cell boundaries instead of inferring label/value/row structure from text colour and spacing. `extract_table_rows()` and `check_table_rows_v2()` accept optional `extra_lines` (from Doc Intelligence gap-fill) so vector-outlined labels that PyMuPDF's text layer never saw (Vendor Job No., Barcode Information, …) can still be attached to their row. Rectangle detection itself is untouched by gap-fill; the `extra_lines` overlap check guarantees nothing already found can be duplicated or overridden. |
| **`src/checkers/whitespace.py`** | 87 | **Case, Hyphen, Space** — narrow character-pattern rules, each detecting one specific difference rather than a general change (that is *Change*'s job). `check_case()` is deliberately exclusive with Change (it fires only when the strings match case-insensitively but not case-sensitively), so a case-only difference is never reported twice. `check_hyphen()` fires only when the strings match once all hyphens are stripped. **Line Break (Space) is not implemented** — it needs per-line spacing information that block-level extraction discards; deferred and documented as a known gap. |

### 6.6 `src/pipelines/` — orchestration

| File | Lines | What it does |
|------|-------|--------------|
| **`src/pipelines/__init__.py`** | 0 | Package marker. |
| **`src/pipelines/comparison_pipeline.py`** | 605 | **The single real entry point for a Text Inspection run.** Wires extraction → matching → checkers → Location grouping → combined findings. Feature flags at the top control behaviour: `ENABLE_FORMATTING_CHECKERS = False` with individual `ENABLE_FONT_TYPE_CHECKER`, `ENABLE_MIXED_FONT_CHECKER`, `ENABLE_BOLD_CHECKER`, `ENABLE_ITALIC_CHECKER`, `ENABLE_UNDERLINE_CHECKER`, `ENABLE_COLOR_CHECKER` (all `True`); legacy `ENABLE_CASE_CHECKER` / `ENABLE_HYPHEN_CHECKER` / `ENABLE_SPACE_CHECKER` (all `False`); and `ENABLE_DI_GAPFILL = False`. Key functions: `run_text_inspection(master_path, sample_path, filters)` (the registered pipeline; returns `{"findings": [...], "match_stats": {...}}`), `save_report(result, output_dir)` (CSV export), plus helpers `_filter_enabled`, `_findings_for_enabled`, `FINDING_TYPE_TO_FILTER`, `_table_region_bboxes`, `_boxes_overlap`, `_exclude_table_region`, `_get_di_gap_rows`. It also hosts the **crop** entry point `run_crop_text_inspection(master_path, sample_path, page_number, box_px, dpi)` together with `box_px_to_pdf_rect`, `_filter_lines_to_region`, `_filter_table_rows_to_region` and `_row_in_table`. Table regions are excluded from ordinary line comparison so the same text is never reported twice (once as a line change, once as a table-cell change). |
| **`src/pipelines/report_builder.py`** | 118 | The bridge between pipeline findings (**PDF point coordinates**) and the frontend (**pixel coordinates matching a rendered image**); `REPORT_DPI = 150` is the shared scaling convention. Functions: `_scale_bbox`, `render_page`, `fitz_page_count`, `_render_job` and `build_report(master_path, sample_path, result, output_dir, dpi)`. Page rendering is the most expensive step on large artwork PDFs (full-page rasterization + PNG encode), so pages are rendered **in parallel across worker threads** — each task opens its own `fitz` Document, which PyMuPDF permits. Every finding passes through with its `source` field (`pymupdf` / `doc_intelligence` / `ocr_fallback`) intact so the web UI and CSV show which engine detected each piece of text. |
| **`src/pipelines/crop_text_inspection/crop_text_inspection_pipeline.py`** | 217 | **Crop Text Inspection** — runs the *same* text-inspection logic as `comparison_pipeline.py` but scoped to a user-selected region of a single page, for speed. Deliberately a separate file so the existing full-page flow stays untouched; it only **imports** existing modules and reimplements the *sequence* at a smaller scope (filtered lines) rather than running full-page and discarding findings afterwards. Reuses `extract_lines()`, `match_blocks()`, `check_change`/`check_deletions`/`check_insertions`, `check_location()`, `group_location_findings()`, `extract_table_rows()`/`check_table_rows_v2()` and report_builder's DPI↔PDF-point convention. It does **not** call `run_text_inspection()`. |

### 6.7 `src/review/` — Location noise suppression

| File | Lines | What it does |
|------|-------|--------------|
| **`src/review/__init__.py`** | 0 | Package marker. |
| **`src/review/grouping.py`** | 95 | Separates a **genuine, isolated position change** from the noise of a uniform whole-page realignment (a different export/crop offset is not a defect). Redesigned from an earlier version that emitted a summary line ("60 items shifted by X"): the current version suppresses the **dominant shift entirely** — the shift shared by the most elements is almost certainly a global realignment, so it is not reported at all, matching GlobalVision's observed reporting behaviour. Only elements whose shift *deviates* from that dominant pattern surface as real Location findings. Bucket precision was widened from 2 pt to 5 pt because a confirmed real case measured 168.9 / 169.2 / 170.8 / 171.2 — rounding and font-metric noise that split into three buckets and leaked out as false individual findings. Key API: `group_location_findings(location_findings, min_group_size=DOMINANT_SHIFT_MIN_SIZE, suppress_dominant=True)` and the helper `_shift_vector(finding)`. |

### 6.8 `tests/`

Standard-library `unittest` suites, run with `python -m unittest discover -s tests -t .`.

| File | Lines | What it does |
|------|-------|--------------|
| **`tests/test_azure_infrastructure.py`** | 68 | Asserts APIM URL/header construction and settings loading work from environment variables **without hard-coded secrets**. Sets `AZURE_COSMOS_API_BASE_URL` / `AZURE_COSMOS_SUBSCRIPTION_KEY` / `AZURE_STORAGE_*` on `os.environ`, then exercises `_get_cosmos_url`, `_get_subscription_headers` and `normalize_resource_payload`. |
| **`tests/test_resource_models.py`** | 16 | Confirms `users` exposes the expected seed fields and at least one index, and that `get_seed_payload("results", identifier=...)` honours the supplied id. |
| **`tests/test_resource_schema.py`** | 57 | Confirms the `users` schema requires `username` / `email` and that validation accepts a well-formed document while rejecting malformed ones. |

### 6.9 Development-only helper scripts

These live in `Backend/` but are **not** part of the API surface. They are manual probes for
isolating whether a problem is in the pipeline, the network or the credentials.

| File | Lines | What it does |
|------|-------|--------------|
| **`debug.py`** | 146 | Extraction inspector. Given a PDF it reports whether each page has a live text layer, how many lines/words PyMuPDF pulled out, and renders a debug PNG with every extracted line boxed in green. Anything on the artwork with **no** green box is text the pipeline will never see — no matcher improvement can fix that. Usage: `python debug.py "Data/Master/file.pdf" [--page 0] [--dpi 150]`. |
| **`test_APIM.py`** | 41 | Manual connectivity probe for the APIM Cosmos endpoint (DNS, TLS, subscription key, a trivial query). |
| **`test_doc_intel.py`** | 100 | Manual probe for the Azure AI Document Intelligence endpoint and credentials. |
| **`test_email.py`** | 97 | Manual SMTP send test — useful for telling a bad password apart from a blocked port. |
| **`test_email_services.py`** | 45 | Reachability probe for external email API providers over port 443. |
| **`_test_inspections.py`** | 30 | Drives the *running* API to exercise the inspection endpoints end-to-end (login → upload → inspect). |


