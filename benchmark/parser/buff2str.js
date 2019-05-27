/* eslint-disable prettier/prettier */
const Benchmark = require('benchmark');

const suite = new Benchmark.Suite();

const codeLookup = [
    '\0', '', '', '', '', '', '', '',
    '', '', '', '', '', '', '', '',
    '', '', '', '', '', '', '', '',
    '', '', '', '', '', '', '', '',
    ' ', '!', '"', '#', '$', '%', '&', '\'',
    '', '', '*', '+', ',', '-', '.', '/',
    '0', '1', '2', '3', '4', '5', '6', '7',
    '8', '9', ':', ';', '<', '=', '>', '?',
    '@', 'A', 'B', 'C', 'D', 'E', 'F', 'G',
    'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
    'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W',
    'X', 'Y', 'Z', '[', '\\', ']', '^', '_',
    '`', 'a', 'b', 'c', 'd', 'e', 'f', 'g',
    'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o',
    'p', 'q', 'r', 's', 't', 'u', 'v', 'w',
    'x', 'y', 'z', '{', '|', '}', '~', ''
  ];

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

const loop = (buff) => {
  let result = '';
  for (let i = 0; i < buff.length; i++) {
    result += codeLookup[buff[i]];
  }
  return result;
};

const res = [];

const percentageDiff = arr => {
  const use = arr.sort((a, b) => b - a);
  return ((use[0] - use[1]) / use[1]) * 100;
};

suite
  .add('toString', () => buff.toString('ascii'))
  .add('toString + toLowerCase', () => buff.toString('ascii').toLowerCase())
  .add('Array loop', () => loop(buff))
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
