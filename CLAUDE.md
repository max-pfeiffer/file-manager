# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A web application providing a user facing frontend for managing files.

### Purpose

This application provides a user facing frontend for managing files.
The user can view, create, update and delete files.
The user can upload and download files.
The user can deal with zip files.
The application is run in a container.
The files which the application manages are persisted in the local filesystem of the container or in a volume mounted by the container.
The user can edit text files.

### Key Consumers

Users can use this frontend application.

### Deployment Environment

The application is running in a Container on Kubernetes.
The Kubernetes cluster is built with Talos Linux.
No cloud provider is used.
The application will run 24/7.
No Kubernetes manifests are included in this project.

### Expected Integrations

- Keycloak as identity provider

### Git Repository

- The git repository for this project is hosted on GitHub: https://github.com/max-pfeiffer/file-manager
- The default branch is main. This branch is protected.
- Features need to be created on branches with feature/\* pattern
- Bug fixes need to be created on branches with bugfix/\* pattern

#### GitHub Workflows

- For git commit messages conventional commits specification is used: https://www.conventionalcommits.org/en/v1.0.0/#specification
- Local pre-commit hooks managed with Husky + lint-staged run on every commit.
- GitHub Actions CI checks (linting, unit tests) run on every pull request: `.github/workflows/ci.yaml`
- A new release on GitHub is created when the main branch is tagged with a semantic version
- Release notes are generated automatically
- When a new release is created by tagging the main branch, the container image is built and pushed to Docker Hub: `.github/workflows/release.yaml`
- The image is then tagged with the release tag version and also with latest tag
- In GitHub Actions environment variable DOCKER_HUB_USERNAME is used as Docker Hub username
- In GitHub Actions environment variable DOCKER_HUB_TOKEN is used as Docker Hub password

## Architecture

### Repository Layout

Single package — frontend and backend share one `package.json` and one toolchain (no monorepo/workspace packages; `pnpm-workspace.yaml` exists only for the native-build allowlist):

- `src/` — Vue 3 frontend (SPA)
- `server/` — Fastify backend (TypeScript sources)
- `e2e/` — Playwright E2E tests
- `compose/` — assets for local manual testing (Keycloak realm import)
- `.github/workflows/` — CI and release workflows
- `dist/` — build output: `dist/web/` (SPA, built by Vite) and `dist/server/` (backend, built by `tsc`); not committed

### Backend (File API)

The frontend cannot access the container filesystem directly, so a small backend service provides the file operations:

- Implements the VueFinder endpoint contract (index, upload, download, save, rename, delete, archive/unarchive, search, preview)
- Written in TypeScript with Fastify; lives in this repository and shares the toolchain (pnpm, ESLint, Vitest)
- Serves the built SPA via `@fastify/static` and the file API under `/api/*` — one process, one container, one image
- Exposes `GET /api/config` returning runtime configuration (Keycloak settings, active auth method) from environment variables; the frontend fetches it before initializing authentication
- Validates Keycloak Bearer tokens with `jose` against the Keycloak JWKS endpoint
- Zip archive/unarchive is implemented with `fflate` (no native builds)
- Path sandboxing: every requested path is resolved (including `..` and symlinks) against the configured root directory and rejected if it escapes; the root is the volume mount
- Exposes `GET /healthz` (outside `/api/*`, always unauthenticated) returning `200 OK`; used by Kubernetes liveness/readiness probes
- Listens on `HOST`:`PORT` (defaults `0.0.0.0`:`8080`)

### Authentication

Authentication is selected with the `AUTH_METHOD` environment variable (`basic` | `keycloak` | `none`, default `none`):
1. `basic` — HTTP Basic Auth: username and password configurable using environment variables
2. `keycloak` — OAuth2/OIDC with Keycloak: configurable using environment variables
3. `none` — no authentication (default)

The frontend learns the active auth method and Keycloak settings at runtime from `GET /api/config`.

