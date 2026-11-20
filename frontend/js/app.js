/**
 * Точка входа фронтенда ByteForge.
 *
 * Экраны:
 *   #/login   — вход по никнейму
 *   #/forum   — главная: лента постов + форма создания поста
 *   #/profile — профиль текущего пользователя
 *
 * Логика разделена так:
 *   api.js   — данные (моки/HTTP)
 *   store.js — состояние и сессия
 *   dom.js   — хелперы рендера
 *   app.js   — этот файл: связывает их и рисует интерфейс
 */

import { CONFIG } from './config.js';
import { createApi, LIMITS } from './api.js';
import { createStore } from './store.js';
import { el, clear, timeAgo, autoGrow, icon } from './dom.js';

const api = createApi({
  mode: CONFIG.API_MODE,
  baseUrl: CONFIG.API_BASE_URL,
  delay: CONFIG.MOCK_DELAY,
});

const store = createStore();

const dom = {
  authView: document.getElementById('auth-view'),
  forumView: document.getElementById('forum-view'),
  loginForm: document.getElementById('login-form'),
  loginInput: document.getElementById('login-username'),
  loginError: document.getElementById('login-error'),
  logoutBtn: document.getElementById('logout-btn'),
  userName: document.getElementById('user-name'),
  userAvatar: document.getElementById('user-avatar'),
  categoryList: document.getElementById('category-list'),
  feed: document.getElementById('feed'),
  feedTitle: document.getElementById('feed-title'),
  feedCount: document.getElementById('feed-count'),
  composer: document.getElementById('composer'),
  composerAvatar: document.getElementById('composer-avatar'),
  composerCategory: document.getElementById('composer-category'),
  composerTitle: document.getElementById('composer-title'),
  composerBody: document.getElementById('composer-body'),
  composerCounter: document.getElementById('composer-counter'),
  composerError: document.getElementById('composer-error'),
  composerSubmit: document.getElementById('composer-submit'),
  feedView: document.getElementById('feed-view'),
  profileView: document.getElementById('profile-view'),
  toast: document.getElementById('toast'),
};

let toastTimer = null;

/* ------------------------------------------------------------------ */
/* Вспомогательные функции UI                                          */
/* ------------------------------------------------------------------ */

function showError(node, message) {
  node.textContent = message ?? '';
  node.hidden = !message;
}

function toast(message, { error = false } = {}) {
  dom.toast.textContent = message;
  dom.toast.className = error ? 'toast toast--error' : 'toast';
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2600);
}

function initials(name) {
  return String(name ?? '?').trim().charAt(0) || '?';
}

function avatarNode(name, size = '') {
  return el('span', { class: `avatar ${size}`.trim(), 'aria-hidden': 'true' }, initials(name));
}

/* ------------------------------------------------------------------ */
/* Роутинг                                                             */
/* ------------------------------------------------------------------ */

function currentRoute() {
  return (location.hash.replace(/^#\/?/, '') || 'forum').split('?')[0];
}

function navigate(route) {
  const target = `#/${route}`;
  if (location.hash === target) render();
  else location.hash = target;
}

async function render() {
  const route = currentRoute();
  const session = store.state.session;

  // Неавторизованного всегда отправляем на вход.
  if (!session) {
    dom.authView.hidden = false;
    dom.forumView.hidden = true;
    if (route !== 'login') {
      history.replaceState(null, '', '#/login');
    }
    document.title = 'Вход — ByteForge';
    dom.loginInput.focus();
    return;
  }

  dom.authView.hidden = true;
  dom.forumView.hidden = false;
  document.title = 'ByteForge — форум';

  renderCurrentUser();

  if (route === 'profile') {
    dom.feedView.hidden = true;
    dom.profileView.hidden = false;
    renderProfile();
    return;
  }

  dom.feedView.hidden = false;
  dom.profileView.hidden = true;
  await renderFeed();
}

function renderCurrentUser() {
  const username = store.state.session?.user?.username ?? '';
  dom.userName.textContent = username;
  for (const node of [dom.userAvatar, dom.composerAvatar]) {
    if (node) node.textContent = initials(username);
  }
}

/* ------------------------------------------------------------------ */
/* Экран входа                                                         */
/* ------------------------------------------------------------------ */

dom.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(dom.loginError, null);

  const submit = dom.loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    const session = await api.login(dom.loginInput.value);
    store.setSession(session);
    dom.loginInput.value = '';
    toast(`Привет, ${session.user.username}`);
    navigate('forum');
  } catch (error) {
    showError(dom.loginError, error.message);
  } finally {
    submit.disabled = false;
  }
});

