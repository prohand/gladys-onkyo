// -----------------------------------------------------------------------------
// A pretend Onkyo receiver at the other end of a pretend TCP socket.
//
// `socketFactory()` is what EiscpConnection calls instead of net.createConnection:
// the socket it returns "connects" on the next tick, decodes the eISCP packets
// written to it, and answers the way a receiver does — a query with the state,
// an order with the new state. Tests read `commands` (everything Gladys sent)
// and call `push()` to make the receiver report a change on its own.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { buildPacket, createParser } from '../../src/onkyo/eiscp.js';

const STATE_COMMANDS = ['PWR', 'MVL', 'AMT', 'SLI', 'ZPW', 'ZVL', 'ZMT', 'SLZ', 'LMD', 'PRS'];

export function createFakeReceiver({
  state = {},
  refuse = false,
  silent = false,
  nri = null,
} = {}) {
  const receiver = {
    state: { PWR: '01', MVL: '28', AMT: '00', SLI: '2B', LMD: '00', ZPW: '00', ...state },
    commands: [],
    sockets: [],
    refuse,
    silent,
    nri,
    connections: 0,
  };

  function answer(socket, line) {
    if (receiver.silent || socket.destroyed) {
      return;
    }
    setImmediate(() => socket.emit('data', Buffer.concat([buildPacket(line)])));
  }

  function handle(socket, { command, value }) {
    const full = `${command}${value}`;
    receiver.commands.push(full);
    if (command === 'NRI') {
      if (receiver.nri) {
        answer(socket, `NRI${receiver.nri}`);
      }
      return;
    }
    if (!STATE_COMMANDS.includes(command)) {
      return;
    }
    if (value !== 'QSTN') {
      if (value === 'TG') {
        receiver.state[command] = receiver.state[command] === '01' ? '00' : '01';
      } else if (value === 'UP' || value === 'DOWN') {
        const current = Number.parseInt(receiver.state[command] ?? '0', 16);
        const next = Math.max(0, current + (value === 'UP' ? 1 : -1));
        receiver.state[command] = next.toString(16).toUpperCase().padStart(2, '0');
      } else {
        receiver.state[command] = value;
      }
    }
    if (receiver.state[command] !== undefined) {
      answer(socket, `${command}${receiver.state[command]}`);
    }
  }

  receiver.socketFactory = () => {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.setTimeout = () => {};
    socket.setNoDelay = () => {};
    socket.setKeepAlive = () => {};
    const parse = createParser((message) => handle(socket, message));
    socket.write = (buffer, callback) => {
      parse(buffer);
      callback?.();
      return true;
    };
    socket.destroy = () => {
      if (socket.destroyed) {
        return;
      }
      socket.destroyed = true;
      setImmediate(() => socket.emit('close'));
    };
    receiver.sockets.push(socket);
    setImmediate(() => {
      if (receiver.refuse) {
        socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
        socket.destroy();
        return;
      }
      receiver.connections += 1;
      socket.emit('connect');
    });
    return socket;
  };

  /** The receiver reports something on its own (remote control, knob...). */
  receiver.push = (line) => {
    const socket = receiver.sockets.at(-1);
    socket.emit('data', buildPacket(line));
  };

  /** The receiver drops the link (unplugged). */
  receiver.drop = () => {
    receiver.sockets.at(-1)?.destroy();
  };

  return receiver;
}

/** Wait for the pending immediates and timers of a few ms. */
export function settle(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until a condition holds (the fake answers asynchronously). */
export async function until(condition, timeoutMs = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Condition not met in time');
    }
    await settle(2);
  }
}
