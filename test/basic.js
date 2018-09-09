const tape = require('tape');
const tiny = require('../packages/tcp');

tape('basic', (t) => {
  const opts = { allowHalfOpen: true };

  const server = tiny.createServer(opts, onsocket);

  server.listen(0, () => {
    const socket = tiny.connect(
      server.address().port,
      opts
    );
    const chunks = [];

    socket.read(Buffer.alloc(3), function onread(err, buf, n) {
      t.error(err, 'no error');
      chunks.push(buf.slice(0, n));
      if (n) return socket.read(Buffer.alloc(3), onread);
      socket.close();
      server.close();
      t.same(Buffer.concat(chunks), Buffer.from('abc'));
      t.end();
    });

    socket.write(Buffer.from('a'));
    socket.write(Buffer.from('b'));
    socket.write(Buffer.from('c'));
    socket.end();
  });

  function onsocket(socket) {
    socket.read(Buffer.alloc(3), function onread(err, buf, read) {
      if (!read) return socket.end();
      t.error(err, 'no error');
      socket.write(buf, read, () => {
        socket.read(buf, onread);
      });
    });
  }
});