#### HTTP Basic Auth
- Enforced by a Fastify hook on all `/api/*` routes using a timing-safe comparison
- Credentials come from `AUTH_USERNAME` / `AUTH_PASSWORD`, injected from a Kubernetes Secret
- Frontend UX: the app shows its own login form (no browser-native auth prompt); credentials are kept in memory only (Pinia auth store, never localStorage) and attached as an `Authorization: Basic …` header by the shared `ofetch` client and VueFinder's request config

#### OAuth2/OIDC with Keycloak
- Flow: Authorization Code flow with PKCE
- Keycloak token refresh: handle silent token refresh automatically
- Keycloak init timing: initialize Keycloak and await authentication before mounting the Vue app

### Container Image

- DockerHub image: pfeiffermax/file-manager
- The container image is built with Podman
- The container listens on `PORT` (default 8080) and runs as a non-root user
- Building and running the container is tested
- Use multiple stages in the Containerfile to optimize image size
- The image is published on DockerHub: https://hub.docker.com/
- Image architectures: linux/amd64, linux/arm64

### Tests

#### Unit tests

- Frontend: Pinia stores and composables
- Backend: route handlers via `fastify.inject()` (no real HTTP server), config parsing, and auth logic
- Path sandboxing is security-critical and must have dedicated tests (`..` traversal, symlink escape, absolute paths)

#### E2E tests

Coverage:
- e2e test login flow setup: mock/stub the auth layer in tests

#### Local manual testing

- Podman compose is used for local manual testing
- Configuration: compose.yaml (starts Keycloak, starts the file-manager app)
- Keycloak is preloaded from `compose/keycloak/realm.json` with realm `file-manager`, client `file-manager`
- The realm import includes a test user: username `test`, password `test` (local testing only)

## Stack

- Language: TypeScript (strict mode)
- Node version: 24
- Deployment target: Kubernetes
- Package manager: pnpm
- Framework: Vue 3
- Build tool: Vite
- Router: Vue Router 4
- State management: Pinia
- HTTP client: ofetch
- CSS framework: Tailwind CSS
- File Management library: VueFinder
- Backend framework: Fastify
- Linting: ESLint + Prettier
- Pre-commit hook tooling: Husky + lint-staged
- Unit tests: Vitest
- E2E tests: Playwright
- Container: Podman
- Authentication: keycloak-js
- Web server: Fastify (`@fastify/static` serves the SPA)
- Backend dev runner: tsx (watch mode)

### Toolchain pinning

- Node version is pinned in `.nvmrc` and enforced via `engines.node` in `package.json`
- pnpm version is pinned via the `packageManager` field in `package.json` (Corepack)

## Commands

- `pnpm dev` — full development stack: Fastify API on http://localhost:3000 (tsx watch) and Vite dev server on http://localhost:5173, which proxies `/api` and `/healthz` to :3000
- `pnpm dev:web` — Vite dev server only
- `pnpm dev:server` — backend only (tsx watch)
- `pnpm build` — build the SPA (Vite → `dist/web/`) and the backend (tsc → `dist/server/`)
- `pnpm start` — run the built server; serves SPA and API on `PORT` (production entrypoint)
- `pnpm lint` — ESLint (with `--fix`)
- `pnpm format` — Prettier write
- `pnpm typecheck` — `vue-tsc --noEmit` (frontend) and `tsc --noEmit` (backend)
- `pnpm test:unit` — Vitest
- `pnpm test:e2e` — Playwright

## Environment Variables

All variables are runtime configuration read by the backend; the frontend receives what it needs via `GET /api/config`.

