const noop = () => {
  // noop
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
