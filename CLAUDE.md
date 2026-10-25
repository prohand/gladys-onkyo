# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Onkyo network AV receivers** (and the
Integra / Pioneer models speaking the same eISCP protocol). Local only: TCP and UDP port 60128,
no account, no cloud. Gladys 5.1+ adds scene triggers (input changed, new track, receiver
online/offline), scene actions (play an input, mute, listening mode, raw command) and a
"receiver" widget; Gladys 5.3+ (the manifest floor, `>=5.3.0`) makes the main zone a music
player (`music` features, `publishNowPlaying`, covers, manifest `"music": {}`).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/hub.test.js                # one file
node --test --test-name-pattern "cap"       # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24; pull requests also run the store
checks and build the image. Releases: **Actions → Release** only (bumps `package.json`, manifest
`version` + `docker_image`, re-runs Prettier, moves the changelog section, tags, builds,
publishes the GitHub Release).

## Architecture

```
index.js                   SDK wiring only (handlers registered before connect())
src/config.js              DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/logging.js             "Detailed logs" switch (writes LOG_LEVEL, re-read by the SDK logger)
src/hub.js                 ReceiverHub: discovery, one Receiver per MAC, states, badges,
                           connection status, scene events, Gladys orders -> ISCP
src/devices.js             one Gladys device per zone, feature keys, locate a feature/device
src/onkyo/eiscp.js         packet format, stream parser, discovery query/reply
src/onkyo/connection.js    kept-open TCP link: write queue, queries, keep-alive, reconnection
src/onkyo/receiver.js      one receiver: reported state, track settle, orders
src/onkyo/discovery.js     LAN scan through the core, typed hosts (UDP then TCP/NRI)
src/onkyo/nri.js           the receiver's XML self-description (zones, named inputs)
src/onkyo/codes.js         zones, inputs, listening modes, volume scale, NST / NTM parsing
src/onkyo/jacketArt.js     NJA jacket art packets -> one image (or a link, or none)
src/artwork.js             covers kept in memory by key, served to onMusicGetArtwork
src/capabilities/          Gladys 5.1 scene actions, widget, Configuration buttons
```

### Invariants worth knowing

- **External ids rest on the MAC address** (`ECN` discovery reply or NRI `macaddress`), never on
  the IP: DHCP moves receivers, `hub.ensure()` follows them (`moveTo`). Device types `receiver`,
  `zone2`, `zone3` and the feature keys in `FEATURES` are forever.
- **The container cannot broadcast to the LAN**: discovery goes through
  `gladys.scanNetwork('udp-active-broadcast', { port: 60128 })` (declared in the manifest
  `network_discovery`). Unicast works, which is how typed hosts are probed.
- **State is the receiver's word**: a state is only published from a message the receiver sent,
  never from the order given. Values already published are deduplicated by the SDK
  (`gladys.publishChangedStates`); `publishAll()` forgets them (`forgetPublishedStates()`) and
  re-sends everything after a reconnection to Gladys or a device creation.
- **Volume is a percentage of the configured scale** (`volume_resolution`: 50/80/100/200 steps),
  and nothing ever sends more than `max_volume` — slider, volume-up button, widget or scene.
- **Mute is a push button (toggle)** on the device; on/off/toggle with a reported result is the
  `set_mute` scene action.
- **Text features**: inputs and listening modes are `text`/`select` with `supported_options`
  (string values = ISCP codes), published as `{ text }`. Never publish an empty text (Gladys
  drops it): "now playing" falls back to `—`.
- **No scene loop**: `source_changed` is not fired for 5 s after a Gladys order on that zone's
  input; scene actions never fire triggers. First connection and first track after a connection
  are not events.
- **Receivers drop orders sent too close together**: writes are queued with a small gap.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys), text features included (0/0).
- The NRI answer is a large XML document: never log it whole.
- **Music player** (main zone only: the receiver has ONE network player, NTC / NST / NTI...):
  `gladys.publishNowPlaying` is called on the receiver's messages only (NST status, NTI / NAT /
  NAL, NTM time pushed every second — the SDK sends the position only on a jump, NJA cover),
  never on a timer nor from an order; `playback_state` is written as NTC PLAY / PAUSE / STOP and
  shows the NST that follows (`has_feedback`). Music feature keys are the music types (the SDK's
  default ids); their texts may be `''` (the contract's "nothing loaded"). Covers are image
  bytes kept under a content key and served by `onMusicGetArtwork`: BMP or > 300 KB is "no
  cover", a link is only read on the receiver's own host. No browse / search / queue: eISCP
  exposes the receiver's menus as screens, not as data.

### Manifest

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code: config defaults =
`DEFAULT_CONFIG`, action/scene/widget handlers registered, trigger keys = `SCENE_TRIGGERS`, input
and listening-mode option lists = `codes.js`, version = `package.json` = `docker_image` tag,
`gladys_version >=5.3.0` with `keywords` (1–10, 2–30 characters) and `"music": {}`, categories
in the store vocabulary, no `countries` (sold worldwide).
Texts are `{ en, fr, de, es }` objects (labels, descriptions, placeholders, options). The catalog
`description` is 10–100 characters per language.

## Testing

No hardware, no network: `test/helpers/fakeReceiver.js` is a pretend receiver behind a pretend
TCP socket (answers queries and orders — NTC play/pause/stop with the NST that follows, NJAREQ
with its `jacketArt` lines —, `push()` simulates the remote, `drop()` the cable),
`test/helpers/hubSetup.js` wires a hub to it and to `test/helpers/fakeGladys.js`.

## Conventions

- Prettier formats, ESLint catches mistakes. Comments explain **why**, in English.
- User-facing text is `{ en, fr, de, es }`; user docs in `docs/en.md`, `docs/fr.md`, `docs/de.md`
  and `docs/es.md`, kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md` (`### Added`,
  `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading, never edit `version`
  or `docker_image` by hand: the Release workflow does it.
- The container rootfs is read-only: write only under `/data` (this integration writes nothing).
