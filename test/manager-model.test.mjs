import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, formatBytes, formatTime } from '../src/ui/manager-model.mjs';

const rows = [
  { peerKey: 'group:g1', name: '开发群', id: 'g1', sizeBytes: 4096, count: 3, lastRecallTime: '1720000000' },
  { peerKey: 'friend:u1', name: '小明', id: 'u1', sizeBytes: 1024, count: 1, lastRecallTime: '1720001000000' },
];

test('filterRows searches names and ids without changing size order', () => {
  assert.deepEqual(filterRows(rows, '群').map(row => row.peerKey), ['group:g1']);
  assert.deepEqual(filterRows(rows, 'u1').map(row => row.peerKey), ['friend:u1']);
  assert.deepEqual(filterRows(rows, '').map(row => row.peerKey), ['group:g1', 'friend:u1']);
});

test('formatBytes uses compact binary units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('formatTime accepts QQ seconds and JavaScript milliseconds', () => {
  assert.notEqual(formatTime('1720000000'), '未知');
  assert.equal(formatTime(''), '未知');
  assert.equal(formatTime('not-time'), '未知');
});

