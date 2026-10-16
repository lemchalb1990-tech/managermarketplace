import { brandedShell, renderBlocks, sanitizeBlocks } from './email-blocks';

const brand = { color: '#ff0000', logoUrl: null, showLogo: true, footerText: null, contact: null };
const parts = { items: '<table id="items"></table>', total: '$10.000', delivery: '' };

describe('email-blocks', () => {
  it('reemplaza variables, aplica negrita y escapa el HTML del usuario', () => {
    const html = renderBlocks(
      [{ type: 'text', text: 'Hola **{{customerName}}** <script>x</script>' }],
      { customerName: 'Ana <b>' },
      parts,
      brand,
    );
    expect(html).toContain('<strong>Ana &lt;b&gt;</strong>');
    expect(html).not.toContain('<script>');
  });

  it('inserta los bloques del sistema y omite los vacíos', () => {
    const html = renderBlocks([{ type: 'items' }, { type: 'total' }, { type: 'delivery' }], {}, parts, brand);
    expect(html).toContain('id="items"');
    expect(html).toContain('$10.000');
    expect(html).toContain('#ff0000');
  });

  it('descarta botones e imágenes sin URL http/https', () => {
    const html = renderBlocks(
      [{ type: 'button', label: 'Ver', url: 'javascript:alert(1)' }, { type: 'image', url: 'data:image/png;base64,xx' }],
      {}, parts, brand,
    );
    expect(html.trim()).toBe('');
  });

  it('sanitizeBlocks ignora tipos desconocidos y normaliza el tono', () => {
    const out = sanitizeBlocks([{ type: 'html', text: '<b>' }, { type: 'note', text: 'x', tone: 'rojo' }, { type: 'divider' }]);
    expect(out).toEqual([{ type: 'note', text: 'x', tone: 'info' }, { type: 'divider' }]);
  });

  it('el marco usa el logo solo si se muestra y el pie personalizado', () => {
    const withLogo = brandedShell('c', 'Tienda', { ...brand, logoUrl: 'https://x.cl/logo.png', footerText: 'Gracias' });
    expect(withLogo).toContain('https://x.cl/logo.png');
    expect(withLogo).toContain('Gracias');
    const noLogo = brandedShell('c', 'Tienda', { ...brand, logoUrl: 'https://x.cl/logo.png', showLogo: false });
    expect(noLogo).not.toContain('logo.png');
  });
});
