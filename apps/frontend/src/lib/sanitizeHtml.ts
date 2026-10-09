// Deja solo formato básico de un HTML externo (p. ej. los mensajes del mediador de Mercado
// Libre, que llegan como <p><span>…</span></p>): párrafos, saltos, negritas, cursivas y
// listas. Quita estilos, scripts, eventos y cualquier otra etiqueta o atributo.
const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI']);

export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined' || !html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const out = document.createElement('div');

  const walk = (node: Node, parent: HTMLElement) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        parent.appendChild(document.createTextNode(child.textContent || ''));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(el.tagName)) return;
        if (ALLOWED.has(el.tagName)) {
          const copy = document.createElement(el.tagName.toLowerCase());
          parent.appendChild(copy);
          walk(el, copy);
        } else {
          // Etiqueta no permitida (span, div, a…): se conserva solo su contenido.
          walk(el, parent);
        }
      }
    });
  };
  walk(doc.body.firstChild as Node, out);
  return out.innerHTML;
}

/** true si el texto trae etiquetas HTML. */
export const looksLikeHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s);
