(() => {
  const SUPABASE_URL = 'https://byvvsockfobnrqzkxvap.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_iLXVfFOYROoBHwwhQcoEKg_N7ABYWSx';
  const { createClient } = window.supabase;
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const $ = id => document.getElementById(id);
  let basare = [];
  let bookings = [];
  let selectedBasarId = null;
  let selectedBooking = null;

  const euro = value => Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  function formatDate(dateString) {
    if (!dateString) return '';
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
      .format(new Date(`${dateString}T12:00:00`));
  }

  function formatDateTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showError(id, message) {
    const box = $(id);
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function clearError(id) {
    const box = $(id);
    box.textContent = '';
    box.classList.add('hidden');
  }

  async function isAdmin() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async function loadBasare() {
    clearError('basarError');
    const { data, error } = await supabase
      .from('basare')
      .select('id,name,ort,veranstaltungsdatum,max_tische,aktiv,created_at')
      .order('veranstaltungsdatum', { ascending: true });
    if (error) throw error;
    basare = data || [];

    if (!selectedBasarId || !basare.some(b => b.id === selectedBasarId)) {
      const active = basare.find(b => b.aktiv) || basare[0];
      selectedBasarId = active ? active.id : null;
    }

    renderBasarList();
    if (selectedBasarId) {
      await loadSelectedBasar();
    } else {
      clearSelectedBasar();
    }
  }

  function renderBasarList() {
    const el = $('basarList');
    if (!basare.length) {
      el.innerHTML = '<div class="empty-state">Noch kein Basar vorhanden. Lege deinen ersten Basar an.</div>';
      return;
    }

    el.innerHTML = basare.map(basar => `
      <button class="basar-list-item ${basar.id === selectedBasarId ? 'selected' : ''}" data-basar-id="${basar.id}" type="button">
        <div>
          <strong>${escapeHtml(basar.name)}</strong>
          <span>${escapeHtml(formatDate(basar.veranstaltungsdatum))}${basar.ort ? ' · ' + escapeHtml(basar.ort) : ''}</span>
        </div>
        <span class="status-chip ${basar.aktiv ? 'active' : 'inactive'}">${basar.aktiv ? 'Aktiv' : 'Inaktiv'}</span>
      </button>
    `).join('');

    el.querySelectorAll('[data-basar-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        selectedBasarId = Number(btn.dataset.basarId);
        renderBasarList();
        try { await loadSelectedBasar(); } catch (error) { console.error(error); showError('basarError', humanizeError(error)); }
      });
    });
  }

  async function loadSelectedBasar() {
    const basar = basare.find(b => b.id === selectedBasarId);
    if (!basar) return clearSelectedBasar();

    $('selectedBasarCard').classList.remove('hidden');
    $('bookingCard').classList.remove('hidden');
    $('dashboardTitle').textContent = basar.name;
    $('dashboardDetails').textContent = `${formatDate(basar.veranstaltungsdatum)} · ${basar.ort || ''}`.replace(/ · $/, '') + (basar.aktiv ? '' : ' · Inaktiv');
    $('dashboardTotal').textContent = basar.max_tische;

    await loadBookings();
  }

  function clearSelectedBasar() {
    $('selectedBasarCard').classList.add('hidden');
    $('bookingCard').classList.add('hidden');
  }

  async function loadBookings() {
    clearError('dashboardError');
    const { data, error } = await supabase
      .from('buchungen')
      .select('id,buchungsnummer,anzahl_tische,verkaufsbereich,kuchenspende,preis,vorname,nachname,strasse,hausnummer,plz,ort,email,telefon,zahlungsart,zahlungsstatus,zahlungsfrist,created_at')
      .eq('basar_id', selectedBasarId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    bookings = data || [];
    updateStats();
    renderBookings();
  }

  function updateStats() {
    const basar = basare.find(b => b.id === selectedBasarId);
    if (!basar) return;
    const activeBookings = bookings.filter(row => row.zahlungsstatus !== 'storniert');
    const bookedTables = activeBookings.reduce((sum, row) => sum + Number(row.anzahl_tische || 0), 0);
    $('dashboardBooked').textContent = bookedTables;
    $('dashboardFree').textContent = Math.max(0, Number(basar.max_tische) - bookedTables);
  }

  function renderBookings() {
    const filter = $('bookingFilter').value;
    const filtered = bookings.filter(row => {
      if (filter === 'offen') return row.zahlungsstatus === 'offen';
      if (filter === 'bezahlt') return row.zahlungsstatus === 'bezahlt';
      if (filter === 'kuchen') return row.kuchenspende;
      if (filter === 'kinder') return row.verkaufsbereich === 'kinder';
      if (filter === 'erwachsene') return row.verkaufsbereich === 'erwachsene';
      return true;
    });

    const rows = $('bookingRows');
    if (!filtered.length) {
      rows.innerHTML = '<tr><td colspan="10">Keine passenden Buchungen vorhanden.</td></tr>';
      return;
    }

    rows.innerHTML = filtered.map(row => {
      const category = row.verkaufsbereich === 'kinder' ? 'Kinder' : 'Erwachsene';
      const payment = row.zahlungsart === 'paypal' ? 'PayPal' : 'Überweisung';
      const statusText = row.zahlungsstatus === 'bezahlt' ? 'Bezahlt' : row.zahlungsstatus === 'storniert' ? 'Storniert' : 'Offen';
      const statusClass = row.zahlungsstatus;
      return `
        <tr class="${row.zahlungsstatus === 'storniert' ? 'muted-row' : ''}">
          <td><strong>${escapeHtml(row.buchungsnummer)}</strong></td>
          <td>${escapeHtml(`${row.vorname} ${row.nachname}`)}</td>
          <td>${row.anzahl_tische}</td>
          <td>${category}</td>
          <td>${row.kuchenspende ? 'Ja' : 'Nein'}</td>
          <td>${euro(row.preis)}</td>
          <td>${payment}</td>
          <td>${formatDate(row.zahlungsfrist)}</td>
          <td><span class="badge status-${statusClass}">${statusText}</span></td>
          <td><button class="table-button" type="button" data-booking-id="${row.id}">Öffnen</button></td>
        </tr>`;
    }).join('');

    rows.querySelectorAll('[data-booking-id]').forEach(btn => {
      btn.addEventListener('click', () => openBooking(Number(btn.dataset.bookingId)));
    });
  }

  function openBooking(id) {
    selectedBooking = bookings.find(b => b.id === id) || null;
    if (!selectedBooking) return;

    const row = selectedBooking;
    const category = row.verkaufsbereich === 'kinder' ? 'Kinder' : 'Erwachsene';
    const payment = row.zahlungsart === 'paypal' ? 'PayPal' : 'Überweisung';
    const status = row.zahlungsstatus === 'bezahlt' ? 'Bezahlt' : row.zahlungsstatus === 'storniert' ? 'Storniert' : 'Offen';

    $('bookingModalTitle').textContent = row.buchungsnummer;
    $('bookingDetails').innerHTML = `
      <div class="detail-item"><span>Name</span><strong>${escapeHtml(`${row.vorname} ${row.nachname}`)}</strong></div>
      <div class="detail-item"><span>Bereich</span><strong>${category}</strong></div>
      <div class="detail-item"><span>Tische</span><strong>${row.anzahl_tische}</strong></div>
      <div class="detail-item"><span>Kuchen</span><strong>${row.kuchenspende ? 'Ja' : 'Nein'}</strong></div>
      <div class="detail-item"><span>Betrag</span><strong>${euro(row.preis)}</strong></div>
      <div class="detail-item"><span>Zahlung</span><strong>${payment}</strong></div>
      <div class="detail-item"><span>Status</span><strong>${status}</strong></div>
      <div class="detail-item"><span>Zahlungsfrist</span><strong>${formatDate(row.zahlungsfrist)}</strong></div>
      <div class="detail-item full"><span>Adresse</span><strong>${escapeHtml(`${row.strasse} ${row.hausnummer}, ${row.plz} ${row.ort}`)}</strong></div>
      <div class="detail-item"><span>E-Mail</span><strong>${escapeHtml(row.email)}</strong></div>
      <div class="detail-item"><span>Telefon</span><strong>${escapeHtml(row.telefon || '—')}</strong></div>
      <div class="detail-item full"><span>Buchung eingegangen</span><strong>${formatDateTime(row.created_at)}</strong></div>
    `;

    $('markPaidButton').classList.toggle('hidden', row.zahlungsstatus === 'bezahlt' || row.zahlungsstatus === 'storniert');
    $('markOpenButton').classList.toggle('hidden', row.zahlungsstatus !== 'bezahlt');
    $('cancelBookingButton').classList.toggle('hidden', row.zahlungsstatus === 'storniert');
    $('bookingModal').classList.remove('hidden');
    $('bookingModal').setAttribute('aria-hidden', 'false');
  }

  function closeBooking() {
    const modal = $('bookingModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    selectedBooking = null;
  }

  // Global handlers: the modal controls also use inline onclick attributes
  // so they keep working even if another listener fails to attach.
  window.closeBookingModal = closeBooking;
  window.markSelectedBookingPaid = () => updateBookingStatus('bezahlt');
  window.markSelectedBookingOpen = () => updateBookingStatus('offen');
  window.cancelSelectedBooking = () => updateBookingStatus('storniert');

  async function updateBookingStatus(status) {
    if (!selectedBooking) return;
    const label = status === 'bezahlt' ? 'Zahlung als bezahlt markieren' : status === 'offen' ? 'Zahlung wieder öffnen' : 'Buchung stornieren';
    if (!window.confirm(`${label}?`)) return;

    const { error } = await supabase
      .from('buchungen')
      .update({ zahlungsstatus: status })
      .eq('id', selectedBooking.id);
    if (error) {
      showError('dashboardError', humanizeError(error));
      return;
    }
    closeBooking();
    await loadBookings();
  }

  function startNewBasar() {
    clearError('basarError');
    $('basarForm').reset();
    $('basarId').value = '';
    $('basarFormTitle').textContent = 'Neuen Basar anlegen';
    $('basarTische').value = '50';
    $('basarAktiv').value = 'true';
    $('basarFormCard').classList.remove('hidden');
    $('basarFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function editBasar(basar) {
    clearError('basarError');
    $('basarId').value = basar.id;
    $('basarName').value = basar.name || '';
    $('basarOrt').value = basar.ort || '';
    $('basarDatum').value = basar.veranstaltungsdatum || '';
    $('basarTische').value = basar.max_tische || '';
    $('basarAktiv').value = String(!!basar.aktiv);
    $('basarFormTitle').textContent = 'Basar bearbeiten';
    $('basarFormCard').classList.remove('hidden');
    $('basarFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveBasar(event) {
    event.preventDefault();
    clearError('basarError');
    const id = $('basarId').value ? Number($('basarId').value) : null;
    const payload = {
      name: $('basarName').value.trim(),
      ort: $('basarOrt').value.trim() || null,
      veranstaltungsdatum: $('basarDatum').value,
      max_tische: Number($('basarTische').value),
      aktiv: $('basarAktiv').value === 'true'
    };

    if (!payload.name || !payload.veranstaltungsdatum || !payload.max_tische) {
      showError('basarError', 'Bitte Name, Datum und Tischanzahl ausfüllen.');
      return;
    }

    const button = $('saveBasarButton');
    button.disabled = true;
    button.textContent = 'Speichert …';
    try {
      if (id) {
        const { error } = await supabase.from('basare').update(payload).eq('id', id);
        if (error) throw error;
        selectedBasarId = id;
      } else {
        const { data, error } = await supabase.from('basare').insert(payload).select('id').single();
        if (error) throw error;
        selectedBasarId = data.id;
      }
      $('basarFormCard').classList.add('hidden');
      await loadBasare();
    } catch (error) {
      console.error(error);
      showError('basarError', humanizeError(error));
    } finally {
      button.disabled = false;
      button.textContent = 'Basar speichern';
    }
  }

  function humanizeError(error) {
    const message = error?.message || String(error || 'Unbekannter Fehler.');
    if (/permission|row-level security|not authorized/i.test(message)) {
      return 'Keine Berechtigung für diese Aktion. Bitte prüfe die Admin-Berechtigungen.';
    }
    if (/duplicate/i.test(message)) return 'Dieser Datensatz ist bereits vorhanden.';
    return message;
  }

  async function showDashboard() {
    const admin = await isAdmin();
    if (!admin) {
      await supabase.auth.signOut();
      $('loginCard').classList.remove('hidden');
      $('dashboard').classList.add('hidden');
      $('topLogoutButton').classList.add('hidden');
      showError('loginError', 'Dieses Konto ist nicht als Veranstalter freigeschaltet.');
      return;
    }
    $('loginCard').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    $('topLogoutButton').classList.remove('hidden');
    await loadBasare();
  }

  async function logout() {
    await supabase.auth.signOut();
    $('dashboard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    $('topLogoutButton').classList.add('hidden');
    $('loginForm').reset();
  }

  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    clearError('loginError');
    $('loginButton').disabled = true;
    $('loginButton').textContent = 'Anmeldung läuft …';
    const { error } = await supabase.auth.signInWithPassword({
      email: $('loginEmail').value.trim(),
      password: $('loginPassword').value
    });
    $('loginButton').disabled = false;
    $('loginButton').textContent = 'Anmelden';
    if (error) {
      showError('loginError', 'Anmeldung fehlgeschlagen. Bitte E-Mail-Adresse und Passwort prüfen.');
      return;
    }
    try { await showDashboard(); }
    catch (error) { console.error(error); showError('loginError', 'Das Dashboard konnte nicht geladen werden.'); }
  });

  $('topLogoutButton').addEventListener('click', logout);
  $('newBasarButton').addEventListener('click', startNewBasar);
  $('cancelBasarButton').addEventListener('click', () => $('basarFormCard').classList.add('hidden'));
  $('basarForm').addEventListener('submit', saveBasar);
  $('editCurrentButton').addEventListener('click', () => {
    const basar = basare.find(b => b.id === selectedBasarId);
    if (basar) editBasar(basar);
  });
  $('refreshButton').addEventListener('click', async () => {
    try { await loadBasare(); } catch (error) { console.error(error); showError('dashboardError', humanizeError(error)); }
  });
  $('refreshBookingsButton').addEventListener('click', async () => {
    try { await loadBookings(); } catch (error) { console.error(error); showError('dashboardError', humanizeError(error)); }
  });
  $('bookingFilter').addEventListener('change', renderBookings);
  $('closeBookingModal').addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeBooking();
  });

  // Also allow clicking the dark area outside the dialog to close it.
  $('bookingModal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeBooking();
  });

  // Keyboard fallback.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeBooking();
  });

  // Keep JS listeners too, while inline handlers provide an additional fallback.
  $('markPaidButton').addEventListener('click', event => { event.preventDefault(); updateBookingStatus('bezahlt'); });
  $('markOpenButton').addEventListener('click', event => { event.preventDefault(); updateBookingStatus('offen'); });
  $('cancelBookingButton').addEventListener('click', event => { event.preventDefault(); updateBookingStatus('storniert'); });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) return;
    setTimeout(() => showDashboard().catch(console.error), 0);
  });

  (async function init() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) await showDashboard();
    } catch (error) {
      console.error(error);
      showError('loginError', 'Die Anmeldung konnte nicht geprüft werden.');
    }
  })();
})();
