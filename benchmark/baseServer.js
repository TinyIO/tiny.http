const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

const msg = Buffer.from('find');

exports.makeServer = createServer => {
  const server = createServer((req, res) => {
    res.end(msg);
  });

  server.listen(3001, '0.0.0.0', () => {
    console.log(server.address());
  });
};

exports.makeCluster = server => {
  if (cluster.isMaster) {
    const n = numCPUs * 0.5;
    for (let i = 0; i < n; i++) {
      cluster.fork();
    }
  } else {
    server();
  }
};