dom.logoutBtn.addEventListener('click', () => {
  store.logout();
  history.replaceState(null, '', '#/login');
  render();
  toast('Вы вышли из аккаунта');
});

/* ------------------------------------------------------------------ */
/* Категории                                                           */
/* ------------------------------------------------------------------ */

function renderCategories() {
  const { categories, activeCategory, posts } = store.state;
  clear(dom.categoryList);

  const total = categories.reduce((sum, category) => sum + (category.postCount ?? 0), 0);
  dom.categoryList.append(
    el(
      'button',
      {
        class: 'cat',
        type: 'button',
        'aria-current': String(activeCategory === 'all'),
        onclick: () => selectCategory('all'),
      },
      el('span', {}, 'Все посты'),
      el('span', { class: 'cat__count' }, String(total)),
    ),
  );

  for (const category of categories) {
    dom.categoryList.append(
      el(
        'button',
        {
          class: 'cat',
          type: 'button',
          'aria-current': String(activeCategory === category.id),
          title: category.description ?? '',
          onclick: () => selectCategory(category.id),
        },
        el('span', {}, category.title),
        el('span', { class: 'cat__count' }, String(category.postCount ?? 0)),
      ),
    );
  }

  // Селект в композере
  const previous = dom.composerCategory.value;
  clear(dom.composerCategory);
  for (const category of categories) {
    dom.composerCategory.append(
      el('option', { value: category.id }, `${category.title} — ${category.description ?? ''}`.trim()),
    );
  }
  const fallback = activeCategory !== 'all' ? activeCategory : previous;
  if (fallback && categories.some((c) => c.id === fallback)) {
    dom.composerCategory.value = fallback;
  }
}

function selectCategory(categoryId) {
  store.setActiveCategory(categoryId);
  renderCategories();
  renderPosts();
}

/* ------------------------------------------------------------------ */
/* Лента                                                               */
/* ------------------------------------------------------------------ */

async function renderFeed() {
  const { categories } = store.state;

  if (!categories.length) {
    try {
      const loaded = await api.listCategories();
      store.setCategories(loaded);
      renderCategories();
    } catch (error) {
      renderFeedError(error);
      return;
    }
  }

  try {
    store.setLoading(true);
    const posts = await api.listPosts();
    store.setPosts(posts);
    store.setError(null);
    renderPosts();
  } catch (error) {
    renderFeedError(error);
  } finally {
    store.setLoading(false);
  }
}

function renderFeedError(error) {
  store.setError(error);
  clear(dom.feed);
  dom.feed.append(
    el(
      'div',
      { class: 'card state' },
      el('p', { class: 'state__title' }, 'Не удалось загрузить посты'),
      el('p', {}, error?.message ?? 'Неизвестная ошибка'),
    ),
  );
}

function visiblePosts() {
  const { posts, activeCategory } = store.state;
  return activeCategory === 'all' ? posts : posts.filter((post) => post.categoryId === activeCategory);
}

function renderPosts() {
  const { categories, activeCategory, session } = store.state;
  const posts = visiblePosts();
  const category = categories.find((c) => c.id === activeCategory);
  const me = session?.user?.username?.toLowerCase();

  dom.feedTitle.textContent = category ? category.title : 'Все посты';
  dom.feedCount.textContent = String(posts.length);

  clear(dom.feed);

  if (!posts.length) {
    dom.feed.append(
      el(
        'div',
        { class: 'card state' },
        el('p', { class: 'state__title' }, 'Здесь пока пусто'),
        el('p', {}, category ? `В категории «${category.title}» ещё нет постов.` : 'Напишите первый пост выше.'),
      ),
    );
    return;
  }

  for (const post of posts) {
    const categoryTitle =
      categories.find((c) => c.id === post.categoryId)?.title ?? post.categoryTitle ?? '';
    const isMine = post.author?.toLowerCase() === me;

    const foot = el('div', { class: 'post__foot' });
    if (isMine) {
      const del = el(
        'button',
        { class: 'post__del', type: 'button', 'data-armed': 'false' },
        icon('trash'),
        ' Удалить',
      );
      let armed = false;
      del.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          del.dataset.armed = 'true';
          del.lastChild.textContent = ' Точно удалить?';
          setTimeout(() => {
            armed = false;
            del.dataset.armed = 'false';
            del.lastChild.textContent = ' Удалить';
          }, 3500);
          return;
        }
        del.disabled = true;
        try {
          await api.deletePost(post.id, store.state.session);
          store.setPosts(store.state.posts.filter((item) => item.id !== post.id));
          await refreshCounts();
          renderPosts();
          toast('Пост удалён');
        } catch (error) {
          del.disabled = false;
          toast(error.message, { error: true });
        }
      });
      foot.append(del);
    }

    dom.feed.append(
      el(
        'article',
        { class: 'card post' },
        el(
          'div',
          { class: 'post__head' },
          avatarNode(post.author, 'avatar--sm'),
          el('span', { class: 'post__author' }, post.author),
          el('span', { 'aria-hidden': 'true' }, '·'),
          el('time', { datetime: post.createdAt }, timeAgo(post.createdAt)),
          categoryTitle ? el('span', { class: 'badge' }, categoryTitle) : null,
        ),
        el('h3', { class: 'post__title' }, post.title),
        el('p', { class: 'post__body' }, post.body),
        isMine ? foot : null,
      ),
    );
  }
}

