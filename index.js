const express = require('express');
const mongoose = require('mongoose');
const negocios = require('./negocios');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
    .then(function() { console.log('Conectado a MongoDB'); })
    .catch(function(err) { console.log('Error MongoDB:', err); });

// ─── Modelos ──────────────────────────────────────────────────────────────────

const PedidoSchema = new mongoose.Schema({
    negocio: String,
    slug: String,
    numero_cliente: String,
    nombre_cliente: String,
    pedido: String,
    direccion: String,
    metodo_pago: String,
    fecha: { type: Date, default: Date.now },
    estado: { type: String, default: 'pendiente' }
});
const Pedido = mongoose.model('Pedido', PedidoSchema);

const ClienteSchema = new mongoose.Schema({
    numero: String,
    nombre: String,
    direccion: String
});
const Cliente = mongoose.model('Cliente', ClienteSchema);

const ConversacionSchema = new mongoose.Schema({
    slug: String,
    phoneNumberId: String,
    numero_cliente: String,
    nombre_cliente: String,
    pedido: String,
    direccion: String,
    metodo_pago: String,
    mensajes: [{
        de: String,
        texto: String,
        fecha: { type: Date, default: Date.now }
    }],
    estado: { type: String, default: 'esperando_negocio' },
    fecha: { type: Date, default: Date.now }
});
const Conversacion = mongoose.model('Conversacion', ConversacionSchema);

// ─── Sesiones en memoria ──────────────────────────────────────────────────────
const sesiones = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generarMenu(negocio, nombreCliente) {
    let menu = 'Hola ' + nombreCliente + ', bienvenido a ' + negocio.nombre + '\n\nNuestros productos:\n\n';
    negocio.productos.forEach(function(p) {
        menu += '- ' + p.nombre + ' - $' + p.precio + ' MXN\n';
    });
    menu += '\nTe gustaria hacer un pedido?\nResponde *SI* o *NO*\nEscribe *PAGO* para ver datos de transferencia\nEscribe *CAMBIAR DIRECCION* para actualizar tu direccion';
    return menu;
}

function buscarNegocioPorSlug(slug) {
    return Object.values(negocios).find(function(n) { return n.slug === slug; });
}

// ─── Enviar mensaje via Meta Graph API ───────────────────────────────────────
async function enviarMensaje(phoneNumberId, numeroCliente, texto) {
    const token = process.env.META_TOKEN;
    const url = 'https://graph.facebook.com/v19.0/' + phoneNumberId + '/messages';

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: numeroCliente,
                type: 'text',
                text: { body: texto }
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('Error Meta API:', JSON.stringify(data));
        } else {
            console.log('Mensaje enviado a ' + numeroCliente);
        }
    } catch (err) {
        console.error('Error enviando mensaje:', err);
    }
}

// ─── Ticket ───────────────────────────────────────────────────────────────────
const ANCHO = 48;

function centrar(texto) {
    if (texto.length >= ANCHO) return texto;
    const esp = Math.floor((ANCHO - texto.length) / 2);
    return ' '.repeat(esp) + texto;
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

    if (!apiKey || !printerId) {
        console.log('PrintNode no configurado, omitiendo impresion');
        return;
    }

    const linea  = '-'.repeat(ANCHO);
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
    pedido.split('\n').forEach(function(l) {
        if (l.trim()) ticket += wordWrap(l.trim(), '  ') + '\n';
    });
    ticket += lineaD + '\n';
    ticket += centrar('Gracias por su compra!') + '\n';
    ticket += centrar(negocio.nombre) + '\n';
    ticket += '\n\n\n';

    const ticketBase64 = Buffer.from(ticket).toString('base64');

    try {
        const credentials = Buffer.from(apiKey + ':').toString('base64');
        const response = await fetch('https://api.printnode.com/printjobs', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + credentials,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                printerId: printerId,
                title: 'Pedido - ' + (clienteDB ? clienteDB.nombre : 'Cliente'),
                contentType: 'raw_base64',
                content: ticketBase64,
                source: 'PedidosBot'
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Error PrintNode:', JSON.stringify(data));
        } else {
            console.log('Ticket impreso, job ID: ' + data);
        }
    } catch (err) {
        console.error('Error imprimiendo ticket:', err);
    }
}

