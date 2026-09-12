(() => {
  'use strict';

  const config = window.BASAR_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    console.error('Basar-Konfiguration oder Supabase-Bibliothek fehlt.');
    return;
  }

  const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const euro = value => Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const $ = id => document.getElementById(id);

  let basare = [];
  let currentBasar = null;
  let currentFreeTables = 0;
  let lastContract = null;
  let lastEmailPayload = null;
  let paypalSdkPromise = null;
  let paymentConfigured = false;
  const discoveryAvailability = new Map();
  let discoveryQuery = '';
  let discoveryMode = 'all';
  let discoveryOrigin = null;
  let discoveryRadiusKm = 25;
  let discoveryFreeOnly = true;
  const discoveryDistances = new Map();

  function selectedValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  }

  function formatDate(dateString) {
    if (!dateString) return '';
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
      .format(new Date(`${dateString}T12:00:00`));
  }

  function daysUntil(dateString) {
    if (!dateString) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const event = new Date(`${dateString}T00:00:00`);
    return Math.round((event - today) / 86400000);
  }

  function paymentRuleText() {
    const days = daysUntil(currentBasar?.veranstaltungsdatum);
    const normal = Number(currentBasar?.zahlungsfrist_tage ?? 14);
    const threshold = Number(currentBasar?.kurzfristig_ab_tage ?? 14);
    const shortDays = Number(currentBasar?.kurzfristige_zahlungsfrist_tage ?? 3);
    if (days === null) return 'Die Zahlungsfrist wird anhand des Veranstaltungstermins berechnet.';
    if (days >= threshold) return `Die Reservierung ist ${normal} Tage garantiert. Der Teilnahmebetrag ist innerhalb von ${normal} Tagen nach Buchung zu bezahlen, spätestens jedoch am Veranstaltungstag.`;
    return `Da der Basartermin weniger als ${threshold} Tage entfernt ist, ist der Teilnahmebetrag innerhalb von ${shortDays} Tagen zu zahlen, spätestens jedoch am Veranstaltungstag. Danach besteht keine Garantie mehr auf den Tisch.`;
  }

  function updateBookingRules() {
    const storno = Number(currentBasar?.stornofrist_tage ?? 14);
    const transfer = currentBasar?.uebertragung_erlaubt !== false;
    const fee = Number(currentBasar?.kuchennachgebuehr ?? 10);
    $('paymentRule').textContent = paymentRuleText();
    $('cancellationRule').textContent = `Kostenlose Stornierung bis ${storno} Tage vor Veranstaltungsbeginn; danach keine Rückzahlung.${transfer ? ' Eine Übertragung auf eine andere Person ist nach Information an den Veranstalter möglich.' : ' Eine Übertragung auf eine andere Person ist nicht vorgesehen.'}`;
    $('cakePenaltyRule').textContent = `Bei zugesagter, aber nicht erbrachter Kuchenspende wird nachträglich eine Gebühr von ${euro(fee)} fällig.`;
    const extra = String(currentBasar?.zusatzregeln || '').trim();
    $('additionalRule').textContent = extra;
    $('additionalRule').classList.toggle('hidden', !extra);
  }

  function updatePrice() {
    const tables = Number(selectedValue('tables') || 1);
    const cake = $('cake').checked;
    const priceMap = {
      1: Number(currentBasar?.preis_1_tisch ?? 12),
      2: Number(currentBasar?.preis_2_tische ?? 20),
      3: Number(currentBasar?.preis_3_tische ?? 25)
    };
    const base = priceMap[tables] ?? 0;
    const discount = cake ? Number(currentBasar?.kuchenrabatt ?? 4) : 0;
    $('basePrice').textContent = euro(base);
    $('discount').textContent = discount ? `-${euro(discount)}` : euro(0);
    $('totalPrice').textContent = euro(Math.max(0, base - discount));
  }

  function setBookingEnabled(enabled) {
    $('bookingForm').querySelectorAll('input, select, button').forEach(el => { el.disabled = !enabled; });
    $('submitButton').disabled = !enabled;
    $('submitButton').textContent = enabled ? 'Verbindlich buchen' : 'Derzeit nicht verfügbar';
  }

  function updateAvailability(free) {
    const safeFree = Number.isFinite(Number(free)) ? Math.max(0, Number(free)) : 0;
    currentFreeTables = safeFree;
    $('availableTables').textContent = safeFree;

    document.querySelectorAll('input[name="tables"]').forEach(input => {
      const disabled = Number(input.value) > safeFree;
      input.disabled = disabled;
      input.closest('.choice')?.classList.toggle('disabled', disabled);
    });

    const selected = document.querySelector('input[name="tables"]:checked');
    if (selected?.disabled) {
      const firstAvailable = [...document.querySelectorAll('input[name="tables"]')].find(input => !input.disabled);
      if (firstAvailable) firstAvailable.checked = true;
      updatePrice();
    }

    $('submitButton').disabled = safeFree < 1 || !paymentConfigured;
    $('submitButton').textContent = safeFree < 1 ? 'Ausgebucht' : (!paymentConfigured ? 'Keine Zahlungsart verfügbar' : 'Verbindlich buchen');
  }

  function showError(message) {
    const box = $('formError');
    box.textContent = message;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearError() {
    $('formError').classList.add('hidden');
    $('formError').textContent = '';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function basarLocationText(basar) {
    const parts = [basar.plz, basar.stadt].filter(Boolean);
    if (parts.length) return parts.join(' ');
    return basar.ort || 'Ort wird noch ergänzt';
  }

  function basarSearchHaystack(basar) {
    return [basar.name, basar.ort, basar.plz, basar.stadt]
      .filter(Boolean).join(' ').toLocaleLowerCase('de-DE');
  }

  function hasCoordinates(basar) {
    const latRaw = basar?.latitude;
    const lonRaw = basar?.longitude;
    if (latRaw === null || latRaw === undefined || latRaw === '' || lonRaw === null || lonRaw === undefined || lonRaw === '') return false;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = value => Number(value) * Math.PI / 180;
    const earthKm = 6371;
    const dLat = toRad(lat2) - toRad(lat1);
    const dLon = toRad(lon2) - toRad(lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function setLocationStatus(message = '', state = '') {
    const el = $('locationSearchStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('hidden', !message);
    el.dataset.state = state;
  }

  async function geocodeSearchTerm(query) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('countrycodes', 'de');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('q', query);
    const response = await fetch(url, { headers: { 'Accept-Language': 'de' } });
    if (!response.ok) throw new Error('Standortsuche vorübergehend nicht erreichbar.');
    const results = await response.json();
    if (!Array.isArray(results) || !results.length) return null;
    const hit = results[0];
    const lat = Number(hit.lat), lon = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, label: hit.display_name || query };
  }

  function updateDistanceMap() {
    discoveryDistances.clear();
    if (!discoveryOrigin) return;
    basare.forEach(b => {
      if (!hasCoordinates(b)) return;
      discoveryDistances.set(Number(b.id), distanceKm(discoveryOrigin.lat, discoveryOrigin.lon, Number(b.latitude), Number(b.longitude)));
    });
  }

  function renderDiscoveryCards() {
    const grid = $('basarCards');
    if (!grid) return;
    const query = discoveryQuery.trim().toLocaleLowerCase('de-DE');
    let matches = basare.slice();

    if (discoveryMode === 'distance' && discoveryOrigin) {
      updateDistanceMap();
      matches = matches
        .filter(b => discoveryDistances.has(Number(b.id)) && discoveryDistances.get(Number(b.id)) <= discoveryRadiusKm)
        .sort((a, b) => (discoveryDistances.get(Number(a.id)) ?? Infinity) - (discoveryDistances.get(Number(b.id)) ?? Infinity));
    } else if (query) {
      matches = matches.filter(b => basarSearchHaystack(b).includes(query));
    }

    if (discoveryFreeOnly) {
      matches = matches.filter(b => {
        const free = discoveryAvailability.get(Number(b.id));
        return !Number.isFinite(free) || free > 0;
      });
    }

    $('noBasarResults')?.classList.toggle('hidden', matches.length > 0);
    $('clearBasarSearch')?.classList.toggle('hidden', discoveryMode === 'all' && !query && !discoveryOrigin);
    if ($('discoverySubtitle')) {
      if (discoveryMode === 'distance' && discoveryOrigin) {
        $('discoverySubtitle').textContent = `${matches.length} Basar${matches.length === 1 ? '' : 'e'} im Umkreis von ${discoveryRadiusKm} km gefunden.`;
      } else if (query) {
        $('discoverySubtitle').textContent = `${matches.length} passende${matches.length === 1 ? 'r' : ''} Basar${matches.length === 1 ? '' : 'e'} gefunden.`;
      } else {
        $('discoverySubtitle').textContent = 'Finde einen passenden Basar und reserviere deinen Tisch.';
      }
    }

    grid.innerHTML = matches.map((b, index) => {
      const free = discoveryAvailability.get(Number(b.id));
      const minPrice = Math.min(Number(b.preis_1_tisch ?? 0), Number(b.preis_2_tische ?? 0), Number(b.preis_3_tische ?? 0));
      const soldOut = Number.isFinite(free) && free < 1;
      const selected = currentBasar && Number(currentBasar.id) === Number(b.id);
      const distance = discoveryDistances.get(Number(b.id));
      const distanceBadge = discoveryMode === 'distance' && Number.isFinite(distance)
        ? `<span class="distance-badge">📍 ${distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km entfernt</span>` : '';
      return `<article class="market-basar-card ${selected ? 'selected' : ''}" style="--card-delay:${Math.min(index,6)*45}ms">
        <div class="basar-card-art" aria-hidden="true"><span>${index % 3 === 0 ? '🧸' : index % 3 === 1 ? '👗' : '🧺'}</span><span>${index % 2 === 0 ? '🍰' : '🏷️'}</span></div>
        <div class="basar-card-body">
          <div class="basar-card-date"><span>${formatDate(b.veranstaltungsdatum)}</span>${soldOut ? '<b class="soldout">Ausgebucht</b>' : '<b>Buchbar</b>'}</div>
          ${distanceBadge}
          <h3>${escapeHtml(b.name)}</h3>
          <p class="basar-card-location">📍 ${escapeHtml(basarLocationText(b))}${b.ort && (b.stadt || b.plz) ? ` · ${escapeHtml(b.ort)}` : ''}</p>
          <div class="basar-card-facts"><span><small>ab</small><strong>${euro(minPrice)}</strong></span><span><small>freie Tische</small><strong>${Number.isFinite(free) ? free : '…'}</strong></span></div>
          <button class="market-card-button" type="button" data-discover-basar="${b.id}" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Derzeit ausgebucht' : selected ? 'Ausgewählt · zur Buchung' : 'Details & Tisch buchen'}</button>
        </div>
      </article>`;
    }).join('');
  }

  async function loadDiscoveryAvailability() {
    await Promise.all(basare.map(async b => {
      try {
        const { data, error } = await supabaseClient.rpc('get_basar_availability', { p_basar_id: b.id });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (row) discoveryAvailability.set(Number(b.id), Number(row.free_tables));
      } catch (error) {
        console.warn('Verfügbarkeit für Basar konnte nicht geladen werden:', b.id, error);
      }
    }));
    renderDiscoveryCards();
  }

  async function selectDiscoveredBasar(id, scroll = true) {
    const next = basare.find(b => Number(b.id) === Number(id));
    if (!next) return;
    currentBasar = next;
    const select = $('basarSelect');
    if (select) select.value = String(next.id);
    const url = new URL(window.location.href);
    url.searchParams.set('basar', String(next.id));
    history.replaceState(null, '', url);
    renderDiscoveryCards();
    await showCurrentBasar();
    if (scroll) $('bookingZone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function applyDiscoverySearch() {
    discoveryQuery = $('basarSearch')?.value || '';
    const query = discoveryQuery.trim();
    discoveryRadiusKm = Number($('radiusSelect')?.value || 25);
    discoveryFreeOnly = $('freeOnly')?.checked !== false;
    if (!query) {
      discoveryMode = 'all'; discoveryOrigin = null; discoveryDistances.clear(); setLocationStatus(''); renderDiscoveryCards();
      $('discover')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }

    const normalized = query.toLocaleLowerCase('de-DE');
    const nameMatches = basare.filter(b => String(b.name || '').toLocaleLowerCase('de-DE').includes(normalized));
    const locationMatches = basare.filter(b => [b.plz, b.stadt, b.ort].filter(Boolean).join(' ').toLocaleLowerCase('de-DE').includes(normalized));
    if (nameMatches.length && !locationMatches.length) {
      discoveryOrigin = null; discoveryMode = 'text'; setLocationStatus('Basarname gefunden.', 'success'); renderDiscoveryCards();
      $('discover')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }

    const button = $('searchBasarButton');
    if (button) { button.disabled = true; button.textContent = 'Suche …'; }
    setLocationStatus('Standort wird gesucht …', 'loading');
    try {
      const found = await geocodeSearchTerm(query);
      if (found) {
        discoveryOrigin = { lat: found.lat, lon: found.lon };
        discoveryMode = 'distance';
        setLocationStatus(`Basare rund um ${query} – ${discoveryRadiusKm} km Umkreis.`, 'success');
      } else {
        discoveryOrigin = null; discoveryMode = 'text';
        setLocationStatus('Ort nicht eindeutig gefunden. Es wird nach Basarname, Ort oder PLZ gefiltert.', 'notice');
      }
      renderDiscoveryCards();
      $('discover')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.warn('Geocoding fehlgeschlagen:', error);
      discoveryOrigin = null; discoveryMode = 'text';
      setLocationStatus('Die Umkreissuche ist gerade nicht erreichbar. Die normale Textsuche bleibt verfügbar.', 'notice');
      renderDiscoveryCards();
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Basare finden'; }
    }
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('Dein Browser unterstützt die Standortfreigabe nicht.', 'notice'); return;
    }
    const button = $('useLocationButton');
    if (button) { button.disabled = true; button.textContent = 'Standort wird ermittelt …'; }
    setLocationStatus('Standort wird ermittelt …', 'loading');
    navigator.geolocation.getCurrentPosition(position => {
      discoveryOrigin = { lat: position.coords.latitude, lon: position.coords.longitude };
      discoveryMode = 'distance'; discoveryQuery = ''; discoveryRadiusKm = Number($('radiusSelect')?.value || 25);
      discoveryFreeOnly = $('freeOnly')?.checked !== false;
      if ($('basarSearch')) $('basarSearch').value = '';
      setLocationStatus(`Basare in ${discoveryRadiusKm} km rund um deinen Standort.`, 'success');
      renderDiscoveryCards();
      $('discover')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (button) { button.disabled = false; button.textContent = '📍 Meinen Standort verwenden'; }
    }, error => {
      console.warn('Standortfreigabe fehlgeschlagen:', error);
      setLocationStatus('Standort konnte nicht verwendet werden. Bitte Ort oder PLZ eingeben.', 'notice');
      if (button) { button.disabled = false; button.textContent = '📍 Meinen Standort verwenden'; }
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function renderBasarSelector() {
    const wrap = $('basarSelectWrap');
    const select = $('basarSelect');
    select.innerHTML = basare.map(b => `<option value="${b.id}">${escapeHtml(b.name)}${b.ort ? ` – ${escapeHtml(b.ort)}` : ''}</option>`).join('');
    wrap.classList.toggle('hidden', basare.length <= 1);
    if (currentBasar) select.value = String(currentBasar.id);
  }

  async function loadBasare() {
    const { data, error } = await supabaseClient.rpc('get_public_basare');
    if (error) throw error;
    basare = data || [];
    if (!basare.length) throw new Error('Noch kein aktiver Basar angelegt.');

    const params = new URLSearchParams(window.location.search);
    const requestedId = Number(params.get('basar'));
    currentBasar = basare.find(b => b.id === requestedId) || basare[0];
    renderBasarSelector();
    renderDiscoveryCards();
    await showCurrentBasar();
    loadDiscoveryAvailability();
  }

  function updatePaymentOptions() {
    const select = $('payment');
    const options = [];
    if (currentBasar?.zahlung_paypal_api_aktiv) options.push(['paypal', 'PayPal (direkt online)']);
    if (currentBasar?.zahlung_paypal_link_aktiv && currentBasar?.zahlung_paypal_link) options.push(['paypal_link', 'PayPal']);
    if (currentBasar?.zahlung_ueberweisung_aktiv && currentBasar?.zahlung_iban_vorhanden) options.push(['ueberweisung', 'Überweisung']);
    select.innerHTML = options.length ? options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('') : '<option value="">Keine Zahlungsart verfügbar</option>';
    select.disabled = !options.length;
    paymentConfigured = options.length > 0;
    $('formError').classList.add('hidden');
    if (!paymentConfigured) showError('Dieser Veranstalter hat für den Basar noch keine Zahlungsart eingerichtet. Eine Buchung ist derzeit nicht möglich.');
  }

  async function showCurrentBasar() {
    if (!currentBasar) return;
    clearError();
    $('basarName').textContent = currentBasar.name;
    const publicLocation = [currentBasar.plz, currentBasar.stadt].filter(Boolean).join(' ');
    $('basarDetails').textContent = [formatDate(currentBasar.veranstaltungsdatum), publicLocation, currentBasar.ort].filter(Boolean).join(' · ');
    updateBookingRules();
    updatePaymentOptions();
    $('price1Label').textContent = euro(currentBasar.preis_1_tisch ?? 12);
    $('price2Label').textContent = euro(currentBasar.preis_2_tische ?? 20);
    $('price3Label').textContent = euro(currentBasar.preis_3_tische ?? 25);
    $('cakeDiscountText').textContent = euro(currentBasar.kuchenrabatt ?? 4);
    updatePrice();
    $('availableTables').textContent = '…';
    await loadAvailability();
  }

  async function loadAvailability() {
    if (!currentBasar) return;
    const { data, error } = await supabaseClient.rpc('get_basar_availability', { p_basar_id: currentBasar.id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Verfügbarkeit konnte nicht geladen werden.');
    updateAvailability(Number(row.free_tables));
  }

  function setLoading(loading) {
    $('submitButton').disabled = loading || !paymentConfigured || currentFreeTables < 1;
    $('submitButton').textContent = loading ? 'Buchung wird gespeichert …' : (currentFreeTables < 1 ? 'Ausgebucht' : (!paymentConfigured ? 'Keine Zahlungsart verfügbar' : 'Verbindlich buchen'));
  }

  function paymentInfoText(booking, paymentMethod) {
    if (paymentMethod === 'paypal') {
      return `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. Bitte bezahle über den PayPal-Button auf dieser Seite. Die Buchungsnummer ${booking.buchungsnummer} wird automatisch zugeordnet.`;
    }
    if (paymentMethod === 'paypal_link') {
      return `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. Bitte bezahle über den PayPal-Link des Veranstalters. Verwendungszweck: ${booking.buchungsnummer}.`;
    }
    if (booking.veranstalter_iban) {
      const owner = booking.veranstalter_kontoinhaber || booking.veranstalter_name;
      return `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. Überweisung an ${owner}, IBAN ${booking.veranstalter_iban}. Verwendungszweck: ${booking.buchungsnummer}.`;
    }
    return `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. Die Zahlungsdaten werden vom Veranstalter separat mitgeteilt.`;
  }

  function setPayPalStatus(message, type = '') {
    const el = $('paypalStatus');
    el.textContent = message || '';
    el.className = `small paypal-status${type ? ` ${type}` : ''}`;
  }

  function loadPayPalSdk() {
    if (window.paypal?.createInstance) return Promise.resolve(window.paypal);
    if (paypalSdkPromise) return paypalSdkPromise;
    if (!config.paypalClientId) return Promise.reject(new Error('PayPal Client-ID fehlt in der Konfiguration.'));

    paypalSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const isSandbox = (config.paypalEnvironment || 'sandbox') !== 'live';
      script.src = isSandbox
        ? 'https://www.sandbox.paypal.com/web-sdk/v6/core'
        : 'https://www.paypal.com/web-sdk/v6/core';
      script.async = true;
      script.onload = () => window.paypal?.createInstance
        ? resolve(window.paypal)
        : reject(new Error('PayPal Web SDK v6 wurde geladen, ist aber nicht verfügbar.'));
      script.onerror = () => reject(new Error('PayPal Web SDK v6 konnte nicht geladen werden.'));
      document.head.appendChild(script);
    });
    return paypalSdkPromise;
  }

  async function renderPayPalButtons(booking) {
    const section = $('paypalSection');
    const container = $('paypalButtonContainer');
    section.classList.remove('hidden');
    container.innerHTML = '';
    setPayPalStatus('PayPal wird geladen …');

    if (!booking?.buchung_id || !booking?.email_token) {
      setPayPalStatus('PayPal kann für diese Buchung nicht gestartet werden.', 'error');
      return;
    }

    try {
      await loadPayPalSdk();

      const { data: tokenResult, error: tokenError } = await supabaseClient.functions.invoke('paypal-client-token', {
        body: { origin: window.location.origin, booking_id: booking.buchung_id, email_token: booking.email_token }
      });
      if (tokenError) throw tokenError;
      if (tokenResult?.error) throw new Error(tokenResult.error);
      if (!tokenResult?.client_token) throw new Error('PayPal Client-Token konnte nicht erstellt werden.');

      const sdk = await window.paypal.createInstance({
        clientToken: tokenResult.client_token,
        components: ['paypal-payments'],
        pageType: 'checkout'
      });

      const methods = await sdk.findEligibleMethods({
        currencyCode: config.paypalCurrency || 'EUR'
      });

      if (!methods?.isEligible?.('paypal')) {
        setPayPalStatus('PayPal ist für diese Testumgebung derzeit nicht verfügbar.', 'error');
        return;
      }

      const session = sdk.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          setPayPalStatus('Zahlung wird bestätigt …');
          try {
            const { data: result, error } = await supabaseClient.functions.invoke('paypal-capture-order', {
              body: {
                booking_id: booking.buchung_id,
                email_token: booking.email_token,
                order_id: orderId
              }
            });
            if (error) throw error;
            if (result?.error) throw new Error(result.error);
            if (result?.status !== 'COMPLETED') throw new Error('PayPal hat die Zahlung nicht als abgeschlossen bestätigt.');

            booking.zahlungsstatus = 'bezahlt';
            booking.paypal_status = 'COMPLETED';
            booking.paypal_capture_id = result.capture_id || null;
            $('paymentInfo').textContent = `PayPal-Zahlung erfolgreich abgeschlossen. Buchungsnummer: ${booking.buchungsnummer}.`;
            setPayPalStatus('✓ Zahlung erfolgreich. Dein Zahlungsstatus wurde automatisch auf „bezahlt“ gesetzt.', 'success');
            container.innerHTML = '';
          } catch (error) {
            console.error('PayPal-Capture fehlgeschlagen:', error);
            setPayPalStatus(`Die Zahlung konnte nicht bestätigt werden: ${error?.message || error}`, 'error');
          }
        },
        onCancel: () => {
          setPayPalStatus('Die PayPal-Zahlung wurde abgebrochen. Deine Tischreservierung bleibt bestehen.', 'warning');
        },
        onError: error => {
          console.error('PayPal-Fehler:', error);
          setPayPalStatus(`PayPal konnte nicht gestartet werden: ${error?.message || error}`, 'error');
        }
      });

      const button = document.createElement('paypal-button');
      button.setAttribute('type', 'pay');
      button.style.display = 'block';
      button.style.width = '100%';
      container.appendChild(button);
      setPayPalStatus('');

      button.addEventListener('click', async () => {
        try {
          setPayPalStatus('PayPal-Zahlung wird vorbereitet …');

          // PayPal Web SDK v6 erwartet als zweiten Parameter von start()
          // zwingend ein Promise, das zu { orderId } aufloest.
          // Die Order wird deshalb direkt als Promise erzeugt und an PayPal
          // weitergereicht, statt erst auf die Order zu warten und ein Objekt
          // zu uebergeben.
          const orderPromise = supabaseClient.functions.invoke('paypal-create-order', {
            body: { booking_id: booking.buchung_id, email_token: booking.email_token }
          }).then(({ data, error }) => {
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            if (!data?.order_id) throw new Error('PayPal hat keine Order-ID geliefert.');
            setPayPalStatus('Bitte bestaetige die Zahlung im PayPal-Fenster.');
            return { orderId: data.order_id };
          });

          await session.start(
            { presentationMode: 'auto' },
            orderPromise
          );
        } catch (error) {
          console.error('PayPal-Start fehlgeschlagen:', error);
          setPayPalStatus(`PayPal konnte nicht gestartet werden: ${error?.message || error}`, 'error');
        }
      });
    } catch (error) {
      console.error('PayPal konnte nicht geladen werden:', error);
      setPayPalStatus(`PayPal konnte nicht geladen werden: ${error?.message || error}`, 'error');
    }
  }

  async function sendBookingEmail(booking, silent = false) {
    if (!booking?.buchung_id || !booking?.email_token) {
      if (!silent) {
        $('emailStatus').textContent = 'Die Buchung wurde gespeichert, aber der automatische E-Mail-Versand ist für diese Buchung nicht verfügbar.';
        $('emailStatus').className = 'small email-status warning';
      }
      return false;
    }

    lastEmailPayload = { booking_id: booking.buchung_id, email_token: booking.email_token };
    if (!silent) {
      $('emailStatus').textContent = 'Buchungsbestätigung wird per E-Mail versendet …';
      $('emailStatus').className = 'small email-status';
      $('resendEmailButton').classList.add('hidden');
    }

    try {
      const { data, error } = await supabaseClient.functions.invoke('send-booking-email', { body: lastEmailPayload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      $('emailStatus').textContent = data?.already_sent
        ? 'Die Buchungsbestätigung wurde bereits per E-Mail versendet.'
        : 'Buchungsbestätigung und Vertrag wurden per E-Mail versendet.';
      $('emailStatus').className = 'small email-status success';
      $('resendEmailButton').classList.add('hidden');
      return true;
    } catch (error) {
      console.error('E-Mail-Versand fehlgeschlagen:', error);
      $('emailStatus').textContent = 'Die Buchung ist erfolgreich gespeichert. Die E-Mail konnte gerade nicht versendet werden. Du kannst sie hier erneut senden.';
      $('emailStatus').className = 'small email-status warning';
      $('resendEmailButton').classList.remove('hidden');
      return false;
    }
  }

  async function submitBooking(event) {
    event.preventDefault();
    clearError();

    if (!currentBasar) return showError('Dieser Basar ist derzeit nicht verfügbar.');

    const tables = Number(selectedValue('tables'));
    if (!tables || tables < 1 || tables > 3) return showError('Bitte wähle eine gültige Tischanzahl.');
    if (tables > currentFreeTables) {
      showError(`Diese Buchung ist nicht möglich. Es sind nur noch ${currentFreeTables} Tische frei.`);
      await loadAvailability();
      return;
    }

    const category = selectedValue('category');
    if (!['Kinder', 'Erwachsene'].includes(category)) return showError('Bitte wähle Kinder oder Erwachsene.');

    setLoading(true);
    const payload = {
      p_basar_id: currentBasar.id,
      p_anzahl_tische: tables,
      p_verkaufsbereich: category === 'Kinder' ? 'kinder' : 'erwachsene',
      p_kuchenspende: $('cake').checked,
      p_vorname: $('firstName').value.trim(),
      p_nachname: $('lastName').value.trim(),
      p_strasse: $('street').value.trim(),
      p_hausnummer: $('houseNumber').value.trim(),
      p_plz: $('zip').value.trim(),
      p_ort: $('city').value.trim(),
      p_email: $('email').value.trim(),
      p_telefon: $('phone').value.trim() || null,
      p_zahlungsart: $('payment').value
    };

    try {
      const { data, error } = await supabaseClient.rpc('create_buchung', payload);
      if (error) throw error;
      const booking = Array.isArray(data) ? data[0] : data;
      if (!booking?.buchungsnummer) throw new Error('Keine Buchungsnummer erhalten.');

      lastContract = { booking, payload, pricing: { kuchenrabatt: Number(currentBasar?.kuchenrabatt ?? 4) }, rules: { zahlungsfrist_tage: Number(currentBasar?.zahlungsfrist_tage ?? 14), kurzfristig_ab_tage: Number(currentBasar?.kurzfristig_ab_tage ?? 14), kurzfristige_zahlungsfrist_tage: Number(currentBasar?.kurzfristige_zahlungsfrist_tage ?? 3), stornofrist_tage: Number(currentBasar?.stornofrist_tage ?? 14), kuchennachgebuehr: Number(currentBasar?.kuchennachgebuehr ?? 10), uebertragung_erlaubt: currentBasar?.uebertragung_erlaubt !== false, zusatzregeln: String(currentBasar?.zusatzregeln || '').trim() } };
      $('confirmationText').textContent = `${payload.p_vorname} ${payload.p_nachname}, ${tables === 1 ? '1 Tisch wurde' : `${tables} Tische wurden`} verbindlich reserviert. Gesamtbetrag: ${euro(booking.preis)}. Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}.`;
      $('bookingNumber').textContent = booking.buchungsnummer;
      $('paymentInfo').textContent = paymentInfoText(booking, payload.p_zahlungsart);

      $('booking').classList.add('hidden');
      $('confirmation').classList.remove('hidden');
      $('emailStatus').textContent = '';
      $('emailStatus').className = 'small email-status';
      $('resendEmailButton').classList.add('hidden');
      $('paypalSection').classList.add('hidden');
      $('paypalButtonContainer').innerHTML = '';
      $('externalPaypalButton').classList.add('hidden');
      $('externalPaypalButton').removeAttribute('href');
      setPayPalStatus('');
      await loadAvailability();
      if (payload.p_zahlungsart === 'paypal') {
        await renderPayPalButtons(booking);
      } else if (payload.p_zahlungsart === 'paypal_link' && booking.veranstalter_paypal_email) {
        $('externalPaypalButton').href = booking.veranstalter_paypal_email;
        $('externalPaypalButton').classList.remove('hidden');
      }
      await sendBookingEmail(booking);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Buchungsfehler:', error);
      const message = String(error?.message || '');
      if (/nicht genuegend|nicht genügend/i.test(message)) {
        showError('Leider sind die gewünschten Tische inzwischen nicht mehr verfügbar. Bitte wähle eine kleinere Anzahl.');
        await loadAvailability().catch(console.error);
      } else if (/bereits vorbei/i.test(message)) {
        showError('Dieser Basar kann nicht mehr gebucht werden, weil der Veranstaltungstermin bereits vorbei ist.');
      } else {
        showError(`Die Buchung konnte nicht gespeichert werden. Technischer Hinweis: ${message || 'Unbekannter Fehler'}`);
      }
    } finally {
      setLoading(false);
      if (currentFreeTables < 1) updateAvailability(0);
    }
  }

  function addWrapped(doc, text, x, y, width, options = {}) {
    const lineHeight = options.lineHeight || 5.2;
    const pageBottom = 282;
    const lines = doc.splitTextToSize(String(text), width);
    for (const line of lines) {
      if (y > pageBottom) { doc.addPage(); y = 20; }
      doc.text(line, x, y);
      y += lineHeight;
    }
    return y;
  }

  function generateContractPdf() {
    if (!lastContract) return;
    if (!window.jspdf?.jsPDF) {
      showError('Die PDF-Bibliothek konnte nicht geladen werden. Bitte die Seite neu laden.');
      return;
    }

    const { booking: b, payload: p, pricing, rules = {} } = lastContract;
    const contractCakeDiscount = Number(pricing?.kuchenrabatt ?? 4);
    const ruleNormalDays = Number(rules.zahlungsfrist_tage ?? 14);
    const ruleThresholdDays = Number(rules.kurzfristig_ab_tage ?? 14);
    const ruleShortDays = Number(rules.kurzfristige_zahlungsfrist_tage ?? 3);
    const ruleStornoDays = Number(rules.stornofrist_tage ?? 14);
    const ruleCakeFee = Number(rules.kuchennachgebuehr ?? 10);
    const ruleTransfer = rules.uebertragung_erlaubt !== false;
    const ruleExtra = String(rules.zusatzregeln || '').trim();
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const left = 20;
    const width = 170;
    let y = 20;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Buchungsbestaetigung / Teilnahmevereinbarung', left, y);
    y += 9;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Buchungsnummer: ${b.buchungsnummer}`, left, y);
    y += 6;
    doc.text(`Buchungsdatum: ${formatDate(b.buchungsdatum)}`, left, y);
    y += 10;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Veranstaltung', left, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    y = addWrapped(doc, `${b.basar_name} - ${formatDate(b.veranstaltungsdatum)} - ${b.basar_ort || ''}`, left, y, width);
    y += 4;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Veranstalter / Vertragspartner', left, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    y = addWrapped(doc, `${b.veranstalter_name}\n${b.veranstalter_strasse} ${b.veranstalter_hausnummer}\n${b.veranstalter_plz} ${b.veranstalter_ort}\nTelefon: ${b.veranstalter_telefon || '-'}\nE-Mail: ${b.veranstalter_email}`, left, y, width);
    y += 4;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Teilnehmer', left, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    y = addWrapped(doc, `${p.p_vorname} ${p.p_nachname}\n${p.p_strasse} ${p.p_hausnummer}\n${p.p_plz} ${p.p_ort}\nE-Mail: ${p.p_email}${p.p_telefon ? `\nTelefon: ${p.p_telefon}` : ''}`, left, y, width);
    y += 4;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Buchung', left, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const category = p.p_verkaufsbereich === 'kinder' ? 'Kinder' : 'Erwachsene';
    const payment = p.p_zahlungsart === 'paypal' ? 'PayPal (online)' : p.p_zahlungsart === 'paypal_link' ? 'PayPal-Link' : 'Ueberweisung';
    const bookingLines = [
      `Tische: ${p.p_anzahl_tische}`,
      `Verkaufsbereich: ${category}`,
      `Kuchenspende: ${p.p_kuchenspende ? `Ja (-${contractCakeDiscount.toFixed(2).replace('.', ',')} EUR Rabatt)` : 'Nein'}`,
      `Gesamtbetrag: ${Number(b.preis).toFixed(2).replace('.', ',')} EUR`,
      `Zahlungsart: ${payment}`,
      `Zahlungsfrist: ${formatDate(b.zahlungsfrist)}`
    ];
    y = addWrapped(doc, bookingLines.join('\n'), left, y, width);
    y += 4;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Zahlungsinformationen', left, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    y = addWrapped(doc, paymentInfoText(b, p.p_zahlungsart), left, y, width);
    y += 5;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Teilnahmebedingungen', left, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const clauses = [
      '1. Mit Abschluss der Buchung wird die angegebene Anzahl an Verkaufstischen verbindlich reserviert.',
      `2. Der Teilnahmebetrag ist bis ${formatDate(b.zahlungsfrist)} zu bezahlen. Bei Buchungen mindestens ${ruleThresholdDays} Tage vor der Veranstaltung betraegt die regulaere Zahlungsfrist ${ruleNormalDays} Tage. Bei spaeteren Buchungen betraegt sie ${ruleShortDays} Tage, jeweils hoechstens bis zum Veranstaltungstag. Nach Ablauf der Zahlungsfrist besteht ohne Zahlung keine Garantie mehr auf den reservierten Tisch.`,
      `3. Eine kostenlose Stornierung ist bis ${formatDate(b.stornierbar_bis)} (${ruleStornoDays} Tage vor Veranstaltungsbeginn) moeglich. Danach besteht kein Anspruch auf Rueckerstattung bereits geleisteter Zahlungen.${ruleTransfer ? ' Alternativ kann die Buchung auf eine andere Person uebertragen werden, sofern der Veranstalter vorab informiert wird.' : ' Eine Uebertragung auf eine andere Person ist nicht vorgesehen.'}`,
      '4. Pro Buchung ist nur ein Verkaufsbereich zulaessig: Kinderartikel oder Erwachsenenartikel. Fuer beide Bereiche sind zwei getrennte Buchungen erforderlich.',
      `5. Bei ausgewaehlter Kuchenspende wird der Buchungspreis einmalig um ${contractCakeDiscount.toFixed(2).replace('.', ',')} EUR reduziert. Wird der zugesagte Kuchen am Veranstaltungstag nicht erbracht, wird nachtraeglich eine Gebuehr von ${ruleCakeFee.toFixed(2).replace('.', ',')} EUR faellig.`
    ];
    if (ruleExtra) clauses.push(`6. Zusaetzliche Regel des Veranstalters: ${ruleExtra}`);
    for (const clause of clauses) { y = addWrapped(doc, clause, left, y, width, { lineHeight: 4.8 }); y += 2; }

    if (y > 265) { doc.addPage(); y = 20; }
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    y = addWrapped(doc, 'Diese Buchungsbestaetigung dokumentiert die bei der Online-Buchung akzeptierte Teilnahmevereinbarung. Eine Unterschrift ist fuer die elektronische Buchungsbestaetigung nicht vorgesehen.', left, y + 4, width, { lineHeight: 4.5 });

    const filename = `Basar-Vertrag-${b.buchungsnummer}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '-');
    doc.save(filename);
  }

  document.querySelectorAll('input[name="tables"], #cake').forEach(el => el.addEventListener('change', updatePrice));

  $('searchBasarButton')?.addEventListener('click', () => applyDiscoverySearch());
  $('useLocationButton')?.addEventListener('click', useCurrentLocation);
  $('radiusSelect')?.addEventListener('change', () => { discoveryRadiusKm = Number($('radiusSelect').value || 25); if (discoveryMode === 'distance') { setLocationStatus(`Basare im Umkreis von ${discoveryRadiusKm} km.`, 'success'); renderDiscoveryCards(); } });
  $('freeOnly')?.addEventListener('change', () => { discoveryFreeOnly = $('freeOnly').checked; renderDiscoveryCards(); });
  $('basarSearch')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); applyDiscoverySearch(); }
  });
  $('basarSearch')?.addEventListener('input', () => {
    if (!$('basarSearch').value.trim()) { discoveryQuery = ''; discoveryMode = 'all'; discoveryOrigin = null; discoveryDistances.clear(); setLocationStatus(''); renderDiscoveryCards(); }
  });
  $('clearBasarSearch')?.addEventListener('click', () => {
    $('basarSearch').value = ''; discoveryQuery = ''; discoveryMode = 'all'; discoveryOrigin = null; discoveryDistances.clear(); setLocationStatus(''); renderDiscoveryCards(); $('basarSearch').focus();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-discover-basar]');
    if (!button || button.disabled) return;
    selectDiscoveredBasar(Number(button.dataset.discoverBasar));
  });

  $('basarSelect').addEventListener('change', async event => {
    try { await selectDiscoveredBasar(Number(event.target.value), false); }
    catch (error) { console.error(error); showError(`Der Basar konnte nicht geladen werden: ${error?.message || error}`); }
  });

  $('bookingForm').addEventListener('submit', submitBooking);
  $('pdfButton').addEventListener('click', generateContractPdf);
  $('resendEmailButton').addEventListener('click', async () => {
    if (!lastEmailPayload) return;
    $('resendEmailButton').disabled = true;
    $('resendEmailButton').textContent = 'E-Mail wird gesendet …';
    try {
      await sendBookingEmail({ buchung_id: lastEmailPayload.booking_id, email_token: lastEmailPayload.email_token });
    } finally {
      $('resendEmailButton').disabled = false;
      $('resendEmailButton').textContent = 'E-Mail erneut senden';
    }
  });
  $('printButton').addEventListener('click', () => window.print());

  $('newBookingButton').addEventListener('click', async () => {
    $('bookingForm').reset();
    lastContract = null;
    lastEmailPayload = null;
    $('paypalSection').classList.add('hidden');
    $('paypalButtonContainer').innerHTML = '';
    $('externalPaypalButton').classList.add('hidden');
    $('externalPaypalButton').removeAttribute('href');
    setPayPalStatus('');
    clearError();
    updatePrice();
    $('confirmation').classList.add('hidden');
    $('booking').classList.remove('hidden');
    await loadAvailability().catch(console.error);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  (async function init() {
    try {
      setBookingEnabled(false);
      await loadBasare();
      setBookingEnabled(true);
      updateAvailability(currentFreeTables);
      updatePrice();
    } catch (error) {
      console.error('Initialisierungsfehler:', error);
      $('basarName').textContent = 'Buchungsseite momentan nicht verfügbar';
      $('basarDetails').textContent = 'Die Verbindung zur Basardatenbank konnte nicht hergestellt werden.';
      $('availableTables').textContent = '–';
      setBookingEnabled(false);
      showError(`Technischer Hinweis: ${error?.message || error}`);
    }
  })();
})();
