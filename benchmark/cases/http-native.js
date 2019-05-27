const { createServer } = require('http');

const { makeServer } = require('../baseServer');

makeServer(createServer);
