# nib: plan

## Context

pen.dev (formerly Pencil) is an agent-driven design canvas. Its free plan allows 5 "agent days" a month, and any MCP use from Claude Code counts. nib is an open-source, clean-room replacement with two hard requirements:

1. **`.pen`-native.** nib opens and saves pen.dev's `.pen` JSON files in place. A file read and saved without edits stays byte-identical (verified on 13 real files: `JSON.stringify(doc, null, 2)`, no trailing newline).
2. **Drop-in MCP.** nib's MCP server exposes the same tools as pen.dev's `pencil` server (`get_app_state`, `execute`, `read_skill`, `get_style`, `browser`, `spawn_agents`), and `execute` runs the same JavaScript API (`Insert`, `Copy`, `Update`, `Replace`, `Move`, `Delete`, `Get`, `SetVariables`, `GetVariables`, `FindEmptySpace`, `Print`, `TakeScreenshot`, `Export`, `Generate`). Agents and prompts written for pen.dev keep working.

Clean-room rule: the file format and the tool API are reimplemented for interoperability. pen.dev's code, skill documents, style presets and assets are never copied. nib's docs are written from scratch.

The full feature inventory comes from docs.pencil.dev (all 23 pages) and the format/API reference shipped with the app. Existing open-source projects were evaluated: open-pencil/open-pencil opens `.pen` read-only and uses Figma-style tools; ZSeven-W/openpencil uses its own `.op` format. Neither covers the two requirements. MIT code from them may be reused with attribution (e.g. open-pencil's `.fig` parser for Figma import).

## Architecture

TypeScript monorepo (pnpm workspaces, Node >= 24). Sources run directly through Node's type stripping: imports use `.ts` extensions, syntax must be erasable (`erasableSyntaxOnly`). Vitest for tests.

| Package | Role |
| --- | --- |
| `packages/format` | `.pen` types, parse (JSONC), serialize, validate, version handling |
| `packages/core` | Document model: id index, mutations with inverse ops (undo), transactions, component instance expansion (`ref` + `descendants`, `a/b` id paths), variables and themes, imports (`.lib.pen`) |
| `packages/layout` | Single-axis flex engine (`fit_content`, `fill_container`, fallbacks, padding, gap, justify, align, absolute children, text growth) with an injected text measurer |
| `packages/render` | CanvasKit (Skia WASM) renderer, same code in Node and browser: fills (color, linear/radial/angular gradient, image, mesh gradient, shader), strokes (per side, alignment), effects (shadows, blur, background blur), blend modes, clipping, text, icons, fonts |
| `packages/export` | PNG/JPEG/WEBP/PDF, HTML+CSS, HTML+Tailwind |
| `packages/exec` | `execute` runtime in a QuickJS sandbox: transactional, warnings, name-to-id map, failed-snippet `edits` patching |
| `packages/mcp` | MCP stdio server `nib-mcp` with pen.dev-compatible tools; talks to the running app over a local socket, or works headless on files |
| `packages/daemon` | Local server: open documents, file watch, autosave and recovery, WebSocket sync to editors, socket for MCP clients |
| `apps/editor` | Web editor (React + CanvasKit canvas), served by the daemon |
| `apps/desktop` | Electron shell: dashboard, windows, file association, browser nodes, `browser` MCP tool over CDP |
| `packages/agent` | Built-in agent chat (bring-your-own key), parallel agents |
| `packages/generate` | `Generate` back ends (BYO key image/stock/SVG generation; local vectorize and background removal) |
| `packages/cli`, `apps/vscode` | `nib` CLI and the VS Code/Cursor extension |

Why these choices:
- **CanvasKit everywhere.** The editor, `TakeScreenshot` and `Export` must agree pixel for pixel, and layout depends on text measurement. One Skia build in both Node and the browser gives identical text metrics.
- **Custom layout engine instead of Yoga.** pen.dev's layout is single-axis flex with its own sizing keywords and fallbacks (a `fill_container` child of a `fit_content` parent collapses to its fallback). A small dedicated engine states those rules directly instead of mapping them onto CSS semantics.
- **QuickJS for `execute` and script nodes.** Script nodes come from arbitrary repos, so they need a real sandbox with time and node limits (pen.dev: 1000 nodes, 2 s, deterministic `Math.random`).
- **Electron for the desktop shell.** Browser nodes and the `browser` tool need embedded Chromium with CDP access.

## Milestones

Each milestone ends with a usable state and its own verification gate.

- **M1 Engine.** format, core, layout, render, PNG export. Gate: all 13 corpus files render every top-level frame without errors; layout unit tests cover every rule in the format reference; visual check of rendered corpus frames.
- **M2 Drop-in MCP.** daemon + `nib-mcp` with `get_app_state`, `execute` (all functions except `Generate`), `read_skill` (nib's own docs), `get_style` (nib's own styles), `TakeScreenshot`, `Export` (all formats). Gate: Claude Code configured with `nib-mcp` completes a real design task end to end on a copy of a corpus file, and pen.dev's sample snippets run unchanged.
- **M3 Editor.** canvas pan/zoom, selection (click, shift, deep select, marquee), move/resize/rotate, layers panel, properties panel (alignment, layout, appearance, fill, stroke, effects, typography, icon, theme), variables panel, components panel, insert tools (frame, rectangle, ellipse, polygon, text, note, icon), flex layout controls, undo/redo with each agent change as one step, save/save as/recovery, copy/paste (incl. as PNG/HTML), keyboard shortcuts from pen.dev's list, live updates while an agent works.
- **M4 Desktop.** Electron app: dashboard (recents, drafts), file association, multi-window, settings, MCP client auto-configuration (Claude Code, Codex, Gemini CLI, OpenCode, Kiro, Claude Desktop), browser nodes and the `browser` tool (`load-page`, `return-screenshot`, `return-element`, `import-to-canvas`, `screenshot-to-canvas`, `cdp`).
- **M5 Advanced editing.** pen tool and point edit mode, scale tool, mirror, align/z-order commands, snapping and pixel grid, gradient and mesh-gradient handles, image fills with crop, image and SVG import, custom fonts, slots, libraries (`.lib.pen`, locate, linked paste, variable conflicts).
- **M6 Code on canvas.** script nodes (QuickJS, `@input` controls, file watching, convert to layers), shader fills and shader effects (WebGL 1 GLSL with `@resolution`, `@time`, `@mouse`, `@sdf`, `@backdrop`), a shader gallery of nib's own examples.
- **M7 AI.** built-in agent chat with BYO providers (Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek, OpenAI-compatible endpoints; Claude Code and Codex through their own CLIs), sessions, skills, permission prompts, parallel agents (split work, side by side, iterations), `spawn_agents`, `Generate`, nib's own style archetypes.
- **M8 Ecosystem.** CLI (export, agent mode, interactive), VS Code/Cursor extension, slides panel with present mode and PDF, share links (static snapshot, self-hostable), Figma import (`.fig` files and clipboard).

## Conformance

- Corpus: the 13 local `.pen` files (private designs, referenced by path through `NIB_CORPUS`, never committed). Synthetic fixtures live in the repo.
- Oracle: pen.dev's own resolved bounds and PNG exports of the corpus, stored outside the repo in `~/Playground/nib-oracle` (`NIB_ORACLE`). Not captured yet: the pen.dev plan limit was already reached on 2026-10-29. Capture in one agent day after the billing period resets, or from manual PNG exports.
- Behaviour that the reference leaves open is decided by the oracle once available and listed under "Open semantics" until then.

## Open semantics

- Default `strokeAlignment` (assumed `inner` until checked).
- What `layoutIncludeStroke` adds to a child's layout size.
- Reference syntax for imported components and variables (assumed `alias:id`).
- Differences between format versions 2.18, 2.20 and 2.21 (nib preserves the version it read).
