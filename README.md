# AgentHUD

A local dashboard for your Codex sessions.

Keep an eye on multiple sessions in one place: see what’s running, what needs your input, and the latest activity without switching between terminals.

**Currently supports Codex only.** Claude Code and other agent backends are not supported.

## Features

- **Live session board** — follow tool activity, output, and session status.
- **Need you filter** — quickly find sessions waiting for your input.
- **Project and branch grouping** — organize sessions across your work.
- **Prompt-based sorting** — sessions stay ordered by your latest prompt, so background activity doesn’t shuffle the board.
- **Session details** — inspect conversations, plans, recorded file changes and diffs, and subagent activity.
- **Questions and approvals** — answer supported questions and respond to live approval requests when connected to the corresponding Codex daemon session.
- **Responsive layout** — monitor sessions from your desktop or phone.

## Quick start

Requires Bun, Node.js, and existing local Codex sessions.

From the repository root:

```sh
bun install
bun run build
bun start
```

Open **http://127.0.0.1:4174**.

AgentHUD discovers sessions in `$CODEX_HOME/sessions`, defaulting to `~/.codex/sessions`. It also reads archived sessions and the session index when available. No additional API key is required.

To use a different port:

```sh
PORT=4175 bun start
```

### Optional Bun runtime

By default, `bun start` and `npm start` both launch the backend with Node.js. To run the same backend with Bun:

```sh
bun run start:bun
# Or:
npm run start:bun
```

The Bun runtime is experimental. Basic HTTP serving has been verified; live daemon activity and replies still need full verification under Bun. Backend tests continue to use Node.js.

### Local network access

To access the dashboard from another device on your network:

```sh
npm start -- --host
```

Open `http://<your-computer-ip>:4174` on that device. The default bind address is `127.0.0.1`; `--host` listens on all interfaces. You can also specify an interface with `--host <address>` or set `HOST`. The command-line option takes precedence.

Bun supports the same arguments:

```sh
npm run start:bun -- --host
```

## How it works

AgentHUD reads local Codex session records and serves the dashboard through a local HTTP/SSE server. When available, it connects to Codex’s existing shared daemon for live activity and interactions.

Background observation does not change Codex configuration or start new turns. Only answers and decisions you explicitly submit are sent back to the corresponding session. Question answers may start a new turn when the session is idle; live approval and tool-request replies answer the original request.

Session history remains available without a daemon connection. Live replies require a connection to the corresponding daemon session. Sessions started with `--no-daemon` must be answered in their original client.

## Current limitations

- Codex is the only supported backend. The integration has been tested with Codex **0.166.0**; record formats and daemon behavior may change between versions.
- Session status depends on the records and live events Codex provides. Older sessions without recent events may show **State unverified**.
- A finished turn does not necessarily mean the overall task is complete or the Codex client has exited.
- Search covers titles, projects, and indexed message excerpts, rather than full-history text.
- File diffs are shown only when recorded. Added/deleted line counts accumulate across recorded edits and do not represent a Git net diff.
- Approvals, blocking questions, permission requests, and supported MCP forms require the actual live request to reach AgentHUD. Unsupported forms and other agent controls remain in the original client.
- AI summaries and “what changed while you were away” reports are not included.

See [Codex integration notes](docs/codex-integration.md) for protocol details, data limits, and interaction behavior.

## Development

```sh
bun install
bun run dev
```

Open **http://localhost:5173**. The development server uses demo data, so you can work on the interface without local Codex sessions.

To develop against real Codex data, run these in separate terminals:

```sh
PORT=4176 bun start
```

```sh
AGENTHUD_API_TARGET=http://127.0.0.1:4176 bun run dev
```

### Checks

```sh
bun run typecheck
bun run build
bun run test:codex
```

Browser checks require Playwright Chromium:

```sh
bun run test:demo
bun run test:codex:browser
```

Use `CHROMIUM_PATH` to select a browser executable. Demo checks accept `DEMO_URL`; Codex browser checks accept `CODEX_LIVE_URL` for an additional local-instance check. Screenshots from that check are restricted to `CODEX_PROJECT`, which defaults to the current working directory.

Production assets are written to `apps/web/dist/`. Static hosting serves the demo and requires a fallback to `index.html` for page routes; local Codex integration requires the backend.

### Project structure

| Path | Purpose |
| --- | --- |
| `apps/web/` | React frontend, Vite build, and demo data |
| `packages/shared/` | Shared components and types |
| `packages/design-tokens/` | Shared design tokens |
| `server/` | Codex records, daemon integration, and HTTP/SSE API |
| `scripts/` | Browser verification |
| `artifacts/` | Local verification screenshots, excluded from Git |

Dependencies are pinned with `bun.lock`. Build output, test reports, and environment files are excluded from Git. Upstream Sentry initialization has been removed.

## Acknowledgments

AgentHUD started from the frontend of [claude-view](https://github.com/tombelieber/claude-view) by Tom Tang.

This project narrows the feature set, redesigns the dashboard around monitoring multiple sessions, and adds a Codex backend. The original Claude Code backend is not included.

The frontend was derived from upstream version **0.46.2**, commit [`d3e4ad8`](https://github.com/tombelieber/claude-view/tree/d3e4ad89f3847d702f33381735e97dc397fb196d). Thanks to Tom Tang and the upstream contributors for the foundation.

## License

MIT. See [LICENSE](LICENSE). The upstream copyright and license notice are preserved.
