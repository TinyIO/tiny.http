const events = require('events');
const {
  sizeof_tiny_net_tcp_t,
  tiny_net_tcp_init_server,
  tiny_net_tcp_destroy_server,
  tiny_net_tcp_listen,
  tiny_net_tcp_socketname,
  tiny_net_tcp_close
} = require('../binding');
const Connection = require('./connection');
const lookup = require('./lookup');

class Server extends events.EventEmitter {
  constructor(opts) {
    if (!opts) opts = {};
    super();

    this.connections = [];
    this.allowHalfOpen = !!opts.allowHalfOpen;

    this._closed = false;
    this._address = null;
    this._handle = null;
  }

  address() {
    if (!this._address) throw new Error('Not bound');
    return tiny_net_tcp_socketname(this._handle);
  }

  close(onclose) {
    if (!this._address) return;
    if (onclose) this.once('close', onclose);
    if (this._closed) return;
    this._closed = true;
    tiny_net_tcp_close(this._handle);
  }

  listen(port, address, backlog = 511, onlistening) {
    if (typeof port === 'function') return this.listen(0, '0.0.0.0', 511, port);
    if (typeof address === 'function') return this.listen(port, '0.0.0.0', 511, address);
    if (typeof backlog === 'function') return this.listen(port, address, 511, backlog);

    if (!port) port = 0;
    if (typeof port !== 'number') port = Number(port);

    if (onlistening) this.once('listening', onlistening);

    lookup(address, (err, ip) => {
      if (err) {
        this.emit('error', err);
        return;
      }

      if (this._address) this.emit('error', new Error('Already bound'));

      this._init();

      try {
        tiny_net_tcp_listen(this._handle, port, ip, backlog);
      } catch (err) {
        this.emit('error', err);
      }

      this._address = ip;
      this.emit('listening');
    });

    return this;
  }

  _init() {
    if (this._handle) return;

    this._handle = Buffer.alloc(sizeof_tiny_net_tcp_t);

    tiny_net_tcp_init_server(this._handle, this, this._onallocconnection, this._onclose, true);

    // tiny_net_tcp_keep_alive(this._handle, true, 500);
    // tiny_net_tcp_no_delay(this._handle, true);
  }

  _onclose() {
    this._closed = false;
    this._address = null;
    tiny_net_tcp_destroy_server(this._handle);
    this._handle = null;
    this.emit('close');
  }

  _onallocconnection() {
    const c = new Connection(this);
    return c._handle;
  }
}

module.exports = Server;
