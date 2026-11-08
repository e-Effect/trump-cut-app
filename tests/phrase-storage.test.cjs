const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  StorageOrigin, openApp, phraseState, assertInputs, STORAGE_KEY, BACKUP_KEY
} = require('./helpers/browser.cjs');

const seeded = state => new StorageOrigin({ [STORAGE_KEY]: JSON.stringify(state) });
const envelope = phrases => ({ app: 'True Cut', type: 'phrase-settings', version: 2, phrases });
const backup = phrases => JSON.stringify({ savedAt: '2026-11-07T02:49:47.000Z', phrases });
const status = app => app.element('phraseSaveStatus').textContent;
const assertWarning = app => {
  assert.match(status(app), /保存できません|読み込めません|保存ができない/);
  assert.equal(app.element('phraseSaveStatus').style.color, 'rgb(185, 28, 28)');
};

test('fresh storage displays 52 empty entries without writing defaults', t => {
  const app = openApp(t);
  assertInputs(app, phraseState());
  assert.deepEqual(app.origin.writes, []);
  assert.equal(app.element('restorePhrasesBtn').disabled, true);
});

test('all 52 texts, orientations and automatic links survive load and reload', t => {
  const state = phraseState('日本語の設定 🃏 ');
  state['52'] = { text: state['1'].text, orientation: 'front', autoFrom: 1 };
  const origin = seeded(state);
  assertInputs(openApp(t, origin), state);
  assertInputs(openApp(t, origin), state);
  assert.deepEqual(origin.state(), state);
  assert.deepEqual(origin.writes, []);
});

test('legacy string settings load without rewriting storage', t => {
  const legacy = Object.fromEntries(Array.from({ length: 52 }, (_, i) => [String(i + 1), `  旧フレーズ${i + 1}  `]));
  const expected = phraseState();
  for (const key of Object.keys(expected)) expected[key].text = legacy[key].trim();
  const app = openApp(t, seeded(legacy));
  assertInputs(app, expected);
  assert.deepEqual(app.origin.state(), legacy);
  assert.deepEqual(app.origin.writes, []);
});

test('input and orientation events autosave immediately and preserve the other 51 entries', t => {
  const expected = phraseState('既存');
  const origin = seeded(expected);
  const app = openApp(t, origin);
  app.edit(17, '  編集したフレーズ  ');
  expected['17'].text = '編集したフレーズ';
  assert.deepEqual(origin.state(), expected, 'input is persisted before blur or Save');
  assert.equal(app.element('phrase-input-17').value, '  編集したフレーズ  ', 'active input retains caret text');
  app.orient(17, 'front');
  expected['17'].orientation = 'front';
  assert.deepEqual(origin.state(), expected);
  assertInputs(openApp(t, origin), expected);
  assert.equal(origin.state(BACKUP_KEY), null, 'ordinary edits do not replace a restore point');
});

test('automatic mirror text, opposite orientation and link survive reload and clear', t => {
  const app = openApp(t);
  app.edit(1, 'ミラー');
  let state = app.origin.state();
  assert.deepEqual(state['52'], { text: 'ミラー', orientation: 'front', autoFrom: 1 });
  app.orient(1, 'front');
  state = app.origin.state();
  assert.deepEqual(state['52'], { text: 'ミラー', orientation: 'back', autoFrom: 1 });
  assertInputs(openApp(t, app.origin), state);
  app.edit(1, '更新');
  assert.equal(app.origin.state()['52'].text, '更新');
  app.edit(1, '');
  const expected = phraseState();
  expected['1'].orientation = 'front'; // Clearing text preserves the source orientation.
  assert.deepEqual(app.origin.state(), expected);
});

test('every one of the 52 input/select pairs autosaves and survives reopening', t => {
  const expected = phraseState('元');
  const origin = seeded(expected);
  const app = openApp(t, origin);
  for (let position = 1; position <= 52; position++) {
    app.edit(position, `編集${position} 🃏`);
    const orientation = position % 2 ? 'front' : 'back';
    app.orient(position, orientation);
    expected[String(position)] = { text: `編集${position} 🃏`, orientation, autoFrom: null };
    assert.deepEqual(origin.state(), expected, `autosave ${position} preserves all other entries`);
  }
  assertInputs(openApp(t, origin), expected);
});

