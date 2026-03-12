/* ==============================================================
   BLOCO 1: BLINDAGEM E VARIÁVEIS GERAIS
   ============================================================== */
// Escudo global de proteção de rede
window.onerror = function(msg, url, lineNo, columnNo, error) {
    if (msg && msg.includes("Script error")) return true; 
    return false;
};

const firebaseConfig = {
    apiKey: "AIzaSyAuqKgLVpDYqdTxKKnFO6Ns6rptM8YKqn0",
    authDomain: "aed-log.firebaseapp.com",
    databaseURL: "https://aed-log-default-rtdb.firebaseio.com",
    projectId: "aed-log",
    storageBucket: "aed-log.firebasestorage.app",
    messagingSenderId: "274943213765",
    appId: "1:274943213765:web:981162ad21a58c220970ac"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
const DB_ROOT = 'aed_data_empresa';

let secondaryApp;
try { secondaryApp = firebase.app("SecondaryApp"); } catch (e) { secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryApp"); }
const secondaryAuth = secondaryApp.auth();

let currentUser = null; 
let currentDriverName = "MOTORISTA"; 
let GEMINI_API_KEY = ""; let GOOGLE_MAPS_KEY = "";
let CLOUDINARY_CLOUD_NAME = ""; let CLOUDINARY_UPLOAD_PRESET = ""; let CLOUDINARY_BYTES_USED = 0;
let PERCENTUAL_SISTEMA = 5;

let mapsLoaded = false; let mapsLoading = false;
let mapRastreioObj = null, mapRotaObj = null, mapMotoristaObj = null;
let directionsService = null, directionsRenderer = null, dirRendererMot = null;
let markersFrota = {}; let routeMarkers = []; let activePlaceDetails = null;

let clienteGooglePlaceLocation = null;
let editClienteGooglePlaceLocation = null; 

let driverMarkerMap = null;
let wakeLock = null; 


/* ==============================================================
   BLOCO 2: FUNÇÕES UTILITÁRIAS
   ============================================================== */
// Função de escape suprema (BLINDA ASPAS E QUEBRAS DE LINHA NO HTML)
function escapeHtml(str) { 
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\') 
        .replace(/'/g, "\\'")   
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ')    
        .replace(/\r/g, ''); 
}

function getSafeLatLng(lat, lng) {
    if(lat === undefined || lat === null || lat === "" || lng === undefined || lng === null || lng === "") return null;
    let latRaw = typeof lat === 'string' ? lat.replace(',', '.') : lat;
    let lngRaw = typeof lng === 'string' ? lng.replace(',', '.') : lng;
    let latNum = parseFloat(latRaw);
    let lngNum = parseFloat(lngRaw);
    if(isNaN(latNum) || isNaN(lngNum) || latNum === 0 || lngNum === 0) return null;
    return new google.maps.LatLng(latNum, lngNum);
}

window.limparWaypoint = function(wpLocation) {
    if (typeof wpLocation === 'object' && wpLocation.lat) {
        const latNum = typeof wpLocation.lat === 'function' ? wpLocation.lat() : wpLocation.lat;
        const lngNum = typeof wpLocation.lng === 'function' ? wpLocation.lng() : wpLocation.lng;
        return { location: new google.maps.LatLng(latNum, lngNum), stopover: true };
    }
    return { location: wpLocation, stopover: true };
};


/* ==============================================================
   BLOCO 3: CONTROLE DE NAVEGAÇÃO E MODAIS
   ============================================================== */
window.abrirModal = function(id) {
    const m = document.getElementById(id);
    if(m) { 
        m.classList.remove('hidden'); 
        m.classList.add('flex'); 
        if(id === 'modal-cliente') clienteGooglePlaceLocation = null; 
        if(id === 'modal-edit-cliente') editClienteGooglePlaceLocation = null;
    }
};

window.fecharModal = function(id) {
    const m = document.getElementById(id);
    if(m) { m.classList.remove('flex'); m.classList.add('hidden'); }
};

window.nav = function(target) {
    if(window.innerWidth < 640) {
        const sb = document.getElementById('sidebar-menu');
        if(sb) {
            sb.classList.add('-translate-x-full');
            setTimeout(() => sb.classList.add('hidden'), 300); 
        }
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('nav-btn-active', 'nav-btn-ia-active');
        if(btn.dataset.target === target) {
            if(target === 'prospeccao') btn.classList.add('nav-btn-ia-active');
            else btn.classList.add('nav-btn-active');
        }
    });

    document.querySelectorAll('.view-content').forEach(v => v.classList.add('hidden-view'));
    const targetView = document.getElementById(`view-${target}`);
    if(targetView) {
        targetView.classList.remove('hidden-view');
        const title = document.getElementById('page-title');
        if(title) {
            const titles = { 'dashboard':'Dashboard Central', 'cargas':'Romaneios / Rotas', 'rastreio':'Monitoramento Satelital', 'ocorrencias':'Auditoria & Linha do Tempo', 'prospeccao':'Planejamento IA & Rotas', 'clientes':'Base de Lojas', 'equipe':'Equipe & RH', 'frota':'Frota Logística', 'oficina':'Centro de Oficina', 'config':'Configurações APIs', 'relatorios':'Painel de Relatórios' };
            title.innerHTML = `${titles[target] || target.toUpperCase()}`;
        }
    }

    if(target === 'rastreio') window.checkMap('rastreio');
    if(target === 'prospeccao') { window.checkMap('rota'); window.popularSelectMotoristasRadar(); }
    if(target === 'relatorios') { window.carregarRelatorios(); }
};


/* ==============================================================
   BLOCO 4: AUTENTICAÇÃO, LOGIN E LOGOUT
   ============================================================== */
const loginForm = document.getElementById('login-form');
if(loginForm) loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const em = document.getElementById('login-email').value;
    const pa = document.getElementById('login-pass').value;
    const msg = document.getElementById('login-error');
    msg.innerText = "Conectando ao Satélite...";
    try { await auth.signInWithEmailAndPassword(em, pa); } 
    catch (err) { msg.innerText = "Acesso Negado: Chave de acesso inválida."; }
};

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-view').classList.add('hidden-view');
        carregarConfiguracoesAED();
        
        currentDriverName = user.email.split('@')[0].toUpperCase();
        const eqSnap = await db.ref(`${DB_ROOT}/equipe/${user.uid}`).once('value');
        if (eqSnap.exists()) currentDriverName = eqSnap.val().nome;

        const snap = await db.ref(`users_roles/${user.uid}`).once('value');
        const role = snap.exists() ? snap.val().role : 'motorista';
        
        if(role === 'gestor' || user.email.includes('admin') || user.email.includes('aed@')) {
            document.getElementById('admin-view').classList.remove('hidden-view');
            const ud = document.getElementById('user-display'); if(ud) ud.innerText = currentDriverName;
            carregarMecanismoAdmin(); window.nav('dashboard');
        } else {
            document.getElementById('motorista-view').classList.remove('hidden-view');
            const md = document.getElementById('mot-nome-display'); if(md) md.innerText = currentDriverName;
            window.iniciarArquiteturaMotorista();
        }
    }
});

window.fazerLogout = function() { auth.signOut().then(() => window.location.reload()); };


/* ==============================================================
   BLOCO 5: MAPAS DO GOOGLE, RADAR E GEOMETRIA
   ============================================================== */
function carregarConfiguracoesAED() {
    db.ref(`${DB_ROOT}/config`).on('value', snap => {
        if(snap.exists()){
            const c = snap.val();
            GEMINI_API_KEY = c.gemini_key || ""; GOOGLE_MAPS_KEY = c.maps_key || "";
            CLOUDINARY_CLOUD_NAME = c.cloud_name || ""; CLOUDINARY_UPLOAD_PRESET = c.upload_preset || "";
            CLOUDINARY_BYTES_USED = c.cloudinary_bytes_used || 0;
            PERCENTUAL_SISTEMA = c.percentual_sistema || 5;
            
            if(document.getElementById('gemini-key')) document.getElementById('gemini-key').value = GEMINI_API_KEY;
            if(document.getElementById('maps-key')) document.getElementById('maps-key').value = GOOGLE_MAPS_KEY;
            if(document.getElementById('cloud-name')) document.getElementById('cloud-name').value = CLOUDINARY_CLOUD_NAME;
            if(document.getElementById('upload-preset')) document.getElementById('upload-preset').value = CLOUDINARY_UPLOAD_PRESET;
            if(document.getElementById('config-taxa')) document.getElementById('config-taxa').value = PERCENTUAL_SISTEMA;
            if(document.getElementById('cloud-bytes-display')) document.getElementById('cloud-bytes-display').innerText = (CLOUDINARY_BYTES_USED / (1024 * 1024)).toFixed(2) + ' MB';
            
            if(GOOGLE_MAPS_KEY && !mapsLoaded) window.carregarGoogleMapsRuntime();
        }
    });
}

