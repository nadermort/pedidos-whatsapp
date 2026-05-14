const express = require('express');
const mongoose = require('mongoose');
const negocios = require('./negocios');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
    .then(function() { console.log('Conectado a MongoDB'); })
    .catch(function(err) { console.log('Error MongoDB:', err); });

const PedidoSchema = new mongoose.Schema({
    negocio: String, slug: String, numero_cliente: String, nombre_cliente: String,
    pedido: String, direccion: String, metodo_pago: String,
    fecha: { type: Date, default: Date.now }, estado: { type: String, default: 'pendiente' }
});
const Pedido = mongoose.model('Pedido', PedidoSchema);

const ClienteSchema = new mongoose.Schema({ numero: String, nombre: String, direccion: String });
const Cliente = mongoose.model('Cliente', ClienteSchema);

const ConversacionSchema = new mongoose.Schema({
    slug: String, phoneNumberId: String, numero_cliente: String, nombre_cliente: String,
    pedido: String, direccion: String, metodo_pago: String,
    pedido_confirmado: { type: Boolean, default: false },
    mensajes: [{ de: String, texto: String, tipo: { type: String, default: 'texto' }, media_url: String, fecha: { type: Date, default: Date.now } }],
    estado: { type: String, default: 'esperando_negocio' },
    fecha: { type: Date, default: Date.now }
});
const Conversacion = mongoose.model('Conversacion', ConversacionSchema);

const sesiones = {};

function generarMenu(negocio, nombreCliente) {
    let menu = 'Hola ' + nombreCliente + ', bienvenido a ' + negocio.nombre + '\n\nNuestros productos:\n\n';
    negocio.productos.forEach(function(p) { menu += '- ' + p.nombre + ' - $' + p.precio + ' MXN\n'; });
    menu += '\nTe gustaria hacer un pedido?\nResponde *SI* o *NO*\nEscribe *PAGO* para ver datos de transferencia\nEscribe *CAMBIAR DIRECCION* para actualizar tu direccion';
    return menu;
}

function buscarNegocioPorSlug(slug) {
    return Object.values(negocios).find(function(n) { return n.slug === slug; });
}

function formatHora(fecha) {
    return new Date(fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
}

async function enviarMensaje(phoneNumberId, numeroCliente, texto) {
    const token = process.env.META_TOKEN;
    try {
        const response = await fetch('https://graph.facebook.com/v19.0/' + phoneNumberId + '/messages', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: numeroCliente, type: 'text', text: { body: texto } })
        });
        const data = await response.json();
        if (!response.ok) { console.error('Error Meta API:', JSON.stringify(data)); }
        else { console.log('Mensaje enviado a ' + numeroCliente); }
    } catch (err) { console.error('Error enviando mensaje:', err); }
}

