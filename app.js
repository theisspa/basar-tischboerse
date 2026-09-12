const SUPABASE_URL = 'https://byvsockfobnrqzkxvap.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_iLXVfFOYROoBHwwhQcoEKg_N7ABYWSx';
const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const prices = { 1: 12, 2: 20, 3: 25 };
const euro = value => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const $ = id => document.getElementById(id);
function selectedValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

let currentBasar = null;
let currentFreeTables = 0;

function updatePrice() {
  const tables = Number(selectedValue('tables'));
  const cake = $('cake').checked;
  const base = prices[tables];
  const discount = cake ? 4 : 0;
  $('basePrice').textContent = euro(base);
  $('discount').textContent = `-${euro(discount)}`;
  $('totalPrice').textContent = euro(base - discount);
}

function updateAvailability(free) {
  currentFreeTables = free;
  $('availableTables').textContent = free;
  $('dashboardFree').textContent = free;
  if (currentBasar) {
    $('dashboardBooked').textContent = Math.max(0, currentBasar.max_tische - free);
    $('dashboardTotal').textContent = currentBasar.max_tische;
  }
  document.querySelectorAll('input[name="tables"]').forEach(input => {
    const choice = input.closest('.choice');
    const tables = Number(input.value);
    input.disabled = tables > free;
    choice?.classList.toggle('disabled', tables > free);
  });
}

function formatDate(dateString) {
  if (!dateString) return '';
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${dateString}T12:00:00`));
}

async function loadBasar() {
  const { data, error } = await supabase
    .from('basare')
    .select('id,name,ort,veranstaltungsdatum,max_tische,aktiv')
    .eq('aktiv', true)
    .order('veranstaltungsdatum', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('Noch kein aktiver Basar angelegt.');
  }
  currentBasar = data;

  $('basarName').textContent = data.name;
  $('basarDetails').textContent = `${formatDate(data.veranstaltungsdatum)} · ${data.ort || ''}`.replace(/ · $/, '');
  $('dashboardTotal').textContent = data.max_tische;

  await loadAvailability();
}

async function loadAvailability() {
  if (!currentBasar) return;
  const { data, error } = await supabase.rpc('get_basar_availability', { p_basar_id: currentBasar.id });
  if (error) throw error;
  updateAvailability(Number(data.free_tables));
}

function setLoading(loading) {
  $('submitButton').disabled = loading;
  $('submitButton').textContent = loading ? 'Buchung wird gespeichert …' : 'Verbindlich buchen';
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

document.querySelectorAll('input[name="tables"], #cake').forEach(el => el.addEventListener('change', updatePrice));

$('bookingForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearError();

  if (!currentBasar) {
    showError('Dieser Basar ist derzeit nicht verfügbar.');
    return;
  }

  const tables = Number(selectedValue('tables'));
  if (tables > currentFreeTables) {
    showError(`Diese Buchung ist nicht möglich. Es sind nur noch ${currentFreeTables} Tische frei.`);
    await loadAvailability();
    return;
  }

  setLoading(true);

  const payload = {
    p_basar_id: currentBasar.id,
    p_anzahl_tische: tables,
    p_verkaufsbereich: selectedValue('category') === 'Kinder' ? 'kinder' : 'erwachsene',
    p_kuchenspende: $('cake').checked,
    p_vorname: $('firstName').value.trim(),
    p_nachname: $('lastName').value.trim(),
    p_strasse: $('street').value.trim(),
    p_hausnummer: $('houseNumber').value.trim(),
    p_plz: $('zip').value.trim(),
    p_ort: $('city').value.trim(),
    p_email: $('email').value.trim(),
    p_telefon: $('phone').value.trim(),
    p_zahlungsart: $('payment').value
  };

  const { data, error } = await supabase.rpc('create_buchung', payload);

  if (error) {
    if ((error.message || '').toLowerCase().includes('nicht genuegend')) {
      showError('Leider sind die gewünschten Tische inzwischen ausgebucht. Bitte wählen Sie eine kleinere Anzahl.');
      await loadAvailability();
    } else {
      showError('Die Buchung konnte gerade nicht gespeichert werden. Bitte versuchen Sie es erneut.');
      console.error(error);
    }
    setLoading(false);
    return;
  }

  const booking = data?.[0] || data;
  const total = Number(booking.preis);
  const deadline = formatDate(booking.zahlungsfrist);

  $('confirmationText').textContent = `${payload.p_vorname} ${payload.p_nachname}, deine Buchung über ${tables} ${tables === 1 ? 'Tisch' : 'Tische'} für den Bereich ${payload.p_verkaufsbereich === 'kinder' ? 'Kinder' : 'Erwachsene'} wurde verbindlich gespeichert. Gesamtbetrag: ${euro(total)}. Zahlungsfrist: ${deadline}.`;
  $('bookingNumber').textContent = booking.buchungsnummer;
  $('paymentInfo').textContent = payload.p_zahlungsart === 'paypal'
    ? 'Bitte nutze die PayPal-Zahlungsmöglichkeit nach der Buchungsbestätigung.'
    : `Bitte überweise ${euro(total)} innerhalb von 14 Tagen. Die Bankverbindung wird dir mit den Buchungsunterlagen mitgeteilt.`;

  $('booking').classList.add('hidden');
  $('confirmation').classList.remove('hidden');
  setLoading(false);
  await loadAvailability();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('newBookingButton').addEventListener('click', () => {
  $('bookingForm').reset();
  clearError();
  updatePrice();
  $('confirmation').classList.add('hidden');
  $('booking').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('printButton').addEventListener('click', () => window.print());

(async function init() {
  try {
    await loadBasar();
    updatePrice();
  } catch (error) {
    console.error(error);
    $('basarName').textContent = 'Noch kein Basar veröffentlicht';
    $('basarDetails').textContent = 'Der Veranstalter muss zuerst einen aktiven Basar anlegen.';
    updateAvailability(0);
    document.querySelectorAll('input[name="tables"]').forEach(input => input.disabled = true);
    $('submitButton').disabled = true;
    $('submitButton').textContent = 'Derzeit nicht verfügbar';
  }
})();
