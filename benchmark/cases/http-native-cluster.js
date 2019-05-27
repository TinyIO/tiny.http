const { createServer } = require('http');

const { makeServer, makeCluster } = require('../baseServer');

makeCluster(() => makeServer(createServer));
