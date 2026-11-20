/**
 * Настройки фронтенда.
 *
 * По умолчанию используется локальный Java API; для автономной демонстрации выберите 'mock'.
 */

export const CONFIG = {
  /** 'mock' — данные в localStorage, 'rest' — реальный HTTP API. */
  API_MODE: 'rest',

  /** База REST API (используется только в режиме 'rest'). */
  API_BASE_URL: 'http://localhost:3000/api',

  /** Искусственная задержка мок-ответов, мс: чтобы работали лоадеры. */
  MOCK_DELAY: 180,
};