async function refreshCounts() {
  try {
    store.setCategories(await api.listCategories());
    renderCategories();
  } catch {
    /* счётчики не критичны */
  }
}

/* ------------------------------------------------------------------ */
/* Создание поста                                                      */
/* ------------------------------------------------------------------ */

dom.composerBody.addEventListener('input', () => {
  autoGrow(dom.composerBody);
  const length = dom.composerBody.value.length;
  dom.composerCounter.textContent = `${length} / ${LIMITS.body.max}`;
  dom.composerCounter.classList.toggle('counter--limit', length > LIMITS.body.max);
});

dom.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(dom.composerError, null);

  const payload = {
    title: dom.composerTitle.value,
    body: dom.composerBody.value,
    categoryId: dom.composerCategory.value,
  };

  dom.composerSubmit.disabled = true;
  dom.composerSubmit.textContent = 'Публикуем…';

  try {
    const post = await api.createPost(payload, store.state.session);
    store.setPosts([post, ...store.state.posts]);
    dom.composerTitle.value = '';
    dom.composerBody.value = '';
    dom.composerBody.dispatchEvent(new Event('input'));
    autoGrow(dom.composerBody);
    await refreshCounts();
    renderPosts();
    toast('Пост опубликован');
    dom.composerTitle.focus();
  } catch (error) {
    showError(dom.composerError, error.message);
  } finally {
    dom.composerSubmit.disabled = false;
    dom.composerSubmit.textContent = 'Опубликовать';
  }
});

/* ------------------------------------------------------------------ */
/* Профиль                                                             */
/* ------------------------------------------------------------------ */

function renderProfile() {
  const { session, posts } = store.state;
  const username = session?.user?.username ?? '';
  const mine = posts.filter((post) => post.author?.toLowerCase() === username.toLowerCase());

  clear(dom.profileView);
  dom.profileView.append(
    el(
      'section',
      { class: 'card profile' },
      el(
        'div',
        { class: 'profile__head' },
        avatarNode(username, 'avatar--lg'),
        el(
          'div',
          {},
          el('p', { class: 'profile__name' }, username),
          el('p', { class: 'profile__meta' }, `Постов: ${mine.length}`),
          el('p', { class: 'profile__meta' }, `Никнейм: вход по имени, без пароля`),
        ),
      ),
    ),
    el('h2', { class: 'feed-head__title', style: 'margin:0 0 10px' }, 'Мои посты'),
  );

  if (!mine.length) {
    dom.profileView.append(
      el(
        'div',
        { class: 'card state' },
        el('p', { class: 'state__title' }, 'Постов пока нет'),
        el('p', {}, 'Вернитесь на главную и напишите первый.'),
      ),
    );
    return;
  }

  const list = el('div', { class: 'feed' });
  for (const post of mine) {
    list.append(
      el(
        'article',
        { class: 'card post' },
        el(
          'div',
          { class: 'post__head' },
          el('time', { datetime: post.createdAt }, timeAgo(post.createdAt)),
          post.categoryTitle ? el('span', { class: 'badge' }, post.categoryTitle) : null,
        ),
        el('h3', { class: 'post__title' }, post.title),
        el('p', { class: 'post__body' }, post.body),
      ),
    );
  }
  dom.profileView.append(list);
}

/* ------------------------------------------------------------------ */
/* Старт                                                               */
/* ------------------------------------------------------------------ */

window.addEventListener('hashchange', render);

store.subscribe(({ session }) => {
  document.body.dataset.auth = session ? 'in' : 'out';
});

render();
