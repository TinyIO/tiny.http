const cluster = require("cluster");
const numCPUs = require("os").cpus().length;

const { createServer } = require("../../lib/http");

if (cluster.isMaster) {
  for (let i = 1; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  const server = createServer((req, res) => {
    res.end("find");
  });

  server.listen(3001, "0.0.0.0", () => {
    console.log(server.address());
  });
}
