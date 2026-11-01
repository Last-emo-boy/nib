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
- **M2 Drop-in MCP.** `nib-mcp` with `get_app_state`, `execute` (all functions except `Generate`), `read_skill` (nib's own docs), `get_style` (nib's own styles), `TakeScreenshot`, `Export` (all formats). Gate: Claude Code configured with `nib-mcp` completes a real design task end to end on a copy of a corpus file, and pen.dev's sample snippets run unchanged.
  Status 2026-10-30: done. Claude Code connects to `nib-mcp` and lists its tools; a full settings-page task ran end to end through `scripts/mcp-call.ts` (the local `claude` CLI is not logged in, so the agent was driven by hand). 349 of 435 recorded pen.dev snippets that succeeded there run unchanged on copies of their documents; the other 86 reference nodes that no longer exist. HTML exports render in Chrome within 1.3% of nib's PNGs; PDF pages are lossless images (no selectable text yet).
- **M3 Editor.** daemon shared by the editor and `nib-mcp` (one document registry, live updates, token + origin checks on its local socket), canvas pan/zoom, selection (click, shift, deep select, marquee), move/resize/rotate, layers panel, properties panel (alignment, layout, appearance, fill, stroke, effects, typography, icon, theme), variables panel, components panel, insert tools (frame, rectangle, ellipse, polygon, text, note, icon), flex layout controls, undo/redo with each agent change as one step, save/save as/recovery, copy/paste (incl. as PNG/HTML), keyboard shortcuts from pen.dev's list, live updates while an agent works.
  Status 2026-10-30: done, apart from editing parts of component instances on the canvas (agents can, through instance paths) and rotated selection outlines. Built and verified in the browser on a 3.2 MB corpus copy: opens in about 1.4 s, pans at the display's 120 Hz; every edit goes through the daemon and is saved before editors see it; agent changes appear live with an activity feed. Beyond the list: problems panel, command palette (Cmd/Ctrl+K), editable variables, English and Chinese. Run with `pnpm dev` (development) or open the link `get_app_state` prints (the daemon serves `apps/editor/dist`, built with `pnpm --filter @nib/editor build`).
- **M4 Desktop.** Electron app: dashboard (recents, drafts), file association, multi-window, settings, MCP client auto-configuration (Claude Code, Codex, Gemini CLI, OpenCode, Kiro, Claude Desktop), browser nodes and the `browser` tool (`load-page`, `return-screenshot`, `return-element`, `import-to-canvas`, `screenshot-to-canvas`, `cdp`).
  Status 2026-10-30: done for macOS. `pnpm package:desktop` builds `out/nib-darwin-<arch>/nib.app` (ad-hoc signed, `.pen` registered by extension like pen.dev does, icon drawn in nib from `apps/desktop/build/icon.pen`) and a `.dmg`; the app runs nib's TypeScript sources, and the same executable runs the daemon and `nib-mcp` as Node. Verified from the packaged app with a fresh home: it starts its own daemon, opens documents and settings, and agents connect through its MCP server. Settings adds nib to seven MCP clients: Claude Code through its CLI, and Claude Desktop, Cursor, Gemini CLI, Kiro, OpenCode and Codex by editing their config files, which keep their other settings and are backed up once (checked against a scratch home). The `browser` tool drives nib's own headless Chrome; browser nodes draw their page's latest snapshot, redraw live when an agent changes the page, and load their page in the background when a document arrives without one. HTML round trips through `import-to-canvas` differ by 1.44% (tailwindcss.com: 11.7%; repeating-gradient patterns are not drawn). Not done: the element picker (`target: "selection"`), Windows and Linux builds, notarization.
- **M5 Advanced editing.** pen tool and point edit mode, scale tool, mirror, align/z-order commands, snapping and pixel grid, gradient and mesh-gradient handles, image fills with crop, image and SVG import, custom fonts, slots, libraries (`.lib.pen`, locate, linked paste, variable conflicts).
- **M6 Code on canvas.** script nodes (QuickJS, `@input` controls, file watching, convert to layers), shader fills and shader effects (WebGL 1 GLSL with `@resolution`, `@time`, `@mouse`, `@sdf`, `@backdrop`), a shader gallery of nib's own examples.
- **M7 AI.** built-in agent chat with BYO providers (Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek, OpenAI-compatible endpoints; Claude Code and Codex through their own CLIs), sessions, skills, permission prompts, parallel agents (split work, side by side, iterations), `spawn_agents`, `Generate`, nib's own style archetypes.
- **M8 Ecosystem.** CLI (export, agent mode, interactive), VS Code/Cursor extension, slides panel with present mode and PDF, share links (static snapshot, self-hostable), Figma import (`.fig` files and clipboard).

