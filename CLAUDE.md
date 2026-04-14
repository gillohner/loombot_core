# Pubky Bot Builder — Telegram

A Deno-based Telegram bot framework with sandboxed service execution and Pubky decentralized storage
integration. Services are isolated in zero-permission Deno subprocesses and communicate via
stdin/stdout JSON.

## Quick Reference

- **Runtime:** Deno (not Node.js)
- **Framework:** grammY (Telegram bot library)
- **Database:** SQLite (via deno.land/x/sqlite)
- **Language:** TypeScript (strict)
- **Formatting:** Tabs, 100 char line width (`deno fmt`)
- **Linting:** `deno lint` (recommended rules)
- **Testing:** `deno test`
- **Dev:** `deno task dev` (polling mode with --watch)
- **Prod:** `deno task serve` (webhook mode)
- **Fresh start:** Snapshots auto-clear on every process start. Edit `config.yaml` and restart the
  bot to pick up changes. Deleting `bot.sqlite` is rarely needed.

## Architecture

```
Telegram → grammY Bot → Router Middleware → Dispatcher
                                                ↓
                                          Snapshot (routing table)
                                                ↓
                                          Sandbox Host (Deno subprocess, zero permissions)
                                                ↓
                                          Service Bundle (SDK + service code)
                                                ↓
                                          ServiceResponse → Telegram Adapter → User
```

### Core Flow

1. Telegram update arrives (polling or webhook)
2. Router handles admin commands (`/start`, `/config`) or dispatches to services
3. Dispatcher loads routing snapshot for the chat, finds matching service route
4. Service bundle (pre-bundled SDK + service code) runs in isolated Deno subprocess
5. Service returns `ServiceResponse` via stdout JSON
6. Response adapter converts to Telegram API calls

Per-chat configuration happens via the inline `/config` menu (admin-only), which writes feature
toggles and overrides into the `chat_feature_overrides` table. The operator-level defaults live in
`config.yaml` and are loaded once at startup.

## Project Structure

```
src/
├── main.ts                        # Entry point (polling vs webhook)
├── bot.ts                         # Bot init, middleware composition
├── core/
│   ├── config.ts                  # Process-wide env flags (NODE_ENV, DEBUG, …)
│   ├── config/loader.ts           # Parse + validate config.yaml at startup
│   ├── config/schema.ts           # Zod schema for config.yaml
│   ├── config/runtime.ts          # Loaded operator-config singleton + hash
│   ├── config/merge.ts            # Resolve per-chat effective feature list (operator + overrides)
│   ├── config/store.ts            # SQLite persistence (overrides, snapshots, bundles, writes, pins)
│   ├── config/migrations.ts       # DB schema migrations
│   ├── dispatch/dispatcher.ts     # Event routing → sandbox execution → state mgmt
│   ├── sandbox/host.ts            # Deno subprocess with zero permissions
│   ├── snapshot/snapshot.ts       # Effective config → routing table, caching
│   ├── scheduler/scheduler.ts     # Periodic meetups broadcast loop
│   ├── scheduler/pin_store.ts     # SQLite-backed pin + last-fired tracking
│   ├── state/state.ts             # In-memory state (chatId+userId+serviceId keyed)
│   ├── pubky/pubky.ts             # Re-export shim for calendar_meta helpers
│   ├── pubky/calendar_meta.ts     # Fetches calendar metadata from Pubky (used by /config)
│   ├── pubky/writer.ts            # Admin-approval write queue
│   ├── pubky/writer_store.ts      # Writer SQLite persistence
│   ├── ttl/store.ts               # Message auto-deletion scheduling
│   └── util/
│       ├── bundle.ts              # Inline SDK + service into a single file
│       ├── logger.ts              # Structured JSON logging
│       └── npm_allowlist.ts       # Allowed npm packages for services
├── middleware/
│   ├── router.ts                  # Command routing, admin commands
│   ├── response.ts                # ServiceResponse → Telegram API
│   ├── admin.ts                   # Permission checks
│   └── config_ui/                 # /config inline menu: features, calendars, welcome, periodic
├── services/
│   └── registry.ts                # Operator-shipped service registry
├── adapters/
│   └── telegram/
│       ├── adapter.ts             # Telegram API integration
│       └── ui_converter.ts        # UI abstraction → Telegram format
└── types/
    ├── routing.ts                 # RoutingSnapshot, CommandRoute, ListenerRoute
    ├── sandbox.ts                 # ExecutePayload, sandbox types
    └── services.ts                # Service protocol types

packages/
├── sdk/                       # Service SDK (bundled into every service)
│   ├── mod.ts                 # Public API surface
│   ├── service.ts             # defineService() + ServiceDefinition
│   ├── events.ts              # CommandEvent, CallbackEvent, MessageEvent
│   ├── state.ts               # state.replace/merge/clear()
│   ├── responses/
│   │   ├── types.ts           # ServiceResponse union type
│   │   ├── factory.ts         # reply(), edit(), photo(), pubkyWrite(), etc.
│   │   └── guards.ts          # Type guards
│   ├── ui.ts                  # UIBuilder, UIKeyboard, UIMenu, UICard, UICarousel
│   ├── i18n.ts                # Internationalization
│   ├── runner.ts              # runService() — sandbox entry point (stdin→stdout)
│   └── schema.ts              # JSON Schema validation types
├── core_services/             # Production services
│   ├── event-creator/         # Eventky event creation with multi-step flow
│   ├── help/                  # Configurable help message with command list
│   ├── links/                 # Categorized links with inline keyboard navigation
│   ├── meetups/               # Display upcoming events from Pubky calendars
│   ├── new-member/            # Welcome new group members
│   ├── simple-response/       # Responds with a configured message
│   ├── triggerwords/          # Responds to trigger words in messages
│   └── url-cleaner/           # Cleans tracking params and suggests alt frontends
└── eventky-specs/             # Local implementation of eventky data utilities
    └── mod.ts                 # URI builders, ID generation, validation, types
```