test('editing an automatic mirror detaches it and preserves the independent phrase', t => {
  const app = openApp(t);
  app.edit(1, '元');
  app.edit(52, '独立');
  assert.equal(app.origin.state()['52'].autoFrom, null);
  app.edit(1, '変更');
  app.orient(1, 'front');
  app.edit(1, '');
  assert.deepEqual(app.origin.state()['52'], { text: '独立', orientation: 'front', autoFrom: null });
});

test('export includes all 52 persisted entries and can be reimported', async t => {
  const state = phraseState('出力');
  const app = openApp(t, seeded(state));
  const payload = await app.exported();
  assert.equal(payload.app, 'True Cut');
  assert.equal(payload.type, 'phrase-settings');
  assert.equal(payload.version, 2);
  assert.deepEqual(payload.phrases, state);
  const other = openApp(t);
  await other.importFile(JSON.stringify(payload));
  assertInputs(other, state);
  assert.deepEqual(other.origin.state(), state);
});

test('stale tab merges a single edited item into latest storage without losing another tab edits', t => {
  const origin = seeded(phraseState('既存'));
  const a = openApp(t, origin);
  const b = openApp(t, origin);
  a.edit(1, 'タブA');
  assert.equal(b.element('phrase-input-1').value, '既存1', 'storage event is still queued');
  b.edit(2, 'タブB');
  assert.equal(origin.state()['1'].text, 'タブA');
  assert.equal(origin.state()['2'].text, 'タブB');
  const expected = phraseState('既存');
  expected['1'].text = 'タブA';
  expected['2'].text = 'タブB';
  assert.deepEqual(origin.state(), expected);
  a.element('phrase-input-1').blur();
  b.element('phrase-input-2').blur();
  origin.flushEvents();
  assertInputs(a, expected);
  assertInputs(b, expected);
});

test('stale tab merges text and orientation separately for the same item', t => {
  const origin = seeded(phraseState('既存'));
  const a = openApp(t, origin);
  const b = openApp(t, origin);
  a.edit(1, '新しい本文');
  b.orient(1, 'front');
  assert.deepEqual(origin.state()['1'], { text: '新しい本文', orientation: 'front', autoFrom: null });
  a.orient(2, 'back');
  b.edit(2, '別の本文');
  assert.deepEqual(origin.state()['2'], { text: '別の本文', orientation: 'back', autoFrom: null });
});

test('storage notifications refresh passive inputs but preserve the active input', t => {
  const origin = seeded(phraseState('既存'));
  const a = openApp(t, origin);
  const b = openApp(t, origin);
  b.element('phrase-input-1').focus();
  a.edit(1, 'リモート');
  a.edit(2, 'リモート2');
  origin.flushEvents();
  assert.equal(b.element('phrase-input-1').value, '既存1');
  assert.equal(b.element('phrase-input-2').value, 'リモート2');
  assert.equal(origin.state()['1'].text, 'リモート', 'focused stale text is not written back');
  b.click('savePhrasesBtn');
  assert.equal(origin.state()['1'].text, 'リモート', 'Save does not serialize stale inputs');
});

test('backup changes and storage.clear propagate to another tab', async t => {
  const origin = seeded(phraseState('既存'));
  const a = openApp(t, origin);
  const b = openApp(t, origin);
  await a.importFile(JSON.stringify(envelope(phraseState('取込'))));
  origin.flushEvents();
  assert.equal(b.element('restorePhrasesBtn').disabled, false);
  assertInputs(b, phraseState('取込'));
  a.window.localStorage.clear();
  origin.flushEvents();
  assertInputs(b, phraseState());
  assert.equal(b.element('restorePhrasesBtn').disabled, true);
});

test('unrelated storage events do not write or change phrase settings', t => {
  const origin = seeded(phraseState('既存'));
  const a = openApp(t, origin);
  const b = openApp(t, origin);
  a.window.localStorage.setItem('unrelated', 'value');
  origin.flushEvents();
  assertInputs(b, phraseState('既存'));
  assert.equal(origin.writes.length, 1);
});