// ─── QR por negocio ───────────────────────────────────────────────────────────
app.get('/qr/:slug', function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');
    if (!negocio.whatsapp) return res.status(404).send('Numero de WhatsApp no configurado');

    const mensaje = encodeURIComponent('Hola, quiero hacer un pedido');
    const waUrl = 'https://wa.me/' + negocio.whatsapp + '?text=' + mensaje;
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(waUrl);

    res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>QR - ' + negocio.nombre + '</title><style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;}.box{background:white;padding:40px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;max-width:400px;width:90%;}h2{color:#25D366;}img{border:4px solid #25D366;border-radius:12px;margin:20px 0;}.btn{display:inline-block;margin-top:10px;padding:12px 24px;background:#25D366;color:white;border-radius:8px;text-decoration:none;font-weight:bold;}.instruccion{background:#f0fdf4;border:1px solid #25D366;border-radius:8px;padding:12px;margin-top:20px;font-size:13px;color:#444;}</style></head><body><div class="box"><h2>' + negocio.nombre + '</h2><p>Escanea el QR para hacer tu pedido por WhatsApp</p><img src="' + qrUrl + '" width="250" height="250"><br><a href="' + waUrl + '" class="btn">Abrir WhatsApp</a><div class="instruccion">Imprime este QR y colocalo en tu negocio</div></div></body></html>');
});

// ─── Panel login ──────────────────────────────────────────────────────────────
app.get('/panel/:slug', function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');

    res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Panel - ' + negocio.nombre + '</title><style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;}.box{background:white;padding:40px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;width:300px;}h2{color:#25D366;margin-bottom:5px;}p{color:#666;margin-bottom:20px;}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:15px;}button{width:100%;padding:12px;background:#25D366;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer;}button:hover{background:#1ea855;}</style></head><body><div class="box"><h2>' + negocio.nombre + '</h2><p>Panel de pedidos</p><form method="POST" action="/panel/' + req.params.slug + '/login"><input type="password" name="password" placeholder="Contrasena" required><button type="submit">Entrar</button></form></div></body></html>');
});