- PORT — HTTP listen port (default: `8080`)
- HOST — HTTP listen address (default: `0.0.0.0`)
- FILES_ROOT — root directory of the managed files; all file operations are sandboxed to this path (default: `/data`)
- AUTH_METHOD — active authentication method: `basic` | `keycloak` | `none` (default: `none`)
- AUTH_USERNAME — HTTP Basic Auth username (required when AUTH_METHOD=basic)
- AUTH_PASSWORD — HTTP Basic Auth password (required when AUTH_METHOD=basic)
- KEYCLOAK_URL — Keycloak server URL (required when AUTH_METHOD=keycloak)
- KEYCLOAK_REALM — Keycloak realm name (required when AUTH_METHOD=keycloak)
- KEYCLOAK_CLIENT_ID — Keycloak client ID (required when AUTH_METHOD=keycloak)

The backend validates this configuration on startup and fails fast with a clear error if a required variable for the active `AUTH_METHOD` is missing.

## Development Conventions

### Branching

- `main` is protected — never commit directly.
- Feature work: `feature/<short-kebab-name>`
- Bug fixes: `bugfix/<short-kebab-name>`
- Open a pull request against `main`; CI (lint + unit tests) must pass before merge.

### Commit messages

- Follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.
- Common types used in this repo: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`.
- Use a scope when it clarifies the area touched, e.g. `feat(file): …`, `fix(manager): …`.
- Subject line in imperative mood, no trailing period, ≤ 72 chars.

### Code style

- TypeScript **strict mode** — no `any` unless justified with a comment; prefer `unknown` + narrowing.
- ESLint + Prettier are the source of truth for style. Do not hand-format; run `pnpm run lint` / `pnpm run format`.
- Vue Single-File Components use `<script setup lang="ts">` with the Composition API. No Options API.
- Prefer composables (`src/composables/`) over mixins or ad-hoc helpers for shared reactive logic.
- Pinia stores live in `src/stores/`, one store per domain concept; expose state via `storeToRefs`.
- Routes are declared in `src/router/`; pages live in `src/pages/`.
- HTTP access goes through the shared `ofetch` client in `src/lib/` so Bearer-token injection is consistent.
- File server state is owned by **VueFinder**'s built-in data layer; use the shared `ofetch` client for all other app-level HTTP. Do not duplicate server state in Pinia.

### Pre-commit hooks

- Husky runs `lint-staged` on every commit:
  - `{src,server,e2e}/**/*.{vue,ts}` → `eslint --fix` then `prettier --write`
  - `*.{js,css,json,md}` → `prettier --write`
- Do **not** bypass hooks (`--no-verify`) — if a hook fails, fix the underlying issue.

### Testing conventions

- Unit tests (`*.spec.ts`) live next to the code they cover (or under `__tests__/`) — this applies to both `src/` (stores, composables) and `server/` (route handlers, sandboxing, config).
- E2E tests live in `e2e/` and cover the main file CRUD flows; the auth layer is mocked/stubbed.
- New features should ship with at least one unit test for any new store/composable/backend logic and an e2e test if a user-visible flow changes.
- Run `pnpm run test:unit` and `pnpm run test:e2e` locally before opening a PR.

### Dependency management

- Use **pnpm** exclusively — never commit a `package-lock.json` or `yarn.lock`.
- Native-build allowlists live in `pnpm-workspace.yaml` under `allowBuilds` (pnpm 11+), not in `package.json#pnpm`.
- Pin to the major version of each dependency in `package.json`; let pnpm resolve minors/patches via the lockfile.

### Environment & secrets

- Never commit a real `.env` — only `.env.example` with placeholder values.
- `VITE_` env vars are inlined at build time — use them only for genuinely build-time constants. Runtime configuration reaches the frontend via `GET /api/config`, never via `VITE_` vars.
- Do not hard-code backend or Keycloak URLs anywhere in `src/`.

### PR workflow

- Keep PRs focused: one feature or fix per PR.
- Update `CLAUDE.md` and/or `README.md` in the same PR if behaviour or developer workflow changes.
- Squash-merge into `main`; the squash commit message must itself follow Conventional Commits.
