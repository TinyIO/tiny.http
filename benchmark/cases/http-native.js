const { createServer } = require("http");

const server = createServer((req, res) => {
  res.end("find");
});

server.listen(3001, "0.0.0.0", () => {
  console.log(server.address());
});
