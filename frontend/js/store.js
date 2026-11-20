/**
 * Состояние приложения и сессия пользователя.
 *
 * Хранит только данные UI-уровня. Всё, что связано с постами,
 * берётся из API (js/api.js).
 */

const SESSION_KEY = 'byteforge:session';

export function createStore({ storage = globalThis.localStorage, initialSession = null } = {}) {
  let session = initialSession ?? readSession(storage);
  const listeners = new Set();

  const state = {
    session,
    categories: [],
    posts: [],
    activeCategory: 'all',
    loading: false,
    error: null,
  };

  function readSession(store) {
    try {
      const raw = store?.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.user?.username ? parsed : null;
    } catch {
      return null;
    }
  }

  function emit() {
    for (const listener of [...listeners]) listener(state);
  }

  return {
    state,

    /** Подписка на изменения. Возвращает функцию отписки. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setSession(next) {
      state.session = next;
      try {
        if (next) storage?.setItem(SESSION_KEY, JSON.stringify(next));
        else storage?.removeItem(SESSION_KEY);
      } catch {
        /* приватный режим браузера — работаем без сохранения сессии */
      }
      emit();
    },

    logout() {
      this.setSession(null);
    },

    setCategories(categories) {
      state.categories = categories;
      emit();
    },

    setPosts(posts) {
      state.posts = posts;
      emit();
    },

    setActiveCategory(categoryId) {
      state.activeCategory = categoryId;
      emit();
    },

    setLoading(loading) {
      state.loading = Boolean(loading);
      emit();
    },

    setError(error) {
      state.error = error;
      emit();
    },
  };
}