## Gap to pen.dev (2026-10-30)

From pen.dev's site and docs (docs.pencil.dev, updated 2026-10-13), the user's screenshots of its dashboard and editor, and the file names in its app bundle (its agent runs on `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@cursor/sdk` and Pi, which is how it uses a person's own Claude or ChatGPT subscription). In the order nib should close them:

1. **Design systems.** pen.dev's dashboard templates are design systems (shadcn, HeroUI, Halo, Lunaris, Nitro): libraries of components and themed variables that a new file starts from, with a Libraries tab (default libraries, import a `.lib.pen`, "Turn this file into a library") and library components in the Components tab. nib has the engine (`imports`, `alias:id`) but showed openpencil scene templates. nib ships its own libraries built on open-source systems (shadcn/ui, MIT; HeroUI, Apache-2.0); Halo, Lunaris and Nitro are pen.dev's own and are not copied. Status 2026-10-30: done except "Turn this file into a library". `scripts/build-libraries.ts` builds shadcn/ui (55 components) and HeroUI v3 (54) into `packages/daemon/libraries`, each with an overview screen, component boards and Light/Dark variables, and its license. The dashboard's Templates start with Design systems; a new design imports the library from `libraries/<id>.lib.pen` next to it. The editor has a Components tab (this file's and each library's components, previews, search, click or drag to insert) and a Libraries tab (libraries in use, add a design system, import any `.pen` file).
2. **Built-in browser panel.** Enter a URL, import the full page or one picked element, import a screenshot, recent URLs. nib has the `browser` tool for agents but no panel. Status 2026-10-30: done. The editor's Browser panel loads a url (recent ones offered), shows the page, picks an element by clicking it (Larger climbs to its parent), and imports the page or the element as layers or as a screenshot.
3. **Built-in agent.** Agent tab with sessions ("New Agent"), model picker, variants (⊞ 1x), context files, prompt suggestions; selection goes into the chat context. Same composer on the dashboard, with Import from Figma, Import from browser and Recreate a screenshot. Status 2026-10-30: chat, sessions, model picker, suggestions, selection context and the dashboard composer are done. The daemon runs sessions per document (`packages/daemon/src/agent`): Claude through the Claude Agent SDK and Codex through the Codex SDK on the person's own sign-ins, DeepSeek and Ollama through nib's own loop over the OpenAI-compatible API (keys in the system keychain); each gets only nib's MCP tools. The chat docks beside the properties (Cmd+J), so layers stay visible. Not done: variants (several runs side by side), attachments and context files, Import from Figma, Recreate a screenshot.
4. **Slides and Present mode**, **Share by link.**
5. **Editing:** pen tool and path editing (with pasted SVG), snapping, pixel grid, measurements, on-canvas gradient handles and real mesh gradients (nib draws mesh fills as one average color), masking, image crop, scale tool, rotated selection outlines, editing inside instances, custom fonts; settings for nudge, zoom, light mode, animations.
6. **Image tools:** vectorize, remove background, `Generate` (images and SVG), AI Pen (agents drawing icons and illustrations).
7. **Code on canvas:** shaders and script nodes (M6).
8. **Ecosystem:** pen.dev CLI, VS Code/Cursor/OpenVSX extension, Chrome extension (copy a page, paste as layers), web version, Figma import, Windows and Linux builds, auto-update, `spawn_agents`, WebMCP.

## Roadmap after the gap list (2026-10-30)

Everything pen.dev has that nib lacks, the pain points seen while using nib's agent, and features pen.dev does not have. The user asked for all of it. Phases run in order; each item is done when it works in the app and has a test or a recorded check. Items that publish anything outside this computer (store listings, hosted web version, update feed, notarization) are built and verified locally, and published only when the user says so.

**A. Agent: cheaper, fewer failures, safer** (measured on 2026-10-30: Codex spent 106k input tokens on a one-sentence question; DeepSeek spent 528k on one page; 4 of 9 `execute` calls failed on the login-card task)
- A1. Context up front: the first message carries the document's state and its libraries' components; the guide shrinks to one short page plus topic files read on demand. Target: half the tokens on the same task.
- A2. Caching and trimming: a stable prompt prefix for provider caches, older screenshots and long tool outputs dropped from the transcript.
- A3. Codex gets only nib's tools, not the person's other MCP servers and instructions.
- A4. Fewer failed snippets: library components name their editable parts (slots: text, icon, visibility); `Get` on an instance lists the paths it can override; errors suggest the nearest valid path or variable; a high-level `Use(component, {slot: value})` helper.
- A5. Sign-in check before a run (Claude, Codex), with a button that opens Terminal to sign in; a first-run setup card.
- A6. A checkpoint per agent turn: "Undo this turn" and a before/after preview in the chat.
- A7. The camera can follow the agent's cursor; the chat panel can be narrowed or moved.
- A8. Cost: tokens and cost per session and per month, a budget that stops a run, a cheap model for exploring and a strong one for finishing.
- A9. Project rules: notes in the document (context nodes) that every agent run receives.
- Status 2026-10-30: phase A done. Same login-card task with DeepSeek: 84k input tokens (84% cached) instead of 139k, 0 of 6 `execute` calls failed instead of 4 of 9, 30 s instead of 50 s; a one-line question to Codex costs 41k tokens instead of 106k. Claude runs with the `env` block of the person's Claude Code settings (where a gateway sign-in lives) but loads none of their settings files; Codex runs with their other MCP servers turned off. Sign-in is checked with `claude auth status` / `codex login status`, and "Sign in in Terminal" opens Terminal with the command. Every message saves a checkpoint (Restore puts the design back as one undoable change) and its usage line names the frames the run changed. Budgets: tokens per message (all providers; Codex checked when it finishes) and dollars per message (Claude's maxBudgetUsd). Not done from A8: automatic routing between a cheap and a strong model (the model stays the person's choice per chat).

**B. Design to code, tokens, libraries**
- B1. Code export that uses the library's real components: shadcn/ui (`@/components/ui/*`) and HeroUI (`@heroui/react`) React code with the overrides as props, plus the theme. Each library maps its components to code.
- B2. Design tokens out and in: W3C design tokens JSON, CSS variables, Tailwind theme; import a project's CSS variables or Tailwind theme as variables.
- B3. Turn this file into a library; more bundled design systems built on open-source ones (Material 3, Ant Design, Radix Themes).
- B4. A design system from a brand: from a website (colors, fonts, radii read in the browser) or a logo (palette), as a themed copy of a bundled library.
- B5. Component states: hover, pressed, focus, disabled variants in the libraries.
- Status 2026-10-31: phase B done. Five bundled design systems with code maps (shadcn/ui, HeroUI, Ant Design, Radix Themes, Material 3 on Material Web, which needs side-effect imports). "Design system from a brand" in the Libraries panel reads a website in nib's browser (declared brand variables, theme-color, filled buttons, links, the logo SVG; button radius; the text font when nib can load it) or a logo file, and writes a themed copy of a bundled library beside the design; each library's catalog entry names the variables that follow the brand. Checked on stripe.com (#533AFD, 4 px), github.com, duolingo.com, airbnb.com (#DA1249), tailwindcss.com (logo #00BCFF). States: 150 state components (`<Component> / Hover`, `/ Pressed`, `/ Focus`, `/ Disabled`, `/ Invalid`), each an instance of its base following that system's rules, on a States board per library; React export writes them as the base with `disabled`, `aria-invalid`, `isDisabled`, `status="error"` and the like.

**C. Editing (pen.dev parity, M5)**
- C1. Pen tool and point editing; paste or import SVG as editable paths.
- C2. Snapping and smart guides, pixel grid, distance measurements (Alt).
- C3. Gradient handles on the canvas; real mesh-gradient rendering.
- C4. Masks, image crop mode, image import by drop or paste.
- C5. Scale tool, flip, rotated selection outlines, z-order commands.
- C6. Editing inside instances on the canvas (overrides become `descendants`).
- C7. Custom fonts: installed fonts list and font files kept with the project.
- C8. Settings: nudge distance, zoom speed, light interface, fewer animations.
- Status 2026-10-31: phase C done. Pen tool with point editing (turned and mirrored paths too) and SVG paste/import; smart guides, Alt distances, pixel grid; gradient and mesh handles on the canvas with real mesh rendering; images placed by drop, paste or ⇧⌘K into images/ beside the design, crop mode, masks from rectangles, frames and circles (a clipping frame that remembers its shape in `nib-mask` metadata). The canvas carries each node's full transform, so turned and mirrored layers select, resize, rotate and snap along their own sides; scale tool (K) scales everything inside; flip (⇧H/⇧V); stacking order (⌘] ⌘[ ⌥⌘] ⌥⌘[). Double-click steps into instances, and edits there become `descendants` overrides (Delete hides; Reset clears). Fonts: a design's own font files in fonts/ (drop or "Add font file…") come first, a picker lists them with Google Fonts and installed fonts, HTML export writes @font-face for them. Settings: nudge distances, zoom speed, light/dark/system interface, fewer animations, pixel grid. Fixed on the way: daemon undo/redo replayed ops that later ops had changed in place (editors could get duplicated layers).

**D. Slides, present, share, prototype**
- D1. Slides panel (ordered frames), Present mode, PDF of the slides.
- D2. Prototype links between frames, clickable in Present mode, simple transitions.
- D3. Share by link: a static, self-hostable viewer of the design, served read-only on the local network by the daemon.
- Status 2026-10-31: phase D done. Slides are the top-level frames (components left out) in reading order, nothing stored: the Slides tab reorders them by swapping the frames' places, presents from one, and saves them as one PDF. Present mode is the live canvas full screen, fitted to a slide with black around it (agent edits show, cursors hidden). Prototype links are `nib-link` metadata on any layer (a frame, next, previous; instant, dissolve, or a glide across the canvas), drawn as arrows on the canvas. Share writes a read-only snapshot (2× PNG per frame, share.json with link hotspots, a self-contained viewer page) under a stable unguessable id, served at /share/<id>/ by the daemon without the token; "Also on the local network" starts a second server that serves the shares folder and nothing else, off until switched on.

**W. Publishing to w33d** (asked 2026-10-31, before E)
- W1. Sign in with w33d SSO in nib; publish a design as a website on nib.w33d.xyz, public or for w33d users only; republish, switch, take down. Status 2026-10-31: done and checked through the edge (public page anonymous, private page as a signed-in user). Keystone client `nib-desktop` (public, PKCE, loopback redirects on ports 7451 and 7471); service `services/publish` (nib-publish) on OVH behind Sluice (/api bearer; every site at one address /s/<name>/, an sso-optional route where private sites send visitors through /p/, an SSO route, to sign in), files kept as Siteflow prebuilt deployments on internal hosts. Export format `site` (a page per frame, prototype links as links, assets copied).
- W2 (next, not started). Sites with a database and a backend: a Loom repository per site, Cistern for data, Siteflow functions; needs a repository-creation API in Loom.

**E. Agent features**
- E1. Variants: several agents at once on copies of a frame, side by side; keep one.
- E2. Attachments: reference images and files in the chat.
- E3. Recreate a screenshot or page, comparing pixels against the original until close.
- E4. Design review: a reviewer agent checks screenshots against a rubric (contrast, alignment, spacing, overflow, touch targets); "Fix these" hands the list to the designer.
- E5. Stress test: long German text, CJK, right-to-left, dark mode, narrow widths; report what breaks.
- E6. Sketch to UI: a freehand pencil tool; the agent builds the sketch with the document's library.
- E7. Responsive versions: tablet and phone frames from a desktop frame, checked.
- E8. Implementation check: a running app (localhost) in the browser compared with its design frame, differences listed for a coding agent.
- E9. `spawn_agents` and macros (save an agent turn as a reusable command).
- Status 2026-11-01: E3 done (Compare in execute; Recreate as editable layers on a picture: Codex reached 98.2% on a dense card). E4 done (design review in the Problems tab: contrast, text size, tap targets, cut-off text, near alignment, uneven gaps; Fix with the agent; Ask the agent to review). E1 done (2–4 agents at once on copies of the selected frame, side by side; switch between them, keep one in the original's place, or discard them). E2 done (images and text files attached in the chat, shown to models that see). E5 done (Stress test in the Problems tab: copies of the selected frame with long German text, Chinese and Japanese, Arabic, the dark theme and a narrow width, reviewed for overflow, cut-off text and contrast that the original does not have; Fix with the agent; Remove test copies. Arabic and Hebrew fallback fonts added). E6 done (Pencil tool, Shift+P: smoothed strokes that keep their corners collect on a paper Sketch frame that grows to hold them, or go into the frame drawn over; putting the pencil down selects the sketch; Build UI from sketch hands it to the agent, with the sketch read as an outline of boxes, circles, lines, scribbled text and crossed-out pictures for models that cannot see. DeepSeek built a phone screen from one with shadcn avatars and a button). E7 done (Make tablet and phone versions on a top-level frame: copies at 768 and 390 beside it, one agent each at the same time, told to reflow and to clear Review(id) before stopping; Review is a new execute call with the design review's checks, overflow included. DeepSeek made both versions of a 1280 landing page with no findings). E8 done (Implementation check: the browser tool's check-implementation action, for coding agents over MCP, and an Implementation section on top-level frames in the editor. The page at a url is loaded as wide as the frame and compared by pixels (with a difference image) and text by text: place, size, weight, color, font, missing and extra, with short CSS selectors; a text counts as moved only when it lines up neither with the frame nor with the text before it. Copy for a coding agent. On a drifted export of a landing page it listed exactly the five changes made). E9 done (spawn_agents and wait_agents for nib's own agent: up to 6 helpers at once on the same document with its provider and model, each optionally kept to one frame, listed under their lead in the chat with a bar to switch between them; helpers cannot start helpers, and stopping the lead stops them. DeepSeek made three empty phone frames, started a helper per screen, waited, then reviewed and polished the set. Commands: Save as command on a message; type / in the chat or use the command palette to run one again).
- Phase E done 2026-11-01.

**F. Images, code on canvas, data**
- F1. `Generate`: images (person's image API key), SVG (any chat model), stock photos (Openverse, no key).
- F2. Vectorize an image; remove an image's background.
- F3. AI Pen: agents draw icons and illustrations as paths.
- F4. Script nodes and shader fills and effects (M6).
- F5. Data: repeat rows from JSON or CSV, fake data.
- F6. Text in several languages: a strings table and a language switch on the canvas.
- Status 2026-11-01: F1 done (Generate(path, "stock" | "image", prompt, {index}) in execute: a stock photo from Openverse, or Wikimedia Commons when Openverse does not answer (it did not, from this machine), saved in images/ next to the .pen with its credit in images/CREDITS.md; or a picture made by gpt-image-2.5-flare with the person's OpenAI key (NIB_IMAGE_MODEL to change; checked against a mocked API only, no key here). The snippet runs again once the picture is here, like fonts. InsertSvg(parent, svg, props) turns SVG markup any chat model writes into editable layers. A Picture section in Properties: stock photo, another, generate, with the key asked for when missing). F2 done (Vectorize(path, {colors, detail}): the picture a layer shows, as cropped, reduced to 2–24 colors by k-means and traced along pixel edges into stacked, smoothed paths that keep their corners, beside a top-level picture or in place of a nested one. RemoveBackground(path, {method, tolerance}): "color" floods a plain background away from the edges with a soft, color-corrected edge, and says when there is none; "model" asks the image model's edits endpoint for a transparent cut-out (mocked only). Both in the Picture section. Checked on Commons photos: an apple on white, a lake in 8 colors). F3 done (AI pen tool: drag a box, say what to draw and pick a style (flat illustration, line drawing, line icon, logo mark); the agent draws it there as SVG through InsertSvg, so it is editable paths. The agent's instructions now point it to Generate for photos and InsertSvg for drawings. DeepSeek drew "a fox reading a book under a tree" as 37 paths). F4 done. Shader fills and effects: GLSL ES 1.0 fragment shaders translated to SkSL and drawn with CanvasKit's runtime effects; comments mark @resolution, @time, @mouse, @sdf (the outline's distance), @source (effects: the layer as drawn), @margin and @input controls (shown in the panel); animated in the editor, at time 0 in exports; shader files next to the document are watched; a gallery of 10 of nib's own (6 fills, 4 effects); Shader(name, source?) for agents. Not done: @backdrop (CanvasKit 0.42 has no runtime image filter, so a shader cannot read what is behind it). Script nodes: render(input, size) in a QuickJS sandbox of their own (2 s, 1000 layers, seeded Math.random), @input controls in the panel, run in the daemon and drawn in the editor, script files watched, Convert to layers, 3 of nib's own scripts in the command palette, Script(name, source?) for agents. F5 done (Repeat(template, rows, {gap, bind}): a copy per row with {{field}} placeholders filled, the template hidden, repeating again replaces the copies; bind sets colors and numbers by layer name, since .pen validation keeps placeholders to plain strings. ReadData(path) for CSV and JSON next to the document; FakeData(fields, count, {locale, seed}) picks believable values by field name, in English or Chinese, the same for the same seed. A Data section in Properties: the placeholders found, made-up rows, a file, or pasted rows). F6 done (translations are string variables on a Language theme axis, which .pen already has: a Strings tab with a column per language, Make translatable (ExtractStrings for agents: one str.<frame>.<text> variable per distinct text), add a language, the agent fills in what is missing, CSV out and in; a language switch in the toolbar shows every frame in one language without changing the document. DeepSeek translated a landing page's 16 strings into Chinese).
- Phase F done 2026-11-01.

**G. Ecosystem**
- G1. `nib` CLI: render, export, validate, diff, run the agent, open.
- G2. Git: visual diff between commits in the editor and CLI, a three-way merge driver for `.pen`, a GitHub Action posting before/after images on pull requests.
- G3. VS Code and Cursor extension (the editor in a webview).
- G4. Chrome extension: copy a page or element, paste it into nib as layers.
- G5. Figma import (`.fig` files).
- G6. Windows and Linux builds, auto-update, WebMCP.
- G7. Web version of the editor without the desktop app.
- G8. Plugins: local scripts on the execute API, run as commands.
- Status 2026-11-01: G1 done (packages/cli, `nib` / `pnpm nib`: render and export frames headless, validate (schema errors exit 1, plus layout and asset problems), diff two files or two git revisions frame by frame with --images before/after/difference pictures and --markdown for a pull request, agent sends a request to nib's agent through the daemon and prints what it does, open hands a file to the app or the browser editor). G2 done (a three-way merge of .pen files by layer id, property by property, with layers added, removed and moved and child order from either side, variables, imports and theme axes too; both sides changing the same thing keeps ours and exits 1, the file always valid: `nib git-setup` registers it as git's merge driver for *.pen, and a real merge of two branches editing one headline merged cleanly. A History tab in the editor: the commits that changed the file, and since one of them each changed frame then, now and the difference, with the layers that changed. A composite GitHub Action (.github/actions/design-diff) that comments on pull requests with nib diff's summary, the pictures on a branch or in an artifact; nib's own design-diff workflow uses it for its libraries. The action was checked with a dry run only: it runs for real on the first pull request that changes a .pen file). G3 done (apps/vscode: a custom editor for *.pen in VS Code and Cursor showing nib's editor from the daemon in a webview, read-only as far as VS Code goes since the daemon saves the file; it starts the daemon from the nib app or a checkout (nib.path), commands to open the file in the app or as JSON; `pnpm package:vscode` builds nib-vscode.vsix, which tagged releases attach. Packaged and unit-tested; not yet tried inside a running VS Code).

## UX: better than pen.dev

pen.dev's layout (from the user's screenshots): dark UI of floating rounded panels over the canvas; a left panel whose tabs (Agent, Layers, Slides, Components, Libraries) share one slot, so chat hides the layer tree; a vertical tool strip beside it; top-right pill with Agents, Goodies, Share, Settings, Present, Browser; right panel for properties or the web-import browser; zoom control at the bottom. The dashboard is prompt-first: category chips, Import from Figma / browser / screenshot, recents grid with thumbnails.

pen.dev is the model for nib's UI: same structure, same visual language (dark floating panels, vertical tool strip, prompt-first dashboard). The user's own past designs are not a UI model; they serve only as rendering test data.

Templates, style presets and UI kits take ZSeven-W/openpencil (MIT) as the reference: its 96 scene templates (`crates/op-editor-core/assets/scene_templates/*.op`, catalogue in `scene_templates.toml`, scenes such as card, infographic, slides, app, site), 63 style guides (`crates/op-ai-skills/skills/style-guides/*.md`) and `shadcn-kit.json`. A converter turns `.op` into `.pen` (their format differs in names: `linear_gradient`/`solid` fills, `clipContent`), kept with MIT attribution. These feed the dashboard template gallery, `get_style`, and the default design-system library.

On top of pen.dev's structure, nib fixes what gets in the way:

- **Chat and layers at the same time.** The agent panel docks on its own (right or bottom), so the layer tree and inspector stay visible while an agent works.
- **See what the agent did.** A live change feed lists each agent operation (inserted, updated, moved, deleted) with click-to-select; each agent step is one undo checkpoint; per-agent cursors and labels on the canvas instead of only a placeholder tint. Status 2026-10-30: done. Each agent change plays out over at most 2.4 s once it is laid out: the agent's cursor (named after its MCP client, one color per agent) glides to every node it inserts, updates or deletes from, inserted nodes fade and scale in one after another, touched nodes flash an outline; undo/redo and reduced-motion skip it. Edits made through the `browser` tool carry the calling agent's name.
- **Visual diffs.** `.pen` files live in Git, so nib shows a before/after diff of any frame between two versions (commit, checkpoint, or agent step).
- **Problems panel.** The same checks agents get from `Get` (clipped or overflowing nodes, collapsed layouts, missing fills, low contrast) are shown to people, with jump-to-node.
- **Command palette.** One searchable palette for every action, node names and frames (pen.dev puts chat on Cmd+K).
- **Chinese and English UI from the start.**
- **No account, no limits, local-first.** Agents use the user's own subscriptions or keys.
- **Fast on large files.** The corpus includes a 3.2 MB document; panning and selection must stay at 60 fps there.

open-pencil and ZSeven-W/openpencil (both MIT) are references for interaction details. pen.dev's binaries are not decompiled: nib stays a clean-room implementation built from docs, screenshots and observed file behaviour.

## Conformance

- Corpus: the 13 local `.pen` files (private designs, referenced by path through `NIB_CORPUS`, never committed). Synthetic fixtures live in the repo.
- Pixel oracle: 34 frames already exported from pen.dev at 1x in the corpus projects (`*/design/exports/*.png` in aris-lab, inkwords, mactoys, silicon-agent). Some `.pen` files may have changed since export, so each PNG is matched to its frame by name and size first.
- Bounds oracle: pen.dev's resolved bounds for every node, stored outside the repo in `~/Playground/nib-oracle` (`NIB_ORACLE`). Not captured yet: the pen.dev plan limit was already reached on 2026-10-29. Capture in one agent day after the billing period resets.
- Behaviour that the reference leaves open is decided by the oracle once available and listed under "Open semantics" until then.

## Open semantics

Settled from the corpus and pen.dev's exports:
- Frames without `layout` are horizontal; pen.dev drops default values when saving.
- Image `mode` also takes `fill` (= cover) and `fit` (= contain) in older files; shadows take `spread`.
- pen.dev draws text with Chromium on macOS: Han characters fall back to PingFang SC, fullwidth forms
  (U+FF00-FFEF) to Hiragino Sans. Line boxes follow CSS: explicit `lineHeight` gives fractional line heights
  with the primary font centred; `normal` unites rounded ascent/descent/line gap of the fonts a line uses,
  a fallback counting only for glyphs the primary font lacks.
- Strokes in pen.dev's renders sit crisply inside the box: default `strokeAlignment` is `inner`.

Still open (calibrate with the bounds oracle):
- Lines mixing Latin and CJK without `lineHeight` come out 1-2 px taller in pen.dev than the CSS model
  predicts; long columns drift by up to 7 px. The system locale (Traditional Chinese) may change which
  fallback face Chromium picks.
- What `layoutIncludeStroke` adds to a child's layout size.
- Reference syntax for imported components and variables (assumed `alias:id`).
- Differences between format versions 2.18, 2.20 and 2.21 (nib preserves the version it read).
- lucide no longer ships brand icons (`figma` is used in the corpus).
- Mesh gradients: no example in the corpus. nib reads `points` as positions in the node's unit box (row by row, `columns` × `rows`) and `leftHandle`/`rightHandle`/`topHandle`/`bottomHandle` as absolute control points in the same box (as SwiftUI's MeshGradient bezier points); edges without them are straight, colors blend bicubically. Check against pen.dev's rendering once the oracle exists.
