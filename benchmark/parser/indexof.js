const Benchmark = require('benchmark');

const suite = new Benchmark.Suite();

const buff = Buffer.from(
  [
    'GET /favicon.ico HTTP/1.1',
    'Host: 0.0.0.0=5000',
    'User-Agent: Mozilla/5.0 (X11; U; Linux i686; en-US; rv:1.9) ' + 'Gecko/2008061015 Firefox/3.0',
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language: en-us,en;q=0.5',
    'Accept-Encoding: gzip,deflate',
    'Accept-Charset: ISO-8859-1,utf-8;q=0.7,*;q=0.7',
    'Keep-Alive: 300',
    'Connection: keep-alive',
    '',
    ''
  ].join('\r\n')
);

const buffString = buff.toString();

const loopIndex = (buff, num) => {
  for (let i = 0; i < buff.length; i++) {
    if (buff[i] === num) {
      return i;
    }
  }
  return -1;
};

const res = [];

const percentageDiff = arr => {
  const use = arr.sort((a, b) => b - a);
  return ((use[0] - use[1]) / use[1]) * 100;
};

suite
  .add('indexOf buff', () => buff.indexOf(0x20))
  .add('indexOf string', () => buffString.indexOf(' '))
  .add('for loop', () => loopIndex(buff, 0x20))
  .on('cycle', event => {
    res.push(Math.floor(event.target.hz));
    console.log(String(event.target));
  })
  .on('complete', function() {
    const fastest = this.filter('fastest').map('name');
    console.log(`\n# ${fastest} is +${percentageDiff(res).toFixed(2)}% faster`);
    console.log('\n```\n');
  })
  .run();
