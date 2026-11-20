/**
 * Интеграционный тест интерфейса без браузера (jsdom).
 *
 * Поднимает index.html, подключает настоящий js/app.js и проверяет
 * пользовательские сценарии: вход, публикация поста, фильтр, выход.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Поднимает «браузер» с нашим index.html. */
async function boot({ hash = '#/login' } = {}) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: `http://localhost:4173/${hash}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  // jsdom не реализует часть API — добавляем минимальные заглушки.
  window.fetch = () => Promise.reject(new Error('network disabled in tests'));
  window.TextEncoder ??= TextEncoder;

  // app.js использует глобальные document/location/localStorage — подставляем.
  const globals = [
    'window', 'document', 'location', 'history', 'localStorage',
    'Event', 'CustomEvent', 'Node', 'HTMLElement',
  ];
  const saved = new Map();
  for (const key of globals) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === 'window' ? window : window[key];
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }

  // Кэш ESM сбрасываем: каждому «браузеру» нужен свой экземпляр app.js.
  moduleCounter += 1;
  await import(`${pathToFileURL(join(root, 'js/app.js')).href}?boot=${moduleCounter}`);
  await tick(window, 40);

  return {
    window,
    document: window.document,
    close() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}

let moduleCounter = 0;

const tick = (window, ms = 20) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const $ = (document, selector) => document.querySelector(selector);

/** Ждёт, пока в DOM появится элемент (мок-API отвечает с задержкой). */
async function waitFor(app, selector, timeout = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ($(app.document, selector)) return;
    await tick(app.window, 25);
  }
  throw new Error(`Не дождались элемента ${selector}`);
}

test('неавторизованного показываем экран входа', async () => {
  const app = await boot();
  try {
    assert.equal($(app.document, '#auth-view').hidden, false);
    assert.equal($(app.document, '#forum-view').hidden, true);
    assert.match(app.document.title, /Вход/);
  } finally {
    app.close();
  }
});

test('вход по никнейму открывает форум и ленту', async () => {
  const app = await boot();
  try {
    const input = $(app.document, '#login-username');
    input.value = 'Артём';
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));

    await waitFor(app, '#feed .post');

    assert.equal($(app.document, '#auth-view').hidden, true);
    assert.equal($(app.document, '#forum-view').hidden, false);
    assert.equal($(app.document, '#user-name').textContent, 'Артём');
    assert.match($(app.document, '#user-avatar').textContent, /А/);
    assert.ok(app.document.querySelectorAll('#feed .post').length > 0, 'лента не пустая');
    assert.ok(app.document.querySelectorAll('#category-list .cat').length > 1);
  } finally {
    app.close();
  }
});

test('пустой никнейм показывает ошибку и не пускает на форум', async () => {
  const app = await boot();
  try {
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));
    await tick(app.window, 100);

    const error = $(app.document, '#login-error');
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /никнейм/i);
    assert.equal($(app.document, '#forum-view').hidden, true);
  } finally {
    app.close();
  }
});

test('публикация поста добавляет карточку в ленту', async () => {
  const app = await boot();
  try {
    $(app.document, '#login-username').value = 'Artem';
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));
    await waitFor(app, '#feed .post');

    const before = app.document.querySelectorAll('#feed .post').length;

    $(app.document, '#composer-title').value = 'Пост из теста';
    const body = $(app.document, '#composer-body');
    body.value = 'Проверяем публикацию без бэкенда';
    body.dispatchEvent(new app.window.Event('input'));

    assert.match($(app.document, '#composer-counter').textContent, /\/ 3000/);

    $(app.document, '#composer').dispatchEvent(new app.window.Event('submit'));
    await tick(app.window, 700);

    const posts = app.document.querySelectorAll('#feed .post');
    assert.equal(posts.length, before + 1);
    assert.equal(posts[0].querySelector('.post__title').textContent, 'Пост из теста');
    assert.equal($(app.document, '#composer-title').value, '');
  } finally {
    app.close();
  }
});

test('пост с коротким заголовком не публикуется, показывается ошибка', async () => {
  const app = await boot();
  try {
    $(app.document, '#login-username').value = 'Artem';
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));
    await waitFor(app, '#feed .post');

    const before = app.document.querySelectorAll('#feed .post').length;
    $(app.document, '#composer-title').value = 'ok';
    $(app.document, '#composer-body').value = 'текст';
    $(app.document, '#composer').dispatchEvent(new app.window.Event('submit'));
    await tick(app.window, 700);

    const error = $(app.document, '#composer-error');
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /Заголовок/);
    assert.equal(app.document.querySelectorAll('#feed .post').length, before);
  } finally {
    app.close();
  }
});

test('фильтр по категории сужает ленту', async () => {
  const app = await boot();
  try {
    $(app.document, '#login-username').value = 'Artem';
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));
    await waitFor(app, '#feed .post');

    const cats = [...app.document.querySelectorAll('#category-list .cat')];
    const techCat = cats.find((node) => node.textContent.includes('Технологии'));
    assert.ok(techCat, 'категория «Технологии» есть');
    techCat.dispatchEvent(new app.window.Event('click'));
    await tick(app.window, 60);

    assert.equal($(app.document, '#feed-title').textContent, 'Технологии');
    for (const post of app.document.querySelectorAll('#feed .post')) {
      assert.match(post.textContent, /Технологии/);
    }
  } finally {
    app.close();
  }
});

test('выход возвращает на экран входа и очищает сессию', async () => {
  const app = await boot();
  try {
    $(app.document, '#login-username').value = 'Artem';
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));
    await waitFor(app, '#feed .post');

    $(app.document, '#logout-btn').dispatchEvent(new app.window.Event('click'));
    await tick(app.window, 60);

    assert.equal($(app.document, '#auth-view').hidden, false);
    assert.equal(app.window.localStorage.getItem('byteforge:session'), null);
  } finally {
    app.close();
  }
});

test('никнейм пользователя выводится текстом, а не HTML (защита от XSS)', async () => {
  const app = await boot();
  try {
    $(app.document, '#login-username').value = '<img src=x onerror=alert(1)>x';
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));
    await tick(app.window, 400);
    // невалидный никнейм (спецсимволы) — остаёмся на входе без инъекции
    assert.equal(app.document.querySelectorAll('#auth-view img').length, 0);

    $(app.document, '#login-username').value = 'b0b';
    $(app.document, '#login-form').dispatchEvent(new app.window.Event('submit'));
    await waitFor(app, '#feed .post');

    $(app.document, '#composer-title').value = '<b>жирный</b> заголовок';
    $(app.document, '#composer-body').value = '<script>alert(1)</script> тело';
    $(app.document, '#composer').dispatchEvent(new app.window.Event('submit'));
    await tick(app.window, 700);

    const title = app.document.querySelector('#feed .post .post__title');
    assert.equal(title.textContent, '<b>жирный</b> заголовок');
    assert.equal(title.querySelector('b'), null);
    assert.equal(app.document.querySelectorAll('#feed script').length, 0);
  } finally {
    app.close();
  }
});
