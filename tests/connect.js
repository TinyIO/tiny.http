const tape = require('tape');
const tiny = require('../lib/tcp');

tape('connect with hostname', t => {
  const server = tiny.createServer(socket => socket.end());

  server.listen(() => {
    const client = tiny.connect(server.address().port, 'localhost');

    client.on('connect', () => {
      server.close();
      t.pass('connected');
      t.end();
    });
  });
});

tape('connect with error', t => {
  const server = tiny.createServer(socket => socket.end());

  server.listen(() => {
    const { port } = server.address();

    server.close(() => {
      const client = tiny.connect(port, 'localhost');

      client.on('error', err => {
        t.ok(err, 'should error');
        t.end();
      });
    });
  });
});

tape('connect with and read/write and error', t => {
  t.plan(3);

  const server = tiny.createServer(socket => socket.end());

  server.listen(() => {
    const { port } = server.address();

    server.close(() => {
      const client = tiny.connect(port, 'localhost');

      client.on('error', err => t.ok(err, 'should error1'));
      client.read(Buffer.alloc(1024), err => t.ok(err, 'should error2'));
      client.write(Buffer.alloc(1024), err => t.ok(err, 'should error3'));
    });
  });
});

tape('close before connect', t => {
  const server = tiny.createServer(socket => socket.end());

  server.listen(() => {
    const { port } = server.address();
    const client = tiny.connect(port);

    client.close(() => {
      console.log('callback');
      server.close();
      t.end();
    });
  });
});