test('quota failure keeps edits in memory, warns, and exports the unsaved state', async t => {
  const origin = seeded(phraseState('既存'));
  const app = openApp(t, origin);
  origin.failWrite = key => key === STORAGE_KEY;
  app.edit(3, '未保存');
  app.orient(3, 'front');
  assertWarning(app);
  const expected = phraseState('既存');
  expected['3'] = { text: '未保存', orientation: 'front', autoFrom: null };
  assert.deepEqual((await app.exported()).phrases, expected);
  assert.deepEqual(origin.state(), phraseState('既存'), 'durable data is unchanged');
  assertInputs(openApp(t, origin), phraseState('既存'), 'reload sees only durable data');
  origin.failWrite = () => false;
  app.click('savePhrasesBtn');
  assert.deepEqual(origin.state(), expected);
  assert.equal(status(app), 'この端末に保存しました。');
  assertInputs(openApp(t, origin), expected);
});

test('memory-only edits survive storage notifications from another tab', async t => {
  const origin = seeded(phraseState('既存'));
  const app = openApp(t, origin);
  const other = openApp(t, origin);
  origin.failWrite = (key, value, window) => key === STORAGE_KEY && window === app.window;
  app.edit(1, '未保存の編集');
  other.edit(2, '別タブ');
  origin.flushEvents();
  const payload = await app.exported();
  assert.equal(payload.phrases['1'].text, '未保存の編集');
  assert.equal(payload.phrases['2'].text, '既存2');
  assert.equal(app.element('phrase-input-1').value, '未保存の編集');
  assertWarning(app);
});

test('denied reads and writes show warnings and still allow memory edits/export', async t => {
  const origin = seeded(phraseState('既存'));
  origin.failRead = () => true;
  origin.failWrite = () => true;
  const app = openApp(t, origin);
  assertWarning(app);
  assert.equal(app.element('restorePhrasesBtn').disabled, true);
  app.edit(4, 'メモリだけ');
  assertWarning(app);
  const payload = await app.exported();
  assert.equal(payload.phrases['4'].text, 'メモリだけ');
  assert.equal(payload.phrases['49'].autoFrom, 4);
  assert.deepEqual(origin.state(), phraseState('既存'));
});

for (const [name, raw] of [['invalid JSON', '{broken'], ['invalid stored data', '{"53":"bad"}']]) {
  test(`${name} warns and does not silently replace the stored bytes`, async t => {
    const origin = new StorageOrigin({ [STORAGE_KEY]: raw });
    const app = openApp(t, origin);
    assertWarning(app);
    assertInputs(app, phraseState());
    assert.equal(origin.data.get(STORAGE_KEY), raw);
    assert.deepEqual(origin.writes, []);
    assert.deepEqual((await app.exported()).phrases, phraseState());
  });
}

for (const version of [1, 2]) {
  test(`version ${version} JSON import replaces all 52 entries and backs up prior settings`, async t => {
    const old = phraseState('変更前');
    const next = phraseState('変更後');
    next['52'] = { text: next['1'].text, orientation: 'front', autoFrom: 1 };
    const app = openApp(t, seeded(old));
    await app.importFile(JSON.stringify({ ...envelope(next), version }));
    assert.deepEqual(app.alerts, []);
    assert.equal(app.confirmations.length, 1);
    assert.deepEqual(app.origin.state(), next);
    assert.deepEqual(app.origin.state(BACKUP_KEY).phrases, old);
    assert.ok(Number.isFinite(Date.parse(app.origin.state(BACKUP_KEY).savedAt)));
    assert.deepEqual(app.origin.writes.map(write => write.key), [BACKUP_KEY, STORAGE_KEY]);
    assert.equal(app.element('importPhrasesFile').value, '');
    assertInputs(app, next);
    assertInputs(openApp(t, app.origin), next);
  });
}

test('legacy and partial JSON imports normalize missing entries and fields', async t => {
  const app = openApp(t, seeded(phraseState('既存')));
  await app.importFile(JSON.stringify({ '1': '  旧式  ', '52': { text: '  新式  ' } }));
  const expected = phraseState();
  expected['1'].text = '旧式';
  expected['52'].text = '新式';
  assert.deepEqual(app.origin.state(), expected);
  assertInputs(app, expected);
});

