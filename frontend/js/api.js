/**
 * ByteForge — слой доступа к данным (API-клиент).
 *
 * Это единственное место, где фронтенд «разговаривает с сервером».
 * Поддерживаются два режима:
 *
 *   mode: 'mock' — данные хранятся в localStorage браузера (бэкенда ещё нет);
 *   mode: 'rest' — обычные HTTP-запросы к REST API бэкенда.
 *
 * Публичный интерфейс в обоих режимах одинаковый:
 *   login(), listCategories(), listPosts(), createPost(), deletePost()
 * Поэтому переключение на реальный бэкенд = одна строка в js/config.js.
 *
 * Модуль не зависит от DOM и от браузера: хранилище передаётся снаружи,
 * поэтому его можно тестировать в Node.js (см. tests/).
 */

const DB_KEY = 'byteforge:db';
const DB_VERSION = 1;

/** Ограничения полей — используются и в валидации, и в подсчёте символов в UI. */
export const LIMITS = {
  username: { min: 2, max: 24 },
  title: { min: 3, max: 140 },
  body: { min: 1, max: 3000 },
};

/** Категории форума по умолчанию. */
export const DEFAULT_CATEGORIES = [
  { id: 'general', title: 'Общее', description: 'Знакомства, правила, объявления' },
  { id: 'tech', title: 'Технологии', description: 'Код, инструменты, железо' },
  { id: 'study', title: 'Учёба', description: 'Проекты, дедлайны, сессия' },
  { id: 'games', title: 'Игры', description: 'Во что играем и на чём' },
  { id: 'offtop', title: 'Оффтоп', description: 'Всё, что не попало в другие разделы' },
];

/** Ошибка API. status — как у HTTP-ответа (0 = сервер недоступен). */
export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Валидация                                                           */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

export function validateUsername(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new ApiError('Введите никнейм', 422);
  if (name.length < LIMITS.username.min) {
    throw new ApiError(`Никнейм короче ${LIMITS.username.min} символов`, 422);
  }
  if (name.length > LIMITS.username.max) {
    throw new ApiError(`Никнейм длиннее ${LIMITS.username.max} символов`, 422);
  }
  if (!USERNAME_RE.test(name)) {
    throw new ApiError('В никнейме можно использовать буквы, цифры, «_» и «-»', 422);
  }
  return name;
}

export function validateTitle(value) {
  const title = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!title) throw new ApiError('Введите заголовок поста', 422);
  if (title.length < LIMITS.title.min) {
    throw new ApiError(`Заголовок короче ${LIMITS.title.min} символов`, 422);
  }
  if (title.length > LIMITS.title.max) {
    throw new ApiError(`Заголовок длиннее ${LIMITS.title.max} символов`, 422);
  }
  return title;
}

export function validateBody(value) {
  const body = String(value ?? '').trim();
  if (body.length < LIMITS.body.min) throw new ApiError('Напишите текст поста', 422);
  if (body.length > LIMITS.body.max) {
    throw new ApiError(`Текст поста длиннее ${LIMITS.body.max} символов`, 422);
  }
  return body;
}

