import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findMessageContent,
  findMessageRow,
  placeRecallNotice,
  removeRecallNotice,
} from '../src/ui/recall-notice.mjs';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.insertBeforeCalls = 0;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    this.insertBeforeCalls += 1;
    child.remove();
    child.parentElement = this;
    this.children.splice(this.children.indexOf(reference), 0, child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }

  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    const visit = element => {
      if (className && String(element.className).split(/\s+/).includes(className)) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this);
  }
}

class FakeDocument {
  constructor(root) {
    this.root = root;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    const visit = element => {
      if (element.id === id) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this.root);
  }
}

test('placeRecallNotice inserts one native notice immediately before its message row', () => {
  const parent = new FakeElement('div');
  const row = parent.appendChild(new FakeElement('div'));
  const document = new FakeDocument(parent);

  assert.equal(placeRecallNotice(document, row, '123'), true);
  const notice = parent.children[0];
  assert.equal(notice.id, 'qq-local-recall-notice-123');
  assert.equal(notice.className, 'qq-local-recall-notice');
  assert.equal(notice.children[0].className, 'qq-local-recall-notice__pill');
  assert.equal(notice.children[0].textContent, '对方尝试撤回一条消息');
  assert.equal(parent.children[1], row);

  assert.equal(placeRecallNotice(document, row, '123'), true);
  assert.equal(parent.children.length, 2);
  assert.equal(parent.children[0], notice);
  assert.equal(parent.insertBeforeCalls, 1);
});

test('placeRecallNotice does not move an existing notice when it is already directly above the row', () => {
  const parent = new FakeElement('div');
  const row = parent.appendChild(new FakeElement('div'));
  const document = new FakeDocument(parent);

  placeRecallNotice(document, row, '123');
  const callsAfterFirstPlacement = parent.insertBeforeCalls;
  placeRecallNotice(document, row, '123');

  assert.equal(parent.insertBeforeCalls, callsAfterFirstPlacement);
  assert.equal(parent.children[1], row);
});

test('findMessageRow locates the QQ 9.9.32 ml-item whose id is the raw message id', () => {
  const root = new FakeElement('div');
  const row = root.appendChild(new FakeElement('div'));
  row.id = '7662023921262556715';
  row.className = 'ml-item';
  const document = new FakeDocument(root);

  assert.equal(findMessageRow(document, '7662023921262556715'), row);
});

test('findMessageContent locates the restored content inside a raw-id ml-item', () => {
  const root = new FakeElement('div');
  const row = root.appendChild(new FakeElement('div'));
  row.id = '7662023921262556715';
  row.className = 'ml-item';
  const content = row.appendChild(new FakeElement('div'));
  content.className = 'msg-content-container container--others';
  const document = new FakeDocument(root);

  assert.equal(findMessageContent(document, '7662023921262556715'), content);
});

test('removeRecallNotice removes only the notice for the selected message', () => {
  const parent = new FakeElement('div');
  const firstRow = parent.appendChild(new FakeElement('div'));
  const secondRow = parent.appendChild(new FakeElement('div'));
  const document = new FakeDocument(parent);
  placeRecallNotice(document, firstRow, '123');
  placeRecallNotice(document, secondRow, '456');

  removeRecallNotice(document, '123');

  assert.equal(document.getElementById('qq-local-recall-notice-123'), null);
  assert.notEqual(document.getElementById('qq-local-recall-notice-456'), null);
});
