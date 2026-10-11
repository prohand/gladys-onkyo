# Onkyo — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to
**Onkyo network AV receivers** — and to the **Integra** and recent **Pioneer**
models that speak the same protocol (eISCP).

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md).

## What it does

One Gladys device per **zone** of each receiver:

| Zone           | Gladys features                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Main           | Power, volume (%), mute, volume up/down, input, listening mode, tuner preset, play/pause/stop/next/previous, now playing |
| Zone 2, zone 3 | Power, volume (%), mute, volume up/down, input                                                                           |

The input list is the one the receiver declares (NRI), with the names the user
gave the inputs; older models get the standard list. A **maximum volume** setting
caps every slider, button and scene.

Since Gladys 5.1 it also extends the scene editor and the dashboard
(`src/capabilities/`):

| Capability     | Keys                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| Scene triggers | `source_changed`, `track_changed`, `connection_changed`                                |
| Scene actions  | `play_source`, `set_mute`, `set_listening_mode`, `send_command`                        |
| Widget         | `receiver` (volume, input, power, now playing, mute, listening mode, link + 4 buttons) |

## How it talks to the hardware

One transport, declared in the manifest: **local**.

- **Discovery**: the receivers answer a UDP query on port 60128
  (`!xECNQSTN`) with their model and MAC address. The integration container sits
  on a bridge network that broadcasts never cross, so the query is forged here
  and **sent by the Gladys core** (manifest `network_discovery`,
  `udp-active-broadcast` on port 60128). Receivers typed by hand are asked in
  unicast UDP, then over TCP (NRI) when UDP gets no answer.
- **Control**: one TCP connection per receiver on port 60128, kept open. eISCP
  is a push protocol: every change (remote, front panel, another app) arrives
  without polling. The link is checked every minute and re-opened with a growing
  delay when it drops.
- **Identity**: external ids are built on the MAC address, so a receiver moved by
  DHCP keeps its devices, history and scenes.

Each device reports its transport (`publishTransports`): `local` when the link
is up, `unreachable` otherwise; the connection status names the unreachable
receivers.

## Project structure

```
.
├─ index.js                     # SDK wiring only
├─ src/
│  ├─ config.js                 # defaults (mirror the manifest) + normalization
│  ├─ logging.js                # "Detailed logs" switch
│  ├─ hub.js                    # the receivers seen from Gladys: states, badges, triggers, orders
│  ├─ devices.js                # one Gladys device per zone, external ids, features
│  ├─ onkyo/
│  │  ├─ eiscp.js               # packet format, stream parser, discovery packets
│  │  ├─ connection.js          # one kept-open TCP link: queue, queries, keep-alive, reconnection
│  │  ├─ receiver.js            # one receiver: reported state + orders
│  │  ├─ discovery.js           # LAN scan through the core, typed hosts
│  │  ├─ nri.js                 # the receiver's own description (zones, named inputs)
│  │  └─ codes.js               # ISCP vocabulary: zones, inputs, listening modes, volume scale
│  └─ capabilities/
│     ├─ scenes.js              # scene actions
│     ├─ widget.js              # dashboard widget
│     └─ actions.js             # Configuration screen buttons
├─ docs/en.md, docs/fr.md       # user documentation (re-hosted by Gladys)
├─ test/                        # node --test, no network, no hardware
├─ gladys-assistant-integration.json
├─ Dockerfile                   # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
└─ .github/                     # CI, release, build, GitHub Releases, Dependabot
```

## Development

```bash
npm install
npm test               # node --test
npm run lint           # ESLint
npm run format:check   # Prettier (CI gate)
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="onkyo" \
LOG_LEVEL=debug \
npm start
```

The CI runs format, lint and tests on Node 22 and 24 on every push and pull
request; pull requests also run the store admission checks and build the Docker
image.

## Release

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md),
then **Actions → Release → Run workflow** (`patch`, `minor` or `major`). The
workflow bumps `package.json` and the manifest (`version` + `docker_image`),
moves the changelog section, tags `vX.Y.Z`, builds the `linux/amd64` +
`linux/arm64` image to `ghcr.io` and publishes the GitHub Release.

## License

Apache-2.0
