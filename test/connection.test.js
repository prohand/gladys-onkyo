import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EiscpConnection } from '../src/onkyo/connection.js';
import { createFakeReceiver, until } from './helpers/fakeReceiver.js';

function connect(fake, timings = {}) {
  return new EiscpConnection({
    host: '192.168.1.40',
    socketFactory: fake.socketFactory,
    writeGapMs: 0,
    reconnectBaseMs: 5,
    reconnectMaxMs: 20,
    ...timings,
  });
}

test('the link comes up, sends orders and gets answers', async () => {
  const fake = createFakeReceiver();
  const connection = connect(fake);
  const events = [];
  connection.on('online', () => events.push('online'));
  connection.start();
  await until(() => connection.online);

  const answer = await connection.query('MVLQSTN');
  assert.deepEqual(answer, { unit: '1', command: 'MVL', value: '28' });
  await connection.send('PWR00');
  assert.deepEqual(fake.commands, ['MVLQSTN', 'PWR00']);
  assert.deepEqual(events, ['online']);
  connection.stop();
});

test('an order while offline fails at once', async () => {
  const connection = connect(createFakeReceiver());
  await assert.rejects(connection.send('PWR01'), /not connected/);
});

test('a dropped link goes offline and comes back by itself', async () => {
  const fake = createFakeReceiver();
  const connection = connect(fake);
  const events = [];
  connection.on('online', () => events.push('online'));
  connection.on('offline', () => events.push('offline'));
  connection.start();
  await until(() => connection.online);

  fake.drop();
  await until(() => events.includes('offline'));
  await until(() => connection.online);
  assert.deepEqual(events, ['online', 'offline', 'online']);
  assert.equal(fake.connections, 2);
  connection.stop();
});

test('a refused connection is retried with a growing delay', async () => {
  const fake = createFakeReceiver({ refuse: true });
  const connection = connect(fake);
  connection.start();
  await until(() => fake.sockets.length >= 3);
  assert.equal(connection.online, false);
  assert.equal(connection.lastError, 'ECONNREFUSED');
  assert.ok(connection.attempt >= 2);
  connection.stop();
  const opened = fake.sockets.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fake.sockets.length, opened, 'no reconnection after stop()');
});

test('a receiver that stops answering is reconnected by the keep-alive', async () => {
  const fake = createFakeReceiver();
  const connection = connect(fake, { keepAliveMs: 20, queryTimeoutMs: 10 });
  connection.start();
  await until(() => connection.online);
  fake.silent = true;
  await until(() => fake.connections >= 2, 2000);
  connection.stop();
});

test('a query nobody answers times out', async () => {
  const fake = createFakeReceiver();
  const connection = connect(fake, { queryTimeoutMs: 10 });
  connection.start();
  await until(() => connection.online);
  await assert.rejects(connection.query('XYZQSTN'), /No answer/);
  connection.stop();
});

test('over a real TCP socket (localhost), as with a receiver', async () => {
  const net = await import('node:net');
  const { buildPacket, createParser } = await import('../src/onkyo/eiscp.js');
  const received = [];
  const server = net.createServer((socket) => {
    const parse = createParser(({ command, value }) => {
      received.push(`${command}${value}`);
      if (value === 'QSTN') {
        // The way a receiver ends its lines: EOF, CR, LF.
        socket.write(buildPacket(`${command}01\x1a\r\n`));
      }
    });
    socket.on('data', parse);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const connection = new EiscpConnection({
    host: '127.0.0.1',
    port: server.address().port,
    writeGapMs: 0,
  });
  connection.start();
  await until(() => connection.online);
  assert.deepEqual(await connection.query('PWRQSTN'), { unit: '1', command: 'PWR', value: '01' });
  await connection.send('MVL20');
  await until(() => received.length === 2);
  assert.deepEqual(received, ['PWRQSTN', 'MVL20']);
  connection.stop();
  await new Promise((resolve) => server.close(resolve));
});
