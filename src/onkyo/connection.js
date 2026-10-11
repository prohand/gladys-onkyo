// -----------------------------------------------------------------------------
// One TCP link to one receiver, kept open.
//
// eISCP is a push protocol: once connected, the receiver reports every change —
// the volume knob turned, the input picked on the remote, the track that
// changed — without being asked. So the link stays open for as long as the
// integration runs, and is re-opened when it drops (receiver unplugged, network
// standby off, Wi-Fi gone), with a growing delay so a receiver switched off for
// the night is not hammered.
//
// A link can also be silently dead: a TCP connection whose other end
// disappeared stays "open" for a long time. Every minute the receiver is asked
// its power state; no answer means the link is gone, and it is re-opened.
//
// Receivers drop orders sent too close together: writes go through a queue,
// spaced by a few tens of milliseconds.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';
import { buildPacket, createParser, EISCP_PORT } from './eiscp.js';

const logger = createLogger({ name: 'eiscp' });

export const CONNECTION_DEFAULTS = {
  connectTimeoutMs: 5000,
  reconnectBaseMs: 2000,
  reconnectMaxMs: 60000,
  keepAliveMs: 60000,
  queryTimeoutMs: 3000,
  writeGapMs: 60,
};

export class EiscpConnection extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host receiver IP address or host name
   * @param {number} [options.port] eISCP port, 60128 unless the receiver says otherwise
   * @param {Function} [options.socketFactory] `({ host, port }) => net.Socket`, for the tests
   */
  constructor({ host, port = EISCP_PORT, socketFactory, ...timings }) {
    super();
    this.host = host;
    this.port = port;
    this.socketFactory = socketFactory ?? ((target) => net.createConnection(target));
    this.timings = { ...CONNECTION_DEFAULTS, ...timings };
    this.socket = null;
    this.online = false;
    this.stopped = true;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.keepAliveTimer = null;
    this.waiters = [];
    this.writeQueue = Promise.resolve();
    this.lastError = null;
  }

  get address() {
    return `${this.host}:${this.port}`;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepAliveTimer);
    this.reconnectTimer = null;
    this.keepAliveTimer = null;
    this.rejectWaiters(new Error('Connection closed'));
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.on('error', () => {});
      this.socket.destroy();
      this.socket = null;
    }
    this.setOnline(false);
  }

  open() {
    if (this.stopped) {
      return;
    }
    const socket = this.socketFactory({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setTimeout?.(this.timings.connectTimeoutMs);
    socket.setNoDelay?.(true);
    socket.setKeepAlive?.(true, 30000);

    const parse = createParser((message) => {
      logger.debug(`${this.host} <- ${message.command}${shorten(message.value)}`);
      this.resolveWaiters(message);
      this.emit('message', message);
    });

    socket.on('connect', () => {
      // Past the connection, silence is normal: the keep-alive watches the link.
      socket.setTimeout?.(0);
      this.attempt = 0;
      this.lastError = null;
      this.setOnline(true);
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => this.checkAlive(), this.timings.keepAliveMs);
      this.keepAliveTimer.unref?.();
    });
    socket.on('data', parse);
    socket.on('timeout', () => {
      this.lastError = 'timeout';
      socket.destroy();
    });
    socket.on('error', (err) => {
      this.lastError = err.code ?? err.message;
      logger.debug(`${this.address}: ${this.lastError}`);
    });
    socket.on('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      clearInterval(this.keepAliveTimer);
      this.rejectWaiters(new Error(`Connection to ${this.address} lost`));
      this.setOnline(false);
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    const delay = Math.min(
      this.timings.reconnectBaseMs * 2 ** this.attempt,
      this.timings.reconnectMaxMs,
    );
    this.attempt += 1;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
    this.reconnectTimer.unref?.();
  }

  async checkAlive() {
    try {
      await this.query('PWRQSTN');
    } catch {
      logger.warn(`${this.address} stopped answering: reconnecting`);
      this.lastError = 'no answer';
      this.socket?.destroy();
    }
  }

  setOnline(online) {
    if (this.online === online) {
      return;
    }
    this.online = online;
    this.emit(online ? 'online' : 'offline');
  }

  /**
   * Send a command (`PWR01`, `MVLUP`, `SLIQSTN`...). Resolves once written.
   * @param {string} command
   */
  send(command) {
    if (!this.online || !this.socket) {
      return Promise.reject(new Error(`Receiver ${this.address} is not connected`));
    }
    const socket = this.socket;
    const write = this.writeQueue.then(
      () =>
        new Promise((resolve, reject) => {
          logger.debug(`${this.host} -> ${command}`);
          socket.write(buildPacket(command), (err) => {
            if (err) {
              reject(err);
              return;
            }
            setTimeout(resolve, this.timings.writeGapMs);
          });
        }),
    );
    // A failed write must not block the ones queued after it.
    this.writeQueue = write.catch(() => {});
    return write;
  }

  /**
   * Send a command and wait for the receiver's answer to it: the next message
   * carrying the same 3-letter command. `PWRQSTN` → `{ command: 'PWR', value: '01' }`.
   * @param {string} command
   * @param {number} [timeoutMs]
   */
  query(command, timeoutMs = this.timings.queryTimeoutMs) {
    const prefix = command.slice(0, 3);
    return new Promise((resolve, reject) => {
      const waiter = { prefix, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`No answer from ${this.address} to ${command}`));
      }, timeoutMs);
      this.waiters.push(waiter);
      this.send(command).catch((err) => {
        clearTimeout(waiter.timer);
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(err);
      });
    });
  }

  resolveWaiters(message) {
    const matching = this.waiters.filter((w) => w.prefix === message.command);
    if (matching.length === 0) {
      return;
    }
    this.waiters = this.waiters.filter((w) => w.prefix !== message.command);
    for (const waiter of matching) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  rejectWaiters(err) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }
}

// The NRI answer is a whole XML document: not for a log line.
function shorten(value) {
  return value.length > 80 ? `${value.slice(0, 80)}… (${value.length} chars)` : value;
}
