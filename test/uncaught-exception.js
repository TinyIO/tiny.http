const tape = require('tape');
const proc = require('child_process');
const tiny = require('../packages/tcp');

tape('uncaughts are not swallowed', (t) => {
  const server = tiny.createServer((socket) => socket.end());

  server.listen(() => {
    const client = tiny.connect(server.address().port);

    process.on('uncaughtException', (err) => {
      client.close();
      server.close();
      t.same(err.message, 'stop');
      t.end();
    });

    client.on('connect', () => {
      throw new Error('stop');
    });
  });
});

tape('uncaughts are not swallowed (child process)', (t) => {
  const child = proc.spawn(
    process.execPath,
    [
      '-e',
      `
    const tiny = require('../packages/tcp')
    const server = tiny.createServer(socket => socket.end())

    server.listen(function () {
      const client = tiny.connect(server.address().port)
      client.on('connect', function () {
        throw new Error('stop')
      })
    })
  `
    ],
    {
      cwd: __dirname
    }
  );

  const buf = [];
  child.stderr.on('data', (data) => buf.push(data));
  child.stderr.on('end', () => {
    t.ok(buf.join('').indexOf('Error: stop') > -1);
    t.end();
  });
});
