const Benchmark = require('benchmark');

const { HTTPParser } = require('http-parser-js');
const HTTPParser2 = require('../../lib/http/http-parser');

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

const noop = () => {
  // noop
};

const parser1 = new HTTPParser(HTTPParser.REQUEST);
parser1[HTTPParser.kOnHeadersComplete] = noop;
parser1[HTTPParser.kOnBody] = noop;
parser1[HTTPParser.kOnMessageComplete] = noop;

const parser2 = new HTTPParser2();
parser2[HTTPParser2.kOnHeadersComplete] = noop;
parser2[HTTPParser2.kOnBody] = noop;
parser2[HTTPParser2.kOnMessageComplete] = noop;

const res = [];

const percentageDiff = arr => {
  const use = arr.sort((a, b) => b - a);
  return ((use[0] - use[1]) / use[1]) * 100;
};

suite
  .add('http-parser', () => parser1.execute(buff, 0, buff.length))
  .add('tiny-parser', () => parser2.execute(buff, 0, buff.length))
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