## Import Aliases (deno.json)

```
@core/     → ./src/core/
@middleware/ → ./src/middleware/
@adapters/ → ./src/adapters/
@schema/   → ./src/types/
@sdk/      → ./packages/sdk/
@eventky/  → ./packages/eventky-specs/
```

## Key Concepts

### Services

Services are isolated units of bot functionality. Three kinds:

| Kind             | Description             | State                            |
| ---------------- | ----------------------- | -------------------------------- |
| `single_command` | One-shot response       | None                             |
| `command_flow`   | Multi-step conversation | Persistent until `state.clear()` |
| `listener`       | Responds to any message | None                             |

Periodic broadcasts (meetups) are driven by the host-side scheduler in
`src/core/scheduler/scheduler.ts`, not by a service kind — the scheduler reads each chat's merged
meetups config off the snapshot and fires the broadcast directly. Per-chat periodic settings live
under `chat_feature_overrides.data.periodic`.

Services are defined with `defineService()` from the SDK and have handlers for `command`,
`callback`, and `message` events. Network access: declare `net: ["domain.com"]` in
`PubkyServiceSpec` → flows through `BaseRoute.net` → `SandboxCaps.net` → `--allow-net=domain.com` on
the subprocess.

### Sandbox Security Model

Services run in Deno subprocesses with **zero permissions by default**:

- `--allow-read=/tmp` always granted (bundles stored as temp files)
- `--allow-read=$DENO_CACHE,/tmp` for npm services (need cached modules)
- `--allow-net=domain1,domain2` only if service declares `net: ["domain"]` in spec
- No env vars — subprocess gets minimal env: `HOME`, `PATH`, `DENO_DIR`, `XDG_CACHE_HOME`
- Communication via stdin (JSON payload) → stdout (JSON response)
- Timeout enforcement (max 20s; default 2s for commands, 10s if net-enabled)
- Console output redirected to stderr in runner to avoid polluting JSON

### Snapshot System

Routing snapshots map commands → service bundles. Three-layer cache:

1. In-memory (10s TTL per chatId)
2. SQLite (keyed by config hash) — **cleared on every process startup** (`clearAllSnapshots()` in
   `bot.ts`)
3. Content-addressed bundles (SHA-256 deduplication)

On startup, all persisted snapshots are wiped so the first request triggers a fresh build. This
means code changes (via `--watch`) and edits to `config.yaml` are always picked up without needing
to delete `bot.sqlite`. To pick up `config.yaml` changes, restart the bot.

### State Management

- Scope: `(chatId, userId, serviceId)` — in-memory only, lost on restart
- Directives: `state.replace(val)`, `state.merge(val)`, `state.clear()`
- Active flows tracked per user to route messages to the correct service

### PubkyWriter (Admin Approval)

Services can call `pubkyWrite(path, data, preview)` to write to Pubky homeserver:

