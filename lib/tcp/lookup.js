const dns = require('dns');

const IPv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

module.exports = (addr, cb) => {
  if (IPv4.test(addr)) {
    process.nextTick(cb, null, addr);
    return;
  }
  dns.lookup(addr, cb);
};
