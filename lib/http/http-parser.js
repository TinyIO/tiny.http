/* jshint node:true */

const assert = require("assert");

const methods = (exports.METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "COPY",
  "LOCK",
  "MKCOL",
  "MOVE",
  "PROPFIND",
  "PROPPATCH",
  "SEARCH",
  "UNLOCK",
  "BIND",
  "REBIND",
  "UNBIND",
  "ACL",
  "REPORT",
  "MKACTIVITY",
  "CHECKOUT",
  "MERGE",
  "M-SEARCH",
  "NOTIFY",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "PATCH",
  "PURGE",
  "MKCALENDAR",
  "LINK",
  "UNLINK"
]);
const method_connect = methods.indexOf("CONNECT");

const headerState = {
  REQUEST_LINE: true,
  RESPONSE_LINE: true,
  HEADER: true
};

const stateFinishAllowed = {
  REQUEST_LINE: true,
  RESPONSE_LINE: true,
  BODY_RAW: true
};

const headerExp = /^([^: \t]+):[ \t]*((?:.*[^ \t])|)/;
const headerContinueExp = /^[ \t]+(.*[^ \t])/;
const requestExp = /^([A-Z-]+) ([^ ]+) HTTP\/(\d)\.(\d)$/;
const responseExp = /^HTTP\/(\d)\.(\d) (\d{3}) ?(.*)$/;

const parseErrorCode = code => {
  const err = new Error("Parse Error");
  err.code = code;
  return err;
};

class HTTPParser {
  constructor(type) {
    this.reinitialize(type);
  }

  reinitialize(type) {
    assert.ok(type === HTTPParser.REQUEST || type === HTTPParser.RESPONSE);
    this.type = type;
    this.state = `${type}_LINE`;
    this.info = {
      headers: [],
      upgrade: false
    };
    this.trailers = [];
    this.line = "";
    this.isChunked = false;
    this.connection = "";
    this.headerSize = 0; // for preventing too big headers
    this.body_bytes = null;
    this.hadError = false;
  }

  execute(chunk, start, length) {
    if (!(this instanceof HTTPParser)) {
      throw new TypeError("not a HTTPParser");
    }
    start = start || 0;
    length = typeof length === "number" ? length : chunk.length;
    this.chunk = chunk;
    this.offset = start;
    const end = (this.end = start + length);
    while (this.offset < end) {
      if (this[this.state]()) {
        break;
      }
    }
    this.chunk = null;
    length = this.offset - start;
    if (headerState[this.state]) {
      this.headerSize += length;
      if (this.headerSize > HTTPParser.maxHeaderSize) {
        return new Error("max header size exceeded");
      }
    }
    return length;
  }

  finish() {
    if (this.hadError) {
      return;
    }
    if (!stateFinishAllowed[this.state]) {
      return new Error("invalid state for EOF");
    }
    if (this.state === "BODY_RAW") {
      this[kOnMessageComplete]();
    }
  }

  nextRequest() {
    this[kOnMessageComplete]();
    this.reinitialize(this.type);
  }

  consumeLine() {
    const { end } = this;
    const { chunk } = this;
    for (let i = this.offset; i < end; i++) {
      if (chunk[i] === 0x0a) {
        // \n
        let line =
          this.line + chunk.toString(HTTPParser.encoding, this.offset, i);
        if (line.charAt(line.length - 1) === "\r") {
          line = line.substr(0, line.length - 1);
        }
        this.line = "";
        this.offset = i + 1;
        return line;
      }
    }
    // line split over multiple chunks
    this.line += chunk.toString(HTTPParser.encoding, this.offset, this.end);
    this.offset = this.end;
  }

  parseHeader(line, headers) {
    if (line.indexOf("\r") !== -1) {
      throw parseErrorCode("HPE_LF_EXPECTED");
    }
    const match = headerExp.exec(line);
    const k = match && match[1];
    if (k) {
      // skip empty string (malformed header)
      headers.push(k);
      headers.push(match[2]);
    } else {
      const matchContinue = headerContinueExp.exec(line);
      if (matchContinue && headers.length) {
        if (headers[headers.length - 1]) {
          headers[headers.length - 1] += " ";
        }
        headers[headers.length - 1] += matchContinue[1];
      }
    }
  }

  REQUEST_LINE() {
    const line = this.consumeLine();
    if (!line) {
      return;
    }
    const match = requestExp.exec(line);
    if (match === null) {
      throw parseErrorCode("HPE_INVALID_CONSTANT");
    }
    this.info.method = methods.indexOf(match[1]);
    if (this.info.method === -1) {
      throw new Error("invalid request method");
    }
    this.info.url = match[2];
    this.info.versionMajor = +match[3];
    this.info.versionMinor = +match[4];
    this.body_bytes = 0;
    this.state = "HEADER";
  }

  RESPONSE_LINE() {
    const line = this.consumeLine();
    if (!line) {
      return;
    }
    const match = responseExp.exec(line);
    if (match === null) {
      throw parseErrorCode("HPE_INVALID_CONSTANT");
    }
    this.info.versionMajor = +match[1];
    this.info.versionMinor = +match[2];
    const statusCode = (this.info.statusCode = +match[3]);
    this.info.statusMessage = match[4];
    // Implied zero length.
    if (
      ((statusCode / 100) | 0) === 1 ||
      statusCode === 204 ||
      statusCode === 304
    ) {
      this.body_bytes = 0;
    }
    this.state = "HEADER";
  }

  shouldKeepAlive() {
    if (this.info.versionMajor > 0 && this.info.versionMinor > 0) {
      if (this.connection.indexOf("close") !== -1) {
        return false;
      }
    } else if (this.connection.indexOf("keep-alive") === -1) {
      return false;
    }
    if (this.body_bytes !== null || this.isChunked) {
      // || skipBody
      return true;
    }
    return false;
  }

