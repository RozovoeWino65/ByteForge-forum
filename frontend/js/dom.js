/**
 * Работа с DOM: маленькие безопасные хелперы.
 * Весь пользовательский текст выводится через textContent (никакого innerHTML),
 * поэтому HTML-инъекции через посты и никнеймы невозможны.
 */

/** Создаёт элемент: el('div', { class: 'card' }, 'текст', childNode) */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }

  append(node, children);
  return node;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Удаляет всех потомков элемента. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Относительное время: «только что», «5 мин», «3 ч», «12 сен». */
export function timeAgo(iso, now = Date.now()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const diff = Math.max(0, now - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн`;

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Автоматическая высота textarea под содержимое. */
export function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
}

/** Иконки интерфейса (инлайн SVG, чтобы не было внешних запросов). */
export function icon(name) {
  const paths = {
    logo: '<path d="M4 4h9a4 4 0 0 1 0 8H4V4Zm0 8h10a4 4 0 0 1 0 8H4v-8Z" fill="currentColor" stroke="none"/>',
    exit: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13h8l1-13" />',
    send: '<path d="M4 12 20 4l-7 16-2-6-7-2Z" />',
  };

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'width:1.05em;height:1.05em;flex:none';
  svg.innerHTML = paths[name] ?? '';
  return svg;
}
