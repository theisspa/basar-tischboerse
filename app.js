(() => {
  'use strict';

  const config = window.BASAR_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    console.error('Basar-Konfiguration oder Supabase-Bibliothek fehlt.');
    return;
  }

  const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const prices = { 1: 12, 2: 20, 3: 25 };
  const euro = value => Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const $ = id => document.getElementById(id);

  let basare = [];
  let currentBasar = null;
  let currentFreeTables = 0;
  let lastContract = null;
  let lastEmailPayload = null;

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
    if (days === null) return 'Die Zahlungsfrist wird anhand des Veranstaltungstermins berechnet.';
    if (days >= 14) return 'Die Reservierung ist 14 Tage garantiert. Der Teilnahmebetrag ist innerhalb von 14 Tagen nach Buchung zu bezahlen.';
    return 'Da der Basartermin weniger als 14 Tage entfernt ist, ist der Teilnahmebetrag innerhalb von 3 Tagen zu zahlen, spätestens jedoch am Veranstaltungstag. Danach besteht keine Garantie mehr auf den Tisch.';
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

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function renderBasarSelector() {
    const wrap = $('basarSelectWrap');
    const select = $('basarSelect');
    select.innerHTML = basare.map(b => `<option value="${b.id}">${escapeHtml(b.name)}${b.ort ? ` – ${escapeHtml(b.ort)}` : ''}</option>`).join('');
    wrap.classList.toggle('hidden', basare.length <= 1);
    if (currentBasar) select.value = String(currentBasar.id);
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
    $('paymentRule').textContent = paymentRuleText();
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
    $('submitButton').disabled = loading;
    $('submitButton').textContent = loading ? 'Buchung wird gespeichert …' : 'Verbindlich buchen';
  }

  function paymentInfoText(booking, paymentMethod) {
    if (paymentMethod === 'paypal') {
      return booking.veranstalter_paypal_email
        ? `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. PayPal-Zahlung an ${booking.veranstalter_paypal_email}. Als Verwendungszweck bitte ${booking.buchungsnummer} angeben.`
        : `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. Die PayPal-Zahlungsdaten werden vom Veranstalter mitgeteilt.`;
    }
    if (booking.veranstalter_iban) {
      const owner = booking.veranstalter_kontoinhaber || booking.veranstalter_name;
      return `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. Überweisung an ${owner}, IBAN ${booking.veranstalter_iban}. Verwendungszweck: ${booking.buchungsnummer}.`;
    }
    return `Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}. Die Bankverbindung wird vom Veranstalter separat mitgeteilt. Verwendungszweck: ${booking.buchungsnummer}.`;
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

      lastContract = { booking, payload };
      $('confirmationText').textContent = `${payload.p_vorname} ${payload.p_nachname}, ${tables === 1 ? '1 Tisch wurde' : `${tables} Tische wurden`} verbindlich reserviert. Gesamtbetrag: ${euro(booking.preis)}. Zahlungsfrist: ${formatDate(booking.zahlungsfrist)}.`;
      $('bookingNumber').textContent = booking.buchungsnummer;
      $('paymentInfo').textContent = paymentInfoText(booking, payload.p_zahlungsart);

      $('booking').classList.add('hidden');
      $('confirmation').classList.remove('hidden');
      $('emailStatus').textContent = '';
      $('emailStatus').className = 'small email-status';
      $('resendEmailButton').classList.add('hidden');
      await loadAvailability();
      void sendBookingEmail(booking);
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

    const { booking: b, payload: p } = lastContract;
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
    const payment = p.p_zahlungsart === 'paypal' ? 'PayPal' : 'Ueberweisung';
    const bookingLines = [
      `Tische: ${p.p_anzahl_tische}`,
      `Verkaufsbereich: ${category}`,
      `Kuchenspende: ${p.p_kuchenspende ? 'Ja (-4 EUR Rabatt)' : 'Nein'}`,
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
      `2. Der Teilnahmebetrag ist bis ${formatDate(b.zahlungsfrist)} zu bezahlen. Bei Buchungen mindestens 14 Tage vor der Veranstaltung betraegt die Zahlungsfrist 14 Tage. Bei spaeteren Buchungen betraegt sie 3 Tage, jedoch hoechstens bis zum Veranstaltungstag. Nach Ablauf der Zahlungsfrist besteht ohne Zahlung keine Garantie mehr auf den reservierten Tisch.`,
      `3. Eine kostenlose Stornierung ist bis ${formatDate(b.stornierbar_bis)} (14 Tage vor Veranstaltungsbeginn) moeglich. Danach besteht kein Anspruch auf Rueckerstattung bereits geleisteter Zahlungen. Alternativ kann die Buchung auf eine andere Person uebertragen werden, sofern der Veranstalter vorab informiert wird.`,
      '4. Pro Buchung ist nur ein Verkaufsbereich zulaessig: Kinderartikel oder Erwachsenenartikel. Fuer beide Bereiche sind zwei getrennte Buchungen erforderlich.',
      '5. Bei ausgewaehlter Kuchenspende wird der Buchungspreis einmalig um 4 EUR reduziert. Wird der zugesagte Kuchen am Veranstaltungstag nicht erbracht, wird nachtraeglich eine Gebuehr von 10 EUR faellig.'
    ];
    for (const clause of clauses) { y = addWrapped(doc, clause, left, y, width, { lineHeight: 4.8 }); y += 2; }

    if (y > 265) { doc.addPage(); y = 20; }
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    y = addWrapped(doc, 'Diese Buchungsbestaetigung dokumentiert die bei der Online-Buchung akzeptierte Teilnahmevereinbarung. Eine Unterschrift ist fuer die elektronische Buchungsbestaetigung nicht vorgesehen.', left, y + 4, width, { lineHeight: 4.5 });

    const filename = `Basar-Vertrag-${b.buchungsnummer}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '-');
    doc.save(filename);
  }

  document.querySelectorAll('input[name="tables"], #cake').forEach(el => el.addEventListener('change', updatePrice));

  $('basarSelect').addEventListener('change', async event => {
    const id = Number(event.target.value);
    currentBasar = basare.find(b => b.id === id) || basare[0];
    const url = new URL(window.location.href);
    url.searchParams.set('basar', String(currentBasar.id));
    window.history.replaceState({}, '', url);
    try { await showCurrentBasar(); } catch (error) { console.error(error); showError(`Der Basar konnte nicht geladen werden: ${error?.message || error}`); }
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
