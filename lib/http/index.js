const Server = require('./http-server');

exports.createServer = (opts, onrequest) => {
  if (typeof opts === 'function') return exports.createServer(null, opts);
  if (!opts) opts = {};

  const server = new Server(opts);
  if (onrequest) server.on('request', onrequest);
  return server;
};