window.carregarGoogleMapsRuntime = function() {
    if(mapsLoading) return; mapsLoading = true;
    window.initMap = async () => { 
        mapsLoaded = true; 
        mapsLoading = false; 
        
        if (google.maps.importLibrary) {
            try { await google.maps.importLibrary("marker"); } catch(e) {}
        }

        window.checkMap('rastreio'); 
        window.checkMap('rota'); 
        
        const inputEnd = document.getElementById('cli-end');
        if(inputEnd) {
            inputEnd.addEventListener('keydown', function(e) { if (e.key === 'Enter') e.preventDefault(); });
            if(window.google && google.maps.places) {
                const autocomplete = new google.maps.places.Autocomplete(inputEnd);
                autocomplete.addListener('place_changed', () => {
                    const place = autocomplete.getPlace();
                    if (place.geometry && place.geometry.location) {
                        clienteGooglePlaceLocation = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng(), formatted_address: place.formatted_address || inputEnd.value };
                    }
                });
            }
        }

        const inputEditEnd = document.getElementById('edit-cli-end');
        if(inputEditEnd && window.google && google.maps.places) {
            inputEditEnd.addEventListener('keydown', function(e) { if (e.key === 'Enter') e.preventDefault(); });
            const autocompleteEdit = new google.maps.places.Autocomplete(inputEditEnd);
            autocompleteEdit.addListener('place_changed', () => {
                const place = autocompleteEdit.getPlace();
                if (place.geometry && place.geometry.location) {
                    editClienteGooglePlaceLocation = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng(), formatted_address: place.formatted_address || inputEditEnd.value };
                }
            });
        }
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places,geometry,marker&v=weekly&callback=initMap`;
    s.async = true; s.defer = true; document.head.appendChild(s);
};

async function desenharMarcador(position, map, title, iconUrl) {
    if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
        const img = document.createElement("img"); img.src = iconUrl;
        return new google.maps.marker.AdvancedMarkerElement({ position, map, title, content: img });
    } else {
        return new google.maps.Marker({ position, map, title, icon: iconUrl });
    }
}

window.checkMap = function(type) {
    if(!mapsLoaded || !window.google) return;
    if(type === 'rastreio' && !document.getElementById('view-rastreio').classList.contains('hidden-view')) {
        const overlay = document.getElementById('map-rastreio-overlay'); if(overlay) overlay.classList.add('hidden');
        if(!mapRastreioObj) mapRastreioObj = new google.maps.Map(document.getElementById('map-rastreio'), { center: {lat:-20.8, lng:-49.3}, zoom: 7, disableDefaultUI: true, mapId: "AED_MAP_RASTREIO" });
    }
    if(type === 'rota' && !document.getElementById('view-prospeccao').classList.contains('hidden-view')) {
        const overlay = document.getElementById('map-rota-overlay'); if(overlay) overlay.classList.add('hidden');
        if(!mapRotaObj) {
            mapRotaObj = new google.maps.Map(document.getElementById('map-rota'), { center: {lat:-20.8, lng:-49.3}, zoom: 7, disableDefaultUI: true, mapId: "AED_MAP_ROTA" });
            directionsService = new google.maps.DirectionsService();
            directionsRenderer = new google.maps.DirectionsRenderer({ map: mapRotaObj, polylineOptions: { strokeColor: "#0f172a", strokeWeight: 6, strokeOpacity: 0.8 } });
        }
    }
    if(type === 'motorista' && !document.getElementById('motorista-view').classList.contains('hidden-view')) {
        if(!mapMotoristaObj) {
            mapMotoristaObj = new google.maps.Map(document.getElementById('map-motorista'), { center: {lat:-20.8, lng:-49.3}, zoom: 12, disableDefaultUI: true, mapId: "AED_MAP_MOTORISTA" });
            dirRendererMot = new google.maps.DirectionsRenderer({ map: mapMotoristaObj, polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 5 }});
        }
    }
};


/* ==============================================================
   BLOCO 6: ALGORITMO DO RADAR E INTELIGÊNCIA ARTIFICIAL (GEMINI)
   ============================================================== */
window.popularSelectMotoristasRadar = function() {
    db.ref(`${DB_ROOT}/cargas`).once('value', snap => {
        let motoristasSet = new Set();
        let h = '<option value="">-- Selecione o Motorista em Planejamento --</option>';
        if(snap.exists()) { 
            snap.forEach(c => { 
                const val = c.val();
                if(val.status === 'Montando Rota' && val.motorista_email) {
                    if(!motoristasSet.has(val.motorista_email)) {
                        motoristasSet.add(val.motorista_email);
                        h += `<option value="${val.motorista_email}">${val.motorista_nome}</option>`; 
                    }
                } 
            }); 
        }
        const sel = document.getElementById('radar-motorista'); if(sel) sel.innerHTML = h;
    });
};

window.preencherRotaPlanejada = async function() {
    const email = document.getElementById('radar-motorista').value; if(!email) return;
    
    const snap = await db.ref(`${DB_ROOT}/cargas`).orderByChild('motorista_email').equalTo(email).once('value');
    let destinosProg = [];
    snap.forEach(c => {
        if(c.val().status === 'Montando Rota') {
            destinosProg.push(c.val().destino);
        }
    });

    if(destinosProg.length > 0) {
        document.getElementById('destino-rota').value = destinosProg.join(' | ');
    } else {
        document.getElementById('destino-rota').value = "Nenhum destino na fila."; 
    }
};

window.iniciarDespachoPeloRadar = function() {
    const email = document.getElementById('radar-motorista').value;
    if(!email) return alert("Selecione um motorista para planejar e despachar a rota.");
    const sel = document.getElementById('radar-motorista');
    const nome = sel.options[sel.selectedIndex].text;
    window.abrirModalAtribuirVeiculo(email, nome);
};

window.adicionarClienteAoRomaneioRadar = function(emailMot, clienteNome, clienteEnd) {
    window.abrirModalCarga();
    setTimeout(() => {
        const selMot = document.getElementById('carga-motorista');
        const selCli = document.getElementById('carga-cliente');
        if(selMot) selMot.value = emailMot;
        if(selCli) {
            for(let i=0; i<selCli.options.length; i++) {
                if(selCli.options[i].getAttribute('data-nome') === clienteNome) {
                    selCli.selectedIndex = i;
                    break;
                }
            }
        }
    }, 600);
};

window.analisarRotaClientesBase = async function() {
    const emailMotorista = document.getElementById('radar-motorista').value;
    const btn = document.getElementById('btn-analisar-rota');
    const alertBox = document.getElementById('alerta-sucesso');
    if(alertBox) alertBox.classList.add('hidden');
    
    if(!directionsService || !emailMotorista) return alert("Erro: Selecione o Motorista em Planejamento primeiro.");

    btn.innerHTML = "<div class='loader border-t-amber-400 mx-auto'></div> Rastreando Entregas do Motorista...";
    routeMarkers.forEach(m => { m.map = null; }); routeMarkers = [];

    let originLatLng = null;
    let originSourceMsg = "Endereço Base (Planejamento)";
    const geocoder = new google.maps.Geocoder();
    const org = document.getElementById('origem-rota').value;

    // CORREÇÃO CRÍTICA DO ERRO DE PARSE DE LAT/LNG (Evita o INVALID_REQUEST)
    if(org.includes(',')) {
        const parts = org.split(',');
        const latParse = parseFloat(parts[0].trim());
        const lngParse = parseFloat(parts[1].trim());
        
        // Só aceita se os dois lados da vírgula forem números de fato
        if(!isNaN(latParse) && !isNaN(lngParse)) {
            originLatLng = new google.maps.LatLng(latParse, lngParse);
            originSourceMsg = "Coordenadas Iniciais";
        }
    }
    
    // Se a string for um texto "Cidade, Estado", originLatLng não vai ser setado acima, e cai aqui no geocode perfeitamente.
    if (!originLatLng) {
        btn.innerHTML = "<div class='loader border-t-amber-400 mx-auto'></div> Validando Origem por Texto...";
        originLatLng = await new Promise(res => {
            try {
                geocoder.geocode({ address: org }, (r, s) => {
                    if (s === 'OK' && r[0]) res(r[0].geometry.location);
                    else res(null);
                });
            } catch(e) { res(null); }
        });
    }

    if(!originLatLng) {
        btn.innerHTML = "<i class='bx bx-map-pin text-xl'></i> Traçar Rota & Iniciar Varredura";
        return alert("Erro: Não foi possível localizar o ponto de origem no Google Maps. Verifique se o endereço inicial está digitado corretamente.");
    }

    const cgSnap = await db.ref(`${DB_ROOT}/cargas`).orderByChild('motorista_email').equalTo(emailMotorista).once('value');
    const romaneioAtivo = [];
    const destinosParaExcluirDoRadar = [];

    cgSnap.forEach(c => { 
        const val = c.val();
        if(val.status === 'Montando Rota' || val.status === 'Em Rota') {
            if(val.destino) destinosParaExcluirDoRadar.push(val.destino.toUpperCase().trim());
            romaneioAtivo.push({...val, id: c.key}); 
        }
    });

    if(romaneioAtivo.length === 0) {
        btn.innerHTML = "<i class='bx bx-map-pin text-xl'></i> Traçar Rota & Iniciar Varredura";
        return alert("Nenhum romaneio em construção para este motorista. Adicione notas a ele em 'Construção de Romaneios' primeiro.");
    }

    const clSnap = await db.ref(`${DB_ROOT}/clientes`).once('value');
    const clientesBase = [];
    clSnap.forEach(c => { clientesBase.push({...c.val(), id: c.key}); });

    const deliveryPoints = [];
    
    btn.innerHTML = `<div class='loader border-t-amber-400 mx-auto'></div> Extraindo Lat/Lng (${originSourceMsg})...`;
    
    await Promise.all(romaneioAtivo.map(async (carga) => {
        const cliMatch = clientesBase.find(c => {
            if(!c || !carga) return false;
            const nomeMatch = (c.nome && carga.destino) ? c.nome.toUpperCase().trim() === carga.destino.toUpperCase().trim() : false;
            const endMatch = (c.cid && carga.endereco_destino) ? c.cid === carga.endereco_destino : false;
            return nomeMatch || endMatch;
        });

        if (cliMatch) {
            const safePos = getSafeLatLng(cliMatch.lat, cliMatch.lng);
            if(safePos) {
                deliveryPoints.push({ location: safePos, nome: carga.destino, id: carga.id });
            } else {
                deliveryPoints.push({ location: carga.endereco_destino || carga.destino, nome: carga.destino, id: carga.id });
            }
        } else {
            deliveryPoints.push({ location: carga.endereco_destino || carga.destino, nome: carga.destino, id: carga.id });
        }
    }));

    await Promise.all(deliveryPoints.map(async (pt) => {
        if(typeof pt.location === 'string' || !pt.location.lat) {
            await new Promise(res => {
                const q = typeof pt.location === 'string' ? pt.location : pt.nome;
                geocoder.geocode({ address: q }, (r, s) => {
                    if (s === 'OK' && r[0]) pt.location = r[0].geometry.location;
                    res();
                });
            });
        }
    }));

    const validDeliveryPoints = deliveryPoints.filter(pt => pt.location && typeof pt.location.lat === 'function');
    if(validDeliveryPoints.length === 0) {
        btn.innerHTML = "<i class='bx bx-map-pin text-xl animate-pulse'></i> Traçar Rota & Iniciar Varredura";
        return alert("ERRO CRÍTICO: Nenhum dos destinos desta nota tem GPS válido. Apague as notas do motorista, edite os clientes correspondentes salvando com as sugestões do Google e re-envie a viagem.");
    }

    btn.innerHTML = "<div class='loader border-t-amber-400 mx-auto'></div> Roteirizando Algoritmo...";

    let maxDist = -1;
    let destIndex = validDeliveryPoints.length - 1;

    validDeliveryPoints.forEach((pt, i) => {
        if(pt.location && typeof pt.location.lat === 'function') {
            const d = google.maps.geometry.spherical.computeDistanceBetween(originLatLng, pt.location);
            if (d > maxDist) { maxDist = d; destIndex = i; }
        }
    });

    const finalDestination = validDeliveryPoints[destIndex];
    const waypointsList = validDeliveryPoints.filter((_, i) => i !== destIndex);

    const cleanWaypoints = waypointsList.map(w => ({ location: w.location, stopover: true }));

    // CONSTRUÇÃO ESTRUTURADA DA ROTA (Evita INVALID_REQUEST quando só tem 1 destino sem waypoints extras)
    const req = {
        origin: originLatLng,
        destination: finalDestination.location,
        travelMode: 'DRIVING'
    };

    if(cleanWaypoints.length > 0) {
        req.waypoints = cleanWaypoints;
        req.optimizeWaypoints = true;
    }

    try {
        directionsService.route(req, (res, status) => {
            if (status === 'OK') {
                window.processarCruzamentoRadial(res, btn, clientesBase, destinosParaExcluirDoRadar, "planejamento_ativo", geocoder);
            } else {
                btn.innerHTML = "<i class='bx bx-map-pin text-xl'></i> Tentar Novamente";
                alert("A Google Maps falhou ao traçar esta rota. Erro: " + status);
            }
        });
    } catch(e) { btn.innerHTML = "<i class='bx bx-error text-xl'></i> Erro no Motor Google"; console.error(e); }
};

window.processarCruzamentoRadial = function(res, btn, clientesBase, destinosExcluidos, veiculoSelecionado, geocoder) {
    try {
        directionsRenderer.setDirections(res);
        
        if (!window.trafficLayer) window.trafficLayer = new google.maps.TrafficLayer();
        window.trafficLayer.setMap(mapRotaObj);

        let tDist = 0, tTime = 0;
        res.routes[0].legs.forEach(leg => {
            tDist += leg.distance ? leg.distance.value : 0;
            tTime += leg.duration_in_traffic ? leg.duration_in_traffic.value : (leg.duration ? leg.duration.value : 0);
        });
        
        document.getElementById('rota-stats').classList.remove('hidden');
        document.getElementById('stat-dist').innerText = (tDist / 1000).toFixed(1) + " km";
        
        let horas = Math.floor(tTime / 3600);
        let minutos = Math.floor((tTime % 3600) / 60);
        if (horas === 0 && minutos === 0 && tTime > 0) minutos = 1;
        document.getElementById('stat-tempo').innerText = horas > 0 ? `${horas}h ${minutos}m` : `${minutos}m`;
        
        if(!google.maps.geometry || !google.maps.geometry.spherical) return alert("Erro crítico: A biblioteca esférica não inicializou.");
        
        const detailedPath = [];
        res.routes[0].legs.forEach(leg => {
            leg.steps.forEach(step => {
                step.path.forEach(p => detailedPath.push(p));
            });
        });

        const RAIO_LOGISTICO_METROS = 50000; 

        // EVOLUÇÃO DE PERFORMANCE: Passo de 5km evita travamento do navegador em viagens estaduais
        const densePath = [];
        for (let i = 0; i < detailedPath.length - 1; i++) {
            const p1 = detailedPath[i];
            const p2 = detailedPath[i+1];
            densePath.push(p1);
            const dist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
            if (dist > 5000) { 
                const fractionSteps = Math.ceil(dist / 5000);
                for (let j = 1; j < fractionSteps; j++) {
                    densePath.push(google.maps.geometry.spherical.interpolate(p1, p2, j / fractionSteps));
                }
            }
        }
        if (detailedPath.length > 0) densePath.push(detailedPath[detailedPath.length - 1]);

        btn.innerHTML = `<div class='loader border-t-amber-400 mx-auto'></div> Mapeando Corredor 50km...`;
        
        const clientesIn = [];
        const clientesOut = []; 
        const clientesErro = []; 

        for (const cli of clientesBase) {
            if(!cli) continue; 
            const cliName = cli.nome ? String(cli.nome).toUpperCase().trim() : "";
            
            if(cliName && destinosExcluidos.includes(cliName)) continue; 

            const safeLatLng = getSafeLatLng(cli.lat, cli.lng);

            if (safeLatLng !== null) {
                let distMinima = Infinity;
                for (let i = 0; i < densePath.length; i++) {
                    const d = google.maps.geometry.spherical.computeDistanceBetween(safeLatLng, densePath[i]);
                    if (d < distMinima) distMinima = d;
                }

                if (distMinima <= RAIO_LOGISTICO_METROS) {
                    clientesIn.push({ ...cli, location: safeLatLng, dist: distMinima });
                } else {
                    clientesOut.push({ ...cli, location: safeLatLng, dist: distMinima });
                }
            } else {
                clientesErro.push(cli);
            }
        }

        window.renderizarRadarSincrono(clientesIn, clientesOut, clientesErro, veiculoSelecionado);

        btn.innerHTML = "<i class='bx bx-check-circle text-xl'></i> Rota Processada com Sucesso";
        setTimeout(() => { btn.innerHTML = "<i class='bx bx-map-pin text-xl animate-pulse'></i> Traçar Rota & Iniciar Varredura"; }, 3000);
        
    } catch(e) {
        console.error("Erro na matemática da rota:", e);
        btn.innerHTML = "<i class='bx bx-error text-xl'></i> Erro Matemático. Tente Novamente.";
    }
};

window.renderizarRadarSincrono = function(clientesIn, clientesOut, clientesErro, veiculo) {
    const containerLista = document.getElementById('conteudo-lista');
    const badge = document.getElementById('badge-places');
    const alerta = document.getElementById('alerta-sucesso');
    
    const emailMot = document.getElementById('radar-motorista').value;

    const totalAnalisados = clientesIn.length + clientesOut.length + clientesErro.length;
    if(badge) { 
        badge.innerText = `${clientesIn.length} NO CORREDOR 50KM | TOTAL BASE: ${totalAnalisados}`; 
        badge.classList.remove('hidden'); 
    }
    if(alerta) {
        alerta.classList.remove('hidden');
        setTimeout(() => alerta.classList.add('hidden'), 4000);
    }

    clientesIn.sort((a,b) => a.dist - b.dist);
    clientesOut.sort((a,b) => a.dist - b.dist);

    let h = '';
    
    if(clientesIn.length > 0) {
        h += `<h4 class="text-[10px] font-black text-amber-600 uppercase tracking-[0.2em] border-b-2 border-amber-200 pb-2 mb-4 mt-2"><i class='bx bx-radar'></i> Oportunidades na Rota (Raio 50km)</h4>`;
        
        for (const c of clientesIn) {
            const rawName = c.nome ? String(c.nome) : "Cliente Desconhecido";
            const rawAddress = (c.end || c.cid) ? String(c.end || c.cid) : "Endereço não informado";
            
            const escN = escapeHtml(rawName); 
            const escA = escapeHtml(rawAddress); 
            const telefoneReal = escapeHtml(c.tel ? String(c.tel) : '');
            const distKmVis = (c.dist / 1000).toFixed(1);

            h += `
            <div class="bg-white p-4 sm:p-5 border border-slate-200 rounded-2xl shadow-sm border-l-4 border-amber-400 hover:shadow-xl transition mb-4 relative overflow-hidden">
                <div class="flex justify-between items-start mb-2 relative z-10">
                    <h4 class="font-black text-slate-800 text-xs uppercase leading-tight w-3/4">${rawName}</h4>
                    <span class="text-[8px] sm:text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black whitespace-nowrap">${distKmVis} KM</span>
                </div>
                <p class="text-[9px] sm:text-[10px] text-slate-500 font-bold mb-4 leading-tight relative z-10 line-clamp-2"><i class='bx bx-map text-red-500'></i> ${rawAddress}</p>
                <div class="flex flex-col gap-2">
                    <button onclick="window.abrirPitchIA('${escN}','${escA}','${telefoneReal}')" class="w-full bg-slate-900 text-amber-500 py-3 rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest active:scale-95 transition flex justify-center gap-2 items-center relative z-10"><i class='bx bx-brain text-sm'></i> Abordagem IA</button>
                    <button onclick="window.adicionarClienteAoRomaneioRadar('${emailMot}', '${escN}', '${escA}')" class="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest active:scale-95 transition flex justify-center gap-2 items-center relative z-10 border border-green-500 shadow-md"><i class='bx bx-plus-circle text-sm'></i> Confirmar na Rota</button>
                </div>
            </div>`;
        }
    } else {
        h += `
        <div class="bg-slate-100 p-6 rounded-2xl text-center mb-6 border border-slate-200">
            <i class='bx bx-ghost text-4xl text-slate-300 mb-2'></i>
            <p class="text-[10px] sm:text-xs font-black text-slate-500 uppercase tracking-widest">Nenhuma loja da base<br>no raio de 50km da rota.</p>
        </div>`;
    }

    if (clientesErro.length > 0) {
        h += `<h4 class="text-[10px] font-black text-red-600 uppercase tracking-[0.2em] border-b-2 border-red-200 pb-2 mb-4 mt-6"><i class='bx bx-error'></i> Clientes Sem GPS (${clientesErro.length})</h4>`;
        for (const c of clientesErro) {
            const rawName = c.nome ? String(c.nome) : "Cadastro em Branco";
            h += `
            <div class="bg-red-50 p-4 border border-red-200 rounded-xl shadow-sm mb-4 border-l-4 border-red-600">
                <div class="flex justify-between items-start mb-1">
                    <h4 class="font-black text-red-800 text-xs uppercase leading-tight">${rawName}</h4>
                </div>
                <p class="text-[8px] sm:text-[9px] text-red-600 font-bold leading-tight">Ignorado pelo radar pois o cadastro não possui coordenadas GPS válidas. Edite e use o buscador do Google.</p>
            </div>`;
        }
    }

    if(clientesOut.length > 0) {
        h += `<h4 class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-200 pb-2 mb-4 mt-6"><i class='bx bx-block'></i> Longe da Rota (+50km)</h4>`;
        for (const c of clientesOut) {
            const distKm = Math.round(c.dist / 1000);
            const rawName = c.nome ? String(c.nome) : "Cliente";
            const rawAddress = (c.end || c.cid) ? String(c.end || c.cid) : "Endereço não informado";

            h += `
            <div class="bg-slate-100 p-3 sm:p-4 border border-slate-200 rounded-xl mb-3 opacity-75">
                <div class="flex justify-between items-start mb-1">
                    <h4 class="font-black text-slate-500 text-[9px] sm:text-[10px] uppercase leading-tight w-3/4 truncate">${rawName}</h4>
                    <span class="text-[7px] sm:text-[8px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-black whitespace-nowrap">${distKm} KM DE DISTÂNCIA</span>
                </div>
                <p class="text-[8px] sm:text-[9px] text-slate-400 font-bold leading-tight truncate"><i class='bx bx-map'></i> ${rawAddress}</p>
            </div>`;
        }
    }

    if(containerLista) {
        containerLista.innerHTML = h;
    }

    setTimeout(async () => {
        try {
            if(veiculo) {
                const veiculoSeguro = String(veiculo).replace(/[.#$\[\]]/g, '_'); 
                const radarObj = {};
                clientesIn.forEach(c => {
                    radarObj[c.id] = {
                        nome: c.nome ? String(c.nome) : "Desconhecido",
                        end: (c.end || c.cid) ? String(c.end || c.cid) : "Não informado",
                        lat: c.lat || 0,
                        lng: c.lng || 0
                    };
                });
                
                if (Object.keys(radarObj).length > 0) {
                    await db.ref(`${DB_ROOT}/radar_ativo/${veiculoSeguro}`).set(radarObj);
                } else {
                    await db.ref(`${DB_ROOT}/radar_ativo/${veiculoSeguro}`).remove();
                }
            }

            for (const c of clientesIn) {
                const m = await desenharMarcador(c.location, mapRotaObj, c.nome, "https://maps.google.com/mapfiles/ms/icons/red-dot.png");
                routeMarkers.push(m);
            }
            for (const c of clientesOut) {
                const distKm = Math.round(c.dist / 1000);
                const m = await desenharMarcador(c.location, mapRotaObj, `${c.nome} (Longe da Rota: ${distKm}km)`, "https://maps.google.com/mapfiles/ms/icons/blue-dot.png");
                routeMarkers.push(m);
            }
        } catch(e) { console.error("Aviso do processo Background:", e); }
    }, 50); 
};

window.abrirPitchIA = function(n, l, t) {
    const safePhone = t ? String(t).replace(/\D/g,'') : '';
    activePlaceDetails = { name: n, address: l, phone: safePhone };
    
    document.getElementById('ia-store-name').innerText = n || 'Sem Nome';
    document.getElementById('ia-store-address').innerText = l || 'Endereço não cadastrado';
    
    let phoneVal = activePlaceDetails.phone;
    if(phoneVal && !phoneVal.startsWith('55')) phoneVal = '55' + phoneVal;
    document.getElementById('ia-store-phone').value = phoneVal;
    
    window.abrirModal('modal-ia'); window.gerarTextoIA();
};

window.gerarTextoIA = async function() {
    const txt = document.getElementById('ia-texto'); const load = document.getElementById('ia-loading');
    if(load) load.classList.remove('hidden'); if(txt) txt.value = "";
    
    if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === "") {
        if(txt) txt.value = "⚠️ AVISO: A Chave da Inteligência Artificial não está configurada no seu painel.\n\nPor favor, vá ao menu 'Configurações & APIs' (no menu lateral escuro) e insira sua API Key do Google Gemini para que o Cérebro IA comece a redigir os textos automaticamente.";
        if(load) load.classList.add('hidden');
        return;
    }

    const ctx = document.getElementById('ia-contexto').options[document.getElementById('ia-contexto').selectedIndex].text;
    const prompt = `Meu nome é AEDLog Diretor de Logística da AED Marcenaria. Escreva uma mensagem de WhatsApp para o cliente cadastrado "${activePlaceDetails.name}" (Cidade/Local: ${activePlaceDetails.address}). Contexto: Estamos a planear a rota logística dos próximos dias e o nosso caminhão vai passar obrigatoriamente na região ou estrada deles para realizar outras entregas. A nossa estratégia com eles agora é: "${ctx}". Instruções: Como já são nossos clientes, seja cordial e próximo. O grande benefício é que podemos colocar mercadoria, alguma peça de reposição à "boleia" no caminhão com ZERO CUSTO DE FRETE ou mesmo fazer uma visita e tomar um cafezinho. Não envie a mensagem como se o caminhão estivesse à porta agora, mostre que estamos a organizar a logística semanal. Use 2 ou 3 emojis, tom profissional mas atencioso, e feche com uma pergunta que gere interação imediata.`;
    
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, { 
            method: 'POST', 
            headers: {'Content-Type':'application/json'}, 
            body: JSON.stringify({ contents: [{parts:[{text: prompt}]}] }) 
        });
        
        const d = await res.json(); 
        
        if (!res.ok) {
            console.error("Falha no Google API:", d);
            throw new Error(d.error ? d.error.message : "Sua chave de API foi recusada pelo Servidor do Google.");
        }

        if(txt && d.candidates && d.candidates.length > 0) {
            txt.value = d.candidates[0].content.parts[0].text;
        } else {
            throw new Error("A Inteligência Artificial processou, mas não retornou texto útil.");
        }
    } catch(e) { 
        console.error("Erro detalhado IA:", e);
        if(txt) txt.value = `⚠️ Falha de Conexão com o Google AI.\n\nMotivo Técnico: ${e.message}\n\nO que fazer?\n1. Verifique em 'Configurações & APIs' se a sua Chave do Gemini está correta e sem espaços em branco no final.\n2. Acesse o painel do Google AI Studio e verifique se a sua conta não está bloqueada ou sem saldo para uso de APIs de texto.`; 
    } finally { 
        if(load) load.classList.add('hidden'); 
    }
};

