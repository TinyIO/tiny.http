const { createServer } = require('../../lib/http');

const { makeServer, makeCluster } = require('../baseServer');

makeCluster(() => makeServer(createServer));