async function obtenerUrlImagen(mediaId) {
    const token = process.env.META_TOKEN;
    try {
        const response = await fetch('https://graph.facebook.com/v19.0/' + mediaId, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await response.json();
        return data.url || null;
    } catch (err) { return null; }
}

const ANCHO = 48;
function centrar(texto) {
    if (texto.length >= ANCHO) return texto;
    return ' '.repeat(Math.floor((ANCHO - texto.length) / 2)) + texto;
}
function wordWrap(texto, indent) {
    indent = indent || '';
    const maxAncho = ANCHO - indent.length;
    const palabras = texto.split(' ');
    const lineas = [];
    let lineaActual = '';
    palabras.forEach(function(palabra) {
        if ((lineaActual + ' ' + palabra).trim().length <= maxAncho) {
            lineaActual = (lineaActual + ' ' + palabra).trim();
        } else {
            if (lineaActual) lineas.push(indent + lineaActual);
            lineaActual = palabra;
        }
    });
    if (lineaActual) lineas.push(indent + lineaActual);
    return lineas.join('\n');
}

async function imprimirTicket(negocio, clienteDB, pedido, fecha, metodoPago) {
    const apiKey = process.env.PRINTNODE_API_KEY;
    const printerId = negocio.printerId;
    if (!apiKey || !printerId) { console.log('PrintNode no configurado'); return; }
    const linea = '-'.repeat(ANCHO);
    const lineaD = '='.repeat(ANCHO);
    let ticket = '\n';
    ticket += centrar(negocio.nombre.toUpperCase()) + '\n';
    ticket += centrar('Sistema de Pedidos') + '\n';
    ticket += lineaD + '\n';
    ticket += 'Fecha   : ' + fecha + '\n';
    ticket += linea + '\n';
    ticket += 'Cliente : ' + (clienteDB ? clienteDB.nombre : 'N/A') + '\n';
    ticket += 'Tel     : ' + (clienteDB ? clienteDB.numero : 'N/A') + '\n';
    ticket += 'Pago    : ' + (metodoPago || 'N/A') + '\n';
    ticket += 'Direccion:\n';
    ticket += wordWrap(clienteDB && clienteDB.direccion ? clienteDB.direccion : 'N/A', '  ') + '\n';
    ticket += linea + '\n';
    ticket += 'PEDIDO:\n';
    ticket += linea + '\n';
    pedido.split('\n').forEach(function(l) { if (l.trim()) ticket += wordWrap(l.trim(), '  ') + '\n'; });
    ticket += lineaD + '\n';
    ticket += centrar('Gracias por su compra!') + '\n';
    ticket += centrar(negocio.nombre) + '\n';
    ticket += '\n\n\n';
    const ticketBase64 = Buffer.from(ticket).toString('base64');
    try {
        const credentials = Buffer.from(apiKey + ':').toString('base64');
        const response = await fetch('https://api.printnode.com/printjobs', {
            method: 'POST',
            headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/json' },
            body: JSON.stringify({ printerId: printerId, title: 'Pedido - ' + (clienteDB ? clienteDB.nombre : 'Cliente'), contentType: 'raw_base64', content: ticketBase64, source: 'PedidosBot' })
        });
        const data = await response.json();
        if (!response.ok) { console.error('Error PrintNode:', JSON.stringify(data)); }
        else { console.log('Ticket impreso, job ID: ' + data); }
    } catch (err) { console.error('Error imprimiendo:', err); }
}

// QR
app.get('/qr/:slug', function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');
    if (!negocio.whatsapp) return res.status(404).send('Numero no configurado');
    const mensaje = encodeURIComponent('Hola, quiero hacer un pedido');
    const waUrl = 'https://wa.me/' + negocio.whatsapp + '?text=' + mensaje;
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(waUrl);
    res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>QR - ' + negocio.nombre + '</title><style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;}.box{background:white;padding:40px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;max-width:400px;width:90%;}h2{color:#25D366;}img{border:4px solid #25D366;border-radius:12px;margin:20px 0;}.btn{display:inline-block;margin-top:10px;padding:12px 24px;background:#25D366;color:white;border-radius:8px;text-decoration:none;font-weight:bold;}.instruccion{background:#f0fdf4;border:1px solid #25D366;border-radius:8px;padding:12px;margin-top:20px;font-size:13px;color:#444;}</style></head><body><div class="box"><h2>' + negocio.nombre + '</h2><p>Escanea el QR para hacer tu pedido</p><img src="' + qrUrl + '" width="250" height="250"><br><a href="' + waUrl + '" class="btn">Abrir WhatsApp</a><div class="instruccion">Imprime este QR y colocalo en tu negocio</div></div></body></html>');
});

// Panel login
app.get('/panel/:slug', function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');
    res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Panel - ' + negocio.nombre + '</title><style>@import url("https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap");*{box-sizing:border-box;}body{font-family:"Nunito",sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#075E54 0%,#128C7E 50%,#25D366 100%);}.box{background:white;padding:40px;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.2);text-align:center;width:320px;}h2{color:#075E54;margin-bottom:5px;font-size:24px;font-weight:800;}p{color:#888;margin-bottom:24px;font-size:14px;}.logo{width:70px;height:70px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px;}input{width:100%;padding:12px 16px;margin:8px 0;border:2px solid #eee;border-radius:12px;font-size:15px;font-family:inherit;outline:none;transition:border 0.2s;}input:focus{border-color:#25D366;}button{width:100%;padding:14px;background:linear-gradient(135deg,#25D366,#128C7E);color:white;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px;}</style></head><body><div class="box"><div class="logo">📋</div><h2>' + negocio.nombre + '</h2><p>Panel de pedidos</p><form method="POST" action="/panel/' + req.params.slug + '/login"><input type="password" name="password" placeholder="Contrasena" required><button type="submit">Entrar</button></form></div></body></html>');
});