window.enviarWpp = function() { 
    const num = document.getElementById('ia-store-phone').value; 
    const txt = document.getElementById('ia-texto').value; 
    if(num && txt && num.length > 8) { 
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(txt)}`, '_blank'); 
    } else {
        alert("Ação negada: Aguarde a IA redigir a mensagem e verifique se o número do WhatsApp está preenchido corretamente.");
    }
};


/* ==============================================================
   BLOCO 7: PAINEL DE GESTÃO E ADMINISTRAÇÃO (LISTAGENS FIREBASE)
   ============================================================== */
function carregarMecanismoAdmin() {
    db.ref(`${DB_ROOT}/clientes`).on('value', snap => {
        let h = ''; let cCount = 0;
        snap.forEach(c => { 
            cCount++; 
            const d = c.val(); 
            const geoBadge = (d.lat && d.lng) ? `<span class="bg-green-100 text-green-700 text-[8px] px-1 rounded ml-2" title="Coordenadas Salvas">GPS OK</span>` : `<span class="bg-red-100 text-red-700 text-[8px] px-1 rounded ml-2" title="Sem GPS">FALHA GPS</span>`;
            h += `<tr class="hover:bg-slate-50 transition border-b"><td class="p-4 font-black text-slate-800 text-xs uppercase flex items-center">${d.nome} ${geoBadge}</td><td class="p-4 text-xs font-bold text-slate-600">${d.tel}</td><td class="p-4 text-[9px] font-black uppercase text-slate-400 tracking-widest">${d.cid}</td><td class="p-4 text-center whitespace-nowrap">
                <button onclick="window.editarCliente('${c.key}', '${escapeHtml(d.nome)}', '${escapeHtml(d.tel)}', '${escapeHtml(d.cid)}', '${escapeHtml(d.end || '')}', '${escapeHtml(d.comprador || '')}', '${escapeHtml(d.dono || '')}', '${escapeHtml(d.pessoa_contato || '')}', '${escapeHtml(d.email_contato || '')}', '${escapeHtml(d.telefone_contato || '')}', '${escapeHtml(d.obs || '')}')" class="text-blue-400 hover:text-blue-600 mr-3"><i class='bx bx-edit text-lg'></i></button>
                <button onclick="window.excluir('clientes', '${c.key}')" class="text-red-300 hover:text-red-600"><i class='bx bx-trash text-lg'></i></button>
            </td></tr>`; 
        });
        const lc = document.getElementById('lista-clientes'); if(lc) lc.innerHTML = h;
        const dc = document.getElementById('dash-clientes'); if(dc) dc.innerText = cCount;
    });

    db.ref(`${DB_ROOT}/cargas`).on('value', snap => {
        let h = ''; let rCount = 0;
        snap.forEach(c => {
            const d = c.val(); if(d.status === 'Em Rota') rCount++;
            
            let stCls = 'bg-blue-100 text-blue-700';
            if (d.status === 'Entregue') stCls = 'bg-green-100 text-green-700';
            if (d.status === 'Montando Rota') stCls = 'bg-amber-100 text-amber-700 animate-pulse';

            const infosEntrega = d.data_entrega ? `<div class="mt-2 text-[8px] font-black text-green-600 bg-green-50 p-1.5 rounded uppercase tracking-widest border border-green-200"><i class='bx bx-check-double'></i> ${new Date(d.data_entrega).toLocaleString('pt-BR')} <br>POR: ${d.entregue_por}<br>ASSINOU: ${d.recebedor || 'N/A'}<br>OBS: ${d.obs_entrega || 'Nenhuma'}</div>` : '';
            
            let actBtn = '';
            if(d.status === 'Montando Rota') {
                actBtn = `<button onclick="window.abrirModalAtribuirVeiculo('${escapeHtml(d.motorista_email)}', '${escapeHtml(d.motorista_nome)}')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-md transition active:scale-95 mb-1 block w-full"><i class='bx bx-play-circle text-sm align-middle'></i> Despachar</button>`;
            }

            h += `<tr class="border-b text-xs hover:bg-slate-50 transition"><td class="p-4"><span class="px-2 py-1 rounded-lg font-black text-[9px] uppercase ${stCls}">${d.status}</span>${infosEntrega}</td><td class="p-4 font-black tracking-widest text-slate-800 uppercase">${d.motorista_nome || ''}<br><span class="text-[8px] text-red-500 font-bold">Via: ${d.veiculo || 'Planejamento Pendente'}</span></td><td class="p-4 font-bold text-slate-700 uppercase"><i class='bx bxs-map text-red-500'></i> ${d.destino}</td><td class="p-4 text-[9px] text-slate-400 font-medium">NFe: ${d.nfe}<br>${d.desc}</td><td class="p-4 text-center align-middle">${actBtn}<button onclick="window.excluir('cargas', '${c.key}')" class="text-red-300 hover:text-red-600 mt-1"><i class='bx bx-trash text-lg'></i></button></td></tr>`;
        });
        const lr = document.getElementById('lista-cargas'); if(lr) lr.innerHTML = h;
        const dr = document.getElementById('dash-cargas'); if(dr) dr.innerText = rCount;
    });

    db.ref(`${DB_ROOT}/frota`).on('value', snap => {
        let count = 0; let h = '';
        snap.forEach(f => {
            count++; const d = f.val(); const st = d.status || 'Disponível';
            const stCls = st === 'Disponível' ? 'bg-green-100 text-green-600' : (st === 'Em Rota' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600');
            h += `<div class="bg-white p-5 rounded-2xl border flex flex-col hover:shadow-lg transition relative overflow-hidden"><button onclick="window.editarFrota('${f.key}', '${escapeHtml(d.placa)}', '${escapeHtml(d.modelo)}', '${escapeHtml(st)}')" class="absolute top-3 right-3 text-blue-400 hover:text-blue-600 transition"><i class='bx bx-edit text-xl'></i></button><div class="flex justify-between items-start mb-4 pr-6"><div><h4 class="font-black text-2xl tracking-widest text-slate-800">${d.placa}</h4><p class="text-[10px] uppercase font-bold text-slate-400 tracking-widest">${d.modelo}</p></div><span class="text-[8px] font-black uppercase px-2 py-1 rounded-lg ${stCls}">${st}</span></div><div class="flex gap-2 mt-auto border-t pt-4"><button onclick="window.abrirModalManutencao('${d.placa}')" class="flex-1 bg-slate-900 text-white py-2 rounded-xl text-[9px] font-black uppercase tracking-widest active:scale-95">Oficina</button><button onclick="window.excluir('frota', '${f.key}')" class="text-red-300 hover:text-red-600 p-2"><i class='bx bx-trash text-lg'></i></button></div></div>`;
        });
        const lf = document.getElementById('lista-frota'); if(lf) lf.innerHTML = h;
        const df = document.getElementById('dash-frota'); if(df) df.innerText = count;
    });

    db.ref(`${DB_ROOT}/equipe`).on('value', snap => {
        let h = ''; snap.forEach(e => {
            const d = e.val();
            h += `<div class="bg-white p-5 rounded-2xl border flex items-center gap-4 hover:border-red-300 transition relative"><div class="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center text-2xl shadow-inner"><i class='bx bxs-user-detail'></i></div><div class="pr-12"><h4 class="font-black text-slate-800 text-sm uppercase leading-none mb-1">${d.nome}</h4><p class="text-[9px] text-red-500 font-black uppercase tracking-widest">${d.cargo}</p><p class="text-[10px] text-slate-400 mt-2 font-medium">${d.email}</p></div><button onclick="window.editarEquipe('${e.key}', '${escapeHtml(d.nome)}', '${escapeHtml(d.cargo)}', '${escapeHtml(d.cnh||'')}')" class="absolute top-3 right-10 text-blue-300 hover:text-blue-600 transition"><i class='bx bx-edit text-xl'></i></button><button onclick="window.excluirUser('${e.key}')" class="absolute top-3 right-3 text-red-200 hover:text-red-600 transition"><i class='bx bx-user-x text-xl'></i></button></div>`;
        });
        const le = document.getElementById('lista-equipe'); if(le) le.innerHTML = h;
    });

    db.ref(`${DB_ROOT}/manutencao`).on('value', snap => {
        let h = ''; snap.forEach(m => {
            const d = m.val();
            let anexosHtml = '';
            if(d.imgOrcamento) anexosHtml += `<a href="${d.imgOrcamento}" target="_blank" class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-[8px] font-black uppercase shadow-sm inline-block mr-1 hover:bg-indigo-200">Orçamento</a>`;
            if(d.imgNfe) anexosHtml += `<a href="${d.imgNfe}" target="_blank" class="bg-teal-100 text-teal-700 px-2 py-1 rounded text-[8px] font-black uppercase shadow-sm inline-block hover:bg-teal-200">NFe</a>`;
            
            h += `<tr class="border-b text-xs hover:bg-slate-50 transition"><td class="p-4"><p class="text-[8px] font-black text-slate-400 uppercase tracking-widest">${new Date(d.data).toLocaleDateString('pt-BR')}</p><p class="font-bold text-slate-800">${d.tipo}</p></td><td class="p-4 font-black text-slate-800 tracking-widest">${d.veiculo}</td><td class="p-4 text-slate-500 italic text-[11px]">"${d.desc}"<br><div class="mt-1">${anexosHtml}</div></td><td class="p-4 text-right font-black text-red-600">R$ ${parseFloat(d.valor).toFixed(2)}</td><td class="p-4 text-center"><button onclick="window.excluir('manutencao', '${m.key}')" class="text-red-300 hover:text-red-600"><i class='bx bx-trash text-lg'></i></button></td></tr>`;
        });
        const lo = document.getElementById('lista-oficina'); if(lo) lo.innerHTML = h;
    });

    db.ref(`${DB_ROOT}/ocorrencias`).on('value', snap => {
        const eventos = [];
        snap.forEach(o => { eventos.push({...o.val(), id: o.key}); });
        eventos.sort((a,b) => b.data - a.data); 

        let oCount = eventos.length;
        let grouped = {};
        
        eventos.forEach(d => {
            let mot = d.motorista || "Sem Identificação";
            let rota = d.veiculo || "Sem Rota";
            if(!grouped[mot]) grouped[mot] = {};
            if(!grouped[mot][rota]) grouped[mot][rota] = [];
            grouped[mot][rota].push(d);
        });

        let h = ''; 
        let motIndex = 0;
        
        for(let mot in grouped) {
            motIndex++;
            let totalMotEvents = Object.values(grouped[mot]).flat().length;
            let motIdSafe = 'mot_' + mot.replace(/\W/g, '') + motIndex;
            
            h += `<div class="bg-white border border-slate-200 rounded-2xl mb-6 shadow-sm overflow-hidden">
                    <div class="bg-slate-900 hover:bg-black transition p-4 sm:p-5 text-white flex items-center justify-between cursor-pointer" onclick="document.getElementById('${motIdSafe}').classList.toggle('hidden'); this.querySelector('.bx-chevron-down').classList.toggle('rotate-180')">
                        <h4 class="font-black text-sm sm:text-base uppercase tracking-widest flex items-center gap-3"><i class='bx bxs-user-badge text-blue-500 text-2xl'></i> ${mot}</h4>
                        <div class="flex items-center gap-4">
                            <span class="bg-blue-600 text-[10px] px-3 py-1.5 rounded-lg font-black tracking-widest">${totalMotEvents} EVENTOS</span>
                            <i class='bx bx-chevron-down text-2xl transition-transform duration-300'></i>
                        </div>
                    </div>
                    <div id="${motIdSafe}" class="p-4 sm:p-6 space-y-6 hidden bg-slate-50">`;
            
            let rotaIndex = 0;
            for(let rota in grouped[mot]) {
                rotaIndex++;
                let rotaIdSafe = motIdSafe + '_rota_' + rotaIndex;
                let eventosRota = grouped[mot][rota];

                h += `<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ml-2 sm:ml-4 border-l-4 border-l-indigo-500">
                        <div class="bg-slate-100 hover:bg-slate-200 transition p-3 sm:p-4 flex items-center justify-between cursor-pointer border-b border-slate-200" onclick="document.getElementById('${rotaIdSafe}').classList.toggle('hidden'); this.querySelector('.bx-chevron-down').classList.toggle('rotate-180')">
                            <h5 class="font-black text-xs sm:text-sm text-slate-700 uppercase tracking-widest flex items-center gap-2"><i class='bx bxs-truck text-indigo-500 text-lg'></i> ROTA: ${rota}</h5>
                            <div class="flex items-center gap-3">
                                <span class="text-[10px] font-bold text-slate-500">${eventosRota.length} registros</span>
                                <i class='bx bx-chevron-down text-lg text-slate-500 transition-transform duration-300'></i>
                            </div>
                        </div>
                        <div id="${rotaIdSafe}" class="p-4 sm:p-5 space-y-5 hidden bg-white">`;

                eventosRota.forEach(d => {
                    let corBorder = 'border-slate-200';
                    let corIcone = 'text-slate-500';
                    let icone = "<i class='bx bx-info-circle'></i>";
                    let bgIcone = "bg-slate-100";

                    if (d.tipo && d.tipo.includes('Visita') && d.desc && d.desc.includes('Venda Realizada')) {
                        corBorder = 'border-emerald-200'; corIcone = 'text-emerald-600'; icone = "<i class='bx bx-money'></i>"; bgIcone = "bg-emerald-100";
                    } else if (d.tipo && d.tipo.includes('Visita')) {
                        corBorder = 'border-amber-200'; corIcone = 'text-amber-600'; icone = "<i class='bx bxs-user-detail'></i>"; bgIcone = "bg-amber-100";
                    } else if (d.tipo && d.tipo.includes('Entrega')) {
                        corBorder = 'border-blue-200'; corIcone = 'text-blue-600'; icone = "<i class='bx bx-package'></i>"; bgIcone = "bg-blue-100";
                    } else if (d.tipo && d.tipo.includes('Combustível')) {
                        corBorder = 'border-orange-200'; corIcone = 'text-orange-600'; icone = "<i class='bx bxs-gas-pump'></i>"; bgIcone = "bg-orange-100";
                    } else if (d.tipo && d.tipo.includes('Pedágio')) {
                        corBorder = 'border-slate-300'; corIcone = 'text-slate-700'; icone = "<i class='bx bx-barrier'></i>"; bgIcone = "bg-slate-200";
                    }

                    const lnk = d.imgUrl ? `<a href="${d.imgUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-slate-800 hover:bg-black text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md transition"><i class='bx bx-link-external'></i> Ver Anexo</a>` : ``;

                    let detalhesComissao = '';
                    if(d.tipoVenda === 'oportunidade' && parseFloat(d.taxa_sistema) > 0) {
                        detalhesComissao = `<span class="block mt-3 text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded inline-block border border-indigo-100"><i class='bx bx-coin-stack'></i> Taxa Plataforma IA: R$ ${parseFloat(d.taxa_sistema).toFixed(2)}</span>`;
                    }
                    
                    let badgeTipoVenda = '';
                    if(d.tipoVenda) {
                        let corBadge = d.tipoVenda === 'oportunidade' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white';
                        badgeTipoVenda = `<span class="${corBadge} text-[8px] font-black uppercase px-2 py-0.5 rounded ml-2 tracking-widest shadow-sm">${d.tipoVenda}</span>`;
                    }

                    const renderValor = (d.valor && parseFloat(d.valor)>0) ? `<div class="text-right flex-shrink-0"><p class="text-sm sm:text-base font-black ${corIcone}">R$ ${parseFloat(d.valor).toFixed(2)}</p></div>` : '';

                    h += `
                    <div class="flex gap-4 relative">
                        <div class="w-10 h-10 rounded-full ${bgIcone} ${corIcone} flex items-center justify-center text-xl flex-shrink-0 shadow-sm border ${corBorder} z-10">${icone}</div>
                        <div class="absolute left-5 top-10 bottom-[-20px] w-0.5 bg-slate-100 z-0 last:hidden"></div>
                        <div class="flex-grow bg-white border ${corBorder} p-4 rounded-xl shadow-sm hover:shadow-md transition relative">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <p class="text-xs sm:text-sm font-black text-slate-800 uppercase tracking-widest flex items-center">${d.tipo} ${badgeTipoVenda}</p>
                                    <p class="text-[9px] text-slate-400 font-bold uppercase mt-0.5 tracking-wider"><i class='bx bx-time-five'></i> ${new Date(d.data).toLocaleString('pt-BR')}</p>
                                </div>
                                ${renderValor}
                            </div>
                            <p class="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 mt-2">"${d.desc}"</p>
                            ${detalhesComissao}
                            ${lnk}
                            <button onclick="window.excluir('ocorrencias', '${d.id}')" class="absolute top-2 right-2 text-slate-300 hover:text-red-500 transition" title="Excluir Registro"><i class='bx bx-x text-xl'></i></button>
                        </div>
                    </div>`;
                });

                h += `</div></div>`; 
            }
            
            h += `</div></div>`; 
        }
        
        const loc = document.getElementById('lista-ocorrencias'); if(loc) loc.innerHTML = h || "<div class='text-center p-10 bg-slate-50 rounded-2xl border border-slate-200'><i class='bx bx-ghost text-5xl text-slate-300 mb-3'></i><p class='text-xs font-black text-slate-400 uppercase tracking-widest'>Nenhuma atividade registrada.</p></div>";
        const doc = document.getElementById('dash-ocorrencias'); if(doc) doc.innerText = oCount;
    });

    db.ref(`${DB_ROOT}/gps_tracking`).on('value', snap => {
        let at = 0; if(snap.exists() && mapRastreioObj) {
            snap.forEach(g => {
                const d = g.val(); const placa = g.key;
                if(d.status === 'online') {
                    at++;
                    window.atualizarMarcadorVeiculo(placa, d.lat, d.lng, d.motorista);
                } else { if(markersFrota[placa]) { markersFrota[placa].setMap(null); delete markersFrota[placa]; } }
            });
        }
        const elDashGps = document.getElementById('dash-gps-ativos'); if(elDashGps) elDashGps.innerText = at;
    });
}

