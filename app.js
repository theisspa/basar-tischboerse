(() => {
  'use strict';

  const config = window.BASAR_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    console.error('Basar-Konfiguration oder Supabase-Bibliothek fehlt.');
    return;
  }

  const supabaseClient = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );

  const prices = { 1: 12, 2: 20, 3: 25 };
  const euro = value => Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const $ = id => document.getElementById(id);

  let basare = [];
  let currentBasar = null;
  let currentFreeTables = 0;

  function selectedValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  }

  function formatDate(dateString) {
    if (!dateString) return '';
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: 'long', year: 'numeric'
    }).format(new Date(`${dateString}T12:00:00`));
  }

  function updatePrice() {
    const tables = Number(selectedValue('tables') || 1);
    const cake = $('cake').checked;
    const base = prices[tables] ?? 0;
    const discount = cake ? 4 : 0;
    $('basePrice').textContent = euro(base);
    $('discount').textContent = discount ? `-${euro(discount)}` : euro(0);
    $('totalPrice').textContent = euro(Math.max(0, base - discount));
  }

  function setBookingEnabled(enabled) {
    $('bookingForm').querySelectorAll('input, select, button').forEach(el => {
      if (el.id === 'submitButton') return;
      el.disabled = !enabled;
    });
    $('submitButton').disabled = !enabled;
    $('submitButton').textContent = enabled ? 'Verbindlich buchen' : 'Derzeit nicht verfügbar';
  }

  function updateAvailability(free) {
    const safeFree = Number.isFinite(Number(free)) ? Math.max(0, Number(free)) : 0;
    currentFreeTables = safeFree;
    $('availableTables').textContent = safeFree;

    document.querySelectorAll('input[name="tables"]').forEach(input => {
      const tables = Number(input.value);
      const disabled = tables > safeFree;
      input.disabled = disabled;
      input.closest('.choice')?.classList.toggle('disabled', disabled);
    });

    const selected = document.querySelector('input[name="tables"]:checked');
    if (selected?.disabled) {
      const firstAvailable = [...document.querySelectorAll('input[name="tables"]')].find(input => !input.disabled);
      if (firstAvailable) firstAvailable.checked = true;
      updatePrice();
    }

    $('submitButton').disabled = safeFree < 1;
    $('submitButton').textContent = safeFree < 1 ? 'Ausgebucht' : 'Verbindlich buchen';
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

  function renderBasarSelector() {
    const wrap = $('basarSelectWrap');
    const select = $('basarSelect');
    select.innerHTML = basare.map(b =>
      `<option value="${b.id}">${escapeHtml(b.name)}${b.ort ? ` – ${escapeHtml(b.ort)}` : ''}</option>`
    ).join('');

    wrap.classList.toggle('hidden', basare.length <= 1);
    if (currentBasar) select.value = String(currentBasar.id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function loadBasare() {
    const { data, error } = await supabaseClient
      .from('basare')
      .select('id,name,ort,veranstaltungsdatum,max_tische,aktiv')
      .eq('aktiv', true)
      .order('veranstaltungsdatum', { ascending: true });

    if (error) throw error;
    basare = data || [];
    if (!basare.length) throw new Error('Noch kein aktiver Basar angelegt.');

    const params = new URLSearchParams(window.location.search);
    const requestedId = Number(params.get('basar'));
    currentBasar = basare.find(b => b.id === requestedId) || basare[0];

    renderBasarSelector();
    await showCurrentBasar();
  }

  async function showCurrentBasar() {
    if (!currentBasar) return;
    clearError();
    $('basarName').textContent = currentBasar.name;
    $('basarDetails').textContent = `${formatDate(currentBasar.veranstaltungsdatum)} · ${currentBasar.ort || ''}`.replace(/ · $/, '');
    $('availableTables').textContent = '…';
    await loadAvailability();
  }

  async function loadAvailability() {
    if (!currentBasar) return;
    const { data, error } = await supabaseClient.rpc('get_basar_availability', {
      p_basar_id: currentBasar.id
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Verfügbarkeit konnte nicht geladen werden.');
    updateAvailability(Number(row.free_tables));
  }

  function setLoading(loading) {
    $('submitButton').disabled = loading;
    $('submitButton').textContent = loading ? 'Buchung wird gespeichert …' : 'Verbindlich buchen';
  }

  async function submitBooking(event) {
    event.preventDefault();
    clearError();

    if (!currentBasar) {
      showError('Dieser Basar ist derzeit nicht verfügbar.');
      return;
    }

    const tables = Number(selectedValue('tables'));
    if (!tables || tables < 1 || tables > 3) {
      showError('Bitte wähle eine gültige Tischanzahl.');
      return;
    }

    if (tables > currentFreeTables) {
      showError(`Diese Buchung ist nicht möglich. Es sind nur noch ${currentFreeTables} Tische frei.`);
      await loadAvailability();
      return;
    }

    const category = selectedValue('category');
    if (!['Kinder', 'Erwachsene'].includes(category)) {
      showError('Bitte wähle Kinder oder Erwachsene.');
      return;
    }

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

      const total = Number(booking.preis);
      const deadline = formatDate(booking.zahlungsfrist);
      $('confirmationText').textContent = `${payload.p_vorname} ${payload.p_nachname}, deine Buchung über ${tables} ${tables === 1 ? 'Tisch' : 'Tische'} für den Bereich ${payload.p_verkaufsbereich === 'kinder' ? 'Kinder' : 'Erwachsene'} wurde verbindlich gespeichert. Gesamtbetrag: ${euro(total)}. Zahlungsfrist: ${deadline}.`;
      $('bookingNumber').textContent = booking.buchungsnummer;
      $('paymentInfo').textContent = payload.p_zahlungsart === 'paypal'
        ? 'Zahlungsart: PayPal. Die konkrete Zahlungsabwicklung wird im nächsten Ausbauschritt angebunden.'
        : `Zahlungsart: Überweisung. Bitte überweise ${euro(total)} innerhalb von 14 Tagen. Die Bankverbindung wird mit den Buchungsunterlagen ergänzt.`;

      $('booking').classList.add('hidden');
      $('confirmation').classList.remove('hidden');
      await loadAvailability();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Buchungsfehler:', error);
      const message = String(error?.message || '');
      if (/nicht genuegend|nicht genügend/i.test(message)) {
        showError('Leider sind die gewünschten Tische inzwischen nicht mehr verfügbar. Bitte wähle eine kleinere Anzahl.');
        await loadAvailability().catch(console.error);
      } else if (/zahlungsart/i.test(message)) {
        showError('Die Zahlungsart konnte nicht verarbeitet werden. Bitte wähle PayPal oder Überweisung erneut.');
      } else {
        showError(`Die Buchung konnte nicht gespeichert werden. Technischer Hinweis: ${message || 'Unbekannter Fehler'}`);
      }
    } finally {
      setLoading(false);
      if (currentFreeTables < 1) updateAvailability(0);
    }
  }

  document.querySelectorAll('input[name="tables"], #cake').forEach(el => {
    el.addEventListener('change', updatePrice);
  });

  $('basarSelect').addEventListener('change', async event => {
    const id = Number(event.target.value);
    currentBasar = basare.find(b => b.id === id) || basare[0];
    const url = new URL(window.location.href);
    url.searchParams.set('basar', String(currentBasar.id));
    window.history.replaceState({}, '', url);
    try {
      await showCurrentBasar();
    } catch (error) {
      console.error(error);
      showError(`Der Basar konnte nicht geladen werden: ${error?.message || error}`);
    }
  });

  $('bookingForm').addEventListener('submit', submitBooking);

  $('newBookingButton').addEventListener('click', async () => {
    $('bookingForm').reset();
    clearError();
    updatePrice();
    $('confirmation').classList.add('hidden');
    $('booking').classList.remove('hidden');
    await loadAvailability().catch(console.error);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('printButton').addEventListener('click', () => window.print());

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
