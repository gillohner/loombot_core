# Configuration Guide

Bot configuration is a single operator-owned `config.yaml` loaded at startup, plus per-chat
overrides that chat admins set via the inline `/config` menu.

## Getting started

Copy one of the example profiles from `configs/` to the project root as `config.yaml` and edit it. A
`.env.local` file supplies runtime flags like `BOT_TOKEN`.

```bash
cp configs/general-purpose.example.yaml config.yaml
cp .env.example .env.local
# edit both, then:
deno task config:check   # validate the YAML + its feature references
deno task dev            # run in polling mode
```

Two example profiles ship in `configs/`:

- `general-purpose.example.yaml` — no Pubky identity, sensible defaults. Good starting point.
- `dezentralschweiz.example.yaml` — Pubky-enabled, Swiss bitcoin community profile with a full set
  of services wired up. Useful reference for the feature schema.

## config.yaml structure

```yaml
bot:
  admin_ids: [123456789] # super-admins everywhere
  lock_dm_config: false # true → only super-admins can /config in DMs

pubky: # optional — needed if any feature publishes to Pubky
  enabled: true
  recovery_file: ./secrets/op.pkarr
  passphrase_env: PUBKY_PASSPHRASE
  approval_group_chat_id: -1001234567890
  approval_timeout_hours: 24

features:
  <feature_id>:
    service: <service_name> # must match a registered service in src/services/registry.ts
    groups: true # enabled by default in groups
    dms: true # enabled by default in DMs
    lock: false # true → chat admins cannot toggle this via /config
    command: mycommand # optional, defaults to <feature_id>
    config: { ... } # arbitrary, validated by the service's configSchema
    datasets: { ... } # optional, inline datasets
    allow_external_calendars: false # meetups-only: allow chat admins to add pubky:// URIs
```

### Feature fields

| Field                      | Required | Description                                                        |
| -------------------------- | -------- | ------------------------------------------------------------------ |
| `service`                  | yes      | Name of a service from `src/services/registry.ts`                  |
| `groups`                   | no       | Enabled in groups/supergroups (default `true`)                     |
| `dms`                      | no       | Enabled in private chats (default `false`)                         |
| `lock`                     | no       | If `true`, chat admins cannot override `enabled` via /config       |
| `command`                  | no       | Command name (without `/`), defaults to the feature id             |
| `config`                   | no       | Service config blob — shape defined by the service                 |
| `datasets`                 | no       | Named dataset payloads passed to the service                       |
| `allow_external_calendars` | no       | `meetups` only — let chat admins add external `pubky://` calendars |

You can have multiple features pointing at the same underlying service with different configs (e.g.
two independent `triggerwords` instances with different word lists).

## Per-chat overrides

Chat admins run `/config` in any chat (admin-only) to open an inline menu that writes into the
`chat_feature_overrides` table. Supported override shapes today:

| Feature      | Override shape                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| _any_        | `enabled` toggle (ignored if `lock: true` in `config.yaml`)                                     |
| `meetups`    | `selected_calendar_ids`, `external_calendars`, `periodic` block (enabled/day/hour/tz/range/pin) |
| `new_member` | `welcome_override` (replaces `config.message`)                                                  |

`resolveChatConfig()` in `src/core/config/merge.ts` is the single source of truth for "what is live
in this chat". It merges the operator defaults with the chat's overrides and produces a
`ResolvedFeature[]` list that the snapshot builder and the `/config` UI both consume.

## Environment variables

Runtime-only flags (process-level, set in `.env.local` or the Docker environment):

| Variable               | Default         | Description                                        |
| ---------------------- | --------------- | -------------------------------------------------- |
| `BOT_TOKEN`            | _required_      | Telegram bot token                                 |
| `NODE_ENV`             | `development`   | `development` or `production`                      |
| `DEBUG`                | `0`             | Enable debug logging                               |
| `LOG_MIN_LEVEL`        | `info`          | `debug`, `info`, `warn`, `error`                   |
| `LOG_PRETTY`           | `0`             | Pretty-print logs instead of JSON                  |
| `WEBHOOK`              | `0`             | `1` → webhook mode, `0` → polling                  |
| `CONFIG_FILE`          | `./config.yaml` | Path to the operator config file                   |
| `LOCAL_DB_URL`         | `./bot.sqlite`  | SQLite database path                               |
| `DEFAULT_MESSAGE_TTL`  | `0`             | Auto-delete bot messages after N seconds (0 = off) |
| `ENABLE_DELETE_PINNED` | `0`             | Allow the bot to delete pinned messages            |
| `PUBKY_PASSPHRASE`     | —               | Passphrase for the Pubky recovery keypair          |

