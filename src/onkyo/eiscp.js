// -----------------------------------------------------------------------------
// eISCP: the Onkyo / Integra / Pioneer network protocol (TCP and UDP 60128).
//
// Every message is a 16-byte header followed by an ISCP line:
//
//   "ISCP" | header size (u32 BE, 16) | data size (u32 BE) | version 0x01 | 3 x 0x00
//   "!1PWR01\r"
//
// `!` starts the line, `1` is the unit type (1 = receiver, `x` = any, used by
// the discovery query), then a 3-letter command and its parameter. The receiver
// ends its own lines with EOF (0x1A), often followed by CR/LF: everything after
// the parameter is stripped here, the rest of the code only sees
// `{ command, value }`.
// -----------------------------------------------------------------------------

export const EISCP_PORT = 60128;

const MAGIC = Buffer.from('ISCP', 'ascii');
const HEADER_SIZE = 16;
// A receiver's NRI answer (an XML description) runs to a few dozen KB. Anything
// far beyond that is a stream gone out of sync, not a message.
const MAX_DATA_SIZE = 512 * 1024;

/**
 * Build an eISCP packet.
 * @param {string} command command and parameter, e.g. `PWR01` or `MVLQSTN`
 * @param {string} [unitType] `1` for a receiver, `x` for the discovery query
 * @returns {Buffer}
 */
export function buildPacket(command, unitType = '1') {
  const data = Buffer.from(`!${unitType}${command}\r`, 'ascii');
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt32BE(HEADER_SIZE, 4);
  header.writeUInt32BE(data.length, 8);
  header.writeUInt8(0x01, 12);
  return Buffer.concat([header, data]);
}

/**
 * Decode the ISCP line carried by a packet.
 * @param {string} line e.g. `!1PWR01\x1a\r\n`
 * @returns {{ unit: string, command: string, value: string } | null}
 */
export function parseLine(line) {
  const start = line.indexOf('!');
  if (start === -1 || line.length < start + 5) {
    return null;
  }
  const body = trimControlEnd(line.slice(start + 2));
  const command = body.slice(0, 3);
  if (!/^[A-Z0-9]{3}$/.test(command)) {
    return null;
  }
  return { unit: line[start + 1], command, value: body.slice(3) };
}

// EOF (0x1A), CR, LF, and the 0x19 some models put before them.
function trimControlEnd(text) {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) < 0x20) {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Cut a TCP stream into messages. TCP delivers bytes, not packets: one `data`
 * event can carry half a message, or three.
 * @param {(message: { unit: string, command: string, value: string }) => void} onMessage
 * @returns {(chunk: Buffer) => void} feed it every chunk the socket delivers
 */
export function createParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const start = buffer.indexOf(MAGIC);
      if (start === -1) {
        // Keep the last bytes: they may be the beginning of the next "ISCP".
        buffer = buffer.subarray(Math.max(0, buffer.length - (MAGIC.length - 1)));
        return;
      }
      if (start > 0) {
        buffer = buffer.subarray(start);
      }
      if (buffer.length < HEADER_SIZE) {
        return;
      }
      const headerSize = buffer.readUInt32BE(4);
      const dataSize = buffer.readUInt32BE(8);
      if (headerSize < HEADER_SIZE || headerSize > 64 || dataSize > MAX_DATA_SIZE) {
        // Not a real header: skip this "ISCP" and look for the next one.
        buffer = buffer.subarray(MAGIC.length);
        continue;
      }
      if (buffer.length < headerSize + dataSize) {
        return;
      }
      const line = buffer.subarray(headerSize, headerSize + dataSize).toString('utf8');
      buffer = buffer.subarray(headerSize + dataSize);
      const message = parseLine(line);
      if (message) {
        onMessage(message);
      }
    }
  };
}

/** The discovery query: "any unit type, tell me who you are". */
export function buildDiscoveryPacket() {
  return buildPacket('ECNQSTN', 'x');
}

/**
 * Decode a discovery answer: `!1ECNTX-NR686/60128/DX/0009B0E1F2A3`.
 * @param {Buffer} payload the UDP datagram
 * @returns {{ model: string, port: number, region: string, id: string } | null}
 *   `id` is the identifier the receiver gives itself (its MAC address), in
 *   lower case: the stable id the Gladys devices are built on.
 */
export function parseDiscoveryReply(payload) {
  let line = payload.toString('utf8');
  if (payload.subarray(0, 4).equals(MAGIC) && payload.length >= HEADER_SIZE) {
    const headerSize = payload.readUInt32BE(4);
    line = payload.subarray(headerSize).toString('utf8');
  }
  const message = parseLine(line);
  if (!message || message.command !== 'ECN') {
    return null;
  }
  const [model, port, region, identifier] = message.value.split('/');
  const id = String(identifier ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!model || !id) {
    return null;
  }
  const parsedPort = Number.parseInt(port, 10);
  return {
    model: model.trim(),
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : EISCP_PORT,
    region: (region ?? '').trim(),
    id,
  };
}
