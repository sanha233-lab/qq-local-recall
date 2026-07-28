import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rememberPictureContent,
  restorePictureContent,
} from '../src/ui/picture-memory.mjs';

class FakeElement {
  constructor(name, { media = false } = {}) {
    this.name = name;
    this.media = media;
    this.children = [];
    this.dataset = {};
    this.replaceChildrenCalls = 0;
  }

  get childNodes() {
    return this.children;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (selector === 'img, canvas, video, svg' && this.media) return this;
    return this.children.find(child => child.querySelector?.(selector)) || null;
  }

  cloneNode(deep) {
    const clone = new FakeElement(this.name, { media: this.media });
    if (deep) clone.children = this.children.map(child => child.cloneNode(true));
    return clone;
  }

  replaceChildren(...children) {
    this.children = children;
    this.replaceChildrenCalls += 1;
  }
}

test('picture memory restores a cloned rendered image without sharing live DOM nodes', () => {
  const snapshots = new Map();
  const original = new FakeElement('content');
  original.appendChild(new FakeElement('rendered-image', { media: true }));

  assert.equal(rememberPictureContent(snapshots, 'm1', original), true);
  original.replaceChildren();
  const target = new FakeElement('content');
  assert.equal(restorePictureContent(snapshots, 'm1', target), true);

  assert.equal(target.children[0].name, 'rendered-image');
  assert.notEqual(target.children[0], original.children[0]);
  assert.equal(restorePictureContent(snapshots, 'm1', target), true);
  assert.equal(target.replaceChildrenCalls, 1);
});

test('picture memory ignores content without rendered media and evicts the oldest snapshot', () => {
  const snapshots = new Map();
  assert.equal(rememberPictureContent(snapshots, 'text', new FakeElement('text'), { limit: 1 }), false);
  const first = new FakeElement('first', { media: true });
  const second = new FakeElement('second', { media: true });
  rememberPictureContent(snapshots, 'm1', first, { limit: 1 });
  rememberPictureContent(snapshots, 'm2', second, { limit: 1 });

  assert.equal(snapshots.has('m1'), false);
  assert.equal(snapshots.has('m2'), true);
});

test('picture memory does not restore a loading snapshot over the final unavailable marker', () => {
  const snapshots = new Map([['m1', new FakeElement('snapshot', { media: true })]]);
  const target = new FakeElement('target');
  target.dataset = { qqLocalRecallMemoryId: 'm1' };
  target.querySelector = selector => selector === '.qq-local-recall-media-unavailable' ? {} : null;

  const restored = restorePictureContent(snapshots, 'm1', target);

  assert.equal(restored, true);
  assert.equal(target.replaceChildrenCalls, 0);
});

test('picture memory preserves the pre-recall snapshot after QQ replaces the image', () => {
  const snapshots = new Map();
  const original = new FakeElement('original-content');
  original.appendChild(new FakeElement('original-picture', { media: true }));
  const failed = new FakeElement('failed-content');
  failed.appendChild(new FakeElement('loading-failed', { media: true }));
  rememberPictureContent(snapshots, 'm1', original);

  rememberPictureContent(snapshots, 'm1', failed, { overwrite: false });
  const target = new FakeElement('target');
  restorePictureContent(snapshots, 'm1', target);

  assert.equal(target.children[0].name, 'original-picture');
});
