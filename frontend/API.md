# Контракт API для бэкенда

Фронтенд обращается к серверу только из `js/api.js` (`createRestTransport`).
Ниже — ожидаемые эндпоинты. Пока их нет, работает мок-режим на `localStorage`.

Базовый URL задаётся в `js/config.js` → `API_BASE_URL` (например `http://localhost:3000/api`).

## Общие правила

- Формат: JSON, `Content-Type: application/json`.
- Авторизация: заголовок `Authorization: Bearer <token>` (токен приходит из `/auth/login`).
- Ошибка: любой не-2xx статус + тело `{ "message": "текст для пользователя" }`.
  Фронтенд показывает `message` как есть, поэтому текст лучше писать по-русски.
- Коды: `401` — не авторизован, `403` — нет прав, `404` — не найдено, `422` — ошибка валидации.

## Эндпоинты

### `POST /auth/login`

Вход по никнейму (без пароля). Если пользователя нет — создаётся.

```json
// запрос
{ "username": "Artem" }

// 200
{ "user": { "id": "u_1", "username": "Artem" }, "token": "jwt-or-session-token" }
```

Валидация: 2–24 символа, буквы/цифры/`_`/`-`, первый символ — буква или цифра.

### `GET /categories`

```json
// 200
[
  { "id": "tech", "title": "Технологии", "description": "Код, инструменты, железо", "postCount": 12 }
]
```

`postCount` необязателен (если не пришёл — счётчик будет `0`).

### `GET /posts?categoryId=tech`

`categoryId` необязателен. Сортировка: новые сверху.

```json
// 200
[
  {
    "id": "p_1",
    "title": "Какую БД выбрать для форума",
    "body": "Смотрю в сторону PostgreSQL…",
    "categoryId": "tech",
    "author": "Богдан",
    "authorId": "u_2",
    "createdAt": "2026-11-20T09:12:10.084Z"
  }
]
```

### `POST /posts`

Требует авторизации. Автор берётся из токена.

```json
// запрос
{ "title": "Заголовок", "body": "Текст поста", "categoryId": "tech" }

// 201 — созданный пост в формате выше
```

Ограничения: `title` 3–140 символов, `body` 1–3000 символов, `categoryId` должен существовать.

### `DELETE /posts/:id`

Требует авторизации. Удалять можно только свои посты (иначе `403`).

```json
// 200
{ "ok": true, "id": "p_1" }
```

## Соответствие коду

| Метод клиента (`createApi`) | HTTP |
| --- | --- |
| `api.login(username)` | `POST /auth/login` |
| `api.listCategories()` | `GET /categories` |
| `api.listPosts({ categoryId })` | `GET /posts` |
| `api.createPost({ title, body, categoryId }, session)` | `POST /posts` |
| `api.deletePost(id, session)` | `DELETE /posts/:id` |
