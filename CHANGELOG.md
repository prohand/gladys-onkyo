# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [1.1.0] - 2026-10-12

### Added

- Dashboard widget: a **Play a source** button, while the zone is in standby, opens a form (input of the zone, optional volume capped by the maximum volume) and runs it like the `play_source` scene action.

### Changed

- `@gladysassistant/integration-sdk` updated to 0.15.0.
- Requires Gladys 5.2.0 (the first release relaying the values of a widget button form).

## [1.0.1] - 2026-10-11

### Added

- First version: Onkyo, Integra and Pioneer network AV receivers driven locally over eISCP (TCP/UDP port 60128), no account, no cloud.
- Automatic discovery from the Discovery tab, through the Gladys core (`udp-active-broadcast`), and receivers typed by hand for the ones on another subnet.
- One Gladys device per zone (main, zone 2, zone 3; automatic from what the receiver declares): power, volume, mute, volume up/down, input. The main zone adds listening mode, tuner preset, play/pause/stop/next/previous and "now playing".
- Input names read from the receiver (NRI), so the select shows the names the user gave them.
- Changes made on the remote, the front panel or another app show up at once (push, no polling); the link is watched and re-opened on its own.
- A maximum volume setting no slider, button or scene can cross.
- Scene triggers (Gladys 5.1): input changed, new track, receiver online/offline.
- Scene actions (Gladys 5.1): play an input (power on, wait, input, volume), mute on/off/toggle, listening mode, raw ISCP command.
- Dashboard widget (Gladys 5.1): what plays, volume, input, power, mute, listening mode and link of a zone, with power, volume and mute buttons.
- "Test the connection" and "Send an ISCP command" buttons in the configuration.
- Transport badge per device (`local` / `unreachable`) and a connection status that names the unreachable receivers.
- `SECURITY.md`, `CHANGELOG.md`, `CLAUDE.md`, CI (format, lint, tests on Node 22 and 24, store checks and Docker build on pull requests), Dependabot, UI-driven releases with GitHub Releases.

[Unreleased]: https://github.com/prohand/gladys-onkyo/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/prohand/gladys-onkyo/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/prohand/gladys-onkyo/releases/tag/v1.0.1
