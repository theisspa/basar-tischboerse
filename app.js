const state = { totalTables: 50, bookedTables: 13 };
const prices = {1:12, 2:20, 3:25};
const euro = value => value.toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const $ = id => document.getElementById(id);
function selectedValue(name){ return document.querySelector(`input[name="${name}"]:checked`).value; }
function updatePrice(){
  const tables = Number(selectedValue('tables'));
  const cake = $('cake').checked;
  const base = prices[tables];
  const discount = cake ? 4 : 0;
  $('basePrice').textContent = euro(base);
  $('discount').textContent = `-${euro(discount)}`;
  $('totalPrice').textContent = euro(base-discount);
}
function updateAvailability(){
  const free = state.totalTables - state.bookedTables;
  $('availableTables').textContent = free;
  $('dashboardBooked').textContent = state.bookedTables;
  $('dashboardFree').textContent = free;
}
document.querySelectorAll('input[name="tables"], #cake').forEach(el=>el.addEventListener('change',updatePrice));
$('bookingForm').addEventListener('submit', e=>{
  e.preventDefault();
  const tables = Number(selectedValue('tables'));
  const free = state.totalTables-state.bookedTables;
  if(tables>free){ alert(`Diese Buchung ist nicht möglich. Es sind nur noch ${free} Tische frei.`); return; }
  const first = $('firstName').value.trim();
  const last = $('lastName').value.trim();
  const category = selectedValue('category');
  const cake = $('cake').checked;
  const total = prices[tables]-(cake?4:0);
  const number = `B-2026-${String(Math.floor(Math.random()*90000)+10000)}`;
  state.bookedTables += tables;
  updateAvailability();
  $('confirmationText').textContent = `${first} ${last}, du hast ${tables} ${tables===1?'Tisch':'Tische'} für den Bereich ${category} verbindlich reserviert. Gesamtbetrag: ${euro(total)}. Deine Unterlagen werden nach Abschluss der Buchung per E-Mail versendet.`;
  $('bookingNumber').textContent = number;
  $('booking').classList.add('hidden');
  $('confirmation').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'smooth'});
});
$('newBookingButton').addEventListener('click',()=>{ $('bookingForm').reset(); updatePrice(); $('confirmation').classList.add('hidden'); $('booking').classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'}); });
$('printButton').addEventListener('click',()=>window.print());
updatePrice(); updateAvailability();
