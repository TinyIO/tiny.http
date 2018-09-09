const tape = require('tape');
const tiny = require('../packages/tcp');

tape('read', (t) => {
  const server = tiny.createServer((socket) => {
    socket.write(Buffer.from('hello world'));
    socket.end();
  });

  server.listen(() => {
    const socket = tiny.connect(server.address().port);

    socket.on('connect', () => {
      socket.read(Buffer.alloc(1024), (err, buf, n) => {
        t.error(err, 'no error');
        t.ok(n > 0);
        t.same(buf.slice(0, n), Buffer.from('hello world').slice(0, n));
        socket.close();
        server.close();
        t.end();
      });
    });
  });
});

tape('many reads', (t) => {
  const expected = Buffer.from('hello world hello world hello world');
  const server = tiny.createServer((socket) => {
    socket.write(expected);
    socket.end();
  });

  t.plan(2 * expected.length + 2);

  server.listen(() => {
    const socket = tiny.connect(server.address().port);
    for (let i = 0; i < expected.length; i++) {
      const next = expected[i];
      socket.read(Buffer.alloc(1), (err, buf) => {
        t.error(err);
        t.same(buf, Buffer.from([next]));
      });
    }
    socket.read(Buffer.alloc(1024), (err, buf, n) => {
      server.close();
      t.error(err);
      t.same(n, 0);
    });
  });
});