window.atualizarMarcadorVeiculo = async function(placa, lat, lng, motorista) {
    if(!mapRastreioObj || !window.google) return;
    const safePos = getSafeLatLng(lat, lng);
    if(!safePos) return;

    if(markersFrota[placa]) { 
        if(markersFrota[placa].position) { markersFrota[placa].position = safePos; } 
        else { markersFrota[placa].setPosition(safePos); }
    } else {
        markersFrota[placa] = await desenharMarcador(safePos, mapRastreioObj, `${placa} - Condutor: ${motorista}`, "https://maps.google.com/mapfiles/ms/icons/truck.png");
        const info = new google.maps.InfoWindow({ content: `<div style="padding: 10px; font-family: sans-serif;"><h4 style="font-weight: 900; color: #b91c1c; margin-bottom: 5px;">${placa}</h4><p style="font-size: 12px; margin: 0;"><b>Operador:</b> ${motorista}</p><p style="font-size: 10px; color: #22c55e; font-weight: bold; margin-top: 5px;">Satélite Online</p></div>` });
        markersFrota[placa].addListener("click", () => { info.open(mapRastreioObj, markersFrota[placa]); });
    }
};


/* ==============================================================
   BLOCO 8: FORMULÁRIOS DE CADASTRO E EDIÇÃO DE DADOS 
   ============================================================== */

