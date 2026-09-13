const fs = require('fs');
const fd = 'C:/Users/DC/Desktop/微信WEB开发者工具/resources/app.asar';
const fd2 = fd;
const size = fs.statSync(fd).size;
const fh = fs.openSync(fd, 'r');
function readPickleUInt32(buf, off) { return buf.readUInt32LE(off); }
const head = Buffer.alloc(16);
fs.readSync(fh, head, 0, 16, 0);
// asar: 4 bytes (4), pickle size uint32, header str size uint32, header size uint32
const jsonSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(jsonSize);
fs.readSync(fh, hbuf, 0, jsonSize, 16);
const json = JSON.parse(hbuf.toString('utf8'));
const hits = [];
function walk(node, p) {
  if (node.files) {
    for (const name of Object.keys(node.files)) {
      const child = node.files[name];
      const np = p + '/' + name;
      if (/token/i.test(name)) hits.push(np);
      walk(child, np);
    }
  }
}
walk(json, '');
console.log(hits.join('\n'));
fs.closeSync(fh);
