const tape = require("tape");
const tiny = require("../lib/tcp");

tape("listen", t => {
  const server = tiny.createServer();

  server.listen(() => {
    const addr = server.address();
    t.ok(typeof addr.port === "number");
    t.same(addr.family, "IPv4");
    t.same(addr.address, "0.0.0.0");
    server.close(() => {
      server.listen(addr.port, () => {
        t.same(server.address(), addr);
        server.close();
        t.end();
      });
    });
  });
});

tape("listen stringed port", t => {
  const server = tiny.createServer();

  server.listen(() => {
    const addr = server.address();
    server.close(() => {
      server.listen(`${addr.port}`, () => {
        t.same(server.address(), addr);
        server.close();
        t.end();
      });
    });
  });
});

tape("address no listen", t => {
  const server = tiny.createServer();

  try {
    server.address();
  } catch (err) {
    t.pass("should error");
    t.end();
  }
});

tape("listen on used port", t => {
  const server = tiny.createServer();

  server.listen(() => {
    const another = tiny.createServer();

    another.on("error", err => {
      server.close();
      t.ok(err, "had error");
      t.end();
    });

    another.listen(server.address().port);
  });
});
