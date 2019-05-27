const {
  sizeof_tiny_http_parser_t,
  tiny_http_parser_execute,
  tiny_http_parser_init,
  tiny_http_parser_destroy
} = require('../binding');

class HttpParser {
  constructor() {
    this._handle = Buffer.alloc(sizeof_tiny_http_parser_t);
    this._opts = null;
    tiny_http_parser_init(
      this._handle,
      this,
      this._onMethod,
      this._onHeader,
      this._onBody,
      this._onMessage
    );
  }

  execute(buffer, start, length) {
    tiny_http_parser_execute(this._handle, buffer, start, length);
  }

  close() {
    tiny_http_parser_destroy(this._handle);
  }

  _onMethod(opts) {
    opts.headers = {};
    this._opts = opts;
  }

  _onHeader(key, val) {
    this._opts.headers[key.toLowerCase()] = val;
  }

  _onBody() {
    // this[HttpParser.kOnBody](this);
  }

  _onMessage() {
    this[HttpParser.kOnHeadersComplete](this._opts);
    this._opts = null;
  }
}

HttpParser.kOnHeadersComplete = Symbol('headers complete');
HttpParser.kOnBody = Symbol('body');
HttpParser.kOnMessageComplete = Symbol('message complete');

module.exports = HttpParser;
