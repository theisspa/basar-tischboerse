(() => {
  'use strict';
  const config = window.BASAR_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) {
    console.error('Basar-Konfiguration oder Supabase-Bibliothek fehlt.'); return;
  }
  const supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const $ = id => document.getElementById(id);
  const euro = value => Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  let currentUser = null, basare = [], bookings = [], selectedBasarId = null, selectedBooking = null;
  let profileExists = false, onboardingMode = false;

  function formatDate(value) { if (!value) return ''; return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
  function formatDateTime(value) { if (!value) return ''; return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
  function showError(id, message) { const box=$(id); box.textContent=message; box.classList.remove('hidden'); }
  function clearError(id) { const box=$(id); box.textContent=''; box.classList.add('hidden'); }
  function humanizeError(error) { const m=error?.message || String(error || 'Unbekannter Fehler.'); if (/permission|row-level security|not authorized/i.test(m)) return 'Keine Berechtigung für diese Aktion.'; if (/nicht genuegend/i.test(m)) return 'Nicht genügend freie Tische vorhanden.'; return m; }

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
    $('profilePaypal').value = data.paypal_email || '';
    return true;
  }

  async function saveProfile(event) {
    event.preventDefault(); clearError('profileError');
    const payload = {
      user_id: currentUser.id,
      name: $('profileName').value.trim(), strasse: $('profileStreet').value.trim(), hausnummer: $('profileHouseNumber').value.trim(),
      plz: $('profileZip').value.trim(), ort: $('profileCity').value.trim(), telefon: $('profilePhone').value.trim() || null,
      email: $('profileEmail').value.trim(), kontoinhaber: $('profileAccountHolder').value.trim() || null,
      iban: $('profileIban').value.trim() || null, paypal_email: $('profilePaypal').value.trim() || null, updated_at: new Date().toISOString()
    };
    if (!payload.name || !payload.strasse || !payload.hausnummer || !payload.plz || !payload.ort || !payload.email) {
      return showError('profileError', 'Bitte alle Pflichtfelder der Veranstalterdaten ausfüllen.');
    }
    const wasOnboarding = onboardingMode;
    const button=$('saveProfileButton'); button.disabled=true; button.textContent='Speichert …';
    try {
      const { error } = await supabase.from('veranstalter').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      profileExists = true; onboardingMode = false;
      button.textContent='Gespeichert ✓';
      applyDashboardMode();
      if (wasOnboarding) {
        await loadBasare();
        $('onboardingBanner').classList.remove('hidden');
        $('onboardingTitle').textContent = 'Schritt 2 von 2: Ersten Basar anlegen';
        $('onboardingText').textContent = 'Deine Veranstalterdaten sind gespeichert. Lege jetzt deinen ersten Basar mit Preisen und Buchungsregeln an.';
        startNewBasar();
      }
      setTimeout(() => { button.textContent='Veranstalterdaten speichern'; }, 1500);
    } catch (error) { console.error(error); showError('profileError', humanizeError(error)); button.textContent='Veranstalterdaten speichern'; }
    finally { button.disabled=false; }
  }

  async function loadBasare() {
    clearError('basarError');
    const { data, error } = await supabase.from('basare').select('id,name,ort,veranstaltungsdatum,max_tische,aktiv,created_at,veranstalter_id,preis_1_tisch,preis_2_tische,preis_3_tische,kuchenrabatt,zahlungsfrist_tage,kurzfristig_ab_tage,kurzfristige_zahlungsfrist_tage,stornofrist_tage,kuchennachgebuehr,uebertragung_erlaubt,zusatzregeln').eq('veranstalter_id', currentUser.id).order('veranstaltungsdatum', { ascending: true });
    if (error) throw error;
    basare=data || [];
    if (!selectedBasarId || !basare.some(b => b.id === selectedBasarId)) { const active=basare.find(b=>b.aktiv) || basare[0]; selectedBasarId=active?.id || null; }
    renderBasarList();
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
    el.innerHTML=basare.map(b=>`<button class="basar-list-item ${b.id===selectedBasarId?'selected':''}" data-basar-id="${b.id}" type="button"><div><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(formatDate(b.veranstaltungsdatum))}${b.ort?' · '+escapeHtml(b.ort):''}</span></div><span class="status-chip ${b.aktiv?'active':'inactive'}">${b.aktiv?'Aktiv':'Inaktiv'}</span></button>`).join('');
    el.querySelectorAll('[data-basar-id]').forEach(btn=>btn.addEventListener('click', async()=>{ selectedBasarId=Number(btn.dataset.basarId); renderBasarList(); try{await loadSelectedBasar();}catch(e){console.error(e);showError('basarError',humanizeError(e));} }));
  }

  async function loadSelectedBasar() {
    const basar=basare.find(b=>b.id===selectedBasarId); if (!basar) return clearSelectedBasar();
    $('selectedBasarCard').classList.remove('hidden'); $('bookingCard').classList.remove('hidden');
    $('dashboardTitle').textContent=basar.name; $('dashboardDetails').textContent=`${formatDate(basar.veranstaltungsdatum)} · ${basar.ort||''}`.replace(/ · $/,'')+(basar.aktiv?'':' · Inaktiv'); $('dashboardTotal').textContent=basar.max_tische;
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
    const blocking=bookings.filter(r=>['offen','bezahlt'].includes(r.zahlungsstatus));
    const booked=blocking.reduce((sum,r)=>sum+Number(r.anzahl_tische||0),0); $('dashboardBooked').textContent=booked; $('dashboardFree').textContent=Math.max(0,Number(basar.max_tische)-booked);
  }

  function statusInfo(status) {
    if(status==='bezahlt')return['Bezahlt','bezahlt']; if(status==='storniert')return['Storniert','storniert']; if(status==='abgelaufen')return['Frist abgelaufen','abgelaufen']; return['Offen','offen'];
  }

  function renderBookings() {
    const filter=$('bookingFilter').value;
    const filtered=bookings.filter(r=>{ if(['offen','bezahlt','abgelaufen'].includes(filter))return r.zahlungsstatus===filter; if(filter==='kuchen')return r.kuchenspende; if(filter==='kinder')return r.verkaufsbereich==='kinder'; if(filter==='erwachsene')return r.verkaufsbereich==='erwachsene'; return true; });
    const rows=$('bookingRows'); if(!filtered.length){rows.innerHTML='<tr><td colspan="10">Keine passenden Buchungen vorhanden.</td></tr>';return;}
    rows.innerHTML=filtered.map(r=>{const [statusText,statusClass]=statusInfo(r.zahlungsstatus);return `<tr class="${['storniert','abgelaufen'].includes(r.zahlungsstatus)?'muted-row':''}"><td><strong>${escapeHtml(r.buchungsnummer)}</strong></td><td>${escapeHtml(`${r.vorname} ${r.nachname}`)}</td><td>${r.anzahl_tische}</td><td>${r.verkaufsbereich==='kinder'?'Kinder':'Erwachsene'}</td><td>${r.kuchenspende?'Ja':'Nein'}</td><td>${euro(r.preis)}</td><td>${r.zahlungsart==='paypal'?'PayPal':'Überweisung'}</td><td>${formatDate(r.zahlungsfrist)}</td><td><span class="badge status-${statusClass}">${statusText}</span></td><td><button class="table-button" type="button" data-booking-id="${r.id}" data-action="open-booking">Öffnen</button></td></tr>`;}).join('');
  }

  function openBooking(id) {
    selectedBooking=bookings.find(b=>b.id===id)||null; if(!selectedBooking)return; const r=selectedBooking; const [status]=statusInfo(r.zahlungsstatus);
    $('bookingModalTitle').textContent=r.buchungsnummer;
    $('bookingDetails').innerHTML=`<div class="detail-item"><span>Name</span><strong>${escapeHtml(`${r.vorname} ${r.nachname}`)}</strong></div><div class="detail-item"><span>Bereich</span><strong>${r.verkaufsbereich==='kinder'?'Kinder':'Erwachsene'}</strong></div><div class="detail-item"><span>Tische</span><strong>${r.anzahl_tische}</strong></div><div class="detail-item"><span>Kuchen</span><strong>${r.kuchenspende?'Ja':'Nein'}</strong></div><div class="detail-item"><span>Betrag</span><strong>${euro(r.preis)}</strong></div><div class="detail-item"><span>Zahlung</span><strong>${r.zahlungsart==='paypal'?'PayPal':'Überweisung'}</strong></div><div class="detail-item"><span>Status</span><strong>${status}</strong></div><div class="detail-item"><span>Zahlungsfrist</span><strong>${formatDate(r.zahlungsfrist)}</strong></div><div class="detail-item full"><span>Adresse</span><strong>${escapeHtml(`${r.strasse} ${r.hausnummer}, ${r.plz} ${r.ort}`)}</strong></div><div class="detail-item"><span>E-Mail</span><strong>${escapeHtml(r.email)}</strong></div><div class="detail-item"><span>Telefon</span><strong>${escapeHtml(r.telefon||'—')}</strong></div><div class="detail-item"><span>E-Mail an Teilnehmer</span><strong>${r.email_status==='sent'?'Versendet':r.email_status==='error'?'Fehler':r.email_status==='sending'?'Wird gesendet':'Ausstehend'}${r.email_sent_at?` · ${formatDateTime(r.email_sent_at)}`:''}</strong></div><div class="detail-item"><span>E-Mail an Veranstalter</span><strong>${r.veranstalter_email_status==='sent'?'Versendet':r.veranstalter_email_status==='error'?'Fehler':r.veranstalter_email_status==='sending'?'Wird gesendet':'Ausstehend'}${r.veranstalter_email_sent_at?` · ${formatDateTime(r.veranstalter_email_sent_at)}`:''}</strong></div><div class="detail-item full"><span>Buchung eingegangen</span><strong>${formatDateTime(r.created_at)}</strong></div>`;
    $('markPaidButton').classList.toggle('hidden', ['bezahlt','storniert'].includes(r.zahlungsstatus)); $('markOpenButton').classList.toggle('hidden', r.zahlungsstatus!=='bezahlt'); $('cancelBookingButton').classList.toggle('hidden', r.zahlungsstatus==='storniert'); $('bookingModal').classList.remove('hidden');
  }
  function closeBooking(){ $('bookingModal').classList.add('hidden'); selectedBooking=null; }

  async function updateBookingStatus(status) {
    if(!selectedBooking)return; const label=status==='bezahlt'?'Zahlung als bezahlt markieren':status==='offen'?'Zahlung wieder öffnen':'Buchung stornieren'; if(!window.confirm(`${label}?`))return;
    const { error }=await supabase.from('buchungen').update({zahlungsstatus:status}).eq('id',selectedBooking.id); if(error){showError('dashboardError',humanizeError(error));return;} closeBooking(); await loadBookings();
  }

  document.addEventListener('click', async e=>{ const b=e.target.closest('[data-action]'); if(!b)return; const a=b.dataset.action; if(a==='open-booking')openBooking(Number(b.dataset.bookingId)); else if(a==='close-booking')closeBooking(); else if(a==='mark-paid')await updateBookingStatus('bezahlt'); else if(a==='mark-open')await updateBookingStatus('offen'); else if(a==='cancel-booking')await updateBookingStatus('storniert'); }, true);
  document.addEventListener('click',e=>{if(e.target===$('bookingModal'))closeBooking();}); document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBooking();});

  function startNewBasar(){ clearError('basarError'); $('basarForm').reset(); $('basarId').value=''; $('basarFormTitle').textContent='Neuen Basar anlegen'; $('basarTische').value='50'; $('preis1Tisch').value='12.00'; $('preis2Tische').value='20.00'; $('preis3Tische').value='25.00'; $('kuchenrabatt').value='4.00'; $('zahlungsfristTage').value='14'; $('kurzfristigAbTage').value='14'; $('kurzfristigeZahlungsfristTage').value='3'; $('stornofristTage').value='14'; $('kuchennachgebuehr').value='10.00'; $('uebertragungErlaubt').value='true'; $('zusatzregeln').value=''; $('basarAktiv').value='true'; $('basarFormCard').classList.remove('hidden'); $('basarFormCard').scrollIntoView({behavior:'smooth',block:'start'}); }
  function editBasar(b){ clearError('basarError'); $('basarId').value=b.id; $('basarName').value=b.name||''; $('basarOrt').value=b.ort||''; $('basarDatum').value=b.veranstaltungsdatum||''; $('basarTische').value=b.max_tische||''; $('preis1Tisch').value=Number(b.preis_1_tisch ?? 12).toFixed(2); $('preis2Tische').value=Number(b.preis_2_tische ?? 20).toFixed(2); $('preis3Tische').value=Number(b.preis_3_tische ?? 25).toFixed(2); $('kuchenrabatt').value=Number(b.kuchenrabatt ?? 4).toFixed(2); $('zahlungsfristTage').value=Number(b.zahlungsfrist_tage ?? 14); $('kurzfristigAbTage').value=Number(b.kurzfristig_ab_tage ?? 14); $('kurzfristigeZahlungsfristTage').value=Number(b.kurzfristige_zahlungsfrist_tage ?? 3); $('stornofristTage').value=Number(b.stornofrist_tage ?? 14); $('kuchennachgebuehr').value=Number(b.kuchennachgebuehr ?? 10).toFixed(2); $('uebertragungErlaubt').value=String(b.uebertragung_erlaubt ?? true); $('zusatzregeln').value=b.zusatzregeln || ''; $('basarAktiv').value=String(!!b.aktiv); $('basarFormTitle').textContent='Basar bearbeiten'; $('basarFormCard').classList.remove('hidden'); $('basarFormCard').scrollIntoView({behavior:'smooth',block:'start'}); }

  async function saveBasar(event) {
    event.preventDefault(); clearError('basarError'); const id=$('basarId').value?Number($('basarId').value):null;
    const payload={name:$('basarName').value.trim(),ort:$('basarOrt').value.trim()||null,veranstaltungsdatum:$('basarDatum').value,max_tische:Number($('basarTische').value),preis_1_tisch:Number($('preis1Tisch').value),preis_2_tische:Number($('preis2Tische').value),preis_3_tische:Number($('preis3Tische').value),kuchenrabatt:Number($('kuchenrabatt').value),zahlungsfrist_tage:Number($('zahlungsfristTage').value),kurzfristig_ab_tage:Number($('kurzfristigAbTage').value),kurzfristige_zahlungsfrist_tage:Number($('kurzfristigeZahlungsfristTage').value),stornofrist_tage:Number($('stornofristTage').value),kuchennachgebuehr:Number($('kuchennachgebuehr').value),uebertragung_erlaubt:$('uebertragungErlaubt').value==='true',zusatzregeln:$('zusatzregeln').value.trim()||null,aktiv:$('basarAktiv').value==='true',veranstalter_id:currentUser.id};
    if(!payload.name||!payload.veranstaltungsdatum||!payload.max_tische)return showError('basarError','Bitte Name, Datum und Tischanzahl ausfüllen.'); if([payload.preis_1_tisch,payload.preis_2_tische,payload.preis_3_tische,payload.kuchenrabatt,payload.kuchennachgebuehr].some(v=>!Number.isFinite(v)||v<0))return showError('basarError','Bitte gültige Preise und Gebühren eingeben.'); if([payload.zahlungsfrist_tage,payload.kurzfristig_ab_tage,payload.kurzfristige_zahlungsfrist_tage,payload.stornofrist_tage].some(v=>!Number.isInteger(v)||v<0||v>365))return showError('basarError','Bitte gültige Fristen zwischen 0 und 365 Tagen eingeben.');
    const btn=$('saveBasarButton');btn.disabled=true;btn.textContent='Speichert …';
    try { if(id){const {error}=await supabase.from('basare').update(payload).eq('id',id).eq('veranstalter_id',currentUser.id);if(error)throw error;selectedBasarId=id;}else{const {data,error}=await supabase.from('basare').insert(payload).select('id').single();if(error)throw error;selectedBasarId=data.id;} $('basarFormCard').classList.add('hidden'); await loadBasare(); $('onboardingBanner').classList.add('hidden'); }
    catch(error){console.error(error);showError('basarError',humanizeError(error));}finally{btn.disabled=false;btn.textContent='Basar speichern';}
  }

  async function showDashboard() {
    const { data:{user}, error }=await supabase.auth.getUser(); if(error||!user)throw error||new Error('Nicht angemeldet'); currentUser=user;
    $('loginCard').classList.add('hidden'); $('dashboard').classList.remove('hidden'); $('topLogoutButton').classList.remove('hidden');
    profileExists = await loadProfile();
    selectedBasarId = null; basare = []; bookings = [];
    applyDashboardMode();
    if (profileExists) await loadBasare();
  }
  async function logout(){await supabase.auth.signOut();currentUser=null;profileExists=false;onboardingMode=false;selectedBasarId=null;basare=[];bookings=[];$('dashboard').classList.add('hidden');$('loginCard').classList.remove('hidden');$('topLogoutButton').classList.add('hidden');$('loginForm').reset();$('registerForm').reset();setAuthMode('login');}

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
      const redirectTo = `${window.location.origin}${window.location.pathname}?v=21&onboarding=1`;
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      if (data.session) {
        await showDashboard();
      } else {
        $('registerSuccess').textContent = 'Konto angelegt. Bitte öffne jetzt die Bestätigungs-E-Mail und bestätige deine Adresse. Danach kannst du dich anmelden und dein Veranstalterprofil einrichten.';
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
  $('profileForm').addEventListener('submit',saveProfile); $('topLogoutButton').addEventListener('click',logout); $('newBasarButton').addEventListener('click',startNewBasar); $('cancelBasarButton').addEventListener('click',()=> $('basarFormCard').classList.add('hidden')); $('basarForm').addEventListener('submit',saveBasar);
  $('editCurrentButton').addEventListener('click',()=>{const b=basare.find(x=>x.id===selectedBasarId);if(b)editBasar(b);}); $('refreshButton').addEventListener('click',()=>loadBasare().catch(e=>showError('dashboardError',humanizeError(e)))); $('refreshBookingsButton').addEventListener('click',()=>loadBookings().catch(e=>showError('dashboardError',humanizeError(e)))); $('bookingFilter').addEventListener('change',renderBookings);
  supabase.auth.onAuthStateChange((_e,session)=>{if(session)setTimeout(()=>showDashboard().catch(console.error),0);});
  (async()=>{try{const {data:{session}}=await supabase.auth.getSession();if(session)await showDashboard();}catch(e){console.error(e);showError('loginError','Die Anmeldung konnte nicht geprüft werden.');}})();
})();
