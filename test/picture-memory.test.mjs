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
  assert.equal(rememberPictureContent(snapshots, 'text', new FakeElement('text'), 1), false);
  const first = new FakeElement('first', { media: true });
  const second = new FakeElement('second', { media: true });
  rememberPictureContent(snapshots, 'm1', first, 1);
  rememberPictureContent(snapshots, 'm2', second, 1);

  assert.equal(snapshots.has('m1'), false);
  assert.equal(snapshots.has('m2'), true);
});