test('canceling JSON confirmation preserves current settings and the existing backup', async t => {
  const origin = seeded(phraseState('既存'));
  origin.data.set(BACKUP_KEY, backup(phraseState('以前')));
  const app = openApp(t, origin);
  const before = new Map(origin.data);
  app.window.confirm = () => false;
  await app.importFile(JSON.stringify(envelope(phraseState('取込'))));
  assert.deepEqual(origin.data, before);
  assert.deepEqual(origin.writes, []);
  assertInputs(app, phraseState('既存'));
  assert.deepEqual(app.alerts, []);
  assert.equal(app.element('importPhrasesFile').value, '');
});

test('canceling the file picker leaves settings and backup untouched', async t => {
  const app = openApp(t, seeded(phraseState('既存')));
  await app.importFile(null);
  assert.deepEqual(app.origin.writes, []);
  assert.deepEqual(app.confirmations, []);
  assert.deepEqual(app.alerts, []);
  assertInputs(app, phraseState('既存'));
});

const invalidImports = [
  ['broken JSON', '{broken'],
  ['null', 'null'], ['array', '[]'], ['number', '42'], ['empty object', '{}'],
  ['wrong app', JSON.stringify({ ...envelope({ '1': 'ok' }), app: 'Other' })],
  ['wrong type', JSON.stringify({ ...envelope({ '1': 'ok' }), type: 'other' })],
  ['unsupported version', JSON.stringify({ ...envelope({ '1': 'ok' }), version: 3 })],
  ['string version', JSON.stringify({ ...envelope({ '1': 'ok' }), version: '2' })],
  ['empty phrases', JSON.stringify(envelope({}))],
  ['null phrases', JSON.stringify(envelope(null))],
  ['array phrases', JSON.stringify(envelope(['bad']))],
  ...['0', '53', '-1', '01', '1.5', 'other', '__proto__'].map(key => [
    `invalid position ${key}`, JSON.stringify({ '1': 'valid', [key]: 'bad' })
  ]),
  ...[null, 42, [], {}, { text: 42 }, { text: 'bad', orientation: 'side' },
    { text: 'bad', autoFrom: 0 }, { text: 'bad', autoFrom: 53 },
    { text: 'bad', autoFrom: 1 }, { text: 'bad', autoFrom: 1.5 },
    { text: 'bad', autoFrom: '2' }
  ].map((entry, index) => [`invalid entry ${index}`, JSON.stringify({ '2': 'valid', '1': entry })])
];
for (const [name, json] of invalidImports) {
  test(`rejects ${name} without modifying settings or backup`, async t => {
    const origin = seeded(phraseState('既存'));
    origin.data.set(BACKUP_KEY, backup(phraseState('以前')));
    const app = openApp(t, origin);
    const before = new Map(origin.data);
    await app.importFile(json);
    assert.equal(app.alerts.length, 1);
    assert.deepEqual(app.confirmations, [], 'validation precedes confirmation');
    assert.deepEqual(origin.data, before);
    assert.deepEqual(origin.writes, []);
    assertInputs(app, phraseState('既存'));
    assert.equal(app.element('importPhrasesFile').value, '');
  });
}

for (const operation of ['import', 'clear']) {
  for (const failedKey of [BACKUP_KEY, STORAGE_KEY]) {
    test(`${operation} aborts safely when ${failedKey === BACKUP_KEY ? 'backup' : 'main'} write fails`, async t => {
      const old = phraseState('既存');
      const origin = seeded(old);
      const priorBackup = backup(phraseState('以前'));
      origin.data.set(BACKUP_KEY, priorBackup);
      const app = openApp(t, origin);
      origin.failWrite = key => key === failedKey;
      if (operation === 'import') {
        await app.importFile(JSON.stringify(envelope(phraseState('取込'))));
        assert.equal(app.alerts.length, 1);
        assert.match(app.alerts[0], /設定を置き換えませんでした/);
      } else {
        app.click('clearPhrasesBtn');
        assertWarning(app);
      }
      assert.deepEqual(origin.state(), old);
      assertInputs(app, old);
      assert.deepEqual((await app.exported()).phrases, old);
      if (failedKey === BACKUP_KEY) {
        assert.equal(origin.data.get(BACKUP_KEY), priorBackup);
        assert.deepEqual(origin.writes, []);
      } else {
        assert.deepEqual(origin.state(BACKUP_KEY).phrases, old);
        assert.deepEqual(origin.writes.map(write => write.key), [BACKUP_KEY]);
      }
    });
  }
}