function requireSession(session) {
  const username = session?.user?.username;
  if (!username) throw new ApiError('Нужно войти в аккаунт', 401);
  return username;
}

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0;
function createId(prefix = 'id') {
  idCounter += 1;
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}${idCounter}`;
}

/** Хранилище в памяти — для тестов и для окружений без localStorage. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

/** Демо-посты, чтобы лента не была пустой при первом запуске. */
const SEED_POSTS = [
  {
    categoryId: 'general',
    author: 'Богдан',
    hoursAgo: 1,
    title: 'Добро пожаловать на ByteForge',
    body: 'Это MVP форума: входим по никнейму, выбираем категорию и пишем посты. Пока данных немного — бэкенд в работе, поэтому всё хранится локально в браузере.',
  },
  {
    categoryId: 'tech',
    author: 'Богдан',
    hoursAgo: 6,
    title: 'Какую базу данных выбрать для форума',
    body: 'Смотрю в сторону PostgreSQL: нужны связи между пользователями, категориями и постами. У кого есть опыт с форумными нагрузками — подскажите, что взять?',
  },
  {
    categoryId: 'study',
    author: 'Артём',
    hoursAgo: 26,
    title: 'Разбили работу над проектом на спринты',
    body: 'Первый спринт — прототип и каркас интерфейса, второй — API и база, третий — тесты и полировка. Ставьте реакции, если формат удобный.',
  },
  {
    categoryId: 'offtop',
    author: 'Артём',
    hoursAgo: 50,
    title: 'Во что играете между дедлайнами',
    body: 'Нужен проект на пару вечеров, чтобы разгрузить голову. Лучше кооператив, но можно и одиночный.',
  },
];

/* ------------------------------------------------------------------ */
/* Мок-бэкенд на localStorage                                          */
/* ------------------------------------------------------------------ */

function createMockTransport({ storage, seed, delay }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function buildSeedDb() {
    const now = Date.now();
    const users = [];
    const posts = [];

    for (const item of SEED_POSTS) {
      let user = users.find((u) => u.username === item.author);
      if (!user) {
        user = { id: createId('user'), username: item.author, createdAt: new Date(now).toISOString() };
        users.push(user);
      }
      posts.push({
        id: createId('post'),
        title: item.title,
        body: item.body,
        categoryId: item.categoryId,
        authorId: user.id,
        author: user.username,
        createdAt: new Date(now - item.hoursAgo * 3600 * 1000).toISOString(),
      });
    }

    return {
      version: DB_VERSION,
      categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
      users,
      posts,
    };
  }

  function saveDb(db) {
    storage.setItem(DB_KEY, JSON.stringify(db));
  }

  function loadDb() {
    const raw = storage.getItem(DB_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === DB_VERSION) {
          parsed.users ??= [];
          parsed.posts ??= [];
          parsed.categories ??= DEFAULT_CATEGORIES.map((category) => ({ ...category }));
          return parsed;
        }
      } catch {
        /* повреждённые данные пересоздаём */
      }
    }
    const fresh = seed ? buildSeedDb() : {
      version: DB_VERSION,
      categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
      users: [],
      posts: [],
    };
    saveDb(fresh);
    return fresh;
  }

  return {
    async login(username) {
      await sleep(delay);
      const db = loadDb();
      const needle = username.toLowerCase();
      let user = db.users.find((u) => u.username.toLowerCase() === needle);

      if (!user) {
        user = { id: createId('user'), username, createdAt: new Date().toISOString() };
        db.users.push(user);
        saveDb(db);
      }

      return {
        user: { id: user.id, username: user.username },
        token: `mock.${user.id}`,
      };
    },

    async listCategories() {
      await sleep(delay);
      const db = loadDb();
      return db.categories.map((category) => ({
        ...category,
        postCount: db.posts.filter((post) => post.categoryId === category.id).length,
      }));
    },

    async listPosts({ categoryId = null } = {}) {
      await sleep(delay);
      const db = loadDb();
      const posts = categoryId ? db.posts.filter((post) => post.categoryId === categoryId) : db.posts;
      return posts
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((post) => ({ ...post }));
    },

    async createPost({ title, body, categoryId, author }) {
      await sleep(delay);
      const db = loadDb();
      const category = db.categories.find((c) => c.id === categoryId);
      if (!category) throw new ApiError('Такой категории не существует', 400);

      const post = {
        id: createId('post'),
        title,
        body,
        categoryId: category.id,
        categoryTitle: category.title,
        authorId: db.users.find((u) => u.username === author)?.id ?? null,
        author,
        createdAt: new Date().toISOString(),
      };

      db.posts.push(post);
      saveDb(db);
      return { ...post };
    },

    async deletePost(postId, session) {
      await sleep(delay);
      const db = loadDb();
      const index = db.posts.findIndex((post) => post.id === postId);
      if (index === -1) throw new ApiError('Пост не найден', 404);

      const post = db.posts[index];
      if (post.author.toLowerCase() !== session.user.username.toLowerCase()) {
        throw new ApiError('Можно удалять только свои посты', 403);
      }

      db.posts.splice(index, 1);
      saveDb(db);
      return { ok: true, id: postId };
    },
  };
}

/* ------------------------------------------------------------------ */
/* REST-транспорт (реальный бэкенд)                                     */
/* ------------------------------------------------------------------ */

function createRestTransport({ baseUrl }) {
  async function request(path, { method = 'GET', body, session } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;

    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Сервер недоступен. Проверьте подключение к сети.', 0);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(payload?.message ?? `Ошибка сервера (${response.status})`, response.status);
    }
    return payload;
  }

  return {
    login: (username) => request('/auth/login', { method: 'POST', body: { username } }),
    listCategories: () => request('/categories'),
    listPosts: ({ categoryId = null } = {}) =>
      request(categoryId ? `/posts?categoryId=${encodeURIComponent(categoryId)}` : '/posts'),
    createPost: ({ title, body, categoryId }, session) =>
      request('/posts', { method: 'POST', body: { title, body, categoryId }, session }),
    deletePost: (postId, session) =>
      request(`/posts/${encodeURIComponent(postId)}`, { method: 'DELETE', session }),
  };
}

/* ------------------------------------------------------------------ */
/* Публичная фабрика                                                   */
/* ------------------------------------------------------------------ */

/**
 * Создаёт клиент API.
 * @param {object} [options]
 * @param {'mock'|'rest'} [options.mode='mock'] режим работы
 * @param {string} [options.baseUrl=''] база REST API, например http://localhost:3000/api
 * @param {Storage} [options.storage] хранилище для мок-режима
 * @param {boolean} [options.seed=true] наполнять ли мок демо-постами
 * @param {number} [options.delay=180] искусственная задержка мок-ответа, мс
 */
export function createApi(options = {}) {
  const {
    mode = 'mock',
    baseUrl = '',
    storage = globalThis.localStorage,
    seed = true,
    delay = 180,
  } = options;

  if (mode === 'mock' && !storage) {
    throw new Error('Для режима mock нужно хранилище (localStorage)');
  }

  const transport =
    mode === 'rest'
      ? createRestTransport({ baseUrl })
      : createMockTransport({ storage, seed, delay });

  return {
    mode,

    async login(username) {
      return transport.login(validateUsername(username));
    },

    async listCategories() {
      return transport.listCategories();
    },

    async listPosts(params = {}) {
      return transport.listPosts({ categoryId: params.categoryId ?? null });
    },

    async createPost(input = {}, session) {
      const author = requireSession(session);
      return transport.createPost(
        {
          title: validateTitle(input.title),
          body: validateBody(input.body),
          categoryId: input.categoryId ?? null,
          author,
        },
        session,
      );
    },

    async deletePost(postId, session) {
      requireSession(session);
      if (!postId) throw new ApiError('Не указан пост', 400);
      return transport.deletePost(postId, session);
    },
  };
}
