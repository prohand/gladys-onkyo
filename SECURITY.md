# Security policy

## Supported versions

Only the latest release of the Onkyo integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-onkyo](https://github.com/prohand/gladys-onkyo/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- the model of the receiver;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove addresses and MAC addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)) and the
receivers' firmware. The eISCP protocol has no authentication at all: anyone on your
local network can drive the receiver, with or without this integration. That is a
property of the receiver, not a vulnerability of this integration.

## Good practices for users

- Keep the receivers on a trusted network (or a dedicated VLAN); never expose port
  60128 to the Internet.
- Use the **Maximum volume** setting so no scene and no slider can drive the
  speakers too hard.
- Keep Gladys, the integration and the receiver firmware up to date.
