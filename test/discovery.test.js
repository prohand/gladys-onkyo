import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseHosts, probeHost, scanLan } from '../src/onkyo/discovery.js';
import { buildPacket } from '../src/onkyo/eiscp.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeReceiver } from './helpers/fakeReceiver.js';
import { NRI_SAMPLE } from './helpers/samples.js';

const reply = (ip, line) => ({
  source_ip: ip,
  source_port: 60128,
  payload_base64: buildPacket(line).toString('base64'),
});

test('the scan goes through the core, on port 60128, and reads every answer', async () => {
  const gladys = createFakeGladys({
    scanReplies: [
      reply('192.168.1.40', 'ECNTX-NR686/60128/DX/0009B0E1F2A3'),
      reply('192.168.1.40', 'ECNTX-NR686/60128/DX/0009B0E1F2A3'),
      reply('192.168.1.41', 'ECNVSX-LX303/60128/XX/00E036112233'),
      reply('192.168.1.99', 'PWR01'),
    ],
  });
  const found = await scanLan(gladys, 3);
  assert.equal(gladys.scans[0].type, 'udp-active-broadcast');
  assert.equal(gladys.scans[0].options.port, 60128);
  assert.equal(gladys.scans[0].options.timeoutSeconds, 3);
  assert.equal(gladys.scans[0].options.payload.subarray(16).toString(), '!xECNQSTN\r');
  assert.deepEqual(found, [
    { id: '0009b0e1f2a3', host: '192.168.1.40', port: 60128, model: 'TX-NR686' },
    { id: '00e036112233', host: '192.168.1.41', port: 60128, model: 'VSX-LX303' },
  ]);
});

test('typed addresses: IPs, names, ports, any separator', () => {
  assert.deepEqual(parseHosts('192.168.1.40, ampli.local:60129\n10.0.0.2;;'), [
    { host: '192.168.1.40', port: 60128 },
    { host: 'ampli.local', port: 60129 },
    { host: '10.0.0.2', port: 60128 },
  ]);
  assert.deepEqual(parseHosts(''), []);
  assert.deepEqual(parseHosts('http://x/'), []);
  assert.deepEqual(parseHosts('1.2.3.4, 1.2.3.4'), [{ host: '1.2.3.4', port: 60128 }]);
});

function fakeUdp(answer) {
  return () => {
    const socket = new EventEmitter();
    socket.close = () => {};
    socket.send = (_packet, _port, _host, callback) => {
      callback?.();
      if (answer) {
        setImmediate(() => socket.emit('message', answer));
      }
    };
    return socket;
  };
}

test('a typed receiver is asked in unicast UDP', async () => {
  const info = await probeHost(
    { host: '10.0.0.2', port: 60128 },
    { socketFactory: fakeUdp(buildPacket('ECNTX-8270/60128/DX/0009B0AABBCC')) },
  );
  assert.deepEqual(info, { id: '0009b0aabbcc', host: '10.0.0.2', port: 60128, model: 'TX-8270' });
});

test('no UDP answer: the receiver is asked over TCP (NRI)', async () => {
  const fake = createFakeReceiver({ nri: NRI_SAMPLE });
  const info = await probeHost(
    { host: '10.0.0.3', port: 60128 },
    { socketFactory: fakeUdp(null), timeoutMs: 50, tcpSocketFactory: fake.socketFactory },
  );
  assert.deepEqual(info, { id: '0009b0e1f2a3', host: '10.0.0.3', port: 60128, model: 'TX-NR686' });
});

test('nobody there: null, no exception', async () => {
  const fake = createFakeReceiver({ refuse: true });
  const info = await probeHost(
    { host: '10.0.0.4', port: 60128 },
    { socketFactory: fakeUdp(null), timeoutMs: 30, tcpSocketFactory: fake.socketFactory },
  );
  assert.equal(info, null);
});