- Writes queued, previewed to admin Telegram group with clickable user links
- Admin reacts to approve/reject; timeout after `PUBKY_APPROVAL_TIMEOUT` (default 24h)
- Writer loads keypair from recovery file, strips "pubky" prefix from `publicKey.toString()`
- Handles Telegram image downloads → blob upload → file record → event write
- **Blob IDs use BLAKE3** (not SHA-256) per pubky-app-specs:
  `BLAKE3(content) → first 16 bytes → Crockford Base32`. Uses `@noble/hashes/blake3`.
- URIs follow pubky-app-specs format: `pubky://<z32_pk>/pub/<app>/<resource>/<id>`

### Admin Permissions

- `bot.admin_ids` in `config.yaml` — comma-separated Telegram user IDs, always admin in any chat.
  Can be overridden at runtime via the `BOT_ADMIN_IDS` env var.
- `bot.lock_dm_config` — when `true`, only the super-admins above can use `/config` in DMs; when
  `false` (default), any user is admin of their own DM.
- In groups: Telegram chat admins + the super-admins can use admin commands.
- Admin check logic lives in `src/middleware/admin.ts`.

### Configuration

Bot configuration is defined by a single operator-owned `config.yaml` loaded at startup. The top
level has three sections: `bot` (admin ids, DM lock), `pubky` (optional keypair + approval group for
services that publish events), and `features` (a dictionary of feature id → service config with
`groups` / `dms` toggles, locks, command name, config blob, datasets).

Chat admins customise per-chat via the inline `/config` menu, which writes into the
`chat_feature_overrides` table. Supported override shapes today:

- Any feature: `enabled` toggle (unless `lock: true` in `config.yaml`)
- `meetups`: `selected_calendar_ids`, `external_calendars`, and a `periodic` block (enabled / day /
  hour / timezone / range / pin / unpin_previous) overriding the matching operator defaults
- `new_member`: `welcome_override` (replaces the default welcome message)

`resolveChatConfig()` in `src/core/config/merge.ts` is the single source of truth for "what features
are live in this chat right now" — both the snapshot builder and the `/config` UI call it.

Two example profiles live in `configs/`:

- `configs/general-purpose.example.yaml` — no Pubky identity, sensible defaults
- `configs/dezentralschweiz.example.yaml` — Pubky-enabled, Swiss bitcoin community profile

Copy one to `config.yaml` and edit it. Run `deno task config:check` to validate.

## SQLite Tables

- `chat_feature_overrides` — per-chat feature toggles and config-blob overrides (source of truth for
  "known chats" — the scheduler enumerates chats via DISTINCT chat_id here)
- `snapshots_by_config` — cached routing snapshots keyed by config hash
- `service_bundles` — content-addressed bundled service code
- `ttl_messages` — scheduled message auto-deletion
- `pending_writes` — Pubky write admin-approval queue (plus `on_approval` / `on_rejection` hooks)
- `periodic_pin_state` — scheduler's per-chat last-pinned message id + last-fired slot

## Environment Variables

Runtime-only flags (process-level, not per-chat):

```bash
BOT_TOKEN                       # Required: Telegram bot token
NODE_ENV                        # development | production
DEBUG                           # 0 | 1
LOG_MIN_LEVEL                   # debug | info | warn | error
LOG_PRETTY                      # 0 | 1
WEBHOOK                         # 0 (polling) | 1 (webhook)
LOCAL_DB_URL                    # SQLite path (default: ./bot.sqlite)
CONFIG_FILE                     # YAML path (default: ./config.yaml)
DEFAULT_MESSAGE_TTL              # Auto-delete seconds (0 = disabled)
ENABLE_DELETE_PINNED            # 0 | 1
PUBKY_PASSPHRASE                # Passphrase for the recovery keypair (Pubky-enabled profiles)
```

Config-file overrides (optional, so Docker/Umbrel deployments can patch `config.yaml` without
editing it):

```bash
BOT_ADMIN_IDS                   # Comma-separated Telegram user IDs → bot.admin_ids
LOCK_DM_CONFIG                  # 1|true|yes|on → bot.lock_dm_config
PUBKY_ENABLED                   # 1|true|yes|on → pubky.enabled
PUBKY_RECOVERY_FILE             # Path to .pkarr recovery file → pubky.recovery_file
PUBKY_APPROVAL_GROUP_CHAT_ID    # Telegram group id → pubky.approval_group_chat_id
PUBKY_APPROVAL_TIMEOUT_HOURS    # Integer hours → pubky.approval_timeout_hours
```

