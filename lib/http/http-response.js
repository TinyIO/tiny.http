const httpStatus = require('./http-status');

const SEP = ': ';
const EOL = '\r\n';
const EOL_BUFFER = Buffer.from(EOL);
const EMPTY = Buffer.alloc(0);
const LAST_CHUNK = Buffer.from('0\r\n\r\n');
const LAST_CHUNK_AFTER_DATA = Buffer.from('\r\n0\r\n\r\n');
const HEADER_CHUNKED = Buffer.from('Transfer-Encoding: chunked\r\n');
const HEADER_KEEP_ALIVE = Buffer.from('Connection: keep-alive\r\n');
const CONTENT_LENGTH = 'content-length';
const CONNECTION = 'connection';

const encodeHex = (n, buf) => {
  const hex = n.toString(16);
  buf.asciiWrite(hex, 0);
  buf.asciiWrite('\r\n', hex.length);
  return hex.length + 2;
};

const addAll = lens => {
  let sum = 0;
  for (let i = 0; i < lens.length; i++) sum += lens[i];
  return sum;
};

const getLengths = bufs => {
  const lens = new Array(bufs.length);
  for (let i = 0; i < bufs.length; i++) lens[i] = bufs[i].length;
  return lens;
};

class Response {
  constructor(server, socket, headers) {
    this.server = server;
    this.socket = socket;
    this.statusCode = 200;
    this.headerSent = false;

    this._headers = headers;
    this._headersLength = 0;
    this._keepAlive = true;
    this._chunked = true;
    this._reuseChunkHeader = server._reuseChunkHeader;
    this._reuseChunk = server._reuseChunk;
  }

  setHeader(name, value) {
    if (this.headerSent) throw new Error('Cannot write to headers after headers sent');

    name = name.toLowerCase();

    const header = name + SEP + value + EOL;

    // slow path but very unlikely (a *lot* of headers)
    if (this._headersLength + header.length > 65534) {
      this._headers = Buffer.concat([this._headers, Buffer.allocUnsafe(65536)]);
    }

    this._headers.asciiWrite(header, this._headersLength, header.length);
    this._headersLength += header.length;

    if (CONTENT_LENGTH === name) this._chunked = false;
    else if (CONNECTION === name) this._keepAlive = false;
  }

  _appendHeader(buf) {
    // slow path but very unlikely (a *lot* of headers)
    if (this._headersLength + buf.length > 65534) {
      this._headers = Buffer.concat([this._headers, Buffer.allocUnsafe(65536)]);
    }

    buf.copy(this._headers, this._headersLength);
    this._headersLength += buf.length;
  }

  _flushHeaders() {
    this.headerSent = true;
    if (this._keepAlive) this._appendHeader(HEADER_KEEP_ALIVE);
    if (this._chunked) this._appendHeader(HEADER_CHUNKED);
    this._headers.asciiWrite(EOL, this._headersLength);
  }

  _writeHeader(buf, n, cb) {
    this._flushHeaders();

    const status = httpStatus[this.statusCode];

    this.socket.writev(
      [status, this._headers, buf],
      [status.length, this._headersLength + 2, n],
      cb
    );
  }

  _writeHeaderv(bufs, ns, cb) {
    this._flushHeaders();

    const status = httpStatus[this.statusCode];

    this.socket.writev(
      [status, this._headers].concat(bufs),
      [status.length, this._headersLength + 2].concat(ns),
      cb
    );
  }

  _writeHeaderChunkedv(bufs, ns, cb = this._reuseChunkHeader) {
    this._flushHeaders();

    const status = httpStatus[this.statusCode];
    const chunkHeader = this.server._allocSmall();
    const chunkHeaderLength = encodeHex(addAll(ns), chunkHeader);

    this.socket.writev(
      [status, this._headers, chunkHeader].concat(bufs, EOL_BUFFER),
      [status.length, this._headersLength + 2, chunkHeaderLength].concat(ns, 2),
      cb
    );
  }

  _writeHeaderChunked(buf, n, cb = this._reuseChunkHeader) {
    this._flushHeaders();

    const status = httpStatus[this.statusCode];
    const chunkHeader = this.server._allocSmall();
    const chunkHeaderLength = encodeHex(n, chunkHeader);

    this.socket.writev(
      [status, this._headers, chunkHeader, buf, EOL_BUFFER],
      [status.length, this._headersLength + 2, chunkHeaderLength, n, 2],
      cb
    );
  }

  write(buf, cb) {
    if (typeof buf === 'string') buf = Buffer.from(buf);
    return this._write(buf, buf.length, cb);
  }

  writev(bufs, ns = getLengths(bufs), cb) {
    return this._writev(bufs, ns, cb);
  }

  _writev(bufs, ns, cb) {
    if (this._chunked) {
      if (this.headerSent) this._writeChunkv(bufs, ns, cb);
      else this._writeHeaderChunkedv(bufs, ns, cb);
    } else if (this.headerSent) this.socket.writev(bufs, ns, cb);
    else this._writeHeaderv(bufs, ns, cb);
  }

  _write(buf, n, cb) {
    if (this._chunked) {
      if (this.headerSent) this._writeChunk(buf, n, cb);
      else this._writeHeaderChunked(buf, n, cb);
    } else if (this.headerSent) this.socket.write(buf, n, cb);
    else this._writeHeader(buf, n, cb);
  }

  _writeChunk(buf, n, cb = this._reuseChunk) {
    const header = this.server._allocSmall();
    const headerLength = encodeHex(n, header);

    this.socket.writev([header, buf, EOL_BUFFER], [headerLength, n, 2], cb);
  }

  _writeChunkv(bufs, ns, cb) {
    const header = this.server._allocSmall();
    const headerLength = encodeHex(addAll(ns), header);

    this.socket.writev([header].concat(bufs, EOL_BUFFER), [headerLength].concat(ns, 2), cb);
  }

  endv(bufs, ns = getLengths(bufs), cb) {
    return this._endv(bufs, ns, cb);
  }

  end(buf = EMPTY, cb) {
    if (typeof buf === 'string') buf = Buffer.from(buf);
    return this._end(buf, buf.length, cb);
  }

  _endv(bufs, ns, cb) {
    if (!this.headerSent) {
      if (this._chunked) {
        this.setHeader('Content-Length', addAll(ns));
        this._chunked = false;
      }
      this._writeHeaderv(bufs, ns, cb);
      return;
    }

    if (this._chunked) {
      const header = this.server._allocSmall();
      const headerLength = encodeHex(addAll(ns), header);
      this.socket.writev(
        [header].concat(bufs, LAST_CHUNK_AFTER_DATA),
        [headerLength].concat(ns, LAST_CHUNK_AFTER_DATA.length),
        cb
      );
      return;
    }

    this.socket.writev(bufs, ns, cb);
  }

  _end(buf, n, cb) {
    if (!this.headerSent) {
      if (this._chunked) {
        this.setHeader('Content-Length', n);
        this._chunked = false;
      }
      this._writeHeader(buf, n, cb);
      return;
    }

    if (this._chunked) {
      if (n) {
        const header = this.server._allocSmall();
        const headerLength = encodeHex(n, header);
        this.socket.writev(
          [header, buf, LAST_CHUNK_AFTER_DATA],
          [headerLength, n, LAST_CHUNK_AFTER_DATA.length],
          cb
        );
        return;
      }

      this.socket.write(LAST_CHUNK, LAST_CHUNK.length, cb);
      return;
    }

    if (cb || n) this.socket.write(buf, n, cb);
  }
}

module.exports = Response;