  HEADER() {
    const line = this.consumeLine();
    if (line === undefined) {
      return;
    }
    const { info } = this;
    if (line) {
      this.parseHeader(line, info.headers);
    } else {
      const { headers } = info;
      let hasContentLength = false;
      let currentContentLengthValue;
      let hasUpgradeHeader = false;
      for (let i = 0; i < headers.length; i += 2) {
        switch (headers[i].toLowerCase()) {
          case "transfer-encoding":
            this.isChunked = headers[i + 1].toLowerCase() === "chunked";
            break;
          case "content-length":
            currentContentLengthValue = +headers[i + 1];
            if (hasContentLength) {
              // Fix duplicate Content-Length header with same values.
              // Throw error only if values are different.
              // Known issues:
              // https://github.com/request/request/issues/2091#issuecomment-328715113
              // https://github.com/nodejs/node/issues/6517#issuecomment-216263771
              if (currentContentLengthValue !== this.body_bytes) {
                throw parseErrorCode("HPE_UNEXPECTED_CONTENT_LENGTH");
              }
            } else {
              hasContentLength = true;
              this.body_bytes = currentContentLengthValue;
            }
            break;
          case "connection":
            this.connection += headers[i + 1].toLowerCase();
            break;
          case "upgrade":
            hasUpgradeHeader = true;
            break;
        }
      }
      // See https://github.com/creationix/http-parser-js/pull/53
      // if both isChunked and hasContentLength, content length wins
      // because it has been verified to match the body length already
      if (this.isChunked && hasContentLength) {
        this.isChunked = false;
      }
      // Logic from https://github.com/nodejs/http-parser/blob/921d5585515a153fa00e411cf144280c59b41f90/http_parser.c#L1727-L1737
      // "For responses, "Upgrade: foo" and "Connection: upgrade" are
      //   mandatory only when it is a 101 Switching Protocols response,
      //   otherwise it is purely informational, to announce support.
      if (hasUpgradeHeader && this.connection.indexOf("upgrade") != -1) {
        info.upgrade =
          this.type === HTTPParser.REQUEST || info.statusCode === 101;
      } else {
        info.upgrade = info.method === method_connect;
      }
      info.shouldKeepAlive = this.shouldKeepAlive();
      // problem which also exists in original node: we should know skipBody before calling onHeadersComplete
      const skipBody = this[kOnHeadersComplete](info);
      if (skipBody === 2) {
        this.nextRequest();
        return true;
      }
      if (this.isChunked && !skipBody) {
        this.state = "BODY_CHUNKHEAD";
      } else if (skipBody || this.body_bytes === 0) {
        this.nextRequest();
        // For older versions of node (v6.x and older?), that return skipBody=1 or skipBody=true,
        //   need this "return true;" if it's an upgrade request.
        return info.upgrade;
      } else if (this.body_bytes === null) {
        this.state = "BODY_RAW";
      } else {
        this.state = "BODY_SIZED";
      }
    }
  }

  BODY_CHUNKHEAD() {
    const line = this.consumeLine();
    if (line === undefined) {
      return;
    }
    this.body_bytes = parseInt(line, 16);
    if (!this.body_bytes) {
      this.state = "BODY_CHUNKTRAILERS";
    } else {
      this.state = "BODY_CHUNK";
    }
  }

  BODY_CHUNK() {
    const length = Math.min(this.end - this.offset, this.body_bytes);
    this[kOnBody](this.chunk, this.offset, length);
    this.offset += length;
    this.body_bytes -= length;
    if (!this.body_bytes) {
      this.state = "BODY_CHUNKEMPTYLINE";
    }
  }

  BODY_CHUNKEMPTYLINE() {
    const line = this.consumeLine();
    if (line === undefined) {
      return;
    }
    assert.equal(line, "");
    this.state = "BODY_CHUNKHEAD";
  }

  BODY_CHUNKTRAILERS() {
    const line = this.consumeLine();
    if (line === undefined) {
      return;
    }
    if (line) {
      this.parseHeader(line, this.trailers);
    } else {
      if (this.trailers.length) {
        this[kOnHeaders](this.trailers, "");
      }
      this.nextRequest();
    }
  }

  BODY_RAW() {
    const length = this.end - this.offset;
    this[kOnBody](this.chunk, this.offset, length);
    this.offset = this.end;
  }

  BODY_SIZED() {
    const length = Math.min(this.end - this.offset, this.body_bytes);
    this[kOnBody](this.chunk, this.offset, length);
    this.offset += length;
    this.body_bytes -= length;
    if (!this.body_bytes) {
      this.nextRequest();
    }
  }
}

HTTPParser.encoding = "ascii";
HTTPParser.maxHeaderSize = 80 * 1024; // maxHeaderSize (in bytes);
HTTPParser.REQUEST = "REQUEST";
HTTPParser.RESPONSE = "RESPONSE";

const kOnHeaders = (HTTPParser.kOnHeaders = 0);
const kOnHeadersComplete = (HTTPParser.kOnHeadersComplete = 1);
const kOnBody = (HTTPParser.kOnBody = 2);
const kOnMessageComplete = (HTTPParser.kOnMessageComplete = 3);

// Some handler stubs, needed for compatibility
HTTPParser.prototype[kOnHeaders] = HTTPParser.prototype[
  kOnHeadersComplete
] = HTTPParser.prototype[kOnBody] = HTTPParser.prototype[
  kOnMessageComplete
] = () => {};

exports.HTTPParser = HTTPParser;
