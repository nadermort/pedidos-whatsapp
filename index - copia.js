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

// Divide un texto largo en líneas de máximo ANCHO caracteres sin cortar palabras
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

    // Dirección con word wrap
    const direccion = clienteDB?.direccion || 'N/A';
    ticket += wordWrap(direccion, '  ') + '\n';

    ticket += linea + '\n';
    ticket += 'PEDIDO:\n';
    ticket += linea + '\n';

    // Pedido con word wrap por línea
    pedido.split('\n').forEach(l => {
        if (l.trim()) {
            ticket += wordWrap(l.trim(), '  ') + '\n';
        }
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
            .content { padding: 20px; }
            .pedido { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #25D366; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .pedido.entregado { border-left-color: #6c757d; opacity: 0.7; }
            .pedido.cancelado { border-left-color: #dc3545; opacity: 0.7; }
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
            .vacio { text-align: center; color: #999; margin-top: 50px; }
        </style>
        <meta http-equiv="refresh" content="30">
    </head>
    <body>
    <div class="header">
        <h1>📋 ${negocio.nombre}</h1>
        <div style="display:flex;align-items:center;gap:10px">
            <span>${pedidos.length} pedidos</span>
            <a href="/panel/${req.params.slug}/export" style="background:white;color:#25D366;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;text-decoration:none">⬇️ Excel</a>
        </div>
    </div>
    <div class="content">`;

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

    html += `</div></body></html>`;
    res.send(html);
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
        respuesta = `Tu pedido es:\n\n${texto}\n\n¿Confirmas?\nResponde *SI* o *NO*`;
        sesion.estado = 'confirmando_pedido';

    } else if (sesion.estado === 'confirmando_pedido') {
        if (mensajeLower === 'si' || mensajeLower === 'sí') {
            if (!clienteDB?.direccion) {
                respuesta = `¿Cual es tu direccion de entrega? 📍`;
                sesion.estado = 'esperando_direccion';
            } else {
                const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                await guardarPedido(negocio, numeroCliente, clienteDB, sesion);
                await imprimirTicket(negocio, clienteDB, sesion.pedido, fecha);
                respuesta = `✅ Pedido confirmado!\n\n👤 ${clienteDB.nombre}\n🛒 ${sesion.pedido}\n📍 ${clienteDB.direccion}\n\nGracias por tu compra en ${negocio.nombre}! 🎉`;
                delete sesiones[sesionKey];
            }
        } else if (mensajeLower === 'no') {
            respuesta = `Por favor escribenos tu pedido nuevamente 📝`;
            sesion.estado = 'esperando_pedido';
        } else {
            respuesta = `Por favor responde *SI* o *NO*.`;
        }

    } else if (sesion.estado === 'esperando_direccion') {
        if (!clienteDB) {
            clienteDB = await Cliente.create({ numero: numeroCliente, direccion: texto });
        } else {
            clienteDB.direccion = texto;
            await clienteDB.save();
        }
        const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        await guardarPedido(negocio, numeroCliente, clienteDB, sesion);
        await imprimirTicket(negocio, clienteDB, sesion.pedido, fecha);
        respuesta = `✅ Pedido confirmado!\n\n👤 ${clienteDB.nombre}\n🛒 ${sesion.pedido}\n📍 ${texto}\n\nGracias por tu compra en ${negocio.nombre}! 🎉`;
        delete sesiones[sesionKey];

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

    await enviarMensaje(phoneNumberId, numeroCliente, respuesta);
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