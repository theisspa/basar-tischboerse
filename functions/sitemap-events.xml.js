import { basarPath, escapeXml, getPublicBasars } from './_lib/seo.js';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;
  try {
    const basars = await getPublicBasars(request, env);
    const urls = basars.map(b => `  <url>\n    <loc>${escapeXml(origin + basarPath(b))}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml; charset=UTF-8', 'cache-control': 'public, max-age=300, s-maxage=300' } });
  } catch (error) {
    console.error('Event-Sitemap konnte nicht erzeugt werden:', error);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', { status: 503, headers: { 'content-type': 'application/xml; charset=UTF-8', 'retry-after': '60' } });
  }
}
