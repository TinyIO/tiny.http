const tape = require("tape");
const tiny = require("../lib/tcp");

tape("writev", t => {
  const server = tiny.createServer(echo);

  server.listen(() => {
    const client = tiny.connect(server.address().port);

    read(client, 11, (err, buf) => {
      t.error(err, "no error");
      t.same(buf, Buffer.from("hello world"));
      server.close();
      client.close(() => t.end());
    });

    client.writev([Buffer.from("hello "), Buffer.from("world")]);
  });
});

tape("writev after connect", t => {
  const server = tiny.createServer(echo);

  server.listen(() => {
    const client = tiny.connect(server.address().port);

    read(client, 11, (err, buf) => {
      t.error(err, "no error");
      t.same(buf, Buffer.from("hello world"));
      server.close();
      client.close(() => t.end());
    });

    client.on("connect", () => {
      client.writev([Buffer.from("hello "), Buffer.from("world")]);
    });
  });
});

tape("writev before and after connect", t => {
  const server = tiny.createServer(echo);

  server.listen(() => {
    const client = tiny.connect(server.address().port);

    read(client, 14 + 11, (err, buf) => {
      t.error(err, "no error");
      console.log(buf.toString());
      t.same(buf, Buffer.from("hej verden og hello world"));
      server.close();
      client.close(() => t.end());
    });

    client.writev([
      Buffer.from("hej "),
      Buffer.from("verden "),
      Buffer.from("og ")
    ]);

    client.on("connect", () => {
      client.writev([Buffer.from("hello "), Buffer.from("world")]);
    });
  });
});

tape("writev twice", t => {
  const server = tiny.createServer(echo);

  server.listen(() => {
    const client = tiny.connect(server.address().port);

    read(client, 14 + 11, (err, buf) => {
      t.error(err, "no error");
      t.same(buf, Buffer.from("hej verden og hello world"));
      server.close();
      client.close(() => t.end());
    });

    client.writev([
      Buffer.from("hej "),
      Buffer.from("verden "),
      Buffer.from("og ")
    ]);

    client.writev([Buffer.from("hello "), Buffer.from("world")]);
  });
});

tape("write 256 buffers", t => {
  const server = tiny.createServer(echo);

  server.listen(() => {
    const client = tiny.connect(server.address().port);
    const expected = Buffer.alloc(256);

    read(client, 256, (err, buf) => {
      t.error(err, "no error");
      t.same(buf, expected);
      server.close();
      client.close(() => t.end());
    });

    for (let i = 0; i < 256; i++) {
      expected[i] = i;
      client.write(Buffer.from([i]));
    }
  });
});

function read(socket, read, cb) {
  const buf = Buffer.alloc(read);
  socket.read(buf, (err, next, n) => {
    if (err) return cb(err);
    read -= n;
    if (!read) return cb(null, buf);
    socket.read(next.slice(n), cb);
  });
}

function echo(socket) {
  socket.read(Buffer.alloc(65536), function onread(err, buf, n) {
    if (err) return;
    socket.write(buf, n, err => {
      if (err) return;
      socket.read(buf, onread);
    });
  });
}
