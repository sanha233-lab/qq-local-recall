'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'src');
const forbidden = [
  { name: 'network module', pattern: /require\(['"](?:node:)?(?:http|https|net|tls|dgram)['"]\)/ },
  { name: 'network API', pattern: /\b(?:fetch|WebSocket|EventSource)\s*\(/ },
  { name: 'network URL literal', pattern: /https?:/i },
  { name: 'child process', pattern: /require\(['"](?:node:)?child_process['"]\)/ },
  { name: 'dynamic evaluation', pattern: /\b(?:eval|Function)\s*\(/ },
  { name: 'native module reference', pattern: /\.(?:node|dll)\b/i },
];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? files(fullPath) : [fullPath];
  });
}

const failures = [];
for (const file of files(root)) {
  if (!/\.(?:js|mjs|html)$/.test(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) failures.push(`${path.relative(root, file)}: ${rule.name}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Static audit passed: no forbidden network APIs, URL literals, process, dynamic-code, or native-module usage in src/.');
