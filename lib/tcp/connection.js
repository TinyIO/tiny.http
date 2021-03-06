const events = require('events');
const {
  sizeof_tiny_net_tcp_t,
  sizeof_uv_write_t,
  tiny_net_tcp_keep_alive,
  tiny_net_tcp_no_delay,
  tiny_net_tcp_init,
  tiny_net_tcp_connect,
  tiny_net_tcp_shutdown,
  tiny_net_tcp_close,
  tiny_net_tcp_read,
  tiny_net_tcp_destroy,
  tiny_net_tcp_write,
  tiny_net_tcp_write_two,
  tiny_net_tcp_writev
} = require('../binding');
const RequestQueue = require('./queue');
const lookup = require('./lookup');

const EMPTY = Buffer.alloc(0);

const noop = () => {
  // noop
};

const callAll = (list, err) => {
  for (let i = 0; i < list.length; i++) list[i](err);
  return null;
};

const getLengths = datas => {
  const lens = new Array(datas.length);
  for (let i = 0; i < datas.length; i++) lens[i] = datas[i].length;
  return lens;
};

const writeDone = (req, err) => (req.buffers ? req.donev(err) : req.done(err, req.length));

class Connection extends events.EventEmitter {
  constructor(server) {
    super();

    this.closed = false;
    this.finished = false;
    this.ended = false;
    this.allowHalfOpen = false;
    this.writable = false;
    this.readable = false;

    this._server = null;
    this._handle = Buffer.alloc(sizeof_tiny_net_tcp_t);
    this._reads = new RequestQueue(8, 0);
    this._writes = new RequestQueue(16, sizeof_uv_write_t);

    this._finishing = [];
    this._closing = [];
    this._paused = true;
    this._queued = server ? null : [];

    tiny_net_tcp_init(
      this._handle,
      this,
      this._onconnect,
      this._onwrite,
      this._onread,
      this._onfinish,
      this._onclose
    );

    if (server) {
      this._server = server;
      this.allowHalfOpen = server.allowHalfOpen;
    }
  }

  setKeepAlive(enable, initialdelay) {
    tiny_net_tcp_keep_alive(this._handle, !!enable, initialdelay || 0);
  }

  setNoDelay(enable) {
    tiny_net_tcp_no_delay(this._handle, !!enable);
  }

  _connect(port, host) {
    if (typeof port !== 'number') port = Number(port);
    lookup(host, (err, ip) => {
      if (err) {
        this.emit('error', err);
        return;
      }
      tiny_net_tcp_connect(this._handle, port, ip);
    });
  }

  _onclose() {
    this.closed = true;
    this._closing = callAll(this._closing, null);
    if (this._reads.top !== this._reads.btm) this._onend(new Error('Closed'));

    tiny_net_tcp_destroy(this._handle);
    this._handle = this._server = null;

    this.emit('close');
  }

  _onfinish(status) {
    this.finished = true;
    if (this.ended || !this.allowHalfOpen) this.close();
    this.emit('finish');

    const err = status < 0 ? new Error('End failed') : null;
    if (err) this.close();
    this._finishing = callAll(this._finishing, err);
  }

  _onend(err) {
    while (this._reads.top !== this._reads.btm) this._reads.shift().done(err, 0);
    if (err) return;
    if (this.finished || !this.allowHalfOpen) this.close();
    this.emit('end');
  }

  _onconnect(status) {
    if (status < 0) {
      if (this._queued) this._unqueue();
      this.emit('error', new Error('Connect failed'));
      return;
    }

    this.readable = true;
    this.writable = true;
    if (this._queued) this._unqueue();

    this._server ? this._server.emit('connection', this) : this.emit('connect');
  }

  _unqueue() {
    const queued = this._queued;
    this._queued = null;
    while (queued.length) {
      const [cmd, data, len, cb] = queued.shift();
      this._call(cmd, data, len, cb);
    }
  }

