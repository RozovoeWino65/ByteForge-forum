/**
 * Тесты уровня данных (без браузера): Node.js test runner.
 * Запуск: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApi, createMemoryStorage, validateUsername, validateTitle, ApiError, LIMITS } from '../js/api.js';

function makeApi(options = {}) {
  return createApi({ mode: 'mock', storage: createMemoryStorage(), delay: 0, seed: false, ...options });
}

const session = (username) => ({ user: { id: 'u1', username }, token: 't' });

test('вход создаёт пользователя и возвращает сессию', async () => {
  const api = makeApi();
  const result = await api.login('  Артём  ');
  assert.equal(result.user.username, 'Артём');
  assert.ok(result.token);
});

test('повторный вход под тем же ником не дублирует пользователя', async () => {
  const storage = createMemoryStorage();
  const api = makeApi({ storage });
  const first = await api.login('Artem');
  const second = await api.login('artem');
  assert.equal(first.user.id, second.user.id);
});

test('никнейм валидируется: пустой и слишком короткий', async () => {
  const api = makeApi();
  await assert.rejects(() => api.login('   '), /Введите никнейм/);
  await assert.rejects(() => api.login('A'), /короче/);
});

test('никнейм с пробелом внутри отклоняется', async () => {
  assert.throws(() => validateUsername('Art em'), ApiError);
  assert.equal(validateUsername('art_em-1'), 'art_em-1');
});

test('категории возвращаются со счётчиком постов', async () => {
  const api = makeApi();
  const categories = await api.listCategories();
  assert.ok(categories.length >= 3);
  for (const category of categories) {
    assert.equal(typeof category.postCount, 'number');
  }
});

test('создание поста добавляет его в ленту первым', async () => {
  const api = makeApi();
  const created = await api.createPost(
    { title: 'Первый пост', body: 'Текст поста', categoryId: 'general' },
    session('Artem'),
  );
  assert.equal(created.author, 'Artem');

  const posts = await api.listPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, created.id);
});

test('пост без текста или с коротким заголовком не создаётся', async () => {
  const api = makeApi();
  const me = session('Artem');
  await assert.rejects(() => api.createPost({ title: 'Ок', body: 'текст', categoryId: 'general' }, me), /Заголовок короче/);
  await assert.rejects(() => api.createPost({ title: 'Норм заголовок', body: '   ', categoryId: 'general' }, me), /Напишите текст/);
});

test('слишком длинный заголовок отклоняется', async () => {
  const api = makeApi();
  const title = 'a'.repeat(LIMITS.title.max + 1);
  await assert.rejects(() => api.createPost({ title, body: 'текст', categoryId: 'general' }, session('Artem')), /длиннее/);
});

test('создание поста без сессии — ошибка 401', async () => {
  const api = makeApi();
  await assert.rejects(
    () => api.createPost({ title: 'Заголовок', body: 'текст', categoryId: 'general' }, null),
    (error) => error.status === 401,
  );
});

test('несуществующая категория отклоняется', async () => {
  const api = makeApi();
  await assert.rejects(
    () => api.createPost({ title: 'Заголовок', body: 'текст', categoryId: 'nope' }, session('Artem')),
    /не существует/,
  );
});

test('фильтрация постов по категории', async () => {
  const api = makeApi();
  const me = session('Artem');
  await api.createPost({ title: 'Про код', body: 'текст', categoryId: 'tech' }, me);
  await api.createPost({ title: 'Про игры', body: 'текст', categoryId: 'games' }, me);

  const tech = await api.listPosts({ categoryId: 'tech' });
  assert.equal(tech.length, 1);
  assert.equal(tech[0].categoryId, 'tech');
});

test('удалить можно только свой пост', async () => {
  const api = makeApi();
  const post = await api.createPost(
    { title: 'Заголовок', body: 'текст', categoryId: 'general' },
    session('Artem'),
  );

  await assert.rejects(() => api.deletePost(post.id, session('Богдан')), (error) => error.status === 403);
  const result = await api.deletePost(post.id, session('Artem'));
  assert.equal(result.ok, true);
  assert.equal((await api.listPosts()).length, 0);
});

test('демо-данные наполняют пустую базу', async () => {
  const api = makeApi({ seed: true });
  const posts = await api.listPosts();
  assert.ok(posts.length >= 4);
  // лента отсортирована от новых к старым
  const dates = posts.map((post) => new Date(post.createdAt).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
});

test('данные сохраняются между экземплярами API (одно хранилище)', async () => {
  const storage = createMemoryStorage();
  const a = makeApi({ storage });
  await a.createPost({ title: 'Сохраняемый', body: 'текст', categoryId: 'general' }, session('Artem'));

  const b = makeApi({ storage });
  const posts = await b.listPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Сохраняемый');
});