// LÓGICA DE CADASTRO DE NOVO CLIENTE
const frmCliente = document.getElementById('form-cliente');
if(frmCliente) {
    frmCliente.onsubmit = (e) => {
        e.preventDefault();
        const btn = frmCliente.querySelector('button[type="submit"]'); const oldText = btn.innerHTML;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Cadastrando..."; btn.disabled = true;

        const nome = document.getElementById('cli-nome').value;
        const tel = document.getElementById('cli-tel').value;
        const cid = document.getElementById('cli-cidade').value;
        const end = document.getElementById('cli-end').value;
        
        const comprador = document.getElementById('cli-comprador').value;
        const dono = document.getElementById('cli-dono').value;
        const pContato = document.getElementById('cli-pessoa-contato').value;
        const eContato = document.getElementById('cli-email-contato').value;
        const tContato = document.getElementById('cli-telefone-contato').value;
        const obs = document.getElementById('cli-obs').value;

        const payload = { nome, tel, cid, end, comprador, dono, pessoa_contato: pContato, email_contato: eContato, telefone_contato: tContato, obs };

        if (clienteGooglePlaceLocation) {
            payload.end = clienteGooglePlaceLocation.formatted_address; payload.lat = clienteGooglePlaceLocation.lat; payload.lng = clienteGooglePlaceLocation.lng;
            db.ref(`${DB_ROOT}/clientes`).push(payload).then(() => {
                window.fecharModal('modal-cliente'); btn.innerHTML = oldText; btn.disabled = false; frmCliente.reset(); alert("Loja gravada com sucesso e Coordenadas GPS ativadas!");
            });
        } else if (window.google && google.maps.Geocoder) {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ address: end }, (res, stat) => {
                if (stat === 'OK' && res[0]) {
                    payload.end = res[0].formatted_address; payload.lat = res[0].geometry.location.lat(); payload.lng = res[0].geometry.location.lng();
                    db.ref(`${DB_ROOT}/clientes`).push(payload).then(() => {
                        window.fecharModal('modal-cliente'); btn.innerHTML = oldText; btn.disabled = false; frmCliente.reset(); alert("Loja gravada. O GPS foi capturado automaticamente pelo Google.");
                    });
                } else {
                    db.ref(`${DB_ROOT}/clientes`).push(payload).then(() => {
                        window.fecharModal('modal-cliente'); btn.innerHTML = oldText; btn.disabled = false; frmCliente.reset(); alert("Loja gravada apenas como texto, sem GPS exato (Alerta no Radar).");
                    });
                }
            });
        } else {
            db.ref(`${DB_ROOT}/clientes`).push(payload).then(() => {
                window.fecharModal('modal-cliente'); btn.innerHTML = oldText; btn.disabled = false; frmCliente.reset(); alert("Loja gravada.");
            });
        }
    };
}

window.editarCliente = function(id, nome, tel, cid, end, comprador, dono, pContato, eContato, tContato, obs) {
    document.getElementById('edit-cli-id').value = id;
    document.getElementById('edit-cli-nome').value = nome;
    document.getElementById('edit-cli-tel').value = tel;
    document.getElementById('edit-cli-cidade').value = cid;
    document.getElementById('edit-cli-end').value = end;
    
    document.getElementById('edit-cli-comprador').value = comprador || '';
    document.getElementById('edit-cli-dono').value = dono || '';
    document.getElementById('edit-cli-pessoa-contato').value = pContato || '';
    document.getElementById('edit-cli-email-contato').value = eContato || '';
    document.getElementById('edit-cli-telefone-contato').value = tContato || '';
    document.getElementById('edit-cli-obs').value = obs || '';

    editClienteGooglePlaceLocation = null;
    window.abrirModal('modal-edit-cliente');
};

const frmEditCliente = document.getElementById('form-edit-cliente');
if(frmEditCliente) {
    frmEditCliente.onsubmit = (e) => {
        e.preventDefault();
        const btn = frmEditCliente.querySelector('button[type="submit"]'); const oldText = btn.innerHTML;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Atualizando..."; btn.disabled = true;

        const id = document.getElementById('edit-cli-id').value;
        const nome = document.getElementById('edit-cli-nome').value;
        const tel = document.getElementById('edit-cli-tel').value;
        const cid = document.getElementById('edit-cli-cidade').value;
        const end = document.getElementById('edit-cli-end').value;

        const comprador = document.getElementById('edit-cli-comprador').value;
        const dono = document.getElementById('edit-cli-dono').value;
        const pContato = document.getElementById('edit-cli-pessoa-contato').value;
        const eContato = document.getElementById('edit-cli-email-contato').value;
        const tContato = document.getElementById('edit-cli-telefone-contato').value;
        const obs = document.getElementById('edit-cli-obs').value;

        const payload = { nome, tel, cid, end, comprador, dono, pessoa_contato: pContato, email_contato: eContato, telefone_contato: tContato, obs };

        if (editClienteGooglePlaceLocation) {
            payload.end = editClienteGooglePlaceLocation.formatted_address; payload.lat = editClienteGooglePlaceLocation.lat; payload.lng = editClienteGooglePlaceLocation.lng;
            db.ref(`${DB_ROOT}/clientes/${id}`).update(payload).then(() => {
                window.fecharModal('modal-edit-cliente'); btn.innerHTML = oldText; btn.disabled = false; alert("Loja editada com GPS atualizado perfeitamente.");
            });
        } else if (window.google && google.maps.Geocoder) {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ address: end }, (res, stat) => {
                if (stat === 'OK' && res[0]) {
                    payload.end = res[0].formatted_address; payload.lat = res[0].geometry.location.lat(); payload.lng = res[0].geometry.location.lng();
                    db.ref(`${DB_ROOT}/clientes/${id}`).update(payload).then(() => {
                        window.fecharModal('modal-edit-cliente'); btn.innerHTML = oldText; btn.disabled = false; alert("Loja atualizada via texto com GPS recapturado pelo Google.");
                    });
                } else {
                    db.ref(`${DB_ROOT}/clientes/${id}`).update(payload).then(() => {
                        window.fecharModal('modal-edit-cliente'); btn.innerHTML = oldText; btn.disabled = false; alert("Loja editada, mas o novo endereço não gerou GPS automático. Edite de novo se ela falhar no Radar.");
                    });
                }
            });
        } else {
            db.ref(`${DB_ROOT}/clientes/${id}`).update(payload).then(() => {
                window.fecharModal('modal-edit-cliente'); btn.innerHTML = oldText; btn.disabled = false; alert("Dados de texto da Loja atualizados.");
            });
        }
    };
}

window.editarFrota = function(id, placa, modelo, status) {
    document.getElementById('edit-fr-id').value = id;
    document.getElementById('edit-fr-placa').value = placa;
    document.getElementById('edit-fr-modelo').value = modelo;
    document.getElementById('edit-fr-status').value = status;
    window.abrirModal('modal-edit-frota');
};

const frmEditFrota = document.getElementById('form-edit-frota');
if(frmEditFrota) {
    frmEditFrota.onsubmit = (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-fr-id').value;
        db.ref(`${DB_ROOT}/frota/${id}`).update({
            placa: document.getElementById('edit-fr-placa').value.toUpperCase(),
            modelo: document.getElementById('edit-fr-modelo').value,
            status: document.getElementById('edit-fr-status').value
        }).then(() => { window.fecharModal('modal-edit-frota'); alert("Veículo Atualizado."); });
    };
}

const frmFrota = document.getElementById('form-frota');
if(frmFrota) {
    frmFrota.onsubmit = async (e) => {
        e.preventDefault();
        await db.ref(`${DB_ROOT}/frota`).push({
            placa: document.getElementById('fr-placa').value.toUpperCase(),
            modelo: document.getElementById('fr-modelo').value,
            status: document.getElementById('fr-status').value
        });
        window.fecharModal('modal-frota'); e.target.reset();
    };
}

window.editarEquipe = function(id, nome, cargo, cnh) {
    document.getElementById('edit-eq-id').value = id;
    document.getElementById('edit-eq-nome').value = nome;
    document.getElementById('edit-eq-cargo').value = cargo;
    document.getElementById('edit-eq-cnh').value = cnh;
    window.abrirModal('modal-edit-equipe');
};

const frmEditEquipe = document.getElementById('form-edit-equipe');
if(frmEditEquipe) {
    frmEditEquipe.onsubmit = (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-eq-id').value;
        db.ref(`${DB_ROOT}/equipe/${id}`).update({
            nome: document.getElementById('edit-eq-nome').value,
            cargo: document.getElementById('edit-eq-cargo').value,
            cnh: document.getElementById('edit-eq-cnh').value
        }).then(() => { window.fecharModal('modal-edit-equipe'); alert("Dados do Colaborador Atualizados."); });
    };
}

window.abrirModalManutencao = function(placa = '') {
    document.getElementById('man-veiculo').value = placa;
    window.abrirModal('modal-manutencao');
};