## Bundler System (`src/core/util/bundle.ts`)

The bundler inlines all imports (SDK, eventky-specs, relative paths) into a single file for sandbox:

- **Import resolution:** Handles `@sdk/`, `@eventky/`, `./`, `../` imports recursively via regex on
  static `import`/`export` statements
- **Dynamic `import()` NOT supported:** The bundler only processes static imports. Dynamic
  `await import("../path")` is left untouched in the bundle — at runtime it resolves relative to
  `/tmp` and fails with `Module not found`. **Always use static imports in services.**
- **Relative path resolution:** `resolveRelativePath()` handles `../` by walking the path segments;
  preserves leading `/` for absolute paths
- **Output:** All services (npm and non-npm) written to temp files in `/tmp` (not data URLs — OS
  ARG_MAX limit)
- **npm handling:** Uses `deno cache` to pre-fetch allowed npm modules; subprocess gets minimal env
  to avoid ARG_MAX
- **Content addressing:** SHA-256 hash of final code → `service_bundles` table for deduplication

## SDK Patterns for Services (`packages/sdk/`)

### Response Builders

```
reply(text, opts?)          → Text message
edit(text, opts?)           → Edit existing message
photo(url, opts?)           → Photo with caption
pubkyWrite(path, data, preview) → Queue Pubky write for approval
uiKeyboard(kb, msg, opts?)  → Inline keyboard (MUST use this, not reply + keyboard)
```

### UI Message Management

- `replaceGroup: "group_name"` — Edit previous message in same group (in-place updates)
- `cleanupGroup: "group_name"` — Delete last tracked message in group before sending new one
- `deleteTrigger: true` — Delete the message that triggered this response

### State Directives

```
state.replace(val)  — Overwrite all state
state.merge(val)    — Shallow merge into existing
state.clear()       — Erase state, end flow
```

### UI Keyboard Namespacing

`UIBuilder.keyboard().namespace(serviceId)` prefixes callback data with `svc:<serviceId>|`. The
namespace MUST match either a command key or a route's serviceId for callback routing to work.

### Important

- `reply()` only passes `options`, `state`, `deleteTrigger`, `ttl` — spreading `uiKeyboard()` result
  into reply opts silently drops the keyboard. Always use `uiKeyboard(kb, msg, { state })` directly.
- **HTML parse mode:** All services and the adapter use `parse_mode: "HTML"`. Use `<b>bold</b>`,
  `<i>italic</i>`, `<a href="...">link</a>`, `<code>code</code>`. Escape user-provided text with
  `escapeHtml()` to prevent injection.
- **Image uploads:** Telegram sends compressed images as `message.photo` (array of sizes) and
  uncompressed/file images as `message.document` with `mime_type: "image/*"`. Services must check
  both properties.
- **Date validation in flows:** When collecting end date/time, validate end date >= start date
  immediately at input (not just at final end-time validation). Otherwise users get stuck in an
  unrecoverable loop where any end time is rejected.

## Pubky URI Formats

Follow pubky-app-specs exactly:

```
pubky://<z32_public_key>/pub/eventky.app/calendars/<calendarId>
pubky://<z32_public_key>/pub/eventky.app/events/<eventId>
pubky://<z32_public_key>/pub/pubky.app/files/<fileId>
pubky://<z32_public_key>/pub/pubky.app/blobs/<blobId>
```

The public key is a 52-character z-base-32 string (NO "pubky" prefix).
`keypair.publicKey.toString()` returns the key WITH "pubky" prefix — must be stripped.

## Development Notes

- Always use `deno fmt` before committing (tabs, 100 char lines)
- Snapshots auto-clear on process startup — code and config changes are picked up on restart without
  manual intervention
- The SDK is fully inlined into service bundles — changes to `packages/sdk/` affect all services
- npm packages in services must be on the allowlist (`src/core/util/npm_allowlist.ts`)
- Tests: `deno task test` — uses Deno's built-in test runner
- Config validation: `deno task config:check <path>` — parses a YAML profile through the loader
  without booting the bot
- `dispatch.miss` logs at debug level (hidden at default info level) — set `LOG_MIN_LEVEL=debug` to
  see routing misses
- **Never use dynamic `import()` in services** — the bundler only handles static imports. Dynamic
  imports resolve to `/tmp/...` at runtime and fail.
- **JSON config mutations are not a concern** — services are not deployed yet, so breaking changes
  to config schemas, service definitions, or data formats can be made freely without migration
  worries
