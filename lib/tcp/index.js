const Server = require('./server');
const Connection = require('./connection');

exports.Server = Server;
exports.Connection = Connection;

exports.createServer = (opts, onconnection) => {
  if (typeof opts === 'function') return exports.createServer(null, opts);
  const server = new Server(opts);
  onconnection && server.on('connection', onconnection);
  return server;
};

exports.connect = (port, host, opts) => {
  if (typeof host !== 'string' && host) return exports.connect(port, null, host);
  if (!opts) opts = {};

  const connection = new Connection();

  opts.allowHalfOpen && (connection.allowHalfOpen = true);
  connection._connect(port, host || '127.0.0.1');

  return connection;
};