async function uploadToCloudinary(fileInputId) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput || fileInput.files.length === 0) return "";
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) return "";
    
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', 'aed_logistica_oficina');
    
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`, { method: 'POST', body: formData });
    if (!response.ok) throw new Error("Falha no servidor de imagens.");
    const data = await response.json();
    await db.ref(`${DB_ROOT}/config/cloudinary_bytes_used`).set(CLOUDINARY_BYTES_USED + data.bytes);
    return data.secure_url;
}

const frmMan = document.getElementById('form-manutencao');
if(frmMan) {
    frmMan.onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-salvar-manutencao');
        const oldText = btn.innerHTML; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Processando Imagens e Salvando..."; btn.disabled = true;
        try {
            let linkOrcamento = "";
            let linkNfe = "";

            if(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET) {
                linkOrcamento = await uploadToCloudinary('man-foto-orcamento');
                linkNfe = await uploadToCloudinary('man-foto-nfe');
            } else {
                const imgO = document.getElementById('man-foto-orcamento');
                const imgN = document.getElementById('man-foto-nfe');
                if((imgO && imgO.files.length > 0) || (imgN && imgN.files.length > 0)) {
                    alert("Atenção: A chave do Cloudinary não está configurada no Cofre. As imagens não puderam ser anexadas ao relatório.");
                }
            }

            await db.ref(`${DB_ROOT}/manutencao`).push({
                veiculo: document.getElementById('man-veiculo').value.toUpperCase(),
                tipo: document.getElementById('man-tipo').value,
                desc: document.getElementById('man-desc').value,
                valor: document.getElementById('man-valor').value || 0,
                imgOrcamento: linkOrcamento,
                imgNfe: linkNfe,
                data: Date.now()
            });
            
            // Atualiza status do veículo para 'Em Oficina'
            const p = document.getElementById('man-veiculo').value.toUpperCase();
            const snap = await db.ref(`${DB_ROOT}/frota`).orderByChild('placa').equalTo(p).once('value');
            snap.forEach(f => { db.ref(`${DB_ROOT}/frota/${f.key}/status`).set('Em Oficina'); });

            window.fecharModal('modal-manutencao'); e.target.reset(); alert("Serviço de Oficina Registrado com sucesso!");
        } catch(err) { alert("Erro ao lançar oficina: " + err.message); }
        finally { btn.innerHTML = oldText; btn.disabled = false; }
    };
}

// ATRIBUIÇÃO V5: MOTORISTA PRIMEIRO, CAMINHÃO DEPOIS
window.abrirModalCarga = function() {
    db.ref(`${DB_ROOT}/equipe`).once('value', snap => { 
        let h = '<option value="">1. Selecione o Motorista</option>'; 
        if(snap.exists()) { 
            snap.forEach(e => { 
                if(e.val().cargo === 'motorista') { 
                    h += `<option value="${e.val().email}" data-nome="${e.val().nome}">${e.val().nome}</option>`; 
                } 
            }); 
        } 
        const cm = document.getElementById('carga-motorista'); 
        if(cm) cm.innerHTML = h; 
    });
    
    db.ref(`${DB_ROOT}/clientes`).once('value', snap => { 
        let h = '<option value="">2. Selecione a Loja de Descarga</option>'; 
        if(snap.exists()) { 
            snap.forEach(c => { 
                const endCompleto = c.val().end ? c.val().end : c.val().cid;
                h += `<option value="${endCompleto}" data-nome="${c.val().nome}">${c.val().nome} (${c.val().cid})</option>`; 
            }); 
        } 
        const cc = document.getElementById('carga-cliente'); 
        if(cc) cc.innerHTML = h; 
    });
    
    window.abrirModal('modal-carga');
};

const frmCarga = document.getElementById('form-carga');
if(frmCarga) {
    frmCarga.onsubmit = (e) => {
        e.preventDefault(); 
        
        const sm = document.getElementById('carga-motorista'); 
        const selCliente = document.getElementById('carga-cliente');
        
        db.ref(`${DB_ROOT}/cargas`).push({ 
            veiculo: '', 
            motorista_email: sm.value, 
            motorista_nome: sm.options[sm.selectedIndex].getAttribute('data-nome'), 
            destino: selCliente.options[selCliente.selectedIndex].getAttribute('data-nome'), 
            endereco_destino: selCliente.value, 
            nfe: document.getElementById('carga-nfe').value, 
            desc: document.getElementById('carga-desc').value, 
            status: 'Montando Rota', 
            data: Date.now() 
        });
        
        window.fecharModal('modal-carga'); 
        e.target.reset();
    };
}

window.abrirModalAtribuirVeiculo = function(email, nome) {
    document.getElementById('atr-motorista-email').value = email;
    document.getElementById('atr-motorista-nome-display').innerText = "LIBERAR CARGA PARA: " + nome;

    db.ref(`${DB_ROOT}/frota`).once('value', snap => {
        let h = '<option value="">Selecione a Viatura Disponível</option>';
        if(snap.exists()) {
            snap.forEach(f => {
                const st = f.val().status;
                if(st === 'Disponível') {
                    h += `<option value="${f.val().placa}">${f.val().placa} (${f.val().modelo})</option>`;
                } else {
                    h += `<option value="${f.val().placa}" disabled>${f.val().placa} (Atualmente: ${st})</option>`;
                }
            });
        }
        document.getElementById('atr-veiculo').innerHTML = h;
    });
    window.abrirModal('modal-atribuir-veiculo');
};

const frmAtrVeiculo = document.getElementById('form-atribuir-veiculo');
if(frmAtrVeiculo) {
    frmAtrVeiculo.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('atr-motorista-email').value;
        const placa = document.getElementById('atr-veiculo').value;
        const btn = frmAtrVeiculo.querySelector('button[type="submit"]');
        const oldHtml = btn.innerHTML;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin text-xl'></i> Despachando..."; btn.disabled = true;

        try {
            const snap = await db.ref(`${DB_ROOT}/cargas`).orderByChild('motorista_email').equalTo(email).once('value');
            const updates = {};
            let rotasAlteradas = 0;
            
            snap.forEach(c => {
                if(c.val().status === 'Montando Rota') {
                    updates[`${DB_ROOT}/cargas/${c.key}/veiculo`] = placa;
                    updates[`${DB_ROOT}/cargas/${c.key}/status`] = 'Em Rota';
                    rotasAlteradas++;
                }
            });

            if(rotasAlteradas > 0) {
                await db.ref().update(updates);
                const fSnap = await db.ref(`${DB_ROOT}/frota`).orderByChild('placa').equalTo(placa).once('value');
                fSnap.forEach(f => { db.ref(`${DB_ROOT}/frota/${f.key}/status`).set('Em Rota'); });
                alert(`Rota despachada com sucesso! O caminhão ${placa} e o Rastreio do Motorista foram ativados no aplicativo dele.`);
            } else {
                alert("Nenhuma rota pendente encontrada para este motorista.");
            }
        } catch(error) {
            alert("Erro ao despachar rota: " + error.message);
        } finally {
            window.fecharModal('modal-atribuir-veiculo');
            btn.innerHTML = oldHtml; btn.disabled = false;
        }
    };
}

window.salvarConfiguracoes = function() {
    const mk = document.getElementById('maps-key').value;
    db.ref(`${DB_ROOT}/config`).update({ 
        gemini_key: document.getElementById('gemini-key').value, 
        maps_key: mk, 
        cloud_name: document.getElementById('cloud-name').value, 
        upload_preset: document.getElementById('upload-preset').value,
        percentual_sistema: parseFloat(document.getElementById('config-taxa').value || 5)
    }).then(() => { alert("As chaves e parâmetros financeiros foram salvos com sucesso."); if(mk) window.carregarGoogleMapsRuntime(); }); 
};

// CRIAÇÃO E DELEÇÃO DE USUÁRIOS/DADOS
const frmEquipe = document.getElementById('form-equipe');
if(frmEquipe) {
    frmEquipe.onsubmit = async (e) => { 
        e.preventDefault(); const btn = document.getElementById('btn-salvar-equipe'); btn.innerHTML = "<div class='loader border-t-white mx-auto'></div>"; btn.disabled = true;
        try {
            const cred = await secondaryAuth.createUserWithEmailAndPassword(document.getElementById('eq-email').value, document.getElementById('eq-senha').value);
            await db.ref(`users_roles/${cred.user.uid}`).set({ email: document.getElementById('eq-email').value, role: document.getElementById('eq-cargo').value });
            await db.ref(`${DB_ROOT}/equipe/${cred.user.uid}`).set({ nome: document.getElementById('eq-nome').value, cargo: document.getElementById('eq-cargo').value, email: document.getElementById('eq-email').value, cnh: document.getElementById('eq-cnh').value });
            await secondaryAuth.signOut(); window.fecharModal('modal-equipe'); e.target.reset(); alert("Acesso de funcionário gerado com sucesso no Banco.");
        } catch (err) { alert("Erro ao criar acesso. Verifique se o E-mail já existe na base ou se a senha tem pelo menos 6 caracteres."); } 
        finally { btn.innerHTML = "<i class='bx bx-check-circle text-xl'></i> Salvar e Liberar Acesso App"; btn.disabled = false; }
    };
}

window.excluirUser = async function(uid) { if(confirm("Deseja bloquear definitivamente o aplicativo deste colaborador?")) { await db.ref(`${DB_ROOT}/equipe/${uid}`).remove(); await db.ref(`users_roles/${uid}`).remove(); } };
window.excluir = function(path, id) { if(confirm("Confirma a exclusão irreversível deste registro?")) { db.ref(`${DB_ROOT}/${path}/${id}`).remove(); } };

window.exportarClientesExcel = async function() {
    try {
        const snap = await db.ref(`${DB_ROOT}/clientes`).once('value');
        if(!snap.exists()) return alert("Nenhum cliente cadastrado na base para exportar.");
        const data = [];
        snap.forEach(c => { const v = c.val(); data.push({ "Nome": v.nome || "", "Telefone": v.tel || "", "Cidade": v.cid || "", "Endereço": v.end || "", "Lat": v.lat || "", "Lng": v.lng || "" }); });
        const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Lojas_AED"); XLSX.writeFile(wb, "Base_Clientes_AED_Log.xlsx");
    } catch(e) { alert("Erro ao exportar base de dados: " + e.message); }
};

window.importarClientesExcel = function(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async function(ev) {
        try {
            const data = new Uint8Array(ev.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
            if(json.length === 0) return alert("A planilha está vazia ou o formato é inválido.");
            if(!confirm(`Confirma a importação de ${json.length} lojas/clientes para a base de dados?`)) return;

            const btn = document.querySelector('button[title="Importar Excel"]'); const oldHtml = btn.innerHTML; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin text-lg'></i>"; btn.disabled = true;

            let importados = 0;
            for(const row of json) {
                const nome = row["Nome"] || row["nome"] || row["NOME"];
                if(!nome) continue; 
                let lat = row["Lat"] || row["lat"] || row["Latitude"] || ""; let lng = row["Lng"] || row["lng"] || row["Longitude"] || "";
                lat = lat ? parseFloat(String(lat).replace(',', '.')) : null; lng = lng ? parseFloat(String(lng).replace(',', '.')) : null;
                if(isNaN(lat)) lat = null; if(isNaN(lng)) lng = null;

                await db.ref(`${DB_ROOT}/clientes`).push({ nome: String(nome), tel: String(row["Telefone"] || row["telefone"] || row["Celular"] || ""), cid: String(row["Cidade"] || row["cidade"] || ""), end: String(row["Endereço"] || row["Endereco"] || ""), lat: lat, lng: lng });
                importados++;
            }
            alert(`${importados} Lojas importadas com sucesso!`);
            btn.innerHTML = oldHtml; btn.disabled = false;
        } catch(error) { alert("Erro grave ao processar a planilha: " + error.message); } finally { e.target.value = ""; }
    };
    reader.readAsArrayBuffer(file);
};


/* ==============================================================
   BLOCO 9: PAINEL DO MOTORISTA, ROTAS E RASTREIO
   ============================================================== */
let watchId = null; let veiculoDoRomaneio = null; let listenerCargasMotorista = null; let listenerRadarMotorista = null;

window.processarEExibirMapaMotorista = async function(romaneio, placa) {
    try {
        document.getElementById('container-mapa-mot').classList.remove('hidden');
        const overlay = document.getElementById('map-motorista-overlay');
        if(overlay) overlay.classList.remove('hidden');
        window.checkMap('motorista');
        
        const gps = await db.ref(`${DB_ROOT}/gps_tracking/${placa}`).once('value');
        let originLatLng;
        const geocoder = new google.maps.Geocoder();

        if(gps.exists() && gps.val().status === 'online') {
            const safeGps = getSafeLatLng(gps.val().lat, gps.val().lng);
            originLatLng = safeGps ? { lat: safeGps.lat(), lng: safeGps.lng() } : { lat: -20.8, lng: -49.3 };
        } else {
            originLatLng = { lat: -20.8, lng: -49.3 }; 
        }
        
        const clSnap = await db.ref(`${DB_ROOT}/clientes`).once('value');
        const clientesBase = [];
        clSnap.forEach(c => { clientesBase.push({...c.val(), id: c.key}); });

        const deliveryPoints = [];
        
        for (const carga of romaneio) {
            if (!carga) continue;
            const cliMatch = clientesBase.find(c => {
                if(!c || !carga) return false;
                const nomeMatch = (c.nome && carga.destino) ? c.nome.toUpperCase().trim() === carga.destino.toUpperCase().trim() : false;
                const endMatch = (c.cid && carga.endereco_destino) ? c.cid === carga.endereco_destino : false;
                return nomeMatch || endMatch;
            });

            if (cliMatch) {
                const safePos = getSafeLatLng(cliMatch.lat, cliMatch.lng);
                if(safePos) {
                    deliveryPoints.push({ location: safePos, nome: carga.destino, id: carga.id, cargaObj: carga });
                } else {
                    await new Promise(resolve => {
                        geocoder.geocode({ address: carga.endereco_destino || carga.destino }, (res, status) => {
                            if (status === 'OK' && res[0] && res[0].geometry) {
                                deliveryPoints.push({ location: res[0].geometry.location, nome: carga.destino, id: carga.id, cargaObj: carga });
                            }
                            setTimeout(resolve, 200);
                        });
                    });
                }
            } else {
                await new Promise(resolve => {
                    geocoder.geocode({ address: carga.endereco_destino || carga.destino }, (res, status) => {
                        if (status === 'OK' && res[0] && res[0].geometry) {
                            deliveryPoints.push({ location: res[0].geometry.location, nome: carga.destino, id: carga.id, cargaObj: carga });
                        }
                        setTimeout(resolve, 200);
                    });
                });
            }
        }
        
        const validDeliveryPoints = deliveryPoints.filter(pt => pt && pt.location && typeof pt.location.lat === 'function');

        if(validDeliveryPoints.length === 0) { 
            if(overlay) overlay.classList.add('hidden'); 
            document.getElementById('motorista-lista-cargas').innerHTML = `<div class="bg-red-900/50 border border-red-500 p-6 rounded-2xl text-center"><i class='bx bx-error text-4xl text-red-500 mb-2'></i><p class="text-white font-black uppercase text-sm">Destinos Inválidos</p><p class="text-slate-400 text-xs mt-2">Nenhum GPS válido encontrado nas entregas.</p></div>`;
            return; 
        }

        let maxDist = -1;
        let destIndex = validDeliveryPoints.length - 1;
        const origPt = new google.maps.LatLng(originLatLng.lat, originLatLng.lng);

        validDeliveryPoints.forEach((pt, i) => {
            const d = google.maps.geometry.spherical.computeDistanceBetween(origPt, pt.location);
            if (d > maxDist) { maxDist = d; destIndex = i; }
        });

        const finalDestination = validDeliveryPoints[destIndex];
        const waypointsList = validDeliveryPoints.filter((_, i) => i !== destIndex).map(pt => ({ location: pt.location, stopover: true }));
        
        if(!directionsService) directionsService = new google.maps.DirectionsService();
        
        // ESTRUTURA BLINDADA PARA EVITAR INVALID_REQUEST NO MOTORISTA TAMBÉM
        const routeReq = {
            origin: new google.maps.LatLng(originLatLng.lat, originLatLng.lng),
            destination: finalDestination.location,
            travelMode: 'DRIVING'
        };

        if (waypointsList.length > 0) {
            routeReq.waypoints = waypointsList;
            routeReq.optimizeWaypoints = true;
        }

        directionsService.route(routeReq, (res, status) => {
            if(overlay) overlay.classList.add('hidden');
            
            if(status === 'OK' && dirRendererMot) {
                dirRendererMot.setDirections(res);

                let sortedPoints = [];
                if(res.routes[0].waypoint_order && res.routes[0].waypoint_order.length > 0) {
                    const order = res.routes[0].waypoint_order;
                    const rawWaypoints = validDeliveryPoints.filter((_, i) => i !== destIndex);
                    sortedPoints = order.map(index => rawWaypoints[index]);
                }
                sortedPoints.push(finalDestination);

                let cartoesCarga = '';
                sortedPoints.forEach((pt, index) => { 
                    if(!pt || !pt.cargaObj) return;
                    const c = pt.cargaObj;
                    const escDest = escapeHtml(c.destino);
                    const escNfe = escapeHtml(c.nfe);
                    const labelOrdem = (index === sortedPoints.length - 1) ? "DESTINO FINAL (OFICIAL)" : `PARADA ${index + 1} (OTIMIZADA)`;
                    cartoesCarga += `<div class="bg-slate-800 p-5 sm:p-6 rounded-3xl border border-slate-700 shadow-2xl relative overflow-hidden mb-5"><div class="absolute top-0 left-0 w-2 h-full bg-blue-500"></div><p class="text-[9px] sm:text-[10px] text-blue-400 font-black uppercase mb-1 tracking-widest flex items-center gap-1"><i class='bx bx-map-pin'></i> ${labelOrdem}</p><p class="text-xl sm:text-2xl font-black text-white mb-3 sm:mb-4 leading-tight">${c.destino}</p><div class="bg-slate-900 p-3 sm:p-4 rounded-2xl mb-4 sm:mb-5 border border-slate-700 shadow-inner"><p class="text-xs sm:text-sm font-black text-white border-b border-slate-800 pb-2 sm:pb-3 mb-2 sm:mb-3 flex items-center justify-between"><span class="text-slate-400 font-medium text-[10px] sm:text-xs uppercase tracking-widest flex items-center gap-1"><i class='bx bx-barcode'></i> Doc. NFe:</span> <span class="text-blue-400 text-base sm:text-lg">${c.nfe}</span></p><p class="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">${c.desc}</p></div><button onclick="window.motoristaAcionaConfirmacao('${c.id}', '${c.veiculo}', '${escDest}', '${escNfe}')" class="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-black py-4 sm:py-5 rounded-xl sm:rounded-2xl flex justify-center items-center gap-2 shadow-lg transition transform active:scale-95 border border-green-400 uppercase tracking-widest text-[10px] sm:text-sm"><i class='bx bx-check-double text-xl sm:text-2xl drop-shadow'></i> Confirmar Descarga</button></div>`; 
                });
                const lCargas = document.getElementById('motorista-lista-cargas'); 
                if(lCargas) lCargas.innerHTML = cartoesCarga;
            } else {
                let fallbackCartoes = `<div class="bg-amber-900/30 border border-amber-500 p-4 rounded-xl mb-4"><p class="text-amber-500 font-black text-[10px] sm:text-xs text-center"><i class='bx bx-wifi-off'></i> Modo Rota Direta (Servidor Geográfico Lento)</p></div>`;
                validDeliveryPoints.forEach((pt, index) => { 
                    if(!pt || !pt.cargaObj) return;
                    const c = pt.cargaObj;
                    const escDest = escapeHtml(c.destino);
                    const escNfe = escapeHtml(c.nfe);
                    fallbackCartoes += `<div class="bg-slate-800 p-5 sm:p-6 rounded-3xl border border-slate-700 shadow-2xl relative overflow-hidden mb-5"><div class="absolute top-0 left-0 w-2 h-full bg-slate-500"></div><p class="text-xl sm:text-2xl font-black text-white mb-3 sm:mb-4 leading-tight">${c.destino}</p><div class="bg-slate-900 p-3 sm:p-4 rounded-2xl mb-4 sm:mb-5 border border-slate-700 shadow-inner"><p class="text-xs sm:text-sm font-black text-white border-b border-slate-800 pb-2 sm:pb-3 mb-2 sm:mb-3 flex items-center justify-between"><span class="text-slate-400 font-medium text-[10px] sm:text-xs uppercase tracking-widest flex items-center gap-1"><i class='bx bx-barcode'></i> Doc. NFe:</span> <span class="text-blue-400 text-base sm:text-lg">${c.nfe}</span></p><p class="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">${c.desc}</p></div><button onclick="window.motoristaAcionaConfirmacao('${c.id}', '${c.veiculo}', '${escDest}', '${escNfe}')" class="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-black py-4 sm:py-5 rounded-xl sm:rounded-2xl flex justify-center items-center gap-2 shadow-lg transition transform active:scale-95 border border-green-400 uppercase tracking-widest text-[10px] sm:text-sm"><i class='bx bx-check-double text-xl sm:text-2xl drop-shadow'></i> Confirmar Descarga</button></div>`; 
                });
                const lCargas = document.getElementById('motorista-lista-cargas'); 
                if(lCargas) lCargas.innerHTML = fallbackCartoes;
            }
        });

    } catch(e) {
        console.error("Blindagem: Falha evitada.", e);
        const overlay = document.getElementById('map-motorista-overlay');
        if(overlay) overlay.classList.add('hidden');
        document.getElementById('motorista-lista-cargas').innerHTML = `<div class="bg-red-900/50 border border-red-500 p-6 rounded-2xl text-center"><i class='bx bx-error text-4xl text-red-500 mb-2'></i><p class="text-white font-black uppercase text-[10px] sm:text-sm">Falha no Processamento</p><p class="text-slate-400 text-[9px] sm:text-xs mt-2">Um dos destinos tem dados corrompidos no sistema.</p></div>`;
    }
};

window.iniciarArquiteturaMotorista = function() {
    const emailCelular = currentUser.email;
    if(listenerCargasMotorista) db.ref(`${DB_ROOT}/cargas`).off('value', listenerCargasMotorista);
    
    listenerCargasMotorista = db.ref(`${DB_ROOT}/cargas`).on('value', snap => {
        const meuRomaneio = []; let placaEscalada = null;
        if(snap.exists()) { snap.forEach(c => { const val = c.val(); if(val.motorista_email === emailCelular && val.status === 'Em Rota') { meuRomaneio.push({...val, id: c.key}); if(!placaEscalada) placaEscalada = val.veiculo; } }); }

        const st = document.getElementById('status-escala'); const btnGps = document.getElementById('btn-toggle-gps'); const cnt = document.getElementById('motorista-cargas-container');

        if(meuRomaneio.length > 0) {
            veiculoDoRomaneio = placaEscalada; 
            if(st) st.innerHTML = `<div class="bg-blue-600 text-white rounded-t-2xl p-2 sm:p-3 font-black tracking-widest text-[10px] sm:text-xs uppercase shadow-sm flex items-center justify-center gap-2"><i class='bx bx-check-shield text-base sm:text-lg'></i> Missão Atribuída (V5)</div><div class="p-4 sm:p-5 bg-slate-800 rounded-b-2xl border-x border-b border-slate-700 shadow-inner"><p class="text-[10px] sm:text-xs text-slate-400 font-bold uppercase tracking-widest mb-1 sm:mb-2">Viatura Designada:</p><p class="text-3xl sm:text-4xl font-black text-white tracking-widest drop-shadow-md">${placaEscalada}</p></div>`;
            if(btnGps) btnGps.disabled = false;
            if(!watchId && btnGps) { 
                btnGps.className = "w-40 h-40 sm:w-48 sm:h-48 bg-slate-900 border-4 border-blue-500 rounded-full flex flex-col items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.6)] z-10 transition transform hover:scale-105 active:scale-95"; 
                document.getElementById('gps-icon').className = "bx bx-power-off text-5xl sm:text-6xl text-blue-400 mb-2 drop-shadow-md"; document.getElementById('gps-text').className = "font-black text-white uppercase text-[10px] sm:text-sm text-center tracking-widest leading-tight"; document.getElementById('gps-text').innerText = "INICIAR ROTA\nE LIGAR GPS"; 
            }
            const msg = document.getElementById('gps-status-msg'); if(msg) msg.innerHTML = "Toque no botão central acima para iniciar a missão e ativar o rastreador e o mapa.";
            if(cnt) cnt.classList.remove('hidden');
            
            document.getElementById('motorista-lista-cargas').innerHTML = "<div class='loader border-t-blue-500 mx-auto my-6'></div><p class='text-center text-[10px] sm:text-xs text-blue-400 font-black uppercase tracking-widest'>Verificando Rota Segura...</p>";
            window.processarEExibirMapaMotorista(meuRomaneio, placaEscalada);

            if(listenerRadarMotorista) db.ref(`${DB_ROOT}/radar_ativo/${veiculoDoRomaneio}`).off('value', listenerRadarMotorista);
            listenerRadarMotorista = db.ref(`${DB_ROOT}/radar_ativo/${veiculoDoRomaneio}`).on('value', rSnap => {
                let htmlVisitas = '<div class="w-full border-t border-slate-700 pt-5 sm:pt-6 mt-2"><h4 class="text-[10px] sm:text-xs font-black text-amber-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2"><i class="bx bx-radar text-base sm:text-lg animate-pulse"></i> Visitas de Radar na Rota</h4>';
                let temVisitas = false;
                
                if(rSnap.exists()) {
                    rSnap.forEach(v => {
                        temVisitas = true;
                        const cli = v.val();
                        const escN = escapeHtml(cli.nome || "");
                        htmlVisitas += `
                        <div class="bg-slate-800 p-4 sm:p-5 rounded-3xl border border-slate-700 shadow-xl mb-4 border-l-4 border-l-amber-500">
                            <p class="text-white font-black text-xs sm:text-sm uppercase mb-1">${cli.nome}</p>
                            <p class="text-[9px] sm:text-[10px] text-slate-400 font-bold mb-3 sm:mb-4 leading-tight truncate"><i class='bx bx-map text-red-400'></i> ${cli.end || cli.cid}</p>
                            <button onclick="window.abrirModalVisitaMotorista('${escN}', '${v.key}')" class="w-full bg-slate-900 border border-amber-600/30 text-amber-500 py-3 rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest active:scale-95 transition flex justify-center gap-2 items-center"><i class='bx bx-briefcase text-sm'></i> Registrar Ação</button>
                        </div>`;
                    });
                }
                
                if(!temVisitas) {
                    htmlVisitas += `<p class="text-[9px] sm:text-[10px] text-slate-500 text-center italic bg-slate-800 p-4 rounded-xl border border-slate-700 font-bold">O Radar IA não despachou visitas de oportunidade para este percurso.</p>`;
                }
                htmlVisitas += '</div>';
                
                const elVisitas = document.getElementById('motorista-lista-visitas'); 
                if(elVisitas) elVisitas.innerHTML = htmlVisitas;
            });

        } else {
            if(st) st.innerHTML = `<div class="p-6 sm:p-8 text-center"><i class='bx bxs-check-circle text-5xl sm:text-6xl text-green-500 mb-4'></i><p class="text-slate-300 font-black text-lg sm:text-xl mb-1">Entregas Concluídas!</p><p class="text-[10px] sm:text-xs text-slate-500 mt-2 font-medium">Você finalizou todas as rotas ativas.</p></div>`;
            
            if(listenerRadarMotorista) { db.ref(`${DB_ROOT}/radar_ativo/${veiculoDoRomaneio}`).off('value', listenerRadarMotorista); listenerRadarMotorista = null; }
            
            if (watchId) {
                // GPS ESTÁ LIGADO: MANTÉM O MAPA
                if(cnt) cnt.classList.remove('hidden');
                document.getElementById('motorista-lista-cargas').innerHTML = `<div class="bg-green-900/50 border border-green-500 p-6 rounded-2xl text-center shadow-inner"><i class='bx bx-navigation text-4xl text-green-500 mb-2'></i><p class="text-white font-black uppercase text-sm">Retorno à Base</p><p class="text-slate-300 text-xs mt-2">Seu satélite continua transmitindo e o mapa está livre. Desligue no botão vermelho apenas quando estacionar o caminhão na empresa.</p></div>`;
                const elVisitas = document.getElementById('motorista-lista-visitas'); 
                if(elVisitas) elVisitas.innerHTML = "";
                try { if(dirRendererMot) dirRendererMot.setDirections({routes: []}); } catch(e){}
            } else {
                veiculoDoRomaneio = null;
                if(cnt) cnt.classList.add('hidden');
                if(btnGps) { btnGps.disabled = true; btnGps.className = "w-40 h-40 sm:w-48 sm:h-48 bg-slate-900 border-4 border-slate-800 rounded-full flex flex-col items-center justify-center opacity-40 z-10"; document.getElementById('gps-icon').className = "bx bx-navigation text-5xl sm:text-6xl text-slate-700 mb-2"; document.getElementById('gps-text').className = "font-black text-slate-700 uppercase text-[10px] sm:text-sm tracking-widest leading-tight"; document.getElementById('gps-text').innerText = "SISTEMA\nBLOQUEADO"; }
                const msg = document.getElementById('gps-status-msg'); if(msg) msg.innerHTML = "";
            }
        }
    });
};

window.abrirModalVisitaMotorista = function(nome, id) {
    document.getElementById('vis-cliente-nome').value = nome;
    document.getElementById('vis-cliente-id').value = id;
    document.getElementById('vis-cliente-display').innerText = "CLIENTE: " + nome;
    window.abrirModal('modal-visita-motorista');
};

const frmVisita = document.getElementById('form-visita');
if(frmVisita) {
    frmVisita.onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-salvar-visita');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin text-xl'></i> Salvando..."; btn.disabled = true;

        try {
            const acao = document.getElementById('vis-acao').value;
            const tipoVendaSelect = document.getElementById('vis-tipo-venda');
            const tipoVenda = tipoVendaSelect ? tipoVendaSelect.value : 'oportunidade';
            const valor = parseFloat(document.getElementById('vis-valor').value || 0);
            const obs = document.getElementById('vis-obs').value;
            const cliNome = document.getElementById('vis-cliente-nome').value;
            const cliId = document.getElementById('vis-cliente-id').value;

            // MONETIZAÇÃO
            let taxaSistema = 0;
            if (acao === 'Venda Realizada' && tipoVenda === 'oportunidade' && valor > 0) {
                taxaSistema = valor * (PERCENTUAL_SISTEMA / 100);
            }

            await db.ref(`${DB_ROOT}/ocorrencias`).push({ 
                veiculo: veiculoDoRomaneio || "Indeterminado", 
                motorista: currentDriverName, 
                tipo: `Visita Comercial`, 
                tipoVenda: tipoVenda,
                valor: valor, 
                taxa_sistema: taxaSistema,
                desc: `CLIENTE: ${cliNome} | AÇÃO: ${acao} | OBS: ${obs}`, 
                imgUrl: "", 
                data: Date.now() 
            });

            if(veiculoDoRomaneio && cliId) {
                await db.ref(`${DB_ROOT}/radar_ativo/${veiculoDoRomaneio}/${cliId}`).remove();
            }

            window.fecharModal('modal-visita-motorista'); e.target.reset();
            alert("Visita e Linha do Tempo sincronizadas com sucesso com o Painel Admin.");
        } catch (err) { 
            alert("Erro ao gravar: " + err.message); 
        } finally { 
            btn.innerHTML = originalHtml; btn.disabled = false; 
        }
    };
}

window.motoristaAcionaConfirmacao = function(id, placa, destino, nfe) {
    document.getElementById('conf-entrega-id').value = id;
    document.getElementById('conf-entrega-placa').value = placa;
    document.getElementById('conf-entrega-destino').value = destino;
    document.getElementById('conf-entrega-nfe').value = nfe;
    document.getElementById('display-destino-conf').innerText = "ENTREGA EM: " + destino;
    window.abrirModal('modal-confirmar-entrega');
};

const frmConfEntrega = document.getElementById('form-confirmar-entrega');
if(frmConfEntrega) {
    frmConfEntrega.onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-confirmar-entrega');
        const originalBtnText = btn.innerHTML;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin text-xl'></i> Salvando Descarga..."; btn.disabled = true;

        const id = document.getElementById('conf-entrega-id').value;
        const placa = document.getElementById('conf-entrega-placa').value;
        const destino = document.getElementById('conf-entrega-destino').value;
        const nfe = document.getElementById('conf-entrega-nfe').value;
        const recebedor = document.getElementById('conf-recebedor').value;
        const obs = document.getElementById('conf-obs').value;

        try {
            await db.ref(`${DB_ROOT}/cargas/${id}`).update({
                status: 'Entregue',
                data_entrega: Date.now(),
                entregue_por: currentDriverName,
                recebedor: recebedor,
                obs_entrega: obs
            }); 
            
            await db.ref(`${DB_ROOT}/ocorrencias`).push({
                veiculo: placa || "Indeterminado",
                motorista: currentDriverName,
                tipo: `Entrega Realizada`,
                valor: 0,
                desc: `ENTREGA CONCLUÍDA: ${destino} | NFe: ${nfe} | ASSINOU: ${recebedor} | OBS: ${obs}`,
                imgUrl: "",
                data: Date.now()
            });

            db.ref(`${DB_ROOT}/cargas`).once('value', snap => {
                let hasMore = false;
                if(snap.exists()) { snap.forEach(c => { if(c.val().veiculo === placa && c.val().status === 'Em Rota' && c.key !== id) { hasMore = true; } }); }
                if(!hasMore) { db.ref(`${DB_ROOT}/frota`).orderByChild('placa').equalTo(placa).once('value', fSnap => { if(fSnap.exists()) { fSnap.forEach(f => db.ref(`${DB_ROOT}/frota/${f.key}/status`).set('Disponível')); } }); }
            });

            window.fecharModal('modal-confirmar-entrega');
            e.target.reset();
            alert("Entrega confirmada no sistema. A Base Logística já foi notificada.");

        } catch (err) {
            alert("Erro ao confirmar entrega: " + err.message);
        } finally {
            btn.innerHTML = originalBtnText; btn.disabled = false;
        }
    };
}


/* ==============================================================
   BLOCO 10: RASTREADOR WAKE LOCK E REPORTES OCORRÊNCIAS
   ============================================================== */
window.toggleGPS = function() { if(watchId) window.desligarGPS(); else window.ligarGPS(); };

async function ativarWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { console.log('Trava de tela liberada.'); });
        }
    } catch (err) {}
}

document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') { ativarWakeLock(); }
});

window.ligarGPS = async function() {
    if(!navigator.geolocation) return alert("O navegador do celular bloqueia leitura de GPS.");
    if(!veiculoDoRomaneio) return alert("Ação negada: Sem veículo atribuído.");
    
    await ativarWakeLock();

    const btn = document.getElementById('btn-toggle-gps'); const pulse = document.getElementById('gps-pulse');
    if(btn) btn.className = "w-40 h-40 sm:w-48 sm:h-48 bg-red-900 border-4 border-red-500 rounded-full flex flex-col items-center justify-center shadow-[0_0_50px_rgba(220,38,38,0.8)] z-10 animate-pulse transform scale-105 transition";
    const icn = document.getElementById('gps-icon'); if(icn) icn.className = "bx bx-radar text-5xl sm:text-7xl text-white mb-2 drop-shadow-md"; 
    const txt = document.getElementById('gps-text'); if(txt) { txt.className = "font-black text-white uppercase text-[9px] sm:text-[10px] text-center tracking-widest leading-tight px-4"; txt.innerText = "OPERAÇÃO ATIVA\n(TOCAR P/ PAUSAR)"; }
    if(pulse) { pulse.classList.remove('hidden'); pulse.classList.add('gps-active-pulse'); }
    const msg = document.getElementById('gps-status-msg'); if(msg) msg.innerHTML = "<div class='bg-red-900/50 border border-red-800 p-3 sm:p-4 rounded-xl shadow-inner'><b class='text-red-500 block mb-1 text-sm sm:text-base'><i class='bx bx-check-shield'></i> Rastreador Ativo</b><span class='text-slate-300 text-[10px] sm:text-xs font-medium'>O satélite está acompanhando. Mantenha o navegador aberto para não perder o sinal. A tela não vai apagar sozinha.</span></div>";

    watchId = navigator.geolocation.watchPosition(
        (pos) => { 
            const mLat = pos.coords.latitude;
            const mLng = pos.coords.longitude;
            db.ref(`${DB_ROOT}/gps_tracking/${veiculoDoRomaneio}`).set({ lat: mLat, lng: mLng, timestamp: Date.now(), status: 'online', motorista: currentDriverName }); 
            
            if (mapMotoristaObj && window.google) {
                const driverPos = new google.maps.LatLng(mLat, mLng);
                if (!driverMarkerMap) {
                    driverMarkerMap = new google.maps.Marker({
                        position: driverPos,
                        map: mapMotoristaObj,
                        icon: "https://maps.google.com/mapfiles/ms/icons/truck.png",
                        zIndex: 999
                    });
                } else { driverMarkerMap.setPosition(driverPos); }
                mapMotoristaObj.panTo(driverPos);
                if (mapMotoristaObj.getZoom() < 14) mapMotoristaObj.setZoom(16);
            }
        },
        (err) => { alert("Por favor, AUTORIZE o site a acessar a sua Localização (GPS) nas permissões do seu celular."); window.desligarGPS(); },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
};

window.desligarGPS = function() {
    if(watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if(wakeLock !== null) { wakeLock.release().then(() => { wakeLock = null; }); }
    if(veiculoDoRomaneio) { db.ref(`${DB_ROOT}/gps_tracking/${veiculoDoRomaneio}/status`).set('offline'); }
    
    const btn = document.getElementById('btn-toggle-gps'); const pulse = document.getElementById('gps-pulse');
    if(btn) btn.className = "w-40 h-40 sm:w-48 sm:h-48 bg-slate-900 border-4 border-blue-500 rounded-full flex flex-col items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.6)] z-10 transition transform hover:scale-105 active:scale-95";
    const icn = document.getElementById('gps-icon'); if(icn) icn.className = "bx bx-power-off text-5xl sm:text-6xl text-blue-400 mb-2 drop-shadow-md"; 
    const txt = document.getElementById('gps-text'); if(txt) { txt.className = "font-black text-white uppercase text-[9px] sm:text-[10px] text-center tracking-widest px-4"; txt.innerText = "INICIAR ROTA\nE LIGAR GPS"; }
    if(pulse) { pulse.classList.add('hidden'); pulse.classList.remove('gps-active-pulse'); }
    const msg = document.getElementById('gps-status-msg'); if(msg) msg.innerText = "Transmissão pausada. A Base não tem mais a sua localização em tempo real.";
};

window.abrirModalOcorrencia = function() { window.abrirModal('modal-ocorrencia'); };

const frmOco = document.getElementById('form-ocorrencia');
if(frmOco) {
    frmOco.onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-salvar-ocorrencia');
        const originalBtnHtml = btn.innerHTML;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin text-3xl'></i> CONECTANDO...";
        btn.disabled = true;

        try {
            let imgUrl = ""; const fileInput = document.getElementById('oco-foto');
            if (fileInput.files.length > 0) {
                if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
                    alert("O Sistema Fotográfico não foi ativado pela Diretoria no Cofre. O seu relato subirá como apenas texto.");
                } else {
                    btn.innerHTML = "<i class='bx bx-loader-alt bx-spin text-3xl'></i> UPANDO IMAGEM...";
                    const file = fileInput.files[0]; const formData = new FormData(); formData.append('file', file); formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET); formData.append('folder', 'aed_logistica_recibos');
                    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`, { method: 'POST', body: formData });
                    if (!response.ok) { throw new Error("Recusa do Servidor de Imagens Cloudinary."); }
                    const data = await response.json(); imgUrl = data.secure_url; const imgSize = data.bytes;
                    await db.ref(`${DB_ROOT}/config/cloudinary_bytes_used`).set(CLOUDINARY_BYTES_USED + imgSize);
                }
            }
            btn.innerHTML = "<i class='bx bx-loader-alt bx-spin text-3xl'></i> GRAVANDO...";
            
            await db.ref(`${DB_ROOT}/ocorrencias`).push({ veiculo: veiculoDoRomaneio || "Viatura Indeterminada", motorista: currentDriverName, tipo: document.getElementById('oco-tipo').value, valor: document.getElementById('oco-valor').value || 0, desc: document.getElementById('oco-desc').value, imgUrl: imgUrl, data: Date.now() });
            alert("Operação confirmada. O Setor Financeiro já está com o seu relatório na tela.");
            window.fecharModal('modal-ocorrencia'); e.target.reset();
        } catch (err) { alert("Falha Sistêmica: " + err.message); } finally { btn.innerHTML = originalBtnHtml; btn.disabled = false; }
    };
}


