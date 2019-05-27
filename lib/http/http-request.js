const noop = () => {};

const indexHeaders = headers => {
  const map = new Map();
  for (let i = 0; i < headers.length; i += 2) map.set(headers[i].toLowerCase(), headers[i + 1]);
  return map;
};

class Request {
  constructor(socket, opts) {
    this.method = opts.method;
    this.url = opts.url;
    this.socket = socket;

    this._options = opts;
    this._headers = opts.headers;

    this.ondata = noop;
    this.onend = noop;
  }

  getAllHeaders() {
    return this._headers;
  }

  getHeader(name) {
    return this._headers[name.toLowerCase()];
  }
}

module.exports = Request;