test('clear backs up all 52 entries and restore returns their exact values after reload', t => {
  const old = phraseState('元の設定');
  old['52'] = { text: old['1'].text, orientation: 'front', autoFrom: 1 };
  const origin = seeded(old);
  const app = openApp(t, origin);
  app.click('clearPhrasesBtn');
  assert.deepEqual(origin.state(), phraseState());
  assertInputs(app, phraseState());
  assert.deepEqual(origin.state(BACKUP_KEY).phrases, old);
  const reloaded = openApp(t, origin);
  assert.equal(reloaded.element('restorePhrasesBtn').disabled, false);
  reloaded.click('restorePhrasesBtn');
  assert.deepEqual(origin.state(), old);
  assertInputs(reloaded, old);
  assert.equal(status(reloaded), '直前の設定に戻しました。');
  assertInputs(openApp(t, origin), old);
});

test('restore after import returns the latest pre-replacement edits, including memory-only edits', async t => {
  const origin = seeded(phraseState('既存'));
  const app = openApp(t, origin);
  origin.failWrite = key => key === STORAGE_KEY;
  app.edit(1, '保存失敗した編集');
  origin.failWrite = () => false;
  await app.importFile(JSON.stringify(envelope(phraseState('取込'))));
  assert.equal(origin.state(BACKUP_KEY).phrases['1'].text, '保存失敗した編集');
  app.click('restorePhrasesBtn');
  assert.equal(origin.state()['1'].text, '保存失敗した編集');
  assertInputs(app, origin.state());
});

test('repeated replacement updates the restore point; ordinary edits do not', async t => {
  const app = openApp(t, seeded(phraseState('最初')));
  await app.importFile(JSON.stringify(envelope(phraseState('中間'))));
  app.edit(1, '中間で編集');
  assert.deepEqual(app.origin.state(BACKUP_KEY).phrases, phraseState('最初'));
  const beforeClear = app.origin.state();
  app.click('clearPhrasesBtn');
  app.click('restorePhrasesBtn');
  assert.deepEqual(app.origin.state(), beforeClear);
});

for (const button of ['clearPhrasesBtn', 'restorePhrasesBtn']) {
  test(`canceling ${button} preserves both saved records`, t => {
    const origin = seeded(phraseState('既存'));
    origin.data.set(BACKUP_KEY, backup(phraseState('以前')));
    const app = openApp(t, origin);
    const before = new Map(origin.data);
    app.window.confirm = () => false;
    app.click(button);
    assert.deepEqual(origin.data, before);
    assert.deepEqual(origin.writes, []);
    assertInputs(app, phraseState('既存'));
  });
}

for (const raw of ['{broken', '{"phrases":{"53":"bad"}}']) {
  test(`corrupt backup (${raw}) cannot overwrite current settings`, t => {
    const origin = seeded(phraseState('既存'));
    origin.data.set(BACKUP_KEY, raw);
    const app = openApp(t, origin);
    app.click('restorePhrasesBtn');
    assert.match(status(app), /バックアップを読み込めませんでした/);
    assertInputs(app, phraseState('既存'));
    assert.deepEqual(origin.writes, []);
  });
}

test('restore quota failure warns and retains restored data in memory for export and retry', async t => {
  const origin = seeded(phraseState('現在'));
  const previous = phraseState('復元先');
  origin.data.set(BACKUP_KEY, backup(previous));
  const app = openApp(t, origin);
  origin.failWrite = key => key === STORAGE_KEY;
  app.click('restorePhrasesBtn');
  assertWarning(app);
  assertInputs(app, previous);
  assert.deepEqual((await app.exported()).phrases, previous);
  assert.deepEqual(origin.state(), phraseState('現在'));
  assert.deepEqual(origin.state(BACKUP_KEY).phrases, previous);
  origin.failWrite = () => false;
  app.click('savePhrasesBtn');
  assert.deepEqual(origin.state(), previous);
});

test('backup read failure during restore leaves current data unchanged', t => {
  const origin = seeded(phraseState('現在'));
  origin.data.set(BACKUP_KEY, backup(phraseState('以前')));
  const app = openApp(t, origin);
  origin.failRead = key => key === BACKUP_KEY;
  app.click('restorePhrasesBtn');
  assert.match(status(app), /バックアップを読み込めませんでした/);
  assertInputs(app, phraseState('現在'));
  assert.deepEqual(origin.writes, []);
});