/* ==============================================================
   BLOCO 11: MÓDULO DE RELATÓRIOS E INDICADORES
   ============================================================== */
window.carregarRelatorios = async function() {
    const relDiv = document.getElementById('view-relatorios');
    if (!relDiv || relDiv.classList.contains('hidden-view')) return;

    relDiv.innerHTML = `<div class='loader mx-auto my-10 border-t-slate-800'></div><p class='text-center text-xs font-black uppercase text-slate-500 tracking-widest'>Processando Datalake Logístico...</p>`;

    try {
        const [snapCargas, snapOco, snapMan] = await Promise.all([
            db.ref(`${DB_ROOT}/cargas`).once('value'),
            db.ref(`${DB_ROOT}/ocorrencias`).once('value'),
            db.ref(`${DB_ROOT}/manutencao`).once('value')
        ]);

        let entregasPorMot = {};
        let viagensRealizadas = 0;
        let vendasProgramadas = 0;
        let vendasOportunidade = 0;
        let totalVendidoProgramado = 0;
        let totalVendidoOportunidade = 0;
        let comissoesSistema = 0;
        let despesasPorVeiculo = {};
        let totalVisitas = 0;

        if(snapCargas.exists()) {
            snapCargas.forEach(c => {
                const d = c.val();
                if(d.status === 'Entregue') {
                    viagensRealizadas++;
                    const mot = d.motorista_nome || d.entregue_por || "Desconhecido";
                    entregasPorMot[mot] = (entregasPorMot[mot] || 0) + 1;
                }
            });
        }

        if(snapOco.exists()) {
            snapOco.forEach(o => {
                const d = o.val();
                
                if(d.tipo === 'Visita Comercial') {
                    totalVisitas++;
                    if(d.desc && d.desc.includes('Venda Realizada')) {
                        if(d.tipoVenda === 'programada') {
                            vendasProgramadas++;
                            totalVendidoProgramado += parseFloat(d.valor || 0);
                        } else {
                            vendasOportunidade++;
                            totalVendidoOportunidade += parseFloat(d.valor || 0);
                            comissoesSistema += parseFloat(d.taxa_sistema || 0);
                        }
                    }
                }
                
                if(d.tipo === 'Combustível' || d.tipo === 'Pedágio' || d.tipo === 'Oficina' || d.tipo === 'Almoço') {
                    const vec = d.veiculo || "Indeterminado";
                    despesasPorVeiculo[vec] = (despesasPorVeiculo[vec] || 0) + parseFloat(d.valor || 0);
                }
            });
        }

        if(snapMan.exists()) {
            snapMan.forEach(m => {
                const d = m.val();
                const vec = d.veiculo || "Indeterminado";
                despesasPorVeiculo[vec] = (despesasPorVeiculo[vec] || 0) + parseFloat(d.valor || 0);
            });
        }

        let htmlMot = Object.entries(entregasPorMot).sort((a,b) => b[1] - a[1]).map(([m, qtd]) => `<div class="flex justify-between border-b border-slate-100 pb-2"><span class="text-[10px] uppercase font-bold text-slate-600">${m}</span><span class="text-xs font-black bg-slate-100 px-2 py-0.5 rounded">${qtd}</span></div>`).join('');
        let htmlDesp = Object.entries(despesasPorVeiculo).sort((a,b) => b[1] - a[1]).map(([v, val]) => `<div class="flex justify-between border-b border-slate-100 pb-2"><span class="text-[10px] uppercase font-bold text-slate-600">${v}</span><span class="text-xs font-black text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded">R$ ${val.toFixed(2)}</span></div>`).join('');

        relDiv.innerHTML = `
            <div class="bg-white p-6 rounded-2xl shadow-sm border mb-6">
                <h3 class="font-black text-slate-800 uppercase tracking-tighter text-lg mb-4 flex items-center gap-2"><i class='bx bx-pie-chart-alt-2 text-indigo-500'></i> DRE Logístico e Comercial</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <p class="text-[9px] text-slate-500 font-black uppercase tracking-widest">Entregas e Visitas</p>
                        <p class="text-2xl font-black text-slate-800 mt-1">${viagensRealizadas} <span class="text-[10px] font-bold text-slate-400 align-middle">Ent.</span> | ${totalVisitas} <span class="text-[10px] font-bold text-slate-400 align-middle">Vis.</span></p>
                    </div>
                    <div class="bg-blue-50 p-4 rounded-xl border border-blue-200">
                        <p class="text-[9px] text-blue-600 font-black uppercase tracking-widest">Vendas Programadas</p>
                        <p class="text-2xl font-black text-blue-700 mt-1">${vendasProgramadas} <span class="text-xs">/ R$ ${totalVendidoProgramado.toFixed(2)}</span></p>
                    </div>
                    <div class="bg-amber-50 p-4 rounded-xl border border-amber-200">
                        <p class="text-[9px] text-amber-600 font-black uppercase tracking-widest">Vendas Oportunidade</p>
                        <p class="text-2xl font-black text-amber-700 mt-1">${vendasOportunidade} <span class="text-xs">/ R$ ${totalVendidoOportunidade.toFixed(2)}</span></p>
                    </div>
                    <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-200">
                        <p class="text-[9px] text-indigo-600 font-black uppercase tracking-widest">Taxas da Plataforma (${PERCENTUAL_SISTEMA}%)</p>
                        <p class="text-2xl font-black text-indigo-700 mt-1">R$ ${comissoesSistema.toFixed(2)}</p>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="bg-white p-6 rounded-2xl shadow-sm border">
                    <h4 class="font-black text-slate-800 uppercase text-xs mb-4 border-b pb-2 flex items-center gap-2"><i class='bx bxs-package text-slate-400'></i> Ranking de Entregas por Motorista</h4>
                    <div class="space-y-3">${htmlMot || '<p class="text-[10px] uppercase font-bold text-slate-400">Nenhum dado registrado.</p>'}</div>
                </div>
                <div class="bg-white p-6 rounded-2xl shadow-sm border">
                    <h4 class="font-black text-slate-800 uppercase text-xs mb-4 border-b pb-2 flex items-center gap-2"><i class='bx bx-money text-red-400'></i> Despesas Globais por Veículo (Rota + Oficina)</h4>
                    <div class="space-y-3">${htmlDesp || '<p class="text-[10px] uppercase font-bold text-slate-400">Nenhum dado registrado.</p>'}</div>
                </div>
            </div>
        `;
    } catch(e) {
        relDiv.innerHTML = `<div class="bg-red-50 text-red-600 font-bold text-[10px] uppercase p-4 rounded-xl shadow-inner border border-red-200"><i class='bx bx-error text-lg align-middle'></i> Erro na leitura do Datalake: ${e.message}</div>`;
    }
};