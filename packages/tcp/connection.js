const events = require('events');
const {
  sizeof_tiny_net_tcp_t,
  sizeof_uv_write_t,
  tiny_net_tcp_init,
  tiny_net_tcp_connect,
  tiny_net_tcp_shutdown,
  tiny_net_tcp_close,
  tiny_net_tcp_read,
  tiny_net_tcp_destroy,
  tiny_net_tcp_write,
  tiny_net_tcp_write_two,
  tiny_net_tcp_writev
} = require('./binding');
const RequestQueue = require('./queue');
const lookup = require('./lookup');

const EMPTY = Buffer.alloc(0);

const noop = () => {};

const callAll = (list, err) => {
  for (let i = 0; i < list.length; i++) list[i](err);
  return null;
};

const getLengths = (datas) => {
  const lens = new Array(datas.length);
  for (let i = 0; i < datas.length; i++) lens[i] = datas[i].length;
  return lens;
};

const writeDone = (req, err) => {
  if (req.buffers) req.donev(err);
  else req.done(err, req.length);
};

class Connection extends events.EventEmitter {
  constructor(server) {
    super();

    this.closed = false;
    this.finished = false;
    this.ended = false;
    this.allowHalfOpen = false;
    this.writable = false;
    this.readable = false;

    this._index = 0; // used be fastset item
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
      null,
      this._onconnect,
      this._onwrite,
      this._onread,
      this._onfinish,
      this._onclose
    );

    if (server) {
      this._server = server;
      this._index = server.connections.push(this) - 1;
      this.allowHalfOpen = server.allowHalfOpen;
    }
  }

  _connect(port, host) {
    if (typeof port !== 'number') port = Number(port);
    const self = this;
    lookup(host, (err, ip) => {
      if (err) return self.emit('error', err);
      tiny_net_tcp_connect(self._handle, port, ip);
    });
  }

  _onclose() {
    if (this._server) {
      const list = this._server.connections;
      const last = list.pop();
      if (last !== this) {
        list[this._index] = last;
        last._index = this._index;
      }
    }
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

    if (this._server) this._server.emit('connection', this);
    else this.emit('connect');
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
        return this.write(data, len, cb);
      case 1:
        return this.writev(data, len, cb);
      case 2:
        return this.end(cb);
      case 3:
        return this.read(data, cb);
      case 4:
        return this.close(cb);
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

  write(data, len = data.length, cb = noop) {
    return this._write(data, len, cb);
  }

  writev(datas, lens = getLengths(datas), cb = noop) {
    return this._writev(datas, lens, cb);
  }

  _writev(datas, lens, cb) {
    if (!this.writable) return this._notWritable(cb, datas, lens);
    const writing = this._writes.push();

    writing.buffers = datas;
    writing.lengths = lens;
    writing.callback = cb;

    if (datas.length === 2) {
      // faster c case for just two buffers which is common
      tiny_net_tcp_write_two(
        this._handle,
        writing.handle,
        datas[0],
        lens[0],
        datas[1],
        lens[1]
      );
    } else {
      tiny_net_tcp_writev(this._handle, writing.handle, datas, lens);
    }
  }

  _write(data, len, cb) {
    if (!this.writable) return this._notWritable(cb, data, len);
    const writing = this._writes.push();

    writing.buffer = data;
    writing.length = len;
    writing.callback = cb;

    tiny_net_tcp_write(this._handle, writing.handle, writing.buffer, len);
  }

  close(cb = noop) {
    if (this.closed) return process.nextTick(cb);

    if (this._queued) {
      this._queued.push([4, null, 0, cb]);
      return;
    }

    this._closing.push(cb);
    if (this._closing.length > 1) return;

    this.readable = this.writable = false;
    tiny_net_tcp_close(this._handle);
  }

  end(cb = noop) {
    if (!this.writable) return this._notWritable(cb);

    this._finishing.push(cb);
    if (this._finishing.length > 1) return;

    this.writable = false;
    tiny_net_tcp_shutdown(this._handle);
  }

  read(data, cb) {
    if (!this.readable) return this._notReadable(cb, data);

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
