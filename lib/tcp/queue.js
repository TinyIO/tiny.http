class Request {
  constructor(handle) {
    this.callback = null;
    this.buffer = null;
    this.buffers = null;
    this.length = 0;
    this.lengths = null;
    this.handle = handle ? Buffer.alloc(handle) : null;
  }

  donev(err) {
    const { callback, buffers, lengths } = this;

    this.callback = this.buffers = this.lengths = null;
    callback(err, buffers, lengths);
  }

  done(err, len) {
    const { callback, buffer } = this;
    this.callback = this.buffer = null;
    callback(err, buffer, len);
  }
}

class RequestQueue {
  constructor(size, handle) {
    this.size = size;
    this.mask = size - 1;
    this.handle = handle;
    this.top = 0;
    this.btm = 0;
    this.list = new Array(size);
    this.fill(0);
  }

  // In most cases this will never be called so use
  // a simple realloc method, to ensure it always works
  grow() {
    const { size } = this;
    const list = new Array(size * 2);
    for (let i = 0; i < size; i++) list[i] = this.shift();
    this.size = list.length;
    this.mask = this.size - 1;
    this.top = size;
    this.btm = 0;
    this.list = list;
    this.fill(size);
  }

  fill(offset) {
    for (let i = offset; i < this.list.length; i++) {
      this.list[i] = new Request(this.handle);
    }
  }

  push() {
    const req = this.list[this.top];
    this.top = (this.top + 1) & this.mask;
    if (this.top === this.btm) this.grow();
    return req;
  }

  shift() {
    const req = this.list[this.btm];
    this.btm = (this.btm + 1) & this.mask;
    return req;
  }

  peek() {
    return this.list[this.btm];
  }
}

module.exports = RequestQueue;
