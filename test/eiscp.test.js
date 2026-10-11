import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscoveryPacket,
  buildPacket,
  createParser,
  parseDiscoveryReply,
  parseLine,
} from '../src/onkyo/eiscp.js';

test('a packet carries the eISCP header and the ISCP line', () => {
  const packet = buildPacket('PWR01');
  assert.equal(packet.subarray(0, 4).toString(), 'ISCP');
  assert.equal(packet.readUInt32BE(4), 16);
  assert.equal(packet.readUInt32BE(8), '!1PWR01\r'.length);
  assert.equal(packet[12], 0x01);
  assert.equal(packet.subarray(16).toString(), '!1PWR01\r');
});

test('the line the receiver sends is cut from its EOF and CR/LF', () => {
  assert.deepEqual(parseLine('!1MVL28\x1a\r\n'), { unit: '1', command: 'MVL', value: '28' });
  assert.deepEqual(parseLine('!1NTIHello world\x1a'), {
    unit: '1',
    command: 'NTI',
    value: 'Hello world',
  });
  assert.equal(parseLine('garbage'), null);
  assert.equal(parseLine('!1mv'), null);
});

test('a TCP stream is cut into messages, whatever the chunks', () => {
  const messages = [];
  const parse = createParser((message) => messages.push(message));
  const stream = Buffer.concat([buildPacket('PWR01'), buildPacket('MVL1A'), buildPacket('SLI23')]);
  // Byte by byte: the worst case TCP can deliver.
  for (const byte of stream) {
    parse(Buffer.from([byte]));
  }
  assert.deepEqual(
    messages.map((m) => `${m.command}${m.value}`),
    ['PWR01', 'MVL1A', 'SLI23'],
  );
});

test('garbage before a packet is skipped', () => {
  const messages = [];
  const parse = createParser((message) => messages.push(message));
  parse(Buffer.concat([Buffer.from('xxISCPzz'), buildPacket('AMT01')]));
  assert.deepEqual(
    messages.map((m) => m.command),
    ['AMT'],
  );
});

test('the discovery query asks any unit type', () => {
  assert.equal(buildDiscoveryPacket().subarray(16).toString(), '!xECNQSTN\r');
});

test('a discovery reply gives model, port and MAC', () => {
  const reply = buildPacket('ECNTX-NR686/60128/DX/0009B0E1F2A3\x19');
  assert.deepEqual(parseDiscoveryReply(reply), {
    model: 'TX-NR686',
    port: 60128,
    region: 'DX',
    id: '0009b0e1f2a3',
  });
  assert.equal(parseDiscoveryReply(buildPacket('PWR01')), null);
  assert.equal(parseDiscoveryReply(Buffer.from('nothing')), null);
});
