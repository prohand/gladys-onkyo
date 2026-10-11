// -----------------------------------------------------------------------------
// Finding the receivers on the network.
//
// Onkyo receivers answer a UDP query sent to port 60128 ("!xECNQSTN") with
// their model and their MAC address. Sent in broadcast, it finds every receiver
// of the LAN. But this integration runs in a container on a bridge network: a
// broadcast sent from here never reaches the LAN. So the broadcast is sent by
// the Gladys core, which sits on the host network (manifest
// `network_discovery`, type `udp-active-broadcast`): this code forges the
// query, the core sends it and hands back the raw answers.
//
// Unicast does cross the bridge: a receiver typed by hand in the
// configuration (another subnet, a VLAN, a core too old for mediated
// discovery) is asked directly, the same question, at its own address.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { createLogger } from '@gladysassistant/integration-sdk';
import { EiscpConnection } from './connection.js';
import { buildDiscoveryPacket, EISCP_PORT, parseDiscoveryReply } from './eiscp.js';
import { parseNri } from './nri.js';

const logger = createLogger({ name: 'discovery' });

/**
 * Ask the Gladys core to broadcast the discovery query on the LAN.
 * @param {object} gladys the SDK instance
 * @param {number} [timeoutSeconds]
 * @returns {Promise<Array<{ id: string, host: string, port: number, model: string }>>}
 */
export async function scanLan(gladys, timeoutSeconds = 4) {
  const replies = await gladys.scanNetwork('udp-active-broadcast', {
    port: EISCP_PORT,
    payload: buildDiscoveryPacket(),
    timeoutSeconds,
  });
  const found = new Map();
  for (const reply of replies ?? []) {
    const info = parseDiscoveryReply(Buffer.from(reply.payload_base64 ?? '', 'base64'));
    if (info && !found.has(info.id)) {
      found.set(info.id, {
        id: info.id,
        host: reply.source_ip,
        port: info.port,
        model: info.model,
      });
    }
  }
  return [...found.values()];
}

/**
 * Parse the "Receiver addresses" field: IPs or host names, an optional
 * `:port`, separated by commas, spaces or new lines.
 * @param {string} text
 * @returns {Array<{ host: string, port: number }>}
 */
export function parseHosts(text) {
  const result = [];
  for (const entry of String(text ?? '').split(/[\s,;]+/)) {
    const match = /^([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(entry.trim());
    if (!match) {
      if (entry.trim()) {
        logger.warn(`Ignored receiver address "${entry.trim()}": not an IP or a host name`);
      }
      continue;
    }
    const port = match[2] ? Number(match[2]) : EISCP_PORT;
    if (port < 1 || port > 65535) {
      continue;
    }
    if (!result.some((known) => known.host === match[1] && known.port === port)) {
      result.push({ host: match[1], port });
    }
  }
  return result;
}

/**
 * Ask ONE receiver who it is, in unicast UDP, then over TCP (NRI) when UDP
 * gets no answer (a firewall between VLANs often lets TCP through only).
 * @param {{ host: string, port: number }} target
 * @param {object} [options]
 * @returns {Promise<{ id: string, host: string, port: number, model: string } | null>}
 */
export async function probeHost(target, options = {}) {
  const viaUdp = await probeUdp(target, options).catch(() => null);
  if (viaUdp) {
    return viaUdp;
  }
  return probeTcp(target, options).catch(() => null);
}

function probeUdp({ host, port }, { timeoutMs = 2000, socketFactory } = {}) {
  return new Promise((resolve) => {
    const socket = socketFactory ? socketFactory() : dgram.createSocket('udp4');
    let done = false;
    const finish = (value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on('error', () => finish(null));
    socket.on('message', (payload) => {
      const info = parseDiscoveryReply(payload);
      if (info) {
        finish({ id: info.id, host, port: info.port ?? port, model: info.model });
      }
    });
    socket.send(buildDiscoveryPacket(), port, host, (err) => {
      if (err) {
        finish(null);
      }
    });
  });
}

async function probeTcp({ host, port }, { timeoutMs = 4000, tcpSocketFactory } = {}) {
  const connection = new EiscpConnection({
    host,
    port,
    socketFactory: tcpSocketFactory,
    connectTimeoutMs: timeoutMs,
    reconnectBaseMs: 60000,
  });
  try {
    connection.start();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      connection.once('online', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const answer = await connection.query('NRIQSTN', timeoutMs);
    const description = parseNri(answer.value);
    if (!description?.id) {
      return null;
    }
    return { id: description.id, host, port, model: description.model };
  } finally {
    connection.stop();
  }
}
