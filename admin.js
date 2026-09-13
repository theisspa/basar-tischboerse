(() => {
  'use strict';
  const config = window.BASAR_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    console.error('Basar-Konfiguration oder Supabase-Bibliothek fehlt.'); return;
  }
  const supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const $ = id => document.getElementById(id);
  const euro = value => Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  let currentUser = null, basare = [], bookings = [], allBookings = [], selectedBasarId = null, selectedBooking = null;
  let profileExists = false, onboardingMode = false, profileSnapshot = null;
  let isPlatformAdmin = false, platformAccounts = [];

  function formatDate(value) { if (!value) return ''; return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
  function formatDateTime(value) { if (!value) return ''; return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  function deadlineInfo(row) {
    if (!row || row.zahlungsstatus !== 'offen' || !row.zahlungsfrist) return { state: 'normal', text: '', days: null };
    const today = new Date(); today.setHours(0,0,0,0);
    const deadline = new Date(`${row.zahlungsfrist}T00:00:00`);
    if (Number.isNaN(deadline.getTime())) return { state: 'normal', text: '', days: null };
    const days = Math.round((deadline.getTime() - today.getTime()) / 86400000);
    if (days < 0) return { state: 'overdue', text: `${Math.abs(days)} ${Math.abs(days) === 1 ? 'Tag' : 'Tage'} überfällig`, days };
    if (days === 0) return { state: 'today', text: 'Heute fällig', days };
    return { state: 'open', text: days === 1 ? 'Noch 1 Tag' : `Noch ${days} Tage`, days };
  }
  function bookingStatusInfo(row) {
    if (row?.zahlungsstatus === 'bezahlt') return ['Bezahlt','bezahlt'];
    if (row?.zahlungsstatus === 'storniert') return ['Storniert','storniert'];
    if (row?.zahlungsstatus === 'abgelaufen') return ['Frist abgelaufen','abgelaufen'];
    const deadline = deadlineInfo(row);
    if (deadline.state === 'overdue') return ['Überfällig','ueberfaellig'];
    if (deadline.state === 'today') return ['Heute fällig','heute'];
    return ['Offen','offen'];
  }
  function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
  function showError(id, message) { const box=$(id); box.textContent=message; box.classList.remove('hidden'); }
  function clearError(id) { const box=$(id); box.textContent=''; box.classList.add('hidden'); }
  function humanizeError(error) { const m=error?.message || String(error || 'Unbekannter Fehler.'); if (/permission|row-level security|not authorized/i.test(m)) return 'Keine Berechtigung für diese Aktion.'; if (/nicht genuegend/i.test(m)) return 'Nicht genügend freie Tische vorhanden.'; return m; }
  function hasValidCoordinates(value) {
    const latRaw = value?.latitude;
    const lonRaw = value?.longitude;
    if (latRaw === null || latRaw === undefined || latRaw === '' || lonRaw === null || lonRaw === undefined || lonRaw === '') return false;
    const lat = Number(latRaw), lon = Number(lonRaw);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function approvalStatus() { return profileSnapshot?.freigabestatus || (profileExists ? 'ausstehend' : null); }
  function isApprovedOrganizer() { return approvalStatus() === 'freigegeben'; }

  function renderAccountStatus() {
    const box = $('accountStatusBanner');
    if (!box || !profileExists) { if (box) box.classList.add('hidden'); return; }
    const status = approvalStatus();
    box.classList.remove('hidden','approved','pending','blocked');
    const chip = $('accountStatusChip'), icon = $('accountStatusIcon'), title = $('accountStatusTitle'), text = $('accountStatusText');
    if (status === 'freigegeben') {
      box.classList.add('approved'); chip.textContent = 'Freigegeben'; icon.textContent = '✓'; title.textContent = 'Veranstalterkonto freigegeben';
      text.textContent = 'Du kannst deine aktiven Basare selbst öffentlich auf der Basar Tischbörse anzeigen oder als Entwurf speichern.';
    } else if (status === 'gesperrt') {
      box.classList.add('blocked'); chip.textContent = 'Gesperrt'; icon.textContent = '!'; title.textContent = 'Veranstalterkonto gesperrt';
      text.textContent = profileSnapshot?.sperrgrund ? `Grund: ${profileSnapshot.sperrgrund}` : 'Deine Basare sind derzeit nicht öffentlich sichtbar. Bitte wende dich an den Plattformbetreiber.';
    } else {
      box.classList.add('pending'); chip.textContent = 'Prüfung ausstehend'; icon.textContent = '…'; title.textContent = 'Freigabe wird geprüft';
      text.textContent = 'Du kannst dein Profil und deine Basare bereits vorbereiten. Öffentlich sichtbar werden Basare erst nach Freigabe deines Veranstalterkontos.';
    }
    updatePublicationControls();
  }

  function updatePublicationControls() {
    const checkbox = $('basarPublished'), hint = $('basarPublicationHint');
    if (!checkbox || !hint) return;
    const status = approvalStatus();
    const approved = status === 'freigegeben';
    checkbox.disabled = !approved;
    if (approved) hint.textContent = 'Wenn aktiviert und der Buchungsstatus auf „Aktiv“ steht, erscheint der Basar öffentlich in Suche und Umkreissuche.';
    else if (status === 'gesperrt') hint.textContent = 'Veröffentlichung ist gesperrt. Deine bestehenden Daten bleiben erhalten, sind aber nicht öffentlich sichtbar.';
    else hint.textContent = 'Die Veröffentlichung wird nach Freigabe deines Veranstalterkontos freigeschaltet.';
  }

  async function geocodeBasarLocation(plz, stadt) {
    const query = [plz, stadt, 'Deutschland'].filter(Boolean).join(' ');
    if (!query.trim() || (!plz && !stadt)) return null;
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('countrycodes', 'de');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', query);
    const response = await fetch(url, { headers: { 'Accept-Language': 'de' } });
    if (!response.ok) return null;
    const results = await response.json();
    const hit = Array.isArray(results) ? results[0] : null;
    const latitude = Number(hit?.lat), longitude = Number(hit?.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  }

  function setAuthMode(mode) {
    const login = mode === 'login';
    $('loginPanel').classList.toggle('hidden', !login);
    $('registerPanel').classList.toggle('hidden', login);
    $('showLoginButton').classList.toggle('active', login);
    $('showRegisterButton').classList.toggle('active', !login);
    clearError('loginError'); clearError('registerError');
  }

  function applyDashboardMode() {
    const locked = !profileExists;
    onboardingMode = locked;
    $('onboardingBanner').classList.toggle('hidden', !locked);
    $('basarListCard').classList.toggle('hidden', locked);
    $('basarFormCard').classList.add('hidden');
    $('selectedBasarCard').classList.toggle('hidden', locked || !selectedBasarId);
    $('bookingCard').classList.toggle('hidden', locked || !selectedBasarId);
    if (locked) {
      $('onboardingTitle').textContent = 'Willkommen bei der Basar Tischbörse';
      $('onboardingText').textContent = 'Schritt 1 von 2: Vervollständige zuerst deine Veranstalterdaten. Danach legst du deinen ersten Basar an.';
      $('saveProfileButton').textContent = 'Veranstalterdaten speichern und weiter';
      setTimeout(() => $('profileName').focus(), 0);
    } else {
      $('saveProfileButton').textContent = 'Veranstalterdaten speichern';
    }
  }

  async function loadProfile() {
    clearError('profileError');
    const { data, error } = await supabase.from('veranstalter').select('*').eq('user_id', currentUser.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      $('profileForm').reset();
      $('profileEmail').value = currentUser.email || '';
      $('profileTransferActive').checked = false;
      $('profilePaypalLinkActive').checked = false;
      $('profileApiPayPalStatus').dataset.active = 'false';
      $('profileApiPayPalStatus').textContent = 'Direkter PayPal-Checkout ist für dieses Konto nicht freigeschaltet.';
      profileSnapshot = null;
      return false;
    }
    $('profileName').value = data.name || '';
    $('profileStreet').value = data.strasse || '';
    $('profileHouseNumber').value = data.hausnummer || '';
    $('profileZip').value = data.plz || '';
    $('profileCity').value = data.ort || '';
    $('profilePhone').value = data.telefon || '';
    $('profileEmail').value = data.email || currentUser.email || '';
    $('profileAccountHolder').value = data.kontoinhaber || '';
    $('profileIban').value = data.iban || '';
    $('profileTransferActive').checked = data.ueberweisung_aktiv === true;
    $('profilePaypalLinkActive').checked = data.paypal_link_aktiv === true;
    $('profilePaypalLink').value = data.paypal_link || '';
    $('profileApiPayPalStatus').dataset.active = data.paypal_api_aktiv ? 'true' : 'false';
    $('profileApiPayPalStatus').textContent = data.paypal_api_aktiv ? 'Direkter PayPal-Checkout ist für dieses Konto freigeschaltet.' : 'Direkter PayPal-Checkout ist für dieses Konto nicht freigeschaltet.';
    profileSnapshot = data;
    return true;
  }

  async function saveProfile(event) {
    event.preventDefault(); clearError('profileError');
    const payload = {
      user_id: currentUser.id,
      name: $('profileName').value.trim(), strasse: $('profileStreet').value.trim(), hausnummer: $('profileHouseNumber').value.trim(),
      plz: $('profileZip').value.trim(), ort: $('profileCity').value.trim(), telefon: $('profilePhone').value.trim() || null,
      email: $('profileEmail').value.trim(), kontoinhaber: $('profileAccountHolder').value.trim() || null,
      iban: $('profileIban').value.trim() || null,
      ueberweisung_aktiv: $('profileTransferActive').checked,
      paypal_link_aktiv: $('profilePaypalLinkActive').checked,
      paypal_link: $('profilePaypalLink').value.trim() || null,
      updated_at: new Date().toISOString()
    };
    if (!payload.name || !payload.strasse || !payload.hausnummer || !payload.plz || !payload.ort || !payload.email) {
      return showError('profileError', 'Bitte alle Pflichtfelder der Veranstalterdaten ausfüllen.');
    }
    if (payload.ueberweisung_aktiv && !payload.iban) return showError('profileError', 'Für Überweisung bitte eine IBAN hinterlegen.');
    if (payload.paypal_link_aktiv && !/^https:\/\/(?:www\.)?(?:paypal\.me|paypal\.com)\//i.test(payload.paypal_link || '')) return showError('profileError', 'Bitte einen gültigen HTTPS-PayPal-Link (paypal.me oder paypal.com) hinterlegen.');
    const apiPayPalActive = $('profileApiPayPalStatus').dataset.active === 'true';
    if (!payload.ueberweisung_aktiv && !payload.paypal_link_aktiv && !apiPayPalActive) return showError('profileError', 'Bitte mindestens eine Zahlungsart aktivieren.');
    const wasOnboarding = onboardingMode;
    const button=$('saveProfileButton'); button.disabled=true; button.textContent='Speichert …';
    try {
      const { error } = await supabase.from('veranstalter').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      profileExists = true; onboardingMode = false;
      await loadProfile();
      button.textContent='Gespeichert ✓';
      applyDashboardMode();
      renderAccountStatus();
      if (wasOnboarding) {
        await loadBasare();
        $('onboardingBanner').classList.remove('hidden');
        $('onboardingTitle').textContent = 'Schritt 2 von 2: Ersten Basar anlegen';
        $('onboardingText').textContent = 'Deine Veranstalterdaten sind gespeichert. Lege jetzt deinen ersten Basar mit Preisen und Buchungsregeln an.';
        startNewBasar();
      } else {
        renderDashboardOverview();
      }
      setTimeout(() => { button.textContent='Veranstalterdaten speichern'; }, 1500);
    } catch (error) { console.error(error); showError('profileError', humanizeError(error)); button.textContent='Veranstalterdaten speichern'; }
    finally { button.disabled=false; }
  }

  function bookingBlocksTable(r) { return ['offen','bezahlt'].includes(r.zahlungsstatus); }

  function getBasarBookingStats(basarId) {
    const rows = allBookings.filter(r => Number(r.basar_id) === Number(basarId));
    const blocking = rows.filter(bookingBlocksTable);
    return {
      rows,
      reserved: blocking.reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0),
      childrenReserved: blocking.filter(r=>r.verkaufsbereich==='kinder').reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0),
      adultsReserved: blocking.filter(r=>r.verkaufsbereich==='erwachsene').reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0),
      open: rows.filter(r=>r.zahlungsstatus==='offen').length,
      paid: rows.filter(r=>r.zahlungsstatus==='bezahlt').length,
      paidAmount: rows.filter(r=>r.zahlungsstatus==='bezahlt').reduce((sum,r)=>sum+Number(r.preis||0),0)
    };
  }

  function renderDashboardOverview() {
    const box = $('dashboardOverview');
    if (!profileExists) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const activeBasars = basare.filter(b=>b.aktiv);
    const publicBasars = basare.filter(b=>b.aktiv && b.veroeffentlicht && isApprovedOrganizer());
    const openRows = allBookings.filter(r=>r.zahlungsstatus==='offen');
    const paidRows = allBookings.filter(r=>r.zahlungsstatus==='bezahlt');
    const reserved = allBookings.filter(bookingBlocksTable).reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0);
    const capacity = basare.reduce((sum,b)=>sum+Number(b.max_tische||0),0);
    const now = new Date(); now.setHours(0,0,0,0);
    const upcoming = activeBasars.filter(b=>new Date(`${b.veranstaltungsdatum}T12:00:00`)>=now).sort((a,b)=>String(a.veranstaltungsdatum).localeCompare(String(b.veranstaltungsdatum)))[0];
    $('overviewActiveBasars').textContent = activeBasars.length;
    $('overviewNextBasar').textContent = upcoming ? `Nächster Termin: ${formatDate(upcoming.veranstaltungsdatum)}` : (basare.length ? 'Kein aktiver zukünftiger Termin' : 'Noch kein Basar angelegt');
    $('overviewOpenPayments').textContent = openRows.length;
    const overdueRows = openRows.filter(r=>deadlineInfo(r).state==='overdue');
    $('overviewOpenAmount').textContent = `${euro(openRows.reduce((sum,r)=>sum+Number(r.preis||0),0))} offen${overdueRows.length ? ` · ${overdueRows.length} überfällig` : ''}`;
    $('overviewPaidBookings').textContent = paidRows.length;
    $('overviewPaidAmount').textContent = `${euro(paidRows.reduce((sum,r)=>sum+Number(r.preis||0),0))} bezahlt`;
    $('overviewReservedTables').textContent = reserved;
    $('overviewTotalCapacity').textContent = capacity ? `von ${capacity} Tischplätzen` : 'Noch keine Kapazität';

    const issues = [];
    const p = profileSnapshot || {};
    if (!p.telefon) issues.push('Telefonnummer fehlt im Veranstalterprofil.');
    if (!p.ueberweisung_aktiv && !p.paypal_link_aktiv && !p.paypal_api_aktiv) issues.push('Keine Zahlungsart ist aktiviert.');
    if (p.ueberweisung_aktiv && !p.iban) issues.push('Überweisung ist aktiv, aber es ist keine IBAN hinterlegt.');
    if (p.paypal_link_aktiv && !p.paypal_link) issues.push('PayPal-Link ist aktiv, aber kein Link hinterlegt.');
    if (!basare.length) issues.push('Lege deinen ersten Basar an.');
    else if (!publicBasars.length) issues.push(isApprovedOrganizer() ? 'Aktuell ist kein Basar öffentlich sichtbar.' : 'Dein Veranstalterkonto ist noch nicht für öffentliche Basare freigegeben.');
    const health = $('dashboardHealth');
    if (issues.length) {
      health.className = 'dashboard-health warning';
      health.innerHTML = `<strong>${issues.length===1?'Hinweis':'Hinweise'}</strong><span>${issues.map(escapeHtml).join(' · ')}</span>`;
    } else {
      health.className = 'dashboard-health good';
      health.innerHTML = '<strong>Alles bereit</strong><span>Profil, Zahlungsarten und mindestens ein öffentlicher Basar sind vollständig eingerichtet.</span>';
    }
  }

  async function loadDashboardOverview() {
    if (!basare.length) { allBookings = []; renderDashboardOverview(); renderBasarList(); return; }
    const ids = basare.map(b=>b.id);
    const { data, error } = await supabase.from('buchungen').select('id,basar_id,anzahl_tische,verkaufsbereich,preis,zahlungsstatus,zahlungsfrist,created_at').in('basar_id', ids);
    if (error) throw error;
    allBookings = data || [];
    renderDashboardOverview();
    renderBasarList();
  }

  async function loadBasare() {
    clearError('basarError');
    const { data, error } = await supabase.from('basare').select('id,name,ort,plz,stadt,latitude,longitude,veranstaltungsdatum,max_tische,aktiv,veroeffentlicht,veroeffentlicht_at,created_at,veranstalter_id,preis_1_tisch,preis_2_tische,preis_3_tische,kuchenrabatt,zahlungsfrist_tage,kurzfristig_ab_tage,kurzfristige_zahlungsfrist_tage,stornofrist_tage,kuchennachgebuehr,uebertragung_erlaubt,zusatzregeln,verkaufsbereiche,kontingent_modus,max_tische_kinder,max_tische_erwachsene').eq('veranstalter_id', currentUser.id).order('veranstaltungsdatum', { ascending: true });
    if (error) throw error;
    basare=data || [];
    if (!selectedBasarId || !basare.some(b => b.id === selectedBasarId)) { const active=basare.find(b=>b.aktiv) || basare[0]; selectedBasarId=active?.id || null; }
    await loadDashboardOverview();
    if (selectedBasarId) {
      $('onboardingBanner').classList.add('hidden');
      await loadSelectedBasar();
    } else {
      clearSelectedBasar();
      if (profileExists) {
        $('onboardingBanner').classList.remove('hidden');
        $('onboardingTitle').textContent = 'Schritt 2 von 2: Ersten Basar anlegen';
        $('onboardingText').textContent = 'Dein Veranstalterprofil ist bereit. Lege jetzt deinen ersten Basar mit Preisen und Buchungsregeln an.';
      }
    }
  }

  function renderBasarList() {
    const el=$('basarList');
    if (!basare.length) { el.innerHTML='<div class="empty-state">Noch kein Basar vorhanden. Lege deinen ersten Basar an.</div>'; return; }
    const organizerStatus = approvalStatus();
    el.innerHTML=basare.map(b=>{
      const st=getBasarBookingStats(b.id), max=Number(b.max_tische||0), full=max>0&&st.reserved>=max;
      let statusText='Entwurf', statusClass='draft';
      if (organizerStatus==='gesperrt') { statusText='Gesperrt'; statusClass='blocked'; }
      else if (!b.veroeffentlicht) { statusText='Entwurf'; statusClass='draft'; }
      else if (organizerStatus!=='freigegeben') { statusText='Wartet auf Freigabe'; statusClass='pending'; }
      else if (!b.aktiv) { statusText='Inaktiv'; statusClass='inactive'; }
      else if (full) { statusText='Ausgebucht'; statusClass='full'; }
      else { statusText='Öffentlich'; statusClass='active'; }
      const publication = b.veroeffentlicht ? 'Veröffentlichung aktiviert' : 'Nicht öffentlich';
      const areaText = b.verkaufsbereiche === 'kinder' ? 'Nur Kinder' : b.verkaufsbereiche === 'erwachsene' ? 'Nur Erwachsene' : (b.kontingent_modus === 'getrennt' ? `Kinder ${Number(b.max_tische_kinder||0)} · Erwachsene ${Number(b.max_tische_erwachsene||0)}` : 'Kinder & Erwachsene · gemeinsamer Pool');
      return `<button class="basar-list-item ${b.id===selectedBasarId?'selected':''}" data-basar-id="${b.id}" type="button"><div class="basar-list-main"><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(formatDate(b.veranstaltungsdatum))}${b.ort?' · '+escapeHtml(b.ort):''}</span><small>${st.reserved} von ${max} Tischen reserviert · ${escapeHtml(areaText)} · ${st.open} offen · ${st.paid} bezahlt · ${publication}${hasValidCoordinates(b)?' · 📍 Umkreissuche bereit':' · ⚠ Standort neu speichern'}</small></div><span class="status-chip ${statusClass}">${statusText}</span></button>`;
    }).join('');
    el.querySelectorAll('[data-basar-id]').forEach(btn=>btn.addEventListener('click', async()=>{ selectedBasarId=Number(btn.dataset.basarId); renderBasarList(); try{await loadSelectedBasar();}catch(e){console.error(e);showError('basarError',humanizeError(e));} }));
  }

  async function loadSelectedBasar() {
    const basar=basare.find(b=>b.id===selectedBasarId); if (!basar) return clearSelectedBasar();
    $('selectedBasarCard').classList.remove('hidden'); $('bookingCard').classList.remove('hidden');
    $('dashboardTitle').textContent=basar.name; const visibility = basar.veroeffentlicht && isApprovedOrganizer() ? (basar.aktiv ? 'Öffentlich' : 'Veröffentlicht, aber inaktiv') : (approvalStatus()==='gesperrt' ? 'Nicht sichtbar · Konto gesperrt' : basar.veroeffentlicht ? 'Wartet auf Freigabe' : 'Entwurf'); $('dashboardDetails').textContent=`${formatDate(basar.veranstaltungsdatum)} · ${basar.ort||''}`.replace(/ · $/,'')+` · ${visibility}`; $('dashboardTotal').textContent=basar.max_tische;
    await loadBookings();
  }
  function clearSelectedBasar(){ $('selectedBasarCard').classList.add('hidden'); $('bookingCard').classList.add('hidden'); }

  async function loadBookings() {
    clearError('dashboardError');
    if (selectedBasarId) await supabase.rpc('get_basar_availability', { p_basar_id: selectedBasarId });
    const { data, error } = await supabase.from('buchungen').select('id,buchungsnummer,anzahl_tische,verkaufsbereich,kuchenspende,preis,vorname,nachname,strasse,hausnummer,plz,ort,email,telefon,zahlungsart,zahlungsstatus,zahlungsfrist,email_status,email_sent_at,email_last_error,veranstalter_email_status,veranstalter_email_sent_at,veranstalter_email_last_error,created_at').eq('basar_id',selectedBasarId).order('created_at',{ascending:false});
    if (error) throw error; bookings=data||[]; updateStats(); renderBookings();
  }

  function updateStats() {
    const basar=basare.find(b=>b.id===selectedBasarId); if(!basar)return;
    const blocking=bookings.filter(bookingBlocksTable);
    const booked=blocking.reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0);
    const max=Number(basar.max_tische||0);
    const free=Math.max(0,max-booked);
    const open=bookings.filter(r=>r.zahlungsstatus==='offen').length;
    const paidRows=bookings.filter(r=>r.zahlungsstatus==='bezahlt');
    const paidAmount=paidRows.reduce((sum,r)=>sum+Number(r.preis||0),0);
    const percent=max?Math.min(100,Math.round((booked/max)*100)):0;
    $('dashboardBooked').textContent=booked; $('dashboardFree').textContent=free;
    const overdue=bookings.filter(r=>deadlineInfo(r).state==='overdue').length;
    $('dashboardOpen').textContent=open; $('dashboardOpen').title=overdue ? `${overdue} offene Zahlung${overdue===1?' ist':'en sind'} überfällig` : 'Keine überfälligen offenen Zahlungen';
    $('dashboardPaid').textContent=paidRows.length; $('dashboardRevenue').textContent=euro(paidAmount);
    $('dashboardCapacityText').textContent=`${booked} von ${max} · ${percent} %`;
    $('dashboardCapacityFill').style.width=`${percent}%`;
    const childrenBooked=blocking.filter(r=>r.verkaufsbereich==='kinder').reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0);
    const adultsBooked=blocking.filter(r=>r.verkaufsbereich==='erwachsene').reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0);
    const areaBox=$('dashboardAreaCapacity');
    if (basar.verkaufsbereiche==='kinder') {
      areaBox.innerHTML=`<span><strong>Kinder</strong>${childrenBooked} reserviert · ${Math.max(0,max-childrenBooked)} frei</span>`;
    } else if (basar.verkaufsbereiche==='erwachsene') {
      areaBox.innerHTML=`<span><strong>Erwachsene</strong>${adultsBooked} reserviert · ${Math.max(0,max-adultsBooked)} frei</span>`;
    } else if (basar.kontingent_modus==='getrennt') {
      const childMax=Number(basar.max_tische_kinder||0), adultMax=Number(basar.max_tische_erwachsene||0);
      areaBox.innerHTML=`<span><strong>🧸 Kinder</strong>${childrenBooked} / ${childMax} reserviert · ${Math.max(0,childMax-childrenBooked)} frei</span><span><strong>👕 Erwachsene</strong>${adultsBooked} / ${adultMax} reserviert · ${Math.max(0,adultMax-adultsBooked)} frei</span>`;
    } else {
      areaBox.innerHTML=`<span><strong>Kinder & Erwachsene</strong>Gemeinsamer Pool mit ${max} Tischen · ${free} frei</span>`;
    }
  }

  function paymentLabel(value) {
    if (value === 'paypal') return 'PayPal (online)';
    if (value === 'paypal_link') return 'PayPal-Link';
    return 'Überweisung';
  }

  function getFilteredBookings() {
    const statusFilter = $('bookingFilter').value;
    const paymentFilter = $('paymentFilter').value;
    const areaFilter = $('areaFilter').value;
    const cakeFilter = $('cakeFilter').value;
    const search = $('bookingSearch').value.trim().toLocaleLowerCase('de-DE');

    return bookings.filter(r => {
      const deadline = deadlineInfo(r);
      const fullName = `${r.vorname || ''} ${r.nachname || ''}`.trim().toLocaleLowerCase('de-DE');
      const bookingNumber = String(r.buchungsnummer || '').toLocaleLowerCase('de-DE');

      if (search && !fullName.includes(search) && !bookingNumber.includes(search)) return false;

      if (statusFilter === 'offen' && r.zahlungsstatus !== 'offen') return false;
      if (statusFilter === 'bezahlt' && r.zahlungsstatus !== 'bezahlt') return false;
      if (statusFilter === 'storniert' && r.zahlungsstatus !== 'storniert') return false;
      if (statusFilter === 'abgelaufen' && !(r.zahlungsstatus === 'abgelaufen' || deadline.state === 'overdue')) return false;
      if (statusFilter === 'heute' && deadline.state !== 'today') return false;

      if (paymentFilter !== 'alle' && r.zahlungsart !== paymentFilter) return false;
      if (areaFilter !== 'alle' && r.verkaufsbereich !== areaFilter) return false;
      if (cakeFilter === 'ja' && !r.kuchenspende) return false;
      if (cakeFilter === 'nein' && r.kuchenspende) return false;

      return true;
    });
  }

  function renderBookings() {
    const filtered = getFilteredBookings();
    $('bookingResultCount').textContent = filtered.length === bookings.length
      ? `${bookings.length} Buchung${bookings.length === 1 ? '' : 'en'}`
      : `${filtered.length} von ${bookings.length} Buchungen`;

    const rows=$('bookingRows');
    if(!filtered.length){rows.innerHTML='<tr><td colspan="10">Keine passenden Buchungen vorhanden.</td></tr>';return;}
    rows.innerHTML=filtered.map(r=>{
      const [statusText,statusClass]=bookingStatusInfo(r);
      const deadline=deadlineInfo(r);
      const rowClass = r.zahlungsstatus==='storniert' || r.zahlungsstatus==='abgelaufen' ? 'muted-row' : deadline.state==='overdue' ? 'overdue-row' : deadline.state==='today' ? 'due-today-row' : '';
      const deadlineClass = deadline.state==='overdue' ? 'deadline-overdue' : deadline.state==='today' ? 'deadline-today' : '';
      const deadlineSub = deadline.text ? `<small class="deadline-note ${deadlineClass}">${escapeHtml(deadline.text)}</small>` : '';
      return `<tr class="${rowClass}"><td><strong>${escapeHtml(r.buchungsnummer)}</strong></td><td>${escapeHtml(`${r.vorname} ${r.nachname}`)}</td><td>${r.anzahl_tische}</td><td>${r.verkaufsbereich==='kinder'?'Kinder':'Erwachsene'}</td><td>${r.kuchenspende?'Ja':'Nein'}</td><td>${euro(r.preis)}</td><td>${paymentLabel(r.zahlungsart)}</td><td>${formatDate(r.zahlungsfrist)}${deadlineSub}</td><td><span class="badge status-${statusClass}">${statusText}</span></td><td><button class="table-button" type="button" data-booking-id="${r.id}" data-action="open-booking">Öffnen</button></td></tr>`;
    }).join('');
  }

  function csvCell(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ');
    return `"${text.replaceAll('"','""')}"`;
  }

  function excelPhoneCell(value) {
    const phone = String(value ?? '').trim().replace(/[^0-9+()\-./ ]/g, '');
    if (!phone) return '';
    return `="${phone.replaceAll('"','""')}"`;
  }

  function resetBookingFilters() {
    $('bookingSearch').value = '';
    $('bookingFilter').value = 'alle';
    $('paymentFilter').value = 'alle';
    $('areaFilter').value = 'alle';
    $('cakeFilter').value = 'alle';
    renderBookings();
    $('bookingSearch').focus();
  }

  function exportFilteredBookings() {
    const rows = getFilteredBookings();
    if (!rows.length) {
      showError('dashboardError', 'Für die aktuelle Auswahl sind keine Buchungen zum Exportieren vorhanden.');
      return;
    }
    clearError('dashboardError');
    const header = ['Buchungsnummer','Vorname','Nachname','E-Mail','Telefon','Tische','Bereich','Kuchen','Betrag EUR','Zahlungsart','Zahlungsstatus','Zahlungsfrist','Buchung eingegangen'];
    const lines = [header, ...rows.map(r => [
      r.buchungsnummer,
      r.vorname,
      r.nachname,
      r.email,
      excelPhoneCell(r.telefon),
      r.anzahl_tische,
      r.verkaufsbereich === 'kinder' ? 'Kinder' : 'Erwachsene',
      r.kuchenspende ? 'Ja' : 'Nein',
      Number(r.preis || 0).toFixed(2).replace('.', ','),
      paymentLabel(r.zahlungsart),
      bookingStatusInfo(r)[0],
      r.zahlungsfrist || '',
      r.created_at ? formatDateTime(r.created_at) : ''
    ])].map(row => row.map(csvCell).join(';')).join('\r\n');

    const basar = basare.find(b => b.id === selectedBasarId);
    const safeName = String(basar?.name || 'basar').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'basar';
    const date = new Date().toISOString().slice(0,10);
    const blob = new Blob(['\ufeff' + lines], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `buchungen-${safeName}-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }


  function openBooking(id) {
    selectedBooking=bookings.find(b=>b.id===id)||null; if(!selectedBooking)return; const r=selectedBooking; const [status]=bookingStatusInfo(r); const deadline=deadlineInfo(r);
    $('bookingModalTitle').textContent=r.buchungsnummer;
    $('bookingDetails').innerHTML=`<div class="detail-item"><span>Name</span><strong>${escapeHtml(`${r.vorname} ${r.nachname}`)}</strong></div><div class="detail-item"><span>Bereich</span><strong>${r.verkaufsbereich==='kinder'?'Kinder':'Erwachsene'}</strong></div><div class="detail-item"><span>Tische</span><strong>${r.anzahl_tische}</strong></div><div class="detail-item"><span>Kuchen</span><strong>${r.kuchenspende?'Ja':'Nein'}</strong></div><div class="detail-item"><span>Betrag</span><strong>${euro(r.preis)}</strong></div><div class="detail-item"><span>Zahlung</span><strong>${r.zahlungsart==='paypal'?'PayPal (online)':r.zahlungsart==='paypal_link'?'PayPal-Link':'Überweisung'}</strong></div><div class="detail-item"><span>Status</span><strong>${status}</strong></div><div class="detail-item"><span>Zahlungsfrist</span><strong>${formatDate(r.zahlungsfrist)}${deadline.text?` · ${escapeHtml(deadline.text)}`:''}</strong></div><div class="detail-item full"><span>Adresse</span><strong>${escapeHtml(`${r.strasse} ${r.hausnummer}, ${r.plz} ${r.ort}`)}</strong></div><div class="detail-item"><span>E-Mail</span><strong>${escapeHtml(r.email)}</strong></div><div class="detail-item"><span>Telefon</span><strong>${escapeHtml(r.telefon||'—')}</strong></div><div class="detail-item"><span>E-Mail an Teilnehmer</span><strong>${r.email_status==='sent'?'Versendet':r.email_status==='error'?'Fehler':r.email_status==='sending'?'Wird gesendet':'Ausstehend'}${r.email_sent_at?` · ${formatDateTime(r.email_sent_at)}`:''}</strong></div><div class="detail-item"><span>E-Mail an Veranstalter</span><strong>${r.veranstalter_email_status==='sent'?'Versendet':r.veranstalter_email_status==='error'?'Fehler':r.veranstalter_email_status==='sending'?'Wird gesendet':'Ausstehend'}${r.veranstalter_email_sent_at?` · ${formatDateTime(r.veranstalter_email_sent_at)}`:''}</strong></div><div class="detail-item full"><span>Buchung eingegangen</span><strong>${formatDateTime(r.created_at)}</strong></div>`;
    $('markPaidButton').classList.toggle('hidden', ['bezahlt','storniert'].includes(r.zahlungsstatus)); $('markOpenButton').classList.toggle('hidden', r.zahlungsstatus!=='bezahlt'); $('cancelBookingButton').classList.toggle('hidden', r.zahlungsstatus==='storniert'); $('bookingModal').classList.remove('hidden');
  }
  function closeBooking(){ $('bookingModal').classList.add('hidden'); selectedBooking=null; }

  async function updateBookingStatus(status) {
    if(!selectedBooking)return; const label=status==='bezahlt'?'Zahlung als bezahlt markieren':status==='offen'?'Zahlung wieder öffnen':'Buchung stornieren'; if(!window.confirm(`${label}?`))return;
    const { error }=await supabase.from('buchungen').update({zahlungsstatus:status}).eq('id',selectedBooking.id); if(error){showError('dashboardError',humanizeError(error));return;} closeBooking(); await loadBookings(); await loadDashboardOverview();
  }

  document.addEventListener('click', async e=>{ const b=e.target.closest('[data-action]'); if(!b)return; const a=b.dataset.action; if(a==='open-booking')openBooking(Number(b.dataset.bookingId)); else if(a==='close-booking')closeBooking(); else if(a==='mark-paid')await updateBookingStatus('bezahlt'); else if(a==='mark-open')await updateBookingStatus('offen'); else if(a==='cancel-booking')await updateBookingStatus('storniert'); }, true);
  document.addEventListener('click',e=>{if(e.target===$('bookingModal'))closeBooking();}); document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBooking();});

  function updateBasarCapacityFields() {
    const areas=$('basarBereiche').value;
    const both=areas==='beide';
    $('kontingentModusField').classList.toggle('hidden', !both);
    if (!both) $('kontingentModus').value='gemeinsam';
    const split=both && $('kontingentModus').value==='getrennt';
    $('basarTischeKinderField').classList.toggle('hidden', !split);
    $('basarTischeErwachseneField').classList.toggle('hidden', !split);
    $('basarTische').readOnly=split;
    $('basarTischeLabel').textContent=split ? 'Tische insgesamt (automatisch)' : areas==='kinder' ? 'Tische für Kinder' : areas==='erwachsene' ? 'Tische für Erwachsene' : 'Maximale Tischanzahl';
    $('basarTischeHint').textContent=split ? 'Gesamtzahl wird automatisch aus Kinder- und Erwachsenentischen berechnet.' : both ? 'Kinder und Erwachsene teilen sich diese Tischanzahl.' : 'Diese Tischanzahl steht nur für den ausgewählten Bereich zur Verfügung.';
    if (split) {
      const children=Math.max(0,Number($('basarTischeKinder').value)||0);
      const adults=Math.max(0,Number($('basarTischeErwachsene').value)||0);
      $('basarTische').value=children+adults || '';
    }
  }

  function startNewBasar(){ clearError('basarError'); $('basarForm').reset(); $('basarId').value=''; $('basarFormTitle').textContent='Neuen Basar anlegen'; $('basarBereiche').value='beide'; $('kontingentModus').value='gemeinsam'; $('basarTische').value='50'; $('basarTischeKinder').value='30'; $('basarTischeErwachsene').value='20'; $('preis1Tisch').value='12.00'; $('preis2Tische').value='20.00'; $('preis3Tische').value='25.00'; $('kuchenrabatt').value='4.00'; $('zahlungsfristTage').value='14'; $('kurzfristigAbTage').value='14'; $('kurzfristigeZahlungsfristTage').value='3'; $('stornofristTage').value='14'; $('kuchennachgebuehr').value='10.00'; $('uebertragungErlaubt').value='true'; $('zusatzregeln').value=''; $('basarAktiv').value='true'; $('basarPublished').checked=false; updateBasarCapacityFields(); updatePublicationControls(); $('basarFormCard').classList.remove('hidden'); $('basarFormCard').scrollIntoView({behavior:'smooth',block:'start'}); }
  function editBasar(b){ clearError('basarError'); $('basarId').value=b.id; $('basarName').value=b.name||''; $('basarOrt').value=b.ort||''; $('basarPlz').value=b.plz||''; $('basarStadt').value=b.stadt||''; $('basarDatum').value=b.veranstaltungsdatum||''; $('basarBereiche').value=b.verkaufsbereiche||'beide'; $('kontingentModus').value=b.kontingent_modus||'gemeinsam'; $('basarTische').value=b.max_tische||''; $('basarTischeKinder').value=Number(b.max_tische_kinder||0) || ''; $('basarTischeErwachsene').value=Number(b.max_tische_erwachsene||0) || ''; $('preis1Tisch').value=Number(b.preis_1_tisch ?? 12).toFixed(2); $('preis2Tische').value=Number(b.preis_2_tische ?? 20).toFixed(2); $('preis3Tische').value=Number(b.preis_3_tische ?? 25).toFixed(2); $('kuchenrabatt').value=Number(b.kuchenrabatt ?? 4).toFixed(2); $('zahlungsfristTage').value=Number(b.zahlungsfrist_tage ?? 14); $('kurzfristigAbTage').value=Number(b.kurzfristig_ab_tage ?? 14); $('kurzfristigeZahlungsfristTage').value=Number(b.kurzfristige_zahlungsfrist_tage ?? 3); $('stornofristTage').value=Number(b.stornofrist_tage ?? 14); $('kuchennachgebuehr').value=Number(b.kuchennachgebuehr ?? 10).toFixed(2); $('uebertragungErlaubt').value=String(b.uebertragung_erlaubt ?? true); $('zusatzregeln').value=b.zusatzregeln || ''; $('basarAktiv').value=String(!!b.aktiv); $('basarPublished').checked=!!b.veroeffentlicht; updateBasarCapacityFields(); updatePublicationControls(); $('basarFormTitle').textContent='Basar bearbeiten'; $('basarFormCard').classList.remove('hidden'); $('basarFormCard').scrollIntoView({behavior:'smooth',block:'start'}); }

  async function saveBasar(event) {
    event.preventDefault(); clearError('basarError'); const id=$('basarId').value?Number($('basarId').value):null;
    const areas=$('basarBereiche').value;
    const split=areas==='beide' && $('kontingentModus').value==='getrennt';
    const childrenTables=split?Number($('basarTischeKinder').value):null;
    const adultsTables=split?Number($('basarTischeErwachsene').value):null;
    const totalTables=split?(childrenTables+adultsTables):Number($('basarTische').value);
    const payload={name:$('basarName').value.trim(),ort:$('basarOrt').value.trim()||null,plz:$('basarPlz').value.trim()||null,stadt:$('basarStadt').value.trim()||null,veranstaltungsdatum:$('basarDatum').value,max_tische:totalTables,verkaufsbereiche:areas,kontingent_modus:split?'getrennt':'gemeinsam',max_tische_kinder:split?childrenTables:null,max_tische_erwachsene:split?adultsTables:null,preis_1_tisch:Number($('preis1Tisch').value),preis_2_tische:Number($('preis2Tische').value),preis_3_tische:Number($('preis3Tische').value),kuchenrabatt:Number($('kuchenrabatt').value),zahlungsfrist_tage:Number($('zahlungsfristTage').value),kurzfristig_ab_tage:Number($('kurzfristigAbTage').value),kurzfristige_zahlungsfrist_tage:Number($('kurzfristigeZahlungsfristTage').value),stornofrist_tage:Number($('stornofristTage').value),kuchennachgebuehr:Number($('kuchennachgebuehr').value),uebertragung_erlaubt:$('uebertragungErlaubt').value==='true',zusatzregeln:$('zusatzregeln').value.trim()||null,aktiv:$('basarAktiv').value==='true',veroeffentlicht:$('basarPublished').checked,veranstalter_id:currentUser.id};
    if(!payload.name||!payload.veranstaltungsdatum||!Number.isInteger(payload.max_tische)||payload.max_tische<1)return showError('basarError','Bitte Name, Datum und eine gültige Tischanzahl ausfüllen.');
    if(split && (!Number.isInteger(childrenTables)||childrenTables<1||!Number.isInteger(adultsTables)||adultsTables<1))return showError('basarError','Bitte für Kinder und Erwachsene jeweils mindestens 1 Tisch festlegen.');
    if([payload.preis_1_tisch,payload.preis_2_tische,payload.preis_3_tische,payload.kuchenrabatt,payload.kuchennachgebuehr].some(v=>!Number.isFinite(v)||v<0))return showError('basarError','Bitte gültige Preise und Gebühren eingeben.');
    if([payload.zahlungsfrist_tage,payload.kurzfristig_ab_tage,payload.kurzfristige_zahlungsfrist_tage,payload.stornofrist_tage].some(v=>!Number.isInteger(v)||v<0||v>365))return showError('basarError','Bitte gültige Fristen zwischen 0 und 365 Tagen eingeben.');
    const btn=$('saveBasarButton');btn.disabled=true;btn.textContent='Standort wird ermittelt …';
    try {
      const existing=id?basare.find(b=>Number(b.id)===Number(id)):null;
      const locationChanged=!existing || String(existing.plz||'')!==String(payload.plz||'') || String(existing.stadt||'')!==String(payload.stadt||'');
      if (locationChanged || !hasValidCoordinates(existing)) {
        const coords=await geocodeBasarLocation(payload.plz,payload.stadt);
        payload.latitude=coords?.latitude ?? null;
        payload.longitude=coords?.longitude ?? null;
      }
      btn.textContent='Speichert …';
      if(id){const {error}=await supabase.from('basare').update(payload).eq('id',id).eq('veranstalter_id',currentUser.id);if(error)throw error;selectedBasarId=id;}
      else{const {data,error}=await supabase.from('basare').insert(payload).select('id').single();if(error)throw error;selectedBasarId=data.id;}
      $('basarFormCard').classList.add('hidden'); await loadBasare(); $('onboardingBanner').classList.add('hidden');
      if ((payload.plz || payload.stadt) && !hasValidCoordinates(payload) && (locationChanged || !existing)) {
        showError('basarError','Basar wurde gespeichert, aber der Standort konnte nicht automatisch für die Umkreissuche ermittelt werden. Bitte PLZ und Stadt prüfen und erneut speichern.');
      }
    } catch(e){console.error(e);showError('basarError',humanizeError(e));}
    finally{btn.disabled=false;btn.textContent='Basar speichern';}
  }

  async function loadPlatformAdminState() {
    isPlatformAdmin = false; platformAccounts = [];
    try {
      const { data, error } = await supabase.rpc('is_platform_admin');
      if (!error && (data === true || data?.is_platform_admin === true)) isPlatformAdmin = true;
    } catch (e) { console.warn('Plattformadmin-Prüfung nicht verfügbar.', e); }
    $('platformNavLink').classList.toggle('hidden', !isPlatformAdmin);
    $('platformAdminCard').classList.toggle('hidden', !isPlatformAdmin);
    if (isPlatformAdmin) await loadPlatformAccounts();
  }

  async function loadPlatformAccounts() {
    if (!isPlatformAdmin) return;
    clearError('platformError');
    const { data, error } = await supabase.rpc('platform_review_queue');
    if (error) { showError('platformError', humanizeError(error)); return; }
    platformAccounts = data || [];
    renderPlatformAccounts();
  }

  function platformStatusLabel(status) {
    if (status === 'freigegeben') return 'Freigegeben';
    if (status === 'gesperrt') return 'Gesperrt';
    return 'Ausstehend';
  }

  function renderPlatformAccounts() {
    if (!isPlatformAdmin) return;
    const pending = platformAccounts.filter(r=>r.freigabestatus==='ausstehend').length;
    const approved = platformAccounts.filter(r=>r.freigabestatus==='freigegeben').length;
    const blocked = platformAccounts.filter(r=>r.freigabestatus==='gesperrt').length;
    $('platformPendingCount').textContent=pending; $('platformApprovedCount').textContent=approved; $('platformBlockedCount').textContent=blocked;
    const filter=$('platformStatusFilter').value;
    const rows=platformAccounts.filter(r=>filter==='alle'||r.freigabestatus===filter);
    const el=$('platformReviewList');
    if(!rows.length){el.innerHTML='<div class="empty-state">Für diesen Filter gibt es keine Veranstalter.</div>';return;}
    el.innerHTML=rows.map(r=>{
      const basarItems=Array.isArray(r.basare)?r.basare:[];
      const basarHtml=basarItems.length?`<div class="platform-basar-list">${basarItems.map(b=>`<div><strong>${escapeHtml(b.name||'Basar')}</strong><span>${escapeHtml(formatDate(b.veranstaltungsdatum))}${b.stadt?' · '+escapeHtml(b.stadt):''} · ${b.aktiv?'aktiv':'inaktiv'}${b.veroeffentlicht?' · Veröffentlichung an':' · Entwurf'}</span></div>`).join('')}</div>`:'<div class="platform-no-basar">Noch kein Basar angelegt.</div>';
      const payment=[]; if(r.ueberweisung_aktiv)payment.push('Überweisung'); if(r.paypal_link_aktiv)payment.push('PayPal-Link'); if(r.paypal_api_aktiv)payment.push('PayPal online');
      return `<article class="platform-review-item status-${escapeHtml(r.freigabestatus)}" data-platform-user="${escapeHtml(r.user_id)}"><div class="platform-review-main"><div class="platform-review-title"><div><strong>${escapeHtml(r.name||'Ohne Namen')}</strong><span>${escapeHtml(r.email||'')} · ${escapeHtml(r.plz||'')} ${escapeHtml(r.ort||'')}</span></div><span class="status-chip ${r.freigabestatus==='freigegeben'?'active':r.freigabestatus==='gesperrt'?'blocked':'pending'}">${platformStatusLabel(r.freigabestatus)}</span></div><div class="platform-review-meta"><span>Registriert: ${formatDateTime(r.created_at)}</span><span>${Number(r.basare_count||0)} Basar${Number(r.basare_count||0)===1?'':'e'}</span><span>Zahlung: ${escapeHtml(payment.join(', ')||'noch nicht vollständig')}</span></div>${r.sperrgrund?`<div class="platform-block-reason"><strong>Sperrgrund:</strong> ${escapeHtml(r.sperrgrund)}</div>`:''}${basarHtml}</div><div class="platform-review-actions">${r.freigabestatus!=='freigegeben'?`<button class="primary inline-button" type="button" data-platform-action="approve" data-user-id="${escapeHtml(r.user_id)}">Freigeben</button>`:''}${r.freigabestatus!=='ausstehend'?`<button class="secondary" type="button" data-platform-action="pending" data-user-id="${escapeHtml(r.user_id)}">Auf Prüfung setzen</button>`:''}${r.freigabestatus!=='gesperrt'?`<button class="danger" type="button" data-platform-action="block" data-user-id="${escapeHtml(r.user_id)}">Sperren</button>`:''}</div></article>`;
    }).join('');
  }

  async function changePlatformStatus(userId, status) {
    if (!isPlatformAdmin) return;
    let reason = null;
    if (status === 'gesperrt') {
      reason = window.prompt('Grund für die Sperrung (wird dem Veranstalter angezeigt):', '')?.trim() || null;
      if (!reason) return;
    }
    const label = status==='freigegeben'?'Veranstalter freigeben':status==='ausstehend'?'Veranstalter wieder auf Prüfung setzen':'Veranstalter sperren';
    if (!window.confirm(`${label}?`)) return;
    clearError('platformError');
    const { error } = await supabase.rpc('platform_set_veranstalter_status', { p_user_id: userId, p_status: status, p_reason: reason });
    if (error) { showError('platformError', humanizeError(error)); return; }
    await loadPlatformAccounts();
    if (currentUser?.id === userId) { profileExists = await loadProfile(); renderAccountStatus(); await loadBasare(); }
  }

  async function showDashboard() {
    const { data:{user}, error }=await supabase.auth.getUser(); if(error||!user)throw error||new Error('Nicht angemeldet'); currentUser=user;
    $('loginCard').classList.add('hidden'); $('dashboard').classList.remove('hidden'); $('topLogoutButton').classList.remove('hidden'); $('adminNav').classList.remove('hidden');
    profileExists = await loadProfile();
    selectedBasarId = null; basare = []; bookings = []; allBookings = [];
    applyDashboardMode();
    renderAccountStatus();
    if (profileExists) await loadBasare();
    await loadPlatformAdminState();
  }
  async function logout(){await supabase.auth.signOut();currentUser=null;profileExists=false;onboardingMode=false;isPlatformAdmin=false;platformAccounts=[];selectedBasarId=null;basare=[];bookings=[];allBookings=[];profileSnapshot=null;$('dashboard').classList.add('hidden');$('loginCard').classList.remove('hidden');$('topLogoutButton').classList.add('hidden');$('adminNav').classList.add('hidden');$('platformNavLink').classList.add('hidden');$('platformAdminCard').classList.add('hidden');$('accountStatusBanner').classList.add('hidden');$('loginForm').reset();$('registerForm').reset();setAuthMode('login');}

  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();clearError('loginError');$('loginButton').disabled=true;$('loginButton').textContent='Anmeldung läuft …';const {error}=await supabase.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});$('loginButton').disabled=false;$('loginButton').textContent='Anmelden';if(error)return showError('loginError','Anmeldung fehlgeschlagen. Bitte E-Mail-Adresse, Passwort und ggf. die E-Mail-Bestätigung prüfen.');try{await showDashboard();}catch(err){console.error(err);showError('loginError',humanizeError(err));}});

  $('registerForm').addEventListener('submit', async e => {
    e.preventDefault(); clearError('registerError'); $('registerSuccess').classList.add('hidden');
    const email = $('registerEmail').value.trim();
    const password = $('registerPassword').value;
    const repeat = $('registerPasswordRepeat').value;
    if (password.length < 8) return showError('registerError', 'Das Passwort muss mindestens 8 Zeichen lang sein.');
    if (password !== repeat) return showError('registerError', 'Die beiden Passwörter stimmen nicht überein.');
    const button = $('registerButton'); button.disabled = true; button.textContent = 'Konto wird erstellt …';
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}?v=284&onboarding=1`;
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      if (data.session) {
        await showDashboard();
      } else {
        $('registerSuccess').textContent = 'Konto angelegt. Bitte öffne jetzt die Bestätigungs-E-Mail und bestätige deine Adresse. Danach kannst du dein Veranstalterprofil und deinen ersten Basar vorbereiten. Die öffentliche Veröffentlichung wird anschließend vom Plattformbetreiber freigegeben.';
        $('registerSuccess').classList.remove('hidden');
        $('registerPassword').value = ''; $('registerPasswordRepeat').value = '';
      }
    } catch (error) {
      console.error(error);
      const msg = /signups.*disabled/i.test(error?.message || '') ? 'Registrierung ist in Supabase noch deaktiviert. Aktiviere sie erst nach dem V21-Deployment.' : humanizeError(error);
      showError('registerError', msg);
    } finally { button.disabled = false; button.textContent = 'Konto erstellen'; }
  });
  $('showLoginButton').addEventListener('click',()=>setAuthMode('login')); $('showRegisterButton').addEventListener('click',()=>setAuthMode('register'));
  $('basarBereiche').addEventListener('change',updateBasarCapacityFields); $('kontingentModus').addEventListener('change',updateBasarCapacityFields); $('basarTischeKinder').addEventListener('input',updateBasarCapacityFields); $('basarTischeErwachsene').addEventListener('input',updateBasarCapacityFields);
  $('profileForm').addEventListener('submit',saveProfile); $('topLogoutButton').addEventListener('click',logout); $('newBasarButton').addEventListener('click',startNewBasar); $('cancelBasarButton').addEventListener('click',()=> $('basarFormCard').classList.add('hidden')); $('basarForm').addEventListener('submit',saveBasar);
  $('editCurrentButton').addEventListener('click',()=>{const b=basare.find(x=>x.id===selectedBasarId);if(b)editBasar(b);}); $('refreshButton').addEventListener('click',()=>loadBasare().catch(e=>showError('dashboardError',humanizeError(e)))); $('refreshBookingsButton').addEventListener('click',()=>loadBookings().catch(e=>showError('dashboardError',humanizeError(e)))); $('bookingFilter').addEventListener('change',renderBookings); $('paymentFilter').addEventListener('change',renderBookings); $('areaFilter').addEventListener('change',renderBookings); $('cakeFilter').addEventListener('change',renderBookings); $('bookingSearch').addEventListener('input',renderBookings); $('resetBookingFiltersButton').addEventListener('click',resetBookingFilters); $('exportBookingsButton').addEventListener('click',exportFilteredBookings);
  $('platformStatusFilter').addEventListener('change',renderPlatformAccounts); $('refreshPlatformButton').addEventListener('click',()=>loadPlatformAccounts().catch(e=>showError('platformError',humanizeError(e))));
  document.addEventListener('click', async e=>{ const btn=e.target.closest('[data-platform-action]'); if(!btn)return; const action=btn.dataset.platformAction; const status=action==='approve'?'freigegeben':action==='block'?'gesperrt':'ausstehend'; await changePlatformStatus(btn.dataset.userId,status); });
  supabase.auth.onAuthStateChange((_e,session)=>{if(session)setTimeout(()=>showDashboard().catch(console.error),0);});
  (async()=>{try{const {data:{session}}=await supabase.auth.getSession();if(session)await showDashboard();}catch(e){console.error(e);showError('loginError','Die Anmeldung konnte nicht geprüft werden.');}})();
})();
