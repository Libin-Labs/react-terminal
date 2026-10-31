import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import * as api from '../dist/esm/index.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

test('tokenization handles quotes, escapes, empty arguments and syntax errors', () => {
  assert.deepEqual(api.parseCommand('echo "two words" \'\' a\\ b'), [
    'echo',
    'two words',
    '',
    'a b',
  ]);
  assert.deepEqual(api.parseCommand('  '), []);
  assert.deepEqual(api.parseCommand("echo 'a\\b'"), ['echo', 'a\\b']);
  assert.throws(() => api.parseCommand("'missing"), api.CommandParseError);
  assert.throws(() => api.parseCommand('trailing\\'), /Trailing escape/);
});

test('history is bounded, nonmutating and avoids consecutive duplicates', () => {
  const history = ['one', 'two'];
  assert.deepEqual(api.appendHistory(history, ' two ', 2), history);
  assert.deepEqual(api.appendHistory(history, 'three', 2), ['two', 'three']);
  assert.deepEqual(api.appendHistory(history, 'three', 0), []);
  assert.deepEqual(history, ['one', 'two']);
  assert.deepEqual(api.getCompletions('he', ['help', 'hello', 'help', 'echo']), ['hello', 'help']);
});

async function fixture(handler, initial = 'echo hello', extra = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const events = [];
  function App() {
    const [value, onValueChange] = useState(initial);
    const [history, onHistoryChange] = useState(['first', 'second']);
    const [entries, setEntries] = useState([]);
    return React.createElement(api.Terminal, {
      value,
      onValueChange,
      history,
      onHistoryChange,
      entries,
      onCommand: handler,
      onEntry: (entry) => {
        events.push(entry);
        setEntries((previous) => [...previous.filter((item) => item.id !== entry.id), entry]);
      },
      ...extra,
    });
  }
  await act(async () => root.render(React.createElement(App)));
  return {
    host,
    events,
    submit: () =>
      act(async () =>
        host
          .querySelector('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      ),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('async command lifecycle supplies parsed args and updates controlled entries', async () => {
  let resolve;
  let context;
  const f = await fixture((command, value) => {
    assert.equal(command, 'echo hello');
    context = value;
    return new Promise((done) => {
      resolve = done;
    });
  });
  try {
    await f.submit();
    assert.deepEqual(context.args, ['echo', 'hello']);
    assert.equal(context.signal.aborted, false);
    assert.equal(f.events[0].status, 'running');
    assert.equal(f.host.querySelector('input').disabled, true);
    await f.submit();
    assert.equal(f.events.length, 1);
    await act(async () => resolve('<b>plain text</b>'));
    assert.equal(f.events[1].status, 'success');
    assert.equal(f.events[1].id, f.events[0].id);
    assert.match(f.host.textContent, /<b>plain text<\/b>/);
    assert.equal(f.host.querySelector('b'), null);
    assert.equal(f.host.querySelector('input').disabled, false);
  } finally {
    await f.close();
  }
});

test('rejection, syntax failure and completion failure are surfaced', async () => {
  const failed = await fixture(async () => {
    throw new Error('No permission');
  });
  try {
    await failed.submit();
    assert.equal(failed.events[1].status, 'error');
    assert.match(failed.host.textContent, /No permission/);
  } finally {
    await failed.close();
  }
  let called = false;
  const malformed = await fixture(
    () => {
      called = true;
    },
    '"unterminated',
    {
      complete: () => {
        throw new Error('Completion unavailable');
      },
    },
  );
  try {
    await malformed.submit();
    assert.equal(called, false);
    assert.match(malformed.host.textContent, /Unclosed quote/);
    await act(async () =>
      malformed.host
        .querySelector('input')
        .dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        ),
    );
    assert.match(malformed.host.textContent, /Completion unavailable/);
  } finally {
    await malformed.close();
  }
});

test('history restores draft and Tab offers selectable completions', async () => {
  const f = await fixture(() => '', 'he', { complete: () => ['hello', 'help'] });
  const key = (name) =>
    act(async () =>
      f.host
        .querySelector('input')
        .dispatchEvent(
          new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
        ),
    );
  try {
    await key('ArrowUp');
    assert.equal(f.host.querySelector('input').value, 'second');
    await key('ArrowUp');
    assert.equal(f.host.querySelector('input').value, 'first');
    await key('ArrowDown');
    await key('ArrowDown');
    assert.equal(f.host.querySelector('input').value, 'he');
    await key('Tab');
    assert.equal(f.host.querySelectorAll('[aria-label="Completions"] button').length, 2);
    await act(async () => f.host.querySelector('[aria-label="Completions"] button').click());
    assert.equal(f.host.querySelector('input').value, 'hello');
    const input = f.host.querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
        input,
        'help',
      );
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await key('Tab');
    assert.equal(f.host.querySelector('input').value, 'help');
  } finally {
    await f.close();
  }
});

test('cancellation and unmount abort handlers and ignore late results', async () => {
  let resolve;
  let signal;
  const f = await fixture((_, context) => {
    signal = context.signal;
    return new Promise((done) => {
      resolve = done;
    });
  });
  try {
    await f.submit();
    await act(async () =>
      [...f.host.querySelectorAll('button')]
        .find((button) => button.textContent === 'Cancel')
        .click(),
    );
    assert.equal(signal.aborted, true);
    assert.equal(f.events[1].status, 'cancelled');
    await act(async () => resolve('late'));
    assert.equal(f.events.length, 2);
  } finally {
    await f.close();
  }
  let late;
  let unmountSignal;
  const second = await fixture((_, context) => {
    unmountSignal = context.signal;
    return new Promise((done) => {
      late = done;
    });
  });
  await second.submit();
  await second.close();
  assert.equal(unmountSignal.aborted, true);
  await act(async () => late('late after unmount'));
  assert.equal(second.events.length, 1);
});

test('CommonJS exports match ESM', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(api).sort());
  assert.deepEqual(cjs.parseCommand('echo hi'), ['echo', 'hi']);
});
