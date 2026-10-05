import { basarPath, escapeHtml, euro, formatDateDe, formatTime, getAvailability, getPublicBasars } from '../_lib/seo.js';

function jsonLdScript(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function startDateValue(b) {
  const t = formatTime(b.verkauf_von);
  return t ? `${b.veranstaltungsdatum}T${t}:00` : b.veranstaltungsdatum;
}
function endDateValue(b) {
  const t = formatTime(b.verkauf_bis);
  return t ? `${b.veranstaltungsdatum}T${t}:00` : b.veranstaltungsdatum;
}

function page404(origin) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Basar nicht gefunden | Basar Tischbörse</title><link rel="stylesheet" href="/styles.css?v=290"></head><body><main class="container main" style="padding:70px 20px"><section class="card"><h1>Basar nicht gefunden</h1><p>Dieser Basar ist nicht mehr öffentlich verfügbar oder der Link ist ungültig.</p><p><a class="primary" href="${origin}/#discover">Aktuelle Basare ansehen</a></p></section></main></body></html>`;
  return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'public, max-age=60' } });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const raw = decodeURIComponent(url.pathname.replace(/^\/basar\/?/, ''));
  const id = Number((raw.match(/^(\d+)/) || [])[1]);
  if (!Number.isInteger(id) || id <= 0) return page404(url.origin);

  let basars;
  try {
    basars = await getPublicBasars(request, env);
  } catch (error) {
    console.error('SEO Basarseite: get_public_basare fehlgeschlagen', error);
    return new Response('Basardaten konnten vorübergehend nicht geladen werden.', { status: 503, headers: { 'content-type': 'text/plain; charset=UTF-8', 'retry-after': '60' } });
  }

  const b = basars.find(row => Number(row.id) === id);
  if (!b) return page404(url.origin);

  const canonicalPath = basarPath(b);
  if (url.pathname !== canonicalPath) {
    return Response.redirect(`${url.origin}${canonicalPath}`, 301);
  }

  let availability = null;
  try { availability = await getAvailability(request, env, id); } catch (error) { console.warn('Verfügbarkeit konnte nicht geladen werden', error); }
  const free = availability && Number.isFinite(Number(availability.free_tables)) ? Number(availability.free_tables) : null;
  const soldOut = free !== null && free < 1;
  const prices = [b.preis_1_tisch, b.preis_2_tische, b.preis_3_tische].map(Number).filter(Number.isFinite);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const place = [b.plz, b.stadt].filter(Boolean).join(' ') || b.ort || '';
  const fullPlace = [b.ort, place].filter(Boolean).join(' · ');
  const canonical = `${url.origin}${canonicalPath}`;
  const bookingUrl = `${url.origin}/?basar=${Number(b.id)}#bookingZone`;
  const areaText = b.verkaufsbereiche === 'kinder' ? 'Kinderbasar' : b.verkaufsbereiche === 'erwachsene' ? 'Basar für Erwachsenenartikel' : 'Kinder- und Erwachsenenbasar';
  const description = `${areaText} ${place ? `in ${place}` : ''} am ${formatDateDe(b.veranstaltungsdatum)}. ${soldOut ? 'Derzeit ausgebucht.' : `Verkaufstisch ab ${euro(minPrice)} online reservieren.`}`.replace(/\s+/g, ' ').trim();
  const ogImage = `${url.origin}/og-basar-tischboerse-v285.png`;

  const address = {
    '@type': 'PostalAddress',
    ...(b.veranstaltungsadresse ? { streetAddress: String(b.veranstaltungsadresse) } : {}),
    ...(b.plz ? { postalCode: String(b.plz) } : {}),
    ...(b.stadt ? { addressLocality: String(b.stadt) } : {}),
    addressCountry: 'DE'
  };
  const eventLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: String(b.name || 'Basar'),
    description,
    startDate: startDateValue(b),
    endDate: endDateValue(b),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'Place', name: String(b.ort || b.name || 'Veranstaltungsort'), address },
    image: [ogImage],
    url: canonical,
    offers: {
      '@type': 'Offer',
      url: bookingUrl,
      price: Number(minPrice).toFixed(2),
      priceCurrency: 'EUR',
      availability: soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'
    }
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Basar Tischbörse', item: `${url.origin}/` },
      { '@type': 'ListItem', position: 2, name: 'Basare finden', item: `${url.origin}/#discover` },
      { '@type': 'ListItem', position: 3, name: String(b.name || 'Basar'), item: canonical }
    ]
  };

  const setup = [formatTime(b.aufbau_von), formatTime(b.aufbau_bis)].filter(Boolean).join(' bis ');
  const sale = [formatTime(b.verkauf_von), formatTime(b.verkauf_bis)].filter(Boolean).join(' bis ');
  const addressText = [b.veranstaltungsadresse, [b.plz, b.stadt].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const standBits = [];
  if (b.kleiderstaender_erlaubt === true) standBits.push('Kleiderständer erlaubt');
  if (b.kleiderstaender_erlaubt === false) standBits.push('Kleiderständer nicht erlaubt');
  if (b.zusaetzlicher_platz_erlaubt === true) standBits.push('Zusätzlicher Platz neben dem Tisch erlaubt');
  if (b.zusaetzlicher_platz_erlaubt === false) standBits.push('Zusätzlicher Platz neben dem Tisch nicht erlaubt');

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(b.name)}${place ? ` in ${escapeHtml(place)}` : ''} | Basar Tischbörse</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="googlebot" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:locale" content="de_DE"><meta property="og:site_name" content="Basar Tischbörse"><meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(b.name)}${place ? ` – ${escapeHtml(place)}` : ''}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(b.name)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="stylesheet" href="/styles.css?v=290"><link rel="icon" href="/favicon-v285.png" type="image/png"><meta name="theme-color" content="#fbf5ea">
${jsonLdScript(eventLd)}
${jsonLdScript(breadcrumbLd)}
<style>
  .seo-event-main{padding:42px 0 70px}.seo-breadcrumb{font-size:.92rem;margin:0 0 18px;color:#5b6170}.seo-breadcrumb a{color:inherit}.seo-event-hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:24px;align-items:stretch}.seo-event-card,.seo-book-card{background:#fff;border-radius:24px;padding:28px;box-shadow:0 14px 40px rgba(31,42,55,.08);border:1px solid rgba(31,42,55,.08)}.seo-event-card h1{font-size:clamp(2rem,5vw,3.6rem);line-height:1.03;margin:10px 0 16px}.seo-kicker{font-weight:800;letter-spacing:.08em;color:#bb684e;font-size:.8rem}.seo-lead{font-size:1.08rem;line-height:1.65;color:#4a5160}.seo-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:22px}.seo-fact{background:#fbf5ea;border-radius:16px;padding:14px}.seo-fact small{display:block;color:#6c7280;margin-bottom:4px}.seo-fact strong{display:block;font-size:1.02rem}.seo-book-card{background:#17253d;color:#fff;display:flex;flex-direction:column;justify-content:center}.seo-book-card .price{font-size:2.2rem;font-weight:900;margin:8px 0}.seo-book-card p{color:#e6e9ef}.seo-cta{display:inline-flex;justify-content:center;align-items:center;padding:14px 18px;border-radius:14px;background:#c66f54;color:#fff;text-decoration:none;font-weight:900;margin-top:10px}.seo-cta.secondary{background:#fff;color:#17253d}.seo-cta.disabled{background:#6f7786;pointer-events:none}.seo-details{margin-top:24px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.seo-detail{background:#fff;border:1px solid rgba(31,42,55,.08);border-radius:20px;padding:22px}.seo-detail h2{font-size:1.15rem;margin:0 0 8px}.seo-detail p{margin:0;line-height:1.6;color:#4a5160}.seo-wide{grid-column:1/-1}.seo-footer{padding:30px 0 50px;text-align:center;color:#646b78}.seo-footer a{color:inherit;margin:0 8px}@media(max-width:800px){.seo-event-hero,.seo-details{grid-template-columns:1fr}.seo-facts{grid-template-columns:1fr}.seo-wide{grid-column:auto}}
</style>
</head>
<body class="market-page" id="top">
<header class="site-header market-site-header"><div class="container header-inner market-header-inner"><a class="market-logo-link" href="/"><img class="market-logo-img" src="/logo-header-v263.png" alt="Basar Tischbörse – Tische einfach online buchen"></a><nav class="market-nav" aria-label="Hauptnavigation"><a href="/">Startseite</a><a href="/#discover">Basare finden</a><a href="/so-funktionierts.html">So funktioniert’s</a></nav><a class="header-link market-organizer-button" href="/admin.html">Für Veranstalter</a></div></header>
<main class="container seo-event-main">
<nav class="seo-breadcrumb" aria-label="Brotkrumen"><a href="/">Startseite</a> › <a href="/#discover">Basare</a> › ${escapeHtml(b.name)}</nav>
<section class="seo-event-hero">
  <article class="seo-event-card"><span class="seo-kicker">${escapeHtml(areaText.toUpperCase())}</span><h1>${escapeHtml(b.name)}</h1><p class="seo-lead">${escapeHtml(description)}</p><div class="seo-facts">
    <div class="seo-fact"><small>Datum</small><strong>${escapeHtml(formatDateDe(b.veranstaltungsdatum))}</strong></div>
    <div class="seo-fact"><small>Ort</small><strong>${escapeHtml(fullPlace || 'Wird bekanntgegeben')}</strong></div>
    ${sale ? `<div class="seo-fact"><small>Verkaufszeit</small><strong>${escapeHtml(sale)} Uhr</strong></div>` : ''}
    <div class="seo-fact"><small>Freie Tische</small><strong>${free === null ? 'Verfügbarkeit prüfen' : soldOut ? 'Ausgebucht' : escapeHtml(String(free))}</strong></div>
  </div></article>
  <aside class="seo-book-card"><span>Tischreservierung</span><div class="price">ab ${escapeHtml(euro(minPrice))}</div><p>${soldOut ? 'Aktuell sind keine freien Tische verfügbar. Die Veranstaltungsdetails bleiben weiterhin einsehbar.' : 'Reserviere deinen Verkaufstisch direkt online und erhalte deine Buchungsbestätigung per E-Mail.'}</p><a class="seo-cta ${soldOut ? 'disabled' : ''}" href="${escapeHtml(bookingUrl)}">${soldOut ? 'Derzeit ausgebucht' : 'Tisch jetzt buchen'}</a><a class="seo-cta secondary" href="/#discover">Weitere Basare finden</a></aside>
</section>
<section class="seo-details" aria-label="Veranstaltungsdetails">
  ${b.ort ? `<article class="seo-detail"><h2>🏛️ Veranstaltungsort</h2><p>${escapeHtml(b.ort)}</p></article>` : ''}
  ${addressText ? `<article class="seo-detail"><h2>📍 Adresse</h2><p>${escapeHtml(addressText)}</p></article>` : ''}
  ${setup ? `<article class="seo-detail"><h2>🧰 Aufbau</h2><p>${escapeHtml(setup)} Uhr</p></article>` : ''}
  ${sale ? `<article class="seo-detail"><h2>🕒 Verkaufszeit</h2><p>${escapeHtml(sale)} Uhr</p></article>` : ''}
  <article class="seo-detail"><h2>🧸 Verkaufsbereich</h2><p>${escapeHtml(areaText)}${b.kontingent_modus === 'getrennt' ? ' · getrennte Kontingente' : ''}</p></article>
  <article class="seo-detail"><h2>💶 Tischpreise</h2><p>1 Tisch: ${escapeHtml(euro(b.preis_1_tisch))}${Number(b.preis_2_tische) > 0 ? ` · 2 Tische: ${escapeHtml(euro(b.preis_2_tische))}` : ''}${Number(b.preis_3_tische) > 0 ? ` · 3 Tische: ${escapeHtml(euro(b.preis_3_tische))}` : ''}</p></article>
  ${b.erlaubte_waren ? `<article class="seo-detail seo-wide"><h2>🧺 Was darf verkauft werden?</h2><p>${escapeHtml(b.erlaubte_waren)}</p></article>` : ''}
  ${(standBits.length || b.standregeln) ? `<article class="seo-detail seo-wide"><h2>ℹ️ Standregeln</h2><p>${escapeHtml([...standBits, String(b.standregeln || '').trim()].filter(Boolean).join(' · '))}</p></article>` : ''}
  ${b.zusatzregeln ? `<article class="seo-detail seo-wide"><h2>📋 Weitere Hinweise</h2><p>${escapeHtml(b.zusatzregeln)}</p></article>` : ''}
</section>
</main>
<footer class="seo-footer"><div class="container">Basar Tischbörse · Finden. Buchen. Veranstalten.<br><a href="/impressum.html">Impressum</a><a href="/datenschutz.html">Datenschutz</a><a href="/nutzungsbedingungen.html">Nutzungsbedingungen</a><a href="/haftung.html">Hinweise &amp; Haftung</a></div></footer>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-robots-tag': 'index, follow'
    }
  });
}
