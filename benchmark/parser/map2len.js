const Benchmark = require('benchmark');

const suite = new Benchmark.Suite();

const datas = [
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
];

const getLengths = datas => {
  const lens = new Array(datas.length);
  for (let i = 0; i < datas.length; i++) lens[i] = datas[i].length;
  return lens;
};

const res = [];

const percentageDiff = arr => {
  const use = arr.sort((a, b) => b - a);
  return ((use[0] - use[1]) / use[1]) * 100;
};

suite
  .add('map', () => datas.map(item => item.length))
  .add('function', () => getLengths(datas))
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