app.post('/panel/:slug/login', function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');
    if (req.body.password !== negocio.password) {
        return res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title><style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;}.box{background:white;padding:40px;border-radius:12px;text-align:center;}button{padding:10px 20px;background:#25D366;color:white;border:none;border-radius:8px;cursor:pointer;}</style></head><body><div class="box"><p style="color:red">Contrasena incorrecta</p><a href="/panel/' + req.params.slug + '"><button>Volver</button></a></div></body></html>');
    }
    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// ─── Panel de pedidos ─────────────────────────────────────────────────────────
app.get('/panel/:slug/pedidos', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');

    const pedidos = await Pedido.find({ slug: req.params.slug }).sort({ fecha: -1 }).limit(50);
    const chatsActivos = await Conversacion.find({ slug: req.params.slug, estado: 'esperando_negocio' }).sort({ fecha: -1 });

    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pedidos - ' + negocio.nombre + '</title><style>';
    html += 'body{font-family:Arial;margin:0;background:#f5f5f5;}';
    html += '.header{background:#25D366;color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;}';
    html += '.header h1{margin:0;font-size:20px;}';
    html += '.tabs{display:flex;background:white;border-bottom:2px solid #eee;}';
    html += '.tab{padding:12px 24px;cursor:pointer;font-size:14px;font-weight:bold;color:#666;border-bottom:3px solid transparent;margin-bottom:-2px;}';
    html += '.tab.active{color:#25D366;border-bottom-color:#25D366;}';
    html += '.tab-content{display:none;padding:20px;}';
    html += '.tab-content.active{display:block;}';
    html += '.pedido{background:white;padding:15px;margin:10px 0;border-radius:8px;border-left:4px solid #25D366;box-shadow:0 2px 4px rgba(0,0,0,0.1);}';
    html += '.pedido.entregado{border-left-color:#6c757d;opacity:0.7;}';
    html += '.pedido.cancelado{border-left-color:#dc3545;opacity:0.7;}';
    html += '.chat-card{background:white;padding:15px;margin:10px 0;border-radius:8px;border-left:4px solid #f0ad4e;box-shadow:0 2px 4px rgba(0,0,0,0.1);}';
    html += '.chat-card.transferencia{border-left-color:#007bff;}';
    html += '.cliente{color:#666;font-size:13px;}';
    html += '.pedido-texto{margin:8px 0;font-size:15px;}';
    html += '.direccion{color:#444;font-size:13px;margin:4px 0;}';
    html += '.metodo-pago{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;margin:4px 0;}';
    html += '.metodo-efectivo{background:#d4edda;color:#155724;}';
    html += '.metodo-transferencia{background:#cce5ff;color:#004085;}';
    html += '.fecha{color:#999;font-size:12px;margin-bottom:8px;}';
    html += '.estado-pendiente{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;background:#fff3cd;color:#856404;}';
    html += '.estado-entregado{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;background:#d4edda;color:#155724;}';
    html += '.estado-cancelado{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;background:#f8d7da;color:#721c24;}';
    html += '.btn-entregado{background:#25D366;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:8px;}';
    html += '.btn-cancelado{background:#dc3545;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:5px;}';
    html += '.btn-imprimir{background:#007bff;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:5px;}';
    html += '.btn-confirmar{background:#25D366;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;margin-top:8px;width:100%;}';
    html += '.btn-cerrar{background:#6c757d;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;margin-top:5px;width:100%;}';
    html += '.chat-mensajes{background:#f5f5f5;border-radius:8px;padding:10px;margin:8px 0;max-height:200px;overflow-y:auto;}';
    html += '.msg{margin:5px 0;padding:6px 10px;border-radius:8px;font-size:13px;max-width:80%;}';
    html += '.msg.cliente{background:white;border:1px solid #ddd;}';
    html += '.msg.negocio{background:#dcf8c6;margin-left:auto;text-align:right;}';
    html += '.msg-container{display:flex;flex-direction:column;}';
    html += '.reply-box{display:flex;gap:8px;margin-top:8px;}';
    html += '.reply-input{flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;}';
    html += '.btn-reply{background:#25D366;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;}';
    html += '.badge{background:#dc3545;color:white;border-radius:50%;padding:2px 7px;font-size:11px;margin-left:5px;}';
    html += '.vacio{text-align:center;color:#999;margin-top:50px;}';
    html += '</style><meta http-equiv="refresh" content="15"></head><body>';

    html += '<div class="header"><h1>📋 ' + negocio.nombre + '</h1>';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<a href="/qr/' + req.params.slug + '" target="_blank" style="background:white;color:#25D366;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:bold;text-decoration:none">📱 QR</a>';
    html += '<a href="/panel/' + req.params.slug + '/export" style="background:white;color:#25D366;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:bold;text-decoration:none">⬇️ Excel</a>';
    html += '</div></div>';

    html += '<div class="tabs">';
    html += '<div class="tab ' + (chatsActivos.length === 0 ? 'active' : '') + '" onclick="showTab(\'pedidos\')">📦 Pedidos (' + pedidos.length + ')</div>';
    html += '<div class="tab ' + (chatsActivos.length > 0 ? 'active' : '') + '" onclick="showTab(\'chats\')">💬 Chats activos';
    if (chatsActivos.length > 0) html += '<span class="badge">' + chatsActivos.length + '</span>';
    html += '</div></div>';

    // Tab pedidos
    html += '<div id="tab-pedidos" class="tab-content ' + (chatsActivos.length === 0 ? 'active' : '') + '">';
    if (pedidos.length === 0) {
        html += '<div class="vacio"><p>No hay pedidos aun</p></div>';
    } else {
        pedidos.forEach(function(p) {
            const fecha = new Date(p.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            const claseEstado = p.estado === 'entregado' ? 'estado-entregado' : p.estado === 'cancelado' ? 'estado-cancelado' : 'estado-pendiente';
            const clasePedido = p.estado === 'entregado' ? 'pedido entregado' : p.estado === 'cancelado' ? 'pedido cancelado' : 'pedido';
            const claseMetodo = p.metodo_pago === 'TRANSFERENCIA' ? 'metodo-transferencia' : 'metodo-efectivo';
            const iconoMetodo = p.metodo_pago === 'TRANSFERENCIA' ? '🏦' : '💵';

            html += '<div class="' + clasePedido + '">';
            html += '<div class="cliente">👤 ' + (p.nombre_cliente || 'Sin nombre') + ' | 📱 ' + p.numero_cliente + '</div>';
            html += '<div class="pedido-texto">🛒 ' + p.pedido.replace(/\n/g, '<br>') + '</div>';
            html += '<div class="direccion">📍 ' + (p.direccion || 'Sin direccion') + '</div>';
            html += '<span class="metodo-pago ' + claseMetodo + '">' + iconoMetodo + ' ' + (p.metodo_pago || 'N/A') + '</span>';
            html += '<div class="fecha">🕐 ' + fecha + '</div>';
            html += '<span class="' + claseEstado + '">' + p.estado + '</span>';
            if (p.estado === 'pendiente') {
                html += '<form method="POST" action="/panel/' + req.params.slug + '/pedido/' + p._id + '/estado" style="display:inline">';
                html += '<button class="btn-entregado" name="estado" value="entregado">✅ Entregado</button>';
                html += '<button class="btn-cancelado" name="estado" value="cancelado">❌ Cancelado</button>';
                html += '</form>';
                html += '<form method="POST" action="/panel/' + req.params.slug + '/pedido/' + p._id + '/imprimir" style="display:inline">';
                html += '<button class="btn-imprimir">🖨️ Imprimir</button>';
                html += '</form>';
            }
            html += '</div>';
        });
    }
    html += '</div>';

    // Tab chats activos
    html += '<div id="tab-chats" class="tab-content ' + (chatsActivos.length > 0 ? 'active' : '') + '">';
    if (chatsActivos.length === 0) {
        html += '<div class="vacio"><p>No hay chats activos</p></div>';
    } else {
        chatsActivos.forEach(function(conv) {
            const fecha = new Date(conv.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            const esTransferencia = conv.metodo_pago === 'TRANSFERENCIA';
            const claseCard = esTransferencia ? 'chat-card transferencia' : 'chat-card';
            const claseMetodo = esTransferencia ? 'metodo-transferencia' : 'metodo-efectivo';
            const iconoMetodo = esTransferencia ? '🏦' : '💵';

            html += '<div class="' + claseCard + '">';
            html += '<div class="cliente">👤 ' + (conv.nombre_cliente || 'Sin nombre') + ' | 📱 ' + conv.numero_cliente + '</div>';
            html += '<div class="pedido-texto">🛒 ' + conv.pedido.replace(/\n/g, '<br>') + '</div>';
            html += '<div class="direccion">📍 ' + (conv.direccion || 'Sin direccion') + '</div>';
            html += '<span class="metodo-pago ' + claseMetodo + '">' + iconoMetodo + ' ' + (conv.metodo_pago || 'N/A') + '</span>';
            html += '<div class="fecha">🕐 ' + fecha + '</div>';
            html += '<div class="chat-mensajes"><div class="msg-container">';
            conv.mensajes.forEach(function(m) {
                html += '<div class="msg ' + m.de + '"><strong>' + (m.de === 'cliente' ? '👤' : '🏪') + '</strong> ' + m.texto + '</div>';
            });
            html += '</div></div>';
            html += '<form method="POST" action="/panel/' + req.params.slug + '/chat/' + conv._id + '/responder">';
            html += '<div class="reply-box"><input class="reply-input" type="text" name="mensaje" placeholder="Escribe tu respuesta..." required><button class="btn-reply" type="submit">Enviar</button></div>';
            html += '</form>';
            html += '<form method="POST" action="/panel/' + req.params.slug + '/chat/' + conv._id + '/confirmar">';
            html += '<button class="btn-confirmar" type="submit">✅ CONFIRMAR PEDIDO — Imprimir ticket</button>';
            html += '</form>';
            html += '<form method="POST" action="/panel/' + req.params.slug + '/chat/' + conv._id + '/cerrar">';
            html += '<button class="btn-cerrar" type="submit">🔒 CERRAR CHAT</button>';
            html += '</form>';
            html += '</div>';
        });
    }
    html += '</div>';

    html += '<script>function showTab(tab){document.querySelectorAll(".tab").forEach(function(t){t.classList.remove("active");});document.querySelectorAll(".tab-content").forEach(function(t){t.classList.remove("active");});document.getElementById("tab-"+tab).classList.add("active");event.target.classList.add("active");}</script>';
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

// Confirmar pedido desde panel
app.post('/panel/:slug/chat/:id/confirmar', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    const conv = await Conversacion.findById(req.params.id);
    if (!conv) return res.status(404).send('No encontrado');

    const clienteDB = await Cliente.findOne({ numero: conv.numero_cliente });
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

    await Pedido.create({
        negocio: negocio.nombre,
        slug: negocio.slug,
        numero_cliente: conv.numero_cliente,
        nombre_cliente: conv.nombre_cliente,
        pedido: conv.pedido,
        direccion: conv.direccion,
        metodo_pago: conv.metodo_pago
    });

    await imprimirTicket(negocio, clienteDB, conv.pedido, fecha, conv.metodo_pago);

    await enviarMensaje(conv.phoneNumberId, conv.numero_cliente,
        'Pedido confirmado!\n\nCliente: ' + conv.nombre_cliente +
        '\nPedido: ' + conv.pedido +
        '\nDireccion: ' + conv.direccion +
        '\nPago: ' + conv.metodo_pago +
        '\n\nGracias por tu compra en ' + negocio.nombre + '!'
    );

    // Mantener chat abierto para seguimiento de pago
    conv.mensajes.push({ de: 'negocio', texto: 'Pedido confirmado. En espera de pago.' });
    await conv.save();

    console.log('PEDIDO CONFIRMADO - ' + negocio.nombre + ' | ' + conv.nombre_cliente + ' | ' + conv.metodo_pago);

    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Cerrar chat
app.post('/panel/:slug/chat/:id/cerrar', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    const conv = await Conversacion.findById(req.params.id);
    if (!conv) return res.status(404).send('No encontrado');

    conv.estado = 'cerrado';
    await conv.save();

    const sesionKey = conv.phoneNumberId + '_' + conv.numero_cliente;
    delete sesiones[sesionKey];

    res.redirect('/panel/' + req.params.slug + '/pedidos');
});

// Imprimir desde panel
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

// Export a Excel
app.get('/panel/:slug/export', async function(req, res) {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');
    const pedidos = await Pedido.find({ slug: req.params.slug }).sort({ fecha: -1 });
    let csv = 'Fecha,Nombre,Cliente,Pedido,Direccion,Pago,Estado\n';
    pedidos.forEach(function(p) {
        const fecha = new Date(p.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        const pedidoLimpio = p.pedido.replace(/\n/g, ' ').replace(/,/g, ';');
        const direccion = (p.direccion || '').replace(/,/g, ';');
        csv += '"' + fecha + '","' + (p.nombre_cliente || '') + '","' + p.numero_cliente + '","' + pedidoLimpio + '","' + direccion + '","' + (p.metodo_pago || '') + '","' + p.estado + '"\n';
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

// ─── Webhook Meta - verificacion GET ─────────────────────────────────────────
app.get('/webhook-meta', function(req, res) {
    const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'sackval212181';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verificado correctamente');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// ─── Webhook Meta - recibir mensajes POST ────────────────────────────────────
app.post('/webhook-meta', async function(req, res) {
    res.sendStatus(200);

    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const message = value && value.messages && value.messages[0];

    if (!message || message.type !== 'text') return;

    const numeroCliente = message.from;
    const texto = message.text && message.text.body ? message.text.body.trim() : '';
    const mensajeLower = texto.toLowerCase();
    const phoneNumberId = value.metadata && value.metadata.phone_number_id;

    const negocio = Object.values(negocios).find(function(n) { return n.phoneNumberId === phoneNumberId; });
    if (!negocio) {
        console.log('Negocio no encontrado para phoneNumberId: ' + phoneNumberId);
        return;
    }

    console.log('[' + negocio.nombre + '] Mensaje de ' + numeroCliente + ': ' + texto);

    const sesionKey = phoneNumberId + '_' + numeroCliente;
    if (!sesiones[sesionKey]) sesiones[sesionKey] = { estado: 'inicio' };
    const sesion = sesiones[sesionKey];

    let clienteDB = await Cliente.findOne({ numero: numeroCliente });

    // Si hay conversacion activa, agregar mensaje al historial
    const convActiva = await Conversacion.findOne({
        slug: negocio.slug,
        numero_cliente: numeroCliente,
        estado: 'esperando_negocio'
    });

    if (convActiva) {
        convActiva.mensajes.push({ de: 'cliente', texto: texto });
        await convActiva.save();
        return;
    }

    // Comandos globales
    if (mensajeLower === 'cambiar direccion') {
        sesion.estado = 'cambiando_direccion';
        await enviarMensaje(phoneNumberId, numeroCliente, 'Por favor escribe tu nueva direccion de entrega:');
        return;
    }

    if (mensajeLower === 'pago') {
        if (negocio.clabe) {
            await enviarMensaje(phoneNumberId, numeroCliente,
                'Datos para pago:\n\nBanco: ' + negocio.banco +
                '\nTitular: ' + negocio.titular +
                '\nCLABE: ' + negocio.clabe +
                '\n\nUna vez realizado tu pago envianos tu comprobante.'
            );
        } else {
            await enviarMensaje(phoneNumberId, numeroCliente, 'Para informacion de pago comunicate con nosotros directamente.');
        }
        return;
    }

    let respuesta = '';

    if (sesion.estado === 'inicio') {
        if (!clienteDB || !clienteDB.nombre) {
            respuesta = 'Hola! Bienvenido a ' + negocio.nombre + '\n\nPara comenzar, como te llamas?';
            sesion.estado = 'esperando_nombre';
        } else {
            respuesta = generarMenu(negocio, clienteDB.nombre);
            sesion.estado = 'esperando_decision';
        }

    } else if (sesion.estado === 'esperando_nombre') {
        if (!clienteDB) {
            clienteDB = await Cliente.create({ numero: numeroCliente, nombre: texto });
        } else {
            clienteDB.nombre = texto;
            await clienteDB.save();
        }
        respuesta = generarMenu(negocio, texto);
        sesion.estado = 'esperando_decision';

    } else if (sesion.estado === 'esperando_decision') {
        if (mensajeLower === 'si') {
            respuesta = 'Por favor escribenos tu pedido\n\nEjemplo:\n2 Producto 1\n1 Producto 2';
            sesion.estado = 'esperando_pedido';
        } else if (mensajeLower === 'no') {
            respuesta = 'Hasta luego ' + (clienteDB ? clienteDB.nombre : '') + '! Fue un placer atenderte.';
            delete sesiones[sesionKey];
        } else {
            respuesta = 'Por favor responde SI o NO.';
        }

    } else if (sesion.estado === 'esperando_pedido') {
        sesion.pedido = texto;
        if (!clienteDB || !clienteDB.direccion) {
            respuesta = 'Cual es tu direccion de entrega?';
            sesion.estado = 'esperando_direccion';
        } else {
            respuesta = 'Como deseas pagar?\n\nResponde *EFECTIVO* o *TRANSFERENCIA*';
            sesion.estado = 'esperando_pago';
        }

    } else if (sesion.estado === 'esperando_direccion') {
        if (!clienteDB) {
            clienteDB = await Cliente.create({ numero: numeroCliente, direccion: texto });
        } else {
            clienteDB.direccion = texto;
            await clienteDB.save();
        }
        sesion.direccion = texto;
        respuesta = 'Como deseas pagar?\n\nResponde *EFECTIVO* o *TRANSFERENCIA*';
        sesion.estado = 'esperando_pago';

    } else if (sesion.estado === 'esperando_pago') {
        if (mensajeLower === 'efectivo' || mensajeLower === 'transferencia') {
            const metodoPago = mensajeLower === 'efectivo' ? 'EFECTIVO' : 'TRANSFERENCIA';
            sesion.metodo_pago = metodoPago;

            // Si es transferencia, mandar datos bancarios
            if (metodoPago === 'TRANSFERENCIA' && negocio.clabe) {
                await enviarMensaje(phoneNumberId, numeroCliente,
                    'Datos para tu transferencia:\n\nBanco: ' + negocio.banco +
                    '\nTitular: ' + negocio.titular +
                    '\nCLABE: ' + negocio.clabe +
                    '\n\nPuedes realizar el pago antes o despues de recibir tu pedido.'
                );
            }

            // Crear conversacion activa en panel
            await Conversacion.create({
                slug: negocio.slug,
                phoneNumberId: phoneNumberId,
                numero_cliente: numeroCliente,
                nombre_cliente: clienteDB ? clienteDB.nombre : '',
                pedido: sesion.pedido,
                direccion: clienteDB ? clienteDB.direccion : (sesion.direccion || ''),
                metodo_pago: metodoPago,
                mensajes: [{ de: 'cliente', texto: sesion.pedido }]
            });

            respuesta = 'Recibimos tu pedido!\n\nEn breve te confirmamos precio y disponibilidad.';
            sesion.estado = 'inicio';
        } else {
            respuesta = 'Por favor responde *EFECTIVO* o *TRANSFERENCIA*.';
        }

    } else if (sesion.estado === 'cambiando_direccion') {
        if (!clienteDB) {
            clienteDB = await Cliente.create({ numero: numeroCliente, direccion: texto });
        } else {
            clienteDB.direccion = texto;
            await clienteDB.save();
        }
        respuesta = 'Direccion actualizada: ' + texto + '\n\nEscribe Hola para continuar con tu pedido.';
        delete sesiones[sesionKey];

    } else {
        if (!clienteDB || !clienteDB.nombre) {
            respuesta = 'Hola! Como te llamas?';
            sesion.estado = 'esperando_nombre';
        } else {
            respuesta = generarMenu(negocio, clienteDB.nombre);
            sesion.estado = 'esperando_decision';
        }
    }

    if (respuesta) {
        await enviarMensaje(phoneNumberId, numeroCliente, respuesta);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
    console.log('Servidor corriendo en puerto ' + PORT);
});