app.post('/panel/:slug/login', function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');
    if (req.body.password !== negocio.password) {
        return res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title><style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;}.box{background:white;padding:40px;border-radius:12px;text-align:center;}button{padding:10px 20px;background:#25D366;color:white;border:none;border-radius:8px;cursor:pointer;}</style></head><body><div class="box"><p style="color:red">Contrasena incorrecta</p><a href="/panel/' + req.params.slug + '"><button>Volver</button></a></div></body></html>');
    }
    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Panel pedidos
app.get('/panel/:slug/pedidos', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');
    const pedidos = await Pedido.find({ slug: req.params.slug }).sort({ fecha: -1 }).limit(50);
    const chatsActivos = await Conversacion.find({ slug: req.params.slug, estado: 'esperando_negocio' }).sort({ fecha: -1 });

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">';
    html += '<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">';
    html += '<title>Pedidos - ' + negocio.nombre + '</title><style>';
    html += '*{box-sizing:border-box;margin:0;padding:0;}body{font-family:"Nunito",sans-serif;background:#ECE5DD;height:100vh;display:flex;flex-direction:column;}';
    html += '.header{background:#075E54;color:white;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;}';
    html += '.header-left{display:flex;align-items:center;gap:12px;}.header-avatar{width:40px;height:40px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;}';
    html += '.header-info h1{font-size:17px;font-weight:700;}.header-info p{font-size:12px;opacity:0.8;}';
    html += '.header-actions{display:flex;gap:8px;}.header-btn{background:rgba(255,255,255,0.15);color:white;border:none;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px;font-family:inherit;}';
    html += '.tabs{background:#075E54;display:flex;border-top:1px solid rgba(255,255,255,0.1);flex-shrink:0;}';
    html += '.tab{flex:1;padding:10px;text-align:center;color:rgba(255,255,255,0.7);font-size:13px;font-weight:700;cursor:pointer;border-bottom:3px solid transparent;background:none;border-left:none;border-right:none;border-top:none;font-family:inherit;}';
    html += '.tab.active{color:white;border-bottom-color:#25D366;}';
    html += '.tab-content{display:none;flex:1;overflow-y:auto;padding:12px;}.tab-content.active{display:block;}';
    html += '.pedido-card{background:white;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.1);}';
    html += '.pedido-card.entregado{opacity:0.6;}.pedido-card.cancelado{opacity:0.6;}';
    html += '.pedido-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;}';
    html += '.pedido-nombre{font-weight:700;font-size:15px;color:#111;}.pedido-hora{font-size:11px;color:#999;}';
    html += '.pedido-detalle{font-size:13px;color:#444;margin:4px 0;}';
    html += '.tag{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-right:4px;}';
    html += '.tag-efectivo{background:#d4edda;color:#155724;}.tag-transferencia{background:#cce5ff;color:#004085;}';
    html += '.tag-pendiente{background:#fff3cd;color:#856404;}.tag-entregado{background:#d4edda;color:#155724;}.tag-cancelado{background:#f8d7da;color:#721c24;}';
    html += '.pedido-btns{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}';
    html += '.btn-sm{padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;border:none;font-family:inherit;}';
    html += '.btn-verde{background:#25D366;color:white;}.btn-rojo{background:#dc3545;color:white;}.btn-azul{background:#007bff;color:white;}';
    html += '.chat-item{background:white;border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.1);display:flex;align-items:center;gap:12px;}';
    html += '.chat-item.transferencia{border-left:4px solid #007bff;}.chat-item.efectivo{border-left:4px solid #25D366;}';
    html += '.chat-avatar{width:48px;height:48px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}';
    html += '.chat-info{flex:1;min-width:0;}.chat-nombre{font-weight:700;font-size:15px;color:#111;}';
    html += '.chat-preview{font-size:13px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}';
    html += '.chat-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;}.chat-hora{font-size:11px;color:#999;}';
    html += '.badge{background:#25D366;color:white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}';
    html += '.chat-screen{display:none;flex-direction:column;height:100%;position:fixed;top:0;left:0;right:0;bottom:0;z-index:100;background:#ECE5DD;}';
    html += '.chat-screen.active{display:flex;}';
    html += '.chat-topbar{background:#075E54;color:white;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;}';
    html += '.back-btn{background:none;border:none;color:white;font-size:20px;cursor:pointer;padding:4px;}';
    html += '.chat-topbar-avatar{width:38px;height:38px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}';
    html += '.chat-topbar-info{flex:1;}.chat-topbar-info h3{font-size:15px;font-weight:700;margin:0;}.chat-topbar-info p{font-size:12px;opacity:0.8;margin:0;}';
    html += '.chat-action-bar{background:#f0f0f0;padding:8px 12px;display:flex;gap:8px;flex-shrink:0;border-bottom:1px solid #ddd;flex-wrap:wrap;}';
    html += '.btn-confirmar{background:#25D366;color:white;border:none;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}';
    html += '.btn-confirmado{background:#128C7E;color:white;border:none;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:700;font-family:inherit;cursor:default;}';
    html += '.btn-cerrar{background:#6c757d;color:white;border:none;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}';
    html += '.chat-info-bar{background:#FFF9C4;padding:8px 16px;font-size:12px;color:#555;border-bottom:1px solid #eee;flex-shrink:0;}';
    html += '.chat-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px;}';
    html += '.bubble{max-width:75%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;}';
    html += '.bubble.cliente{background:white;border-radius:12px 12px 12px 0;align-self:flex-start;box-shadow:0 1px 2px rgba(0,0,0,0.1);}';
    html += '.bubble.negocio{background:#DCF8C6;border-radius:12px 12px 0 12px;align-self:flex-end;box-shadow:0 1px 2px rgba(0,0,0,0.1);}';
    html += '.bubble-hora{font-size:10px;color:#999;margin-top:3px;text-align:right;}';
    html += '.bubble img{max-width:200px;border-radius:8px;display:block;}';
    html += '.chat-input-bar{background:white;padding:8px 12px;display:flex;align-items:center;gap:8px;flex-shrink:0;border-top:1px solid #eee;}';
    html += '.chat-input{flex:1;padding:10px 16px;border:none;border-radius:24px;background:#f0f0f0;font-size:14px;font-family:inherit;outline:none;}';
    html += '.send-btn{width:44px;height:44px;background:#25D366;border:none;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0;}';
    html += '.vacio{text-align:center;color:#999;padding:40px 20px;}.vacio-icon{font-size:48px;margin-bottom:12px;}';
    html += '</style><meta http-equiv="refresh" content="15"></head><body>';

    html += '<div class="header"><div class="header-left"><div class="header-avatar">📋</div><div class="header-info"><h1>' + negocio.nombre + '</h1><p>Panel de pedidos</p></div></div>';
    html += '<div class="header-actions"><a href="/qr/' + req.params.slug + '" target="_blank" class="header-btn">📱 QR</a><a href="/panel/' + req.params.slug + '/export" class="header-btn">⬇️ Excel</a></div></div>';

    html += '<div class="tabs">';
    html += '<button class="tab ' + (chatsActivos.length === 0 ? 'active' : '') + '" onclick="showTab(\'pedidos\',this)">📦 Pedidos (' + pedidos.length + ')</button>';
    html += '<button class="tab ' + (chatsActivos.length > 0 ? 'active' : '') + '" onclick="showTab(\'chats\',this)">💬 Chats ' + (chatsActivos.length > 0 ? '(' + chatsActivos.length + ')' : '') + '</button>';
    html += '</div>';

    // Tab pedidos
    html += '<div id="tab-pedidos" class="tab-content ' + (chatsActivos.length === 0 ? 'active' : '') + '">';
    if (pedidos.length === 0) {
        html += '<div class="vacio"><div class="vacio-icon">📦</div><p>No hay pedidos aun</p></div>';
    } else {
        pedidos.forEach(function(p) {
            const hora = new Date(p.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
            const fecha = new Date(p.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            const claseMetodo = p.metodo_pago === 'TRANSFERENCIA' ? 'tag-transferencia' : 'tag-efectivo';
            const iconoMetodo = p.metodo_pago === 'TRANSFERENCIA' ? '🏦' : '💵';
            const claseEstado = p.estado === 'entregado' ? 'tag-entregado' : p.estado === 'cancelado' ? 'tag-cancelado' : 'tag-pendiente';
            const claseCard = p.estado !== 'pendiente' ? 'pedido-card ' + p.estado : 'pedido-card';
            html += '<div class="' + claseCard + '">';
            html += '<div class="pedido-header"><div class="pedido-nombre">👤 ' + (p.nombre_cliente || 'Sin nombre') + '</div><div class="pedido-hora">' + hora + '</div></div>';
            html += '<div class="pedido-detalle">🛒 ' + p.pedido.replace(/\n/g, '<br>') + '</div>';
            html += '<div class="pedido-detalle">📍 ' + (p.direccion || 'Sin direccion') + '</div>';
            html += '<div style="margin-top:6px"><span class="tag ' + claseMetodo + '">' + iconoMetodo + ' ' + (p.metodo_pago || 'N/A') + '</span><span class="tag ' + claseEstado + '">' + p.estado + '</span></div>';
            html += '<div class="pedido-detalle" style="font-size:11px;color:#aaa">🕐 ' + fecha + '</div>';
            if (p.estado === 'pendiente') {
                html += '<div class="pedido-btns">';
                html += '<form method="POST" action="/panel/' + req.params.slug + '/pedido/' + p._id + '/estado" style="display:inline"><button class="btn-sm btn-verde" name="estado" value="entregado">✅ Entregado</button></form> ';
                html += '<form method="POST" action="/panel/' + req.params.slug + '/pedido/' + p._id + '/estado" style="display:inline"><button class="btn-sm btn-rojo" name="estado" value="cancelado">❌ Cancelado</button></form> ';
                html += '<form method="POST" action="/panel/' + req.params.slug + '/pedido/' + p._id + '/imprimir" style="display:inline"><button class="btn-sm btn-azul">🖨️ Imprimir</button></form>';
                html += '</div>';
            }
            html += '</div>';
        });
    }
    html += '</div>';

    // Tab chats
    html += '<div id="tab-chats" class="tab-content ' + (chatsActivos.length > 0 ? 'active' : '') + '">';
    if (chatsActivos.length === 0) {
        html += '<div class="vacio"><div class="vacio-icon">💬</div><p>No hay chats activos</p></div>';
    } else {
        chatsActivos.forEach(function(conv) {
            const hora = new Date(conv.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
            const ultimoMensaje = conv.mensajes.length > 0 ? conv.mensajes[conv.mensajes.length - 1].texto : conv.pedido;
            const esTransferencia = conv.metodo_pago === 'TRANSFERENCIA';
            html += '<div class="chat-item ' + (esTransferencia ? 'transferencia' : 'efectivo') + '" onclick="abrirChat(\'' + conv._id + '\')">';
            html += '<div class="chat-avatar">' + (esTransferencia ? '🏦' : '💵') + '</div>';
            html += '<div class="chat-info"><div class="chat-nombre">' + (conv.nombre_cliente || 'Sin nombre') + '</div>';
            html += '<div class="chat-preview">' + ultimoMensaje.substring(0, 50) + '</div></div>';
            html += '<div class="chat-meta"><div class="chat-hora">' + hora + '</div>';
            if (!conv.pedido_confirmado) html += '<div class="badge">!</div>';
            html += '</div></div>';
        });
    }
    html += '</div>';

    // Pantallas de chat
    chatsActivos.forEach(function(conv) {
        const esTransferencia = conv.metodo_pago === 'TRANSFERENCIA';
        const confirmado = conv.pedido_confirmado;
        html += '<div class="chat-screen" id="chat-' + conv._id + '">';
        html += '<div class="chat-topbar"><button class="back-btn" onclick="cerrarChat()">&#8592;</button>';
        html += '<div class="chat-topbar-avatar">' + (esTransferencia ? '🏦' : '💵') + '</div>';
        html += '<div class="chat-topbar-info"><h3>' + (conv.nombre_cliente || 'Sin nombre') + '</h3><p>📱 ' + conv.numero_cliente + '</p></div></div>';
        html += '<div class="chat-action-bar">';
        if (confirmado) {
            html += '<span class="btn-confirmado">✅ Pedido confirmado</span>';
        } else {
            html += '<form method="POST" action="/panel/' + req.params.slug + '/chat/' + conv._id + '/confirmar" style="display:inline"><button class="btn-confirmar">✅ Confirmar pedido</button></form>';
        }
        if (esTransferencia) {
            html += ' <form method="POST" action="/panel/' + req.params.slug + '/chat/' + conv._id + '/cerrar" style="display:inline"><button class="btn-cerrar">🔒 Pago verificado</button></form>';
        }
        html += '</div>';
        html += '<div class="chat-info-bar">🛒 ' + conv.pedido + ' &nbsp;|&nbsp; 📍 ' + (conv.direccion || 'Sin dir') + ' &nbsp;|&nbsp; ' + (esTransferencia ? '🏦 Transferencia' : '💵 Efectivo') + '</div>';
        html += '<div class="chat-messages">';
        conv.mensajes.forEach(function(m) {
            html += '<div class="bubble ' + m.de + '">';
            if (m.tipo === 'imagen' && m.media_url) {
    html += '<a href="' + m.media_url + '" target="_blank" style="color:#075E54;font-weight:bold;">📷 Ver comprobante</a><div class="bubble-hora">' + formatHora(m.fecha) + '</div>';
            } else {
                html += m.texto + '<div class="bubble-hora">' + formatHora(m.fecha) + '</div>';
            }
            html += '</div>';
        });
        html += '</div>';
        html += '<form method="POST" action="/panel/' + req.params.slug + '/chat/' + conv._id + '/responder">';
        html += '<div class="chat-input-bar"><input class="chat-input" type="text" name="mensaje" placeholder="Escribe un mensaje..." required autocomplete="off"><button class="send-btn" type="submit">&#10148;</button></div></form>';
        html += '</div>';
    });

    html += '<script>function showTab(tab,el){document.querySelectorAll(".tab").forEach(function(t){t.classList.remove("active");});document.querySelectorAll(".tab-content").forEach(function(t){t.classList.remove("active");});document.getElementById("tab-"+tab).classList.add("active");el.classList.add("active");}function abrirChat(id){document.getElementById("chat-"+id).classList.add("active");var msgs=document.querySelector("#chat-"+id+" .chat-messages");if(msgs)msgs.scrollTop=msgs.scrollHeight;}function cerrarChat(){document.querySelectorAll(".chat-screen").forEach(function(s){s.classList.remove("active");});}</script>';
    html += '</body></html>';
    res.send(html);
});

// Responder desde panel
app.post('/panel/:slug/chat/:id/responder', async function(req, res) {
    const conv = await Conversacion.findById(req.params.id);
    if (!conv) return res.status(404).send('No encontrado');
    conv.mensajes.push({ de: 'negocio', texto: req.body.mensaje });
    await conv.save();
    await enviarMensaje(conv.phoneNumberId, conv.numero_cliente, req.body.mensaje);
    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Confirmar pedido
app.post('/panel/:slug/chat/:id/confirmar', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');
    const conv = await Conversacion.findById(req.params.id);
    if (!conv || conv.pedido_confirmado) return res.redirect('/panel/' + req.params.slug + '/pedidos');
    const clienteDB = await Cliente.findOne({ numero: conv.numero_cliente });
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    await Pedido.create({ negocio: negocio.nombre, slug: negocio.slug, numero_cliente: conv.numero_cliente, nombre_cliente: conv.nombre_cliente, pedido: conv.pedido, direccion: conv.direccion, metodo_pago: conv.metodo_pago });
    await imprimirTicket(negocio, clienteDB, conv.pedido, fecha, conv.metodo_pago);
    await enviarMensaje(conv.phoneNumberId, conv.numero_cliente, 'Pedido confirmado!\n\nCliente: ' + conv.nombre_cliente + '\nPedido: ' + conv.pedido + '\nDireccion: ' + conv.direccion + '\nPago: ' + conv.metodo_pago + '\n\nGracias por tu compra en ' + negocio.nombre + '!');
    conv.pedido_confirmado = true;
    if (conv.metodo_pago === 'TRANSFERENCIA') {
        conv.mensajes.push({ de: 'negocio', texto: 'Pedido confirmado. En espera de verificacion de pago.' });
        await conv.save();
    } else {
        conv.estado = 'cerrado';
        await conv.save();
        delete sesiones[conv.phoneNumberId + '_' + conv.numero_cliente];
    }
    console.log('PEDIDO CONFIRMADO - ' + negocio.nombre + ' | ' + conv.nombre_cliente + ' | ' + conv.metodo_pago);
    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Cerrar chat
app.post('/panel/:slug/chat/:id/cerrar', async function(req, res) {
    const conv = await Conversacion.findById(req.params.id);
    if (!conv) return res.status(404).send('No encontrado');
    conv.estado = 'cerrado';
    await conv.save();
    delete sesiones[conv.phoneNumberId + '_' + conv.numero_cliente];
    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Imprimir
app.post('/panel/:slug/pedido/:id/imprimir', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');
    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) return res.status(404).send('No encontrado');
    const clienteDB = await Cliente.findOne({ numero: pedido.numero_cliente });
    const fecha = new Date(pedido.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    await imprimirTicket(negocio, clienteDB, pedido.pedido, fecha, pedido.metodo_pago);
    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Export Excel
app.get('/panel/:slug/export', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');
    const pedidos = await Pedido.find({ slug: req.params.slug }).sort({ fecha: -1 });
    let csv = 'Fecha,Nombre,Cliente,Pedido,Direccion,Pago,Estado\n';
    pedidos.forEach(function(p) {
        const fecha = new Date(p.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        csv += '"' + fecha + '","' + (p.nombre_cliente || '') + '","' + p.numero_cliente + '","' + p.pedido.replace(/\n/g, ' ').replace(/,/g, ';') + '","' + (p.direccion || '').replace(/,/g, ';') + '","' + (p.metodo_pago || '') + '","' + p.estado + '"\n';
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=pedidos-' + req.params.slug + '.csv');
    res.send('\uFEFF' + csv);
});

// Cambiar estado
app.post('/panel/:slug/pedido/:id/estado', async function(req, res) {
    await Pedido.findByIdAndUpdate(req.params.id, { estado: req.body.estado });
    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Webhook verificacion
app.get('/webhook-meta', function(req, res) {
    const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'sackval212181';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) { console.log('Webhook verificado'); res.status(200).send(challenge); }
    else { res.sendStatus(403); }
});

// Webhook mensajes
app.post('/webhook-meta', async function(req, res) {
    res.sendStatus(200);
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const message = value && value.messages && value.messages[0];
    if (!message) return;
    const numeroCliente = message.from;
    const phoneNumberId = value.metadata && value.metadata.phone_number_id;
    const tipoMensaje = message.type;
    const negocio = Object.values(negocios).find(function(n) { return n.phoneNumberId === phoneNumberId; });
    if (!negocio) { console.log('Negocio no encontrado: ' + phoneNumberId); return; }

    const convActiva = await Conversacion.findOne({ slug: negocio.slug, numero_cliente: numeroCliente, estado: 'esperando_negocio' });
    if (convActiva) {
        if (tipoMensaje === 'image') {
            const mediaId = message.image && message.image.id;
            const mediaUrl = mediaId ? await obtenerUrlImagen(mediaId) : null;
            convActiva.mensajes.push({ de: 'cliente', texto: 'Imagen recibida', tipo: 'imagen', media_url: mediaUrl });
        } else if (tipoMensaje === 'text') {
            const texto = message.text && message.text.body ? message.text.body.trim() : '';
            convActiva.mensajes.push({ de: 'cliente', texto: texto });
        }
        await convActiva.save();
        return;
    }

    if (tipoMensaje !== 'text') return;
    const texto = message.text && message.text.body ? message.text.body.trim() : '';
    const mensajeLower = texto.toLowerCase();
    console.log('[' + negocio.nombre + '] ' + numeroCliente + ': ' + texto);

    const sesionKey = phoneNumberId + '_' + numeroCliente;
    if (!sesiones[sesionKey]) sesiones[sesionKey] = { estado: 'inicio' };
    const sesion = sesiones[sesionKey];
    let clienteDB = await Cliente.findOne({ numero: numeroCliente });

    if (mensajeLower === 'cambiar direccion') {
        sesion.estado = 'cambiando_direccion';
        await enviarMensaje(phoneNumberId, numeroCliente, 'Por favor escribe tu nueva direccion de entrega:');
        return;
    }

    if (mensajeLower === 'pago') {
        if (negocio.clabe) {
            await enviarMensaje(phoneNumberId, numeroCliente, 'Datos para pago:\n\nBanco: ' + negocio.banco + '\nTitular: ' + negocio.titular + '\nCLABE: ' + negocio.clabe + '\n\nUna vez realizado tu pago envianos tu comprobante.');
        } else {
            await enviarMensaje(phoneNumberId, numeroCliente, 'Para informacion de pago comunicate con nosotros directamente.');
        }
        delete sesiones[sesionKey];
        return;
    }

    let respuesta = '';

    if (sesion.estado === 'inicio') {
        if (!clienteDB || !clienteDB.nombre) { respuesta = 'Hola! Bienvenido a ' + negocio.nombre + '\n\nPara comenzar, como te llamas?'; sesion.estado = 'esperando_nombre'; }
        else { respuesta = generarMenu(negocio, clienteDB.nombre); sesion.estado = 'esperando_decision'; }
    } else if (sesion.estado === 'esperando_nombre') {
        if (!clienteDB) { clienteDB = await Cliente.create({ numero: numeroCliente, nombre: texto }); }
        else { clienteDB.nombre = texto; await clienteDB.save(); }
        respuesta = generarMenu(negocio, texto);
        sesion.estado = 'esperando_decision';
    } else if (sesion.estado === 'esperando_decision') {
        if (mensajeLower === 'si') { respuesta = 'Por favor escribenos tu pedido\n\nEjemplo:\n2 Producto 1\n1 Producto 2'; sesion.estado = 'esperando_pedido'; }
        else if (mensajeLower === 'no') { respuesta = 'Hasta luego ' + (clienteDB ? clienteDB.nombre : '') + '! Fue un placer atenderte.'; delete sesiones[sesionKey]; }
        else { respuesta = 'Por favor responde SI o NO.'; }
    } else if (sesion.estado === 'esperando_pedido') {
        sesion.pedido = texto;
        if (!clienteDB || !clienteDB.direccion) { respuesta = 'Cual es tu direccion de entrega?'; sesion.estado = 'esperando_direccion'; }
        else { respuesta = 'Como deseas pagar?\n\nResponde *EFECTIVO* o *TRANSFERENCIA*'; sesion.estado = 'esperando_pago'; }
    } else if (sesion.estado === 'esperando_direccion') {
        if (!clienteDB) { clienteDB = await Cliente.create({ numero: numeroCliente, direccion: texto }); }
        else { clienteDB.direccion = texto; await clienteDB.save(); }
        sesion.direccion = texto;
        respuesta = 'Como deseas pagar?\n\nResponde *EFECTIVO* o *TRANSFERENCIA*';
        sesion.estado = 'esperando_pago';
    } else if (sesion.estado === 'esperando_pago') {
        if (mensajeLower.includes('efect')) { sesion.metodo_pago = 'EFECTIVO'; }
        else if (mensajeLower.includes('transfer')) { sesion.metodo_pago = 'TRANSFERENCIA'; }
        else { respuesta = 'Por favor responde *EFECTIVO* o *TRANSFERENCIA*.'; }
        if (sesion.metodo_pago) {
            if (sesion.metodo_pago === 'TRANSFERENCIA' && negocio.clabe) {
                await enviarMensaje(phoneNumberId, numeroCliente, 'Datos para tu transferencia:\n\nBanco: ' + negocio.banco + '\nTitular: ' + negocio.titular + '\nCLABE: ' + negocio.clabe + '\n\nPuedes realizar el pago antes o despues de recibir tu pedido.');
            }
            await Conversacion.create({ slug: negocio.slug, phoneNumberId: phoneNumberId, numero_cliente: numeroCliente, nombre_cliente: clienteDB ? clienteDB.nombre : '', pedido: sesion.pedido, direccion: clienteDB ? clienteDB.direccion : (sesion.direccion || ''), metodo_pago: sesion.metodo_pago, mensajes: [{ de: 'cliente', texto: sesion.pedido }] });
            respuesta = 'Recibimos tu pedido!\n\nEn breve te confirmamos precio y disponibilidad.';
            sesion.estado = 'inicio';
            sesion.metodo_pago = null;
        }
    } else if (sesion.estado === 'cambiando_direccion') {
        if (!clienteDB) { clienteDB = await Cliente.create({ numero: numeroCliente, direccion: texto }); }
        else { clienteDB.direccion = texto; await clienteDB.save(); }
        respuesta = 'Direccion actualizada: ' + texto + '\n\nEscribe Hola para continuar con tu pedido.';
        delete sesiones[sesionKey];
    } else {
        if (!clienteDB || !clienteDB.nombre) { respuesta = 'Hola! Como te llamas?'; sesion.estado = 'esperando_nombre'; }
        else { respuesta = generarMenu(negocio, clienteDB.nombre); sesion.estado = 'esperando_decision'; }
    }

    if (respuesta) await enviarMensaje(phoneNumberId, numeroCliente, respuesta);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() { console.log('Servidor corriendo en puerto ' + PORT); });