  _call(cmd, data, len, cb) {
    switch (cmd) {
      case 0:
        this.write(data, len, cb);
        break;
      case 1:
        this.writev(data, len, cb);
        break;
      case 2:
        this.end(cb);
        break;
      case 3:
        this.read(data, cb);
        break;
      case 4:
        this.close(cb);
        break;
      default:
        break;
    }
  }

  _onread(read) {
    if (!read) {
      this.readable = false;
      this.ended = true;
      this._onend(null);
      return EMPTY;
    }

    const reading = this._reads.shift();
    const err = read < 0 ? new Error('Read failed') : null;

    if (err) {
      this.close();
      reading.done(err, 0);
      return EMPTY;
    }

    reading.done(err, read);

    if (this._reads.top === this._reads.btm) {
      this._paused = true;
      return EMPTY;
    }

    return this._reads.peek().buffer;
  }

  _onwrite(status) {
    const writing = this._writes.shift();
    const err = status < 0 ? new Error('Write failed') : null;

    if (err) {
      this.close();
      writeDone(writing, err);
      return;
    }

    writeDone(writing, null);
  }

  write(data, len, cb) {
    if (typeof len === 'function') {
      return this._write(data, data.length, len);
    } else if (!len) {
      return this._write(data, data.length, cb || noop);
    }
    return this._write(data, len, cb || noop);
  }

  writev(datas, lens, cb) {
    if (typeof lens === 'function') {
      this._writev(datas, getLengths(datas), lens);
    } else if (!lens) {
      this._writev(datas, getLengths(datas), cb || noop);
    } else {
      this._writev(datas, lens, cb || noop);
    }
  }

  _writev(datas, lens, cb) {
    if (!this.writable) {
      this._notWritable(cb, datas, lens);
      return;
    }
    const writing = this._writes.push();

    writing.buffers = datas;
    writing.lengths = lens;
    writing.callback = cb;

    if (datas.length === 2) {
      // faster c case for just two buffers which is common
      tiny_net_tcp_write_two(this._handle, writing.handle, datas[0], lens[0], datas[1], lens[1]);
    } else {
      tiny_net_tcp_writev(this._handle, writing.handle, datas, lens);
    }
  }

  _write(data, len, cb) {
    if (!this.writable) {
      this._notWritable(cb, data, len);
      return;
    }
    const writing = this._writes.push();

    writing.buffer = data;
    writing.length = len;
    writing.callback = cb;

    tiny_net_tcp_write(this._handle, writing.handle, writing.buffer, len);
  }

  close(cb = noop) {
    if (this.closed) {
      process.nextTick(cb);
      return;
    }

    if (this._queued) {
      this._queued.push([4, null, 0, cb]);
      return;
    }

    this._closing.push(cb);
    if (this._closing.length > 1) {
      return;
    }

    this.readable = this.writable = false;
    tiny_net_tcp_close(this._handle);
  }

  end(cb = noop) {
    if (!this.writable) {
      this._notWritable(cb);
      return;
    }

    this._finishing.push(cb);
    if (this._finishing.length > 1) {
      return;
    }

    this.writable = false;
    tiny_net_tcp_shutdown(this._handle);
  }

  read(data, cb) {
    if (!this.readable) {
      this._notReadable(cb, data);
      return;
    }

    const reading = this._reads.push();

    reading.buffer = data;
    reading.callback = cb;

    if (this._paused) {
      this._paused = false;
      tiny_net_tcp_read(this._handle, data);
    }
  }

  _notWritable(cb, data, len) {
    if (this._queued) {
      const type = data ? (Array.isArray(data) ? 1 : 0) : 2;
      this._queued.push([type, data, len || 0, cb]);
      return;
    }
    process.nextTick(cb, this.finished ? null : new Error('Not writable'), data);
  }

  _notReadable(cb, data) {
    if (this._queued) {
      this._queued.push([3, data, 0, cb]);
      return;
    }
    process.nextTick(cb, this.ended ? null : new Error('Not readable'), data, 0);
  }
}

module.exports = Connection;
