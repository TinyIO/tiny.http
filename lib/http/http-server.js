const { HTTPParser } = require("./http-parser");
const TCPServer = require("../tcp/server");
const Request = require("./http-request");
const Response = require("./http-response");

class Server extends TCPServer {
  constructor() {
    super();

    this._pool = [];
    this._smallPool = [];
    this._reuseChunkHeader = (_, bufs) => this._smallPool.push(bufs[2]);
    this._reuseChunk = (_, bufs) => this._smallPool.push(bufs[0]);

    this.on("connection", this._onhttpconnection);
  }

  _onhttpconnection(socket) {
    const self = this;
    const headers = this._alloc(); // we are not pipelining (right?) so headers re-use is safe
    const buf = this._alloc();
    const parser = new HTTPParser(HTTPParser.REQUEST);

    let req;
    let res;

    parser[HTTPParser.kOnHeadersComplete] = opts => {
      req = new Request(socket, opts);
      res = new Response(self, socket, headers);
      self.emit("request", req, res);
    };
    parser[HTTPParser.kOnBody] = (body, start, end) => {
      req.ondata(body, start, end);
    };
    parser[HTTPParser.kOnMessageComplete] = () => {
      req.onend();
    };

    const onread = (err, buf, read) => {
      if (err || !read) return;
      parser.execute(buf, 0, read);
      socket.read(buf, onread);
    };

    socket.read(buf, onread);

    socket.on("close", () => {
      self._pool.push(headers, buf);
    });
  }

  _alloc() {
    return this._pool.pop() || Buffer.allocUnsafe(65536);
  }

  _allocSmall() {
    return this._smallPool.pop() || Buffer.allocUnsafe(32);
  }
}

module.exports = Server;