Optional config-file overrides (let Docker/Umbrel/Start9 installs patch `config.yaml` without
editing the file):

| Variable                       | Patches                           |
| ------------------------------ | --------------------------------- |
| `BOT_ADMIN_IDS`                | `bot.admin_ids` (comma-separated) |
| `LOCK_DM_CONFIG`               | `bot.lock_dm_config`              |
| `PUBKY_ENABLED`                | `pubky.enabled`                   |
| `PUBKY_RECOVERY_FILE`          | `pubky.recovery_file`             |
| `PUBKY_APPROVAL_GROUP_CHAT_ID` | `pubky.approval_group_chat_id`    |
| `PUBKY_APPROVAL_TIMEOUT_HOURS` | `pubky.approval_timeout_hours`    |

## Passing config to services

Services receive their merged feature config on every event:

```typescript
function handleCommand(ev: CommandEvent) {
	const config = ev.serviceConfig as MyConfigType;
	const greeting = config?.greeting ?? "Hello!";
	// ...
}
```

The `config` blob in `config.yaml` is validated against the service's `configSchema` when the
snapshot is built. Invalid configs cause the feature to fail to load with a clear error.

## Datasets

Datasets are large or structured data passed into a service alongside its config. Define them inline
under the feature in `config.yaml`:

```yaml
features:
  shitcoin_alarm:
    service: triggerwords
    config: { responseProbability: 1, cooldownSeconds: 60 }
    datasets:
      triggers:
        version: "1.0.0"
        entries:
          - matchMode: word
            triggers: [solana, cardano, ...]
            responses: ["Not in this chat."]
```

In the service, access via `ev.datasets.triggers`. Each service declares its expected dataset shapes
via `datasetSchemas` in its manifest and the loader validates them at startup.

## Admin commands

| Command   | Description                                                       |
| --------- | ----------------------------------------------------------------- |
| `/start`  | (Re)publish the bot's command list for this chat                  |
| `/config` | Admin-only inline menu for per-chat feature toggles and overrides |

Admins are determined by `bot.admin_ids` (super-admins everywhere) plus Telegram chat admins in
groups. In private chats, any user is admin of their own DM unless `bot.lock_dm_config: true`, in
which case only super-admins can `/config`.

## Snapshot caching

Routing snapshots (config → command/listener routing table) are cached by `config_hash` in the
`snapshots_by_config` SQLite table and in memory with a 10s TTL. All persisted snapshots are wiped
on every process start, so code changes (`--watch`) and `config.yaml` edits are always picked up on
the next request.

To force a rebuild without restarting, toggle any feature in `/config` and toggle it back — the hash
changes and the next request rebuilds from scratch.

## SQLite tables

| Table                    | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `chat_feature_overrides` | Per-chat feature toggles and override data (calendars, periodic, …) |
| `snapshots_by_config`    | Cached routing snapshots keyed by config hash                       |
| `service_bundles`        | Content-addressed bundled service code                              |
| `ttl_messages`           | Scheduled message auto-deletions                                    |
| `pending_writes`         | Pubky write admin-approval queue                                    |
| `periodic_pin_state`     | Scheduler per-chat last-pinned message id + last-fired slot         |

## Troubleshooting

- **Config not loading:** `deno task config:check <path>` runs the YAML through the loader and
  prints the first validation error.
- **Feature not appearing in a chat:** check `groups` / `dms` in `config.yaml`, check whether
  `lock: true` is preventing an override, and check the chat's `chat_feature_overrides` row with
  `sqlite3 bot.sqlite "SELECT * FROM chat_feature_overrides WHERE chat_id = ?;"`.
- **Pubky feature auto-disabled:** any feature whose service requires Pubky writes (e.g.
  `event_creator`) is silently disabled when `pubky.enabled: false`. Watch for
  `config.feature.auto_disabled_no_pubky` log lines at startup.
- **State not persisting:** only `command_flow` services have persistent state (scoped to
  `chatId + userId + serviceId`, in-memory, lost on restart). `single_command` services don't.
