# Contributing to Panelarr

## Branch strategy

- **`develop`** is the default branch and the target for all pull requests. All active work lands here first.
- **`main`** is cut from `develop` at release time by the maintainer. It holds stable, tagged releases only. Do not target `main` in pull requests.

## Branch naming

Use one of these prefixes:

| Prefix | Purpose |
|---|---|
| `feature/` | New feature or enhancement |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `ansible/` | Ansible / infrastructure automation |

Example: `feature/show-detail-specials`, `fix/calendar-off-by-one`, `docs/traefik-saltbox`.

## Development setup

See the Development section of [README.md](README.md) for prerequisites and how to run the frontend and backend dev servers together.

## Code style

### Python

Formatted and linted with [Ruff](https://docs.astral.sh/ruff/). Every file starts with `from __future__ import annotations`. Type hints on all function signatures. `async def` for all I/O. snake_case for functions and variables, SCREAMING_SNAKE for constants. No hardcoded credentials, ever.

```bash
ruff check --fix . && ruff format .
```

### JavaScript / JSX

Functional React only. No class components. kebab-case filenames (`container-card.jsx`), PascalCase component exports (`ContainerCard`), camelCase hooks with `use` prefix (`useContainers`). 100% Tailwind CSS utility classes. [coss/ui](https://coss.dev) is the only component library used in the project, never mix in shadcn, Radix directly, MUI, or anything else.

```bash
npm -C frontend run build
```

## Architecture

| Area | Location |
|---|---|
| API routers | `backend/routers/` |
| Service logic | `backend/services/` |
| React pages | `frontend/src/pages/` |
| Query hooks | `frontend/src/hooks/use-api.js` |
| UI primitives | `frontend/src/components/ui/` |

## CI

Every push and pull request to `main` or `develop` runs `.github/workflows/ci.yml`, which has four parallel jobs:

- **Backend**: `ruff check`, `ruff format --check`, `pytest`
- **Frontend**: `npm ci`, `npm run test:run`, `npm run build`
- **Docker**: `docker build` smoke test against the repo `Dockerfile`
- **Scans**: cspell against `cspell.json`, gitleaks against the full history

You don't need to run any of this by hand before opening a PR, but running `ruff check --fix . && ruff format .` and `npm -C frontend run build` locally is the fastest way to catch problems before the CI round-trip.

## Testing

Test against a real Docker setup before submitting a PR. The project integrates with Sonarr, Radarr, SABnzbd, qBittorrent, Plex, and Jellyfin; mocks are not enough to catch integration issues. Describe what you tested in the PR template.

## Pull requests

One feature or fix per PR, targeted at `develop`. Use [conventional commits](https://www.conventionalcommits.org) for commit messages. CI must be green before merge.

## Reporting issues

Open an issue on GitHub with steps to reproduce, expected vs. actual behaviour, and the environment details from the bug report template.

## Getting help

For general Panelarr questions or to chat with other homelabbers running the stack, the [Saltbox Discord](https://discord.gg/saltbox) has a friendly self-hosted community.
