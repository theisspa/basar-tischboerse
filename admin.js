(() => {
  // Prevent accidental double-loading of this script.
  if (window.__basarAdminInitialized) return;
  window.__basarAdminInitialized = true;

  const SUPABASE_URL = 'https://byvvsockfobnrqzkxvap.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_iLXVfFOYROoBHwwhQcoEKg_N7ABYWSx';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('Supabase library is not available.');
    const errorBox = document.getElementById('loginError');
    if (errorBox) {
      errorBox.textContent = 'Die Verbindung zur Anmeldung konnte nicht geladen werden. Bitte Seite neu laden.';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const $ = id => document.getElementById(id);
  const euro = value => Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

  function formatDate(dateString) {
    if (!dateString) return '';
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
      .format(new Date(`${dateString}T12:00:00`));
  }

  function showLoginError(message) {
    const box = $('loginError');
    if (!box) return;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function showDashboardError(message) {
    const box = $('dashboardError');
    if (!box) return;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function clearErrors() {
    $('loginError')?.classList.add('hidden');
    $('dashboardError')?.classList.add('hidden');
    if ($('loginError')) $('loginError').textContent = '';
    if ($('dashboardError')) $('dashboardError').textContent = '';
  }

  async function isAdmin() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabaseClient
      .from('admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  }

  async function loadBasarAndBookings() {
    clearErrors();

    const { data: basar, error: basarError } = await supabaseClient
      .from('basare')
      .select('id,name,ort,veranstaltungsdatum,max_tische,aktiv')
      .eq('aktiv', true)
      .order('veranstaltungsdatum', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (basarError) throw basarError;
    if (!basar) throw new Error('Kein aktiver Basar vorhanden.');

    const { data: bookings, error: bookingError } = await supabaseClient
      .from('buchungen')
      .select('buchungsnummer,anzahl_tische,verkaufsbereich,kuchenspende,preis,vorname,nachname,email,telefon,zahlungsart,zahlungsstatus,zahlungsfrist,created_at')
      .eq('basar_id', basar.id)
      .order('created_at', { ascending: false });

    if (bookingError) throw bookingError;

    const activeBookings = (bookings || []).filter(row => row.zahlungsstatus !== 'storniert');
    const bookedTables = activeBookings.reduce((sum, row) => sum + Number(row.anzahl_tische || 0), 0);
    const freeTables = Math.max(0, Number(basar.max_tische) - bookedTables);

    $('dashboardTitle').textContent = basar.name;
    $('dashboardDetails').textContent = `${formatDate(basar.veranstaltungsdatum)} · ${basar.ort || ''}`.replace(/ · $/, '');
    $('dashboardTotal').textContent = basar.max_tische;
    $('dashboardBooked').textContent = bookedTables;
    $('dashboardFree').textContent = freeTables;

    const rows = $('bookingRows');
    if (!bookings || bookings.length === 0) {
      rows.innerHTML = '<tr><td colspan="9">Noch keine Buchungen vorhanden.</td></tr>';
      return;
    }

    rows.innerHTML = bookings.map(row => {
      const category = row.verkaufsbereich === 'kinder' ? 'Kinder' : 'Erwachsene';
      const payment = row.zahlungsart === 'paypal' ? 'PayPal' : 'Überweisung';
      const status = row.zahlungsstatus === 'bezahlt' ? 'Bezahlt' : row.zahlungsstatus === 'storniert' ? 'Storniert' : 'Offen';
      return `
        <tr>
          <td><strong>${escapeHtml(row.buchungsnummer)}</strong></td>
          <td>${escapeHtml(`${row.vorname} ${row.nachname}`)}</td>
          <td>${row.anzahl_tische}</td>
          <td>${category}</td>
          <td>${row.kuchenspende ? 'Ja' : 'Nein'}</td>
          <td>${euro(row.preis)}</td>
          <td>${payment}</td>
          <td>${formatDate(row.zahlungsfrist)}</td>
          <td><span class="badge">${status}</span></td>
        </tr>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function showDashboard() {
    const admin = await isAdmin();
    if (!admin) {
      await supabaseClient.auth.signOut();
      $('loginCard').classList.remove('hidden');
      $('dashboard').classList.add('hidden');
      showLoginError('Dieses Konto ist nicht als Veranstalter freigeschaltet.');
      return;
    }

    $('loginCard').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    await loadBasarAndBookings();
  }

  $('loginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    clearErrors();
    $('loginButton').disabled = true;
    $('loginButton').textContent = 'Anmeldung läuft …';

    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value
      });

      if (error) {
        showLoginError('Anmeldung fehlgeschlagen. Bitte E-Mail-Adresse und Passwort prüfen.');
        return;
      }

      await showDashboard();
    } catch (error) {
      console.error(error);
      showLoginError('Das Dashboard konnte nicht geladen werden.');
    } finally {
      $('loginButton').disabled = false;
      $('loginButton').textContent = 'Anmelden';
    }
  });

  $('logoutButton')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    $('dashboard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
    $('loginForm').reset();
  });

  $('refreshButton')?.addEventListener('click', async () => {
    try {
      $('refreshButton').disabled = true;
      $('refreshButton').textContent = 'Lädt …';
      await loadBasarAndBookings();
    } catch (error) {
      console.error(error);
      showDashboardError('Die Buchungen konnten nicht aktualisiert werden.');
    } finally {
      $('refreshButton').disabled = false;
      $('refreshButton').textContent = 'Aktualisieren';
    }
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (!session) return;
    setTimeout(() => showDashboard().catch(console.error), 0);
  });

  (async function init() {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) await showDashboard();
    } catch (error) {
      console.error(error);
    }
  })();
})();
