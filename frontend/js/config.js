/**
 * Настройки фронтенда.
 *
 * Когда бэкенд Богдана будет готов — поменяйте API_MODE на 'rest'
 * и укажите адрес сервера в API_BASE_URL. Больше менять ничего не нужно.
 */

export const CONFIG = {
  /** 'mock' — данные в localStorage, 'rest' — реальный HTTP API. */
  API_MODE: 'mock',

  /** База REST API (используется только в режиме 'rest'). */
  API_BASE_URL: 'http://localhost:3000/api',

  /** Искусственная задержка мок-ответов, мс: чтобы работали лоадеры. */
  MOCK_DELAY: 180,
};
