const express = require('express');
const mongoose = require('mongoose');
const negocios = require('./negocios');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB'))
    .catch(err => console.log('Error MongoDB:', err));

// ─── Modelos ──────────────────────────────────────────────────────────────────

const PedidoSchema = new mongoose.Schema({
    negocio: String,
    slug: String,
    numero_cliente: String,
    nombre_cliente: String,
    pedido: String,
    direccion: String,
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

// Modelo de conversación activa (chats en espera de precio)
const ConversacionSchema = new mongoose.Schema({
    slug: String,
    phoneNumberId: String,
    numero_cliente: String,
    nombre_cliente: String,
    pedido: String,
    direccion: String,
    mensajes: [{
        de: String, // 'cliente' o 'negocio'
        texto: String,
        fecha: { type: Date, default: Date.now }
    }],
    estado: { type: String, default: 'esperando_negocio' }, // esperando_negocio, confirmado
    fecha: { type: Date, default: Date.now }
});
const Conversacion = mongoose.model('Conversacion', ConversacionSchema);

// ─── Sesiones en memoria ──────────────────────────────────────────────────────
const sesiones = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generarMenu(negocio, nombreCliente) {
    let menu = `Hola ${nombreCliente}, bienvenido a ${negocio.nombre} 👋\n\nNuestros productos:\n\n`;
    negocio.productos.forEach(p => {
        menu += `- ${p.nombre} - $${p.precio} MXN\n`;
    });
    menu += `\nTe gustaria hacer un pedido?\nResponde *SI* o *NO*\nEscribe *ASESOR* para hablar con alguien\nEscribe *CAMBIAR DIRECCION* para actualizar tu direccion`;
    return menu;
}

function buscarNegocioPorSlug(slug) {
    return Object.values(negocios).find(n => n.slug === slug);
}

// ─── Enviar mensaje via Meta Graph API ───────────────────────────────────────
async function enviarMensaje(phoneNumberId, numeroCliente, texto) {
    const token = process.env.META_TOKEN;
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

    const body = {
        messaging_product: 'whatsapp',
        to: numeroCliente,
        type: 'text',
        text: { body: texto }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('Error Meta API:', JSON.stringify(data));
        } else {
            console.log(`Mensaje enviado a ${numeroCliente}`);
        }
    } catch (err) {
        console.error('Error enviando mensaje:', err);
    }
}

// ─── Utilidades para formato de ticket ───────────────────────────────────────

const ANCHO = 48;

function centrar(texto) {
    if (texto.length >= ANCHO) return texto;
    const esp = Math.floor((ANCHO - texto.length) / 2);
    return ' '.repeat(esp) + texto;
}

function wordWrap(texto, indent = '') {
    const maxAncho = ANCHO - indent.length;
    const palabras = texto.split(' ');
    const lineas = [];
    let lineaActual = '';

    palabras.forEach(palabra => {
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

// ─── Imprimir ticket via PrintNode ────────────────────────────────────────────
async function imprimirTicket(negocio, clienteDB, pedido, fecha) {
    const apiKey = process.env.PRINTNODE_API_KEY;
    const printerId = negocio.printerId;

    if (!apiKey || !printerId) {
        console.log('PrintNode no configurado, omitiendo impresion');
        return;
    }

    const linea  = '-'.repeat(ANCHO);
    const lineaD = '='.repeat(ANCHO);

    let ticket = '';
    ticket += '\n';
    ticket += centrar(negocio.nombre.toUpperCase()) + '\n';
    ticket += centrar('Sistema de Pedidos') + '\n';
    ticket += lineaD + '\n';
    ticket += `Fecha   : ${fecha}\n`;
    ticket += linea + '\n';
    ticket += `Cliente : ${clienteDB?.nombre || 'N/A'}\n`;
    ticket += `Tel     : ${clienteDB?.numero || 'N/A'}\n`;
    ticket += `Direccion:\n`;
    ticket += wordWrap(clienteDB?.direccion || 'N/A', '  ') + '\n';
    ticket += linea + '\n';
    ticket += 'PEDIDO:\n';
    ticket += linea + '\n';
    pedido.split('\n').forEach(l => {
        if (l.trim()) ticket += wordWrap(l.trim(), '  ') + '\n';
    });
    ticket += lineaD + '\n';
    ticket += centrar('Gracias por su compra!') + '\n';
    ticket += centrar(negocio.nombre) + '\n';
    ticket += '\n\n\n';

    const ticketBase64 = Buffer.from(ticket).toString('base64');

    try {
        const credentials = Buffer.from(`${apiKey}:`).toString('base64');
        const response = await fetch('https://api.printnode.com/printjobs', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                printerId: printerId,
                title: `Pedido - ${clienteDB?.nombre || 'Cliente'}`,
                contentType: 'raw_base64',
                content: ticketBase64,
                source: 'PedidosBot'
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('Error PrintNode:', JSON.stringify(data));
        } else {
            console.log(`Ticket impreso, job ID: ${data}`);
        }
    } catch (err) {
        console.error('Error imprimiendo ticket:', err);
    }
}

// ─── QR por negocio ───────────────────────────────────────────────────────────
app.get('/qr/:slug', (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');

    const whatsapp = negocio.whatsapp;
    if (!whatsapp) return res.status(404).send('Numero de WhatsApp no configurado');

    const mensaje = encodeURIComponent('Hola, quiero hacer un pedido');
    const waUrl = `https://wa.me/${whatsapp}?text=${mensaje}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(waUrl)}`;

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>QR - ${negocio.nombre}</title>
        <style>
            body { font-family: Arial; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
            .box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
            h2 { color: #25D366; margin-bottom: 5px; }
            p { color: #666; margin-bottom: 20px; font-size: 14px; }
            img { border: 4px solid #25D366; border-radius: 12px; margin: 20px 0; }
            .btn { display: inline-block; margin-top: 10px; padding: 12px 24px; background: #25D366; color: white; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px; }
            .instruccion { background: #f0fdf4; border: 1px solid #25D366; border-radius: 8px; padding: 12px; margin-top: 20px; font-size: 13px; color: #444; }
        </style>
    </head>
    <body>
        <div class="box">
            <h2>📱 ${negocio.nombre}</h2>
            <p>Escanea el codigo QR para hacer tu pedido por WhatsApp</p>
            <img src="${qrUrl}" alt="QR WhatsApp" width="250" height="250">
            <br>
            <a href="${waUrl}" class="btn">Abrir WhatsApp</a>
            <div class="instruccion">
                📌 Imprime este QR y colócalo en tu negocio para que tus clientes puedan pedir facilmente
            </div>
        </div>
    </body>
    </html>`);
});

// ─── Panel login ──────────────────────────────────────────────────────────────
app.get('/panel/:slug', (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Panel - ${negocio.nombre}</title>
        <style>
            body { font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; width: 300px; }
            h2 { color: #25D366; margin-bottom: 5px; }
            p { color: #666; margin-bottom: 20px; }
            input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; font-size: 15px; }
            button { width: 100%; padding: 12px; background: #25D366; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
            button:hover { background: #1ea855; }
        </style>
    </head>
    <body>
        <div class="box">
            <h2>📋 ${negocio.nombre}</h2>
            <p>Panel de pedidos</p>
            <form method="POST" action="/panel/${req.params.slug}/login">
                <input type="password" name="password" placeholder="Contrasena" required>
                <button type="submit">Entrar</button>
            </form>
        </div>
    </body>
    </html>`);
});

// Panel login POST
app.post('/panel/:slug/login', (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');

    if (req.body.password !== negocio.password) {
        return res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Error</title>
        <style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5;}.box{background:white;padding:40px;border-radius:12px;text-align:center;}button{padding:10px 20px;background:#25D366;color:white;border:none;border-radius:8px;cursor:pointer;}</style>
        </head>
        <body><div class="box"><p style="color:red">Contrasena incorrecta</p><a href="/panel/${req.params.slug}"><button>Volver</button></a></div></body>
        </html>`);
    }

    res.redirect(`/panel/${req.params.slug}/pedidos`);
});

// Panel de pedidos
app.get('/panel/:slug/pedidos', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('Negocio no encontrado');

    const pedidos = await Pedido.find({ slug: req.params.slug }).sort({ fecha: -1 }).limit(50);
    const chatsActivos = await Conversacion.find({ slug: req.params.slug, estado: 'esperando_negocio' }).sort({ fecha: -1 });

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pedidos - ${negocio.nombre}</title>
        <style>
            body { font-family: Arial; margin: 0; background: #f5f5f5; }
            .header { background: #25D366; color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; }
            .header h1 { margin: 0; font-size: 20px; }
            .tabs { display: flex; background: white; border-bottom: 2px solid #eee; }
            .tab { padding: 12px 24px; cursor: pointer; font-size: 14px; font-weight: bold; color: #666; border-bottom: 3px solid transparent; margin-bottom: -2px; }
            .tab.active { color: #25D366; border-bottom-color: #25D366; }
            .tab-content { display: none; padding: 20px; }
            .tab-content.active { display: block; }
            .pedido { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #25D366; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .pedido.entregado { border-left-color: #6c757d; opacity: 0.7; }
            .pedido.cancelado { border-left-color: #dc3545; opacity: 0.7; }
            .chat-card { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #f0ad4e; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .cliente { color: #666; font-size: 13px; }
            .pedido-texto { margin: 8px 0; font-size: 15px; }
            .direccion { color: #444; font-size: 13px; margin: 4px 0; }
            .fecha { color: #999; font-size: 12px; margin-bottom: 8px; }
            .estado-pendiente { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; background: #fff3cd; color: #856404; }
            .estado-entregado { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; background: #d4edda; color: #155724; }
            .estado-cancelado { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; background: #f8d7da; color: #721c24; }
            .btn-entregado { background: #25D366; color: white; border: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-left: 8px; }
            .btn-cancelado { background: #dc3545; color: white; border: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-left: 5px; }
            .btn-imprimir { background: #007bff; color: white; border: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-left: 5px; }
            .btn-confirmar { background: #25D366; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; margin-top: 8px; }
            .chat-mensajes { background: #f5f5f5; border-radius: 8px; padding: 10px; margin: 8px 0; max-height: 200px; overflow-y: auto; }
            .msg { margin: 5px 0; padding: 6px 10px; border-radius: 8px; font-size: 13px; max-width: 80%; }
            .msg.cliente { background: white; border: 1px solid #ddd; align-self: flex-start; }
            .msg.negocio { background: #dcf8c6; margin-left: auto; text-align: right; }
            .msg-container { display: flex; flex-direction: column; }
            .reply-box { display: flex; gap: 8px; margin-top: 8px; }
            .reply-input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; }
            .btn-reply { background: #25D366; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
            .badge { background: #dc3545; color: white; border-radius: 50%; padding: 2px 7px; font-size: 11px; margin-left: 5px; }
            .vacio { text-align: center; color: #999; margin-top: 50px; }
        </style>
        <meta http-equiv="refresh" content="15">
    </head>
    <body>
    <div class="header">
        <h1>📋 ${negocio.nombre}</h1>
        <div style="display:flex;align-items:center;gap:10px">
            <a href="/qr/${req.params.slug}" target="_blank" style="background:white;color:#25D366;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:bold;text-decoration:none">📱 QR</a>
            <a href="/panel/${req.params.slug}/export" style="background:white;color:#25D366;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:bold;text-decoration:none">⬇️ Excel</a>
        </div>
    </div>

    <div class="tabs">
        <div class="tab ${chatsActivos.length === 0 ? 'active' : ''}" onclick="showTab('pedidos')">
            📦 Pedidos <span style="color:#999;font-weight:normal">(${pedidos.length})</span>
        </div>
        <div class="tab ${chatsActivos.length > 0 ? 'active' : ''}" onclick="showTab('chats')">
            💬 Chats activos
            ${chatsActivos.length > 0 ? `<span class="badge">${chatsActivos.length}</span>` : ''}
        </div>
    </div>

    <div id="tab-pedidos" class="tab-content ${chatsActivos.length === 0 ? 'active' : ''}">`;

    if (pedidos.length === 0) {
        html += `<div class="vacio"><p>No hay pedidos aun</p></div>`;
    } else {
        pedidos.forEach(p => {
            const fecha = new Date(p.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            const claseEstado = p.estado === 'entregado' ? 'estado-entregado' : p.estado === 'cancelado' ? 'estado-cancelado' : 'estado-pendiente';
            const clasePedido = p.estado === 'entregado' ? 'pedido entregado' : p.estado === 'cancelado' ? 'pedido cancelado' : 'pedido';

            html += `
            <div class="${clasePedido}">
                <div class="cliente">👤 ${p.nombre_cliente || 'Sin nombre'} | 📱 ${p.numero_cliente}</div>
                <div class="pedido-texto">🛒 ${p.pedido.replace(/\n/g, '<br>')}</div>
                <div class="direccion">📍 ${p.direccion || 'Sin direccion'}</div>
                <div class="fecha">🕐 ${fecha}</div>
                <span class="${claseEstado}">${p.estado}</span>
                ${p.estado === 'pendiente' ? `
                <form method="POST" action="/panel/${req.params.slug}/pedido/${p._id}/estado" style="display:inline">
                    <button class="btn-entregado" name="estado" value="entregado">✅ Entregado</button>
                    <button class="btn-cancelado" name="estado" value="cancelado">❌ Cancelado</button>
                </form>
                <form method="POST" action="/panel/${req.params.slug}/pedido/${p._id}/imprimir" style="display:inline">
                    <button class="btn-imprimir">🖨️ Imprimir</button>
                </form>` : ''}
            </div>`;
        });
    }

    html += `</div>
    <div id="tab-chats" class="tab-content ${chatsActivos.length > 0 ? 'active' : ''}">`;

    if (chatsActivos.length === 0) {
        html += `<div class="vacio"><p>No hay chats activos</p></div>`;
    } else {
        chatsActivos.forEach(conv => {
            const fecha = new Date(conv.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            html += `
            <div class="chat-card">
                <div class="cliente">👤 ${conv.nombre_cliente || 'Sin nombre'} | 📱 ${conv.numero_cliente}</div>
                <div class="pedido-texto">🛒 ${conv.pedido.replace(/\n/g, '<br>')}</div>
                <div class="direccion">📍 ${conv.direccion || 'Sin direccion'}</div>
                <div class="fecha">🕐 ${fecha}</div>
                <div class="chat-mensajes">
                    <div class="msg-container">
                        ${conv.mensajes.map(m => `
                            <div class="msg ${m.de}">
                                <strong>${m.de === 'cliente' ? '👤' : '🏪'}</strong> ${m.texto}
                            </div>
                        `).join('')}
                    </div>
                </div>
                <form method="POST" action="/panel/${req.params.slug}/chat/${conv._id}/responder" style="margin-top:8px">
                    <div class="reply-box">
                        <input class="reply-input" type="text" name="mensaje" placeholder="Escribe tu respuesta..." required>
                        <button class="btn-reply" type="submit">Enviar</button>
                    </div>
                </form>
                <form method="POST" action="/panel/${req.params.slug}/chat/${conv._id}/confirmar" style="margin-top:5px">
                    <button class="btn-confirmar" type="submit">✅ CONFIRMAR PEDIDO — Imprimir ticket</button>
                </form>
            </div>`;
        });
    }

    html += `</div>
    <script>
        function showTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-' + tab).classList.add('active');
            event.target.classList.add('active');
        }
    </script>
    </body></html>`;

    res.send(html);
});

// ─── Responder desde panel ────────────────────────────────────────────────────
app.post('/panel/:slug/chat/:id/responder', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    const conv = await Conversacion.findById(req.params.id);
    if (!conv) return res.status(404).send('Conversacion no encontrada');

    const mensaje = req.body.mensaje;

    // Agregar mensaje al historial
    conv.mensajes.push({ de: 'negocio', texto: mensaje });
    await conv.save();

    // Enviar al cliente por WhatsApp
    await enviarMensaje(conv.phoneNumberId, conv.numero_cliente, mensaje);

    res.redirect(`/panel/${req.params.slug}/pedidos`);
});

// ─── Confirmar pedido desde panel ────────────────────────────────────────────
app.post('/panel/:slug/chat/:id/confirmar', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    const conv = await Conversacion.findById(req.params.id);
    if (!conv) return res.status(404).send('Conversacion no encontrada');

    const clienteDB = await Cliente.findOne({ numero: conv.numero_cliente });
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

    // Guardar pedido en BD
    await Pedido.create({
        negocio: negocio.nombre,
        slug: negocio.slug,
        numero_cliente: conv.numero_cliente,
        nombre_cliente: conv.nombre_cliente,
        pedido: conv.pedido,
        direccion: conv.direccion
    });

    // Imprimir ticket
    await imprimirTicket(negocio, clienteDB, conv.pedido, fecha);

    // Notificar al cliente
    await enviarMensaje(conv.phoneNumberId, conv.numero_cliente,
        `✅ Pedido confirmado!\n\n👤 ${conv.nombre_cliente}\n🛒 ${conv.pedido}\n📍 ${conv.direccion}\n\nGracias por tu compra en ${negocio.nombre}! 🎉`
    );

    // Cerrar conversación
    conv.estado = 'confirmado';
    await conv.save();

    // Limpiar sesión
    const sesionKey = `${conv.phoneNumberId}_${conv.numero_cliente}`;
    delete sesiones[sesionKey];

    console.log('================================');
    console.log(`PEDIDO CONFIRMADO - ${negocio.nombre}`);
    console.log(`Cliente: ${conv.nombre_cliente} (${conv.numero_cliente})`);
    console.log(`Pedido:  ${conv.pedido}`);
    console.log(`Fecha:   ${fecha}`);
    console.log('================================');

    res.redirect(`/panel/${req.params.slug}/pedidos`);
});

// Imprimir desde panel
app.post('/panel/:slug/pedido/:id/imprimir', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) return res.status(404).send('Pedido no encontrado');

    const clienteDB = await Cliente.findOne({ numero: pedido.numero_cliente });
    const fecha = new Date(pedido.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

    await imprimirTicket(negocio, clienteDB, pedido.pedido, fecha);
    res.redirect(`/panel/${req.params.slug}/pedidos`);
});

// Export a Excel
app.get('/panel/:slug/export', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    const pedidos = await Pedido.find({ slug: req.params.slug }).sort({ fecha: -1 });

    let csv = 'Fecha,Nombre,Cliente,Pedido,Direccion,Estado\n';
    pedidos.forEach(p => {
        const fecha = new Date(p.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        const pedidoLimpio = p.pedido.replace(/\n/g, ' ').replace(/,/g, ';');
        const direccion = (p.direccion || '').replace(/,/g, ';');
        csv += `"${fecha}","${p.nombre_cliente || ''}","${p.numero_cliente}","${pedidoLimpio}","${direccion}","${p.estado}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=pedidos-${req.params.slug}.csv`);
    res.send('\uFEFF' + csv);
});

// Cambiar estado
app.post('/panel/:slug/pedido/:id/estado', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    await Pedido.findByIdAndUpdate(req.params.id, { estado: req.body.estado });
    res.redirect(`/panel/${req.params.slug}/pedidos`);
});

// ─── Webhook Meta - verificacion GET ─────────────────────────────────────────
app.get('/webhook-meta', (req, res) => {
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
app.post('/webhook-meta', async (req, res) => {
    res.sendStatus(200);

    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== 'text') return;

    const numeroCliente = message.from;
    const texto = message.text?.body?.trim();
    const mensajeLower = texto?.toLowerCase();
    const phoneNumberId = value?.metadata?.phone_number_id;

    const negocio = Object.values(negocios).find(n => n.phoneNumberId === phoneNumberId);
    if (!negocio) {
        console.log(`Negocio no encontrado para phoneNumberId: ${phoneNumberId}`);
        return;
    }

    console.log(`[${negocio.nombre}] Mensaje de ${numeroCliente}: ${texto}`);

    const sesionKey = `${phoneNumberId}_${numeroCliente}`;
    if (!sesiones[sesionKey]) sesiones[sesionKey] = { estado: 'inicio' };
    const sesion = sesiones[sesionKey];

    let clienteDB = await Cliente.findOne({ numero: numeroCliente });
    let respuesta = '';

    // Si hay una conversación activa, agregar mensaje al historial
    const convActiva = await Conversacion.findOne({
        slug: negocio.slug,
        numero_cliente: numeroCliente,
        estado: 'esperando_negocio'
    });

    if (convActiva) {
        // Agregar mensaje del cliente al historial
        convActiva.mensajes.push({ de: 'cliente', texto });
        await convActiva.save();
        // No hacer nada más — ella responde desde el panel
        return;
    }

    // Comando global
    if (mensajeLower === 'cambiar direccion') {
        sesion.estado = 'cambiando_direccion';
        await enviarMensaje(phoneNumberId, numeroCliente, `Por favor escribe tu nueva direccion de entrega:`);
        return;
    }

    if (sesion.estado === 'inicio') {
        if (!clienteDB || !clienteDB.nombre) {
            respuesta = `Hola! Bienvenido a ${negocio.nombre} 👋\n\nPara comenzar, ¿como te llamas?`;
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
        if (mensajeLower === 'si' || mensajeLower === 'sí') {
            respuesta = `Por favor escribenos tu pedido 📝\n\nEjemplo:\n2 Producto 1\n1 Producto 2`;
            sesion.estado = 'esperando_pedido';
        } else if (mensajeLower === 'no') {
            respuesta = `Hasta luego ${clienteDB?.nombre || ''}! Fue un placer atenderte 😊`;
            delete sesiones[sesionKey];
        } else if (mensajeLower === 'asesor') {
            respuesta = `En breve un asesor se comunicara contigo. Gracias por tu paciencia.`;
            delete sesiones[sesionKey];
        } else {
            respuesta = `Por favor responde *SI*, *NO* o escribe *ASESOR*.`;
        }

    } else if (sesion.estado === 'esperando_pedido') {
        sesion.pedido = texto;
        respuesta = `Por favor escribenos tu pedido 📝\n\nEjemplo:\n2 Producto 1\n1 Producto 2`;
        sesion.estado = 'esperando_pedido';

    } else if (sesion.estado === 'esperando_pedido') {
        sesion.pedido = texto;

        if (!clienteDB?.direccion) {
            respuesta = `¿Cual es tu direccion de entrega? 📍`;
            sesion.estado = 'esperando_direccion';
        } else {
            // Crear conversación activa para que ella responda precio
            await Conversacion.create({
                slug: negocio.slug,
                phoneNumberId,
                numero_cliente: numeroCliente,
                nombre_cliente: clienteDB?.nombre || '',
                pedido: texto,
                direccion: clienteDB?.direccion || '',
                mensajes: [{ de: 'cliente', texto }]
            });
            respuesta = `Recibimos tu pedido 📝\n\nEn breve te confirmamos precio y disponibilidad.`;
            sesion.estado = 'inicio';
        }

    } else if (sesion.estado === 'esperando_direccion') {
        if (!clienteDB) {
            clienteDB = await Cliente.create({ numero: numeroCliente, direccion: texto });
        } else {
            clienteDB.direccion = texto;
            await clienteDB.save();
        }
        sesion.direccion = texto;

        // Crear conversación activa
        await Conversacion.create({
            slug: negocio.slug,
            phoneNumberId,
            numero_cliente: numeroCliente,
            nombre_cliente: clienteDB?.nombre || '',
            pedido: sesion.pedido,
            direccion: texto,
            mensajes: [{ de: 'cliente', texto: sesion.pedido }]
        });
        respuesta = `Recibimos tu pedido 📝\n\nEn breve te confirmamos precio y disponibilidad.`;
        sesion.estado = 'inicio';

    } else if (sesion.estado === 'cambiando_direccion') {
        if (!clienteDB) {
            clienteDB = await Cliente.create({ numero: numeroCliente, direccion: texto });
        } else {
            clienteDB.direccion = texto;
            await clienteDB.save();
        }
        respuesta = `✅ Direccion actualizada: ${texto}\n\nEscribe *Hola* para continuar con tu pedido.`;
        delete sesiones[sesionKey];

    } else {
        if (!clienteDB || !clienteDB.nombre) {
            respuesta = `Hola! ¿Como te llamas?`;
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

// ─── Guardar pedido ───────────────────────────────────────────────────────────
async function guardarPedido(negocio, numeroCliente, clienteDB, sesion) {
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    await Pedido.create({
        negocio: negocio.nombre,
        slug: negocio.slug,
        numero_cliente: numeroCliente,
        nombre_cliente: clienteDB?.nombre || '',
        pedido: sesion.pedido,
        direccion: clienteDB?.direccion || ''
    });
    console.log('================================');
    console.log(`NUEVO PEDIDO - ${negocio.nombre}`);
    console.log(`Cliente: ${clienteDB?.nombre} (${numeroCliente})`);
    console.log(`Pedido:  ${sesion.pedido}`);
    console.log(`Direc:   ${clienteDB?.direccion}`);
    console.log(`Fecha:   ${fecha}`);
    console.log('================================');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});