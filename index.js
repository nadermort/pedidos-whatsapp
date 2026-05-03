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

// Modelo de Pedido
const PedidoSchema = new mongoose.Schema({
    negocio: String,
    slug: String,
    numero_cliente: String,
    pedido: String,
    fecha: { type: Date, default: Date.now },
    estado: { type: String, default: 'pendiente' }
});
const Pedido = mongoose.model('Pedido', PedidoSchema);

// Sesiones en memoria
const sesiones = {};

function generarMenu(negocio) {
    let menu = `Bienvenido a ${negocio.nombre}\nNuestros productos:\n\n`;
    negocio.productos.forEach(p => {
        menu += `- ${p.nombre} - $${p.precio} MXN\n`;
    });
    menu += `\nTe gustaria hacer un pedido?\nResponde SI o NO\nEscribe ASESOR para hablar con alguien`;
    return menu;
}

function buscarNegocioPorSlug(slug) {
    return Object.values(negocios).find(n => n.slug === slug);
}

// Panel login
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
            .header span { font-size: 13px; opacity: 0.9; }
            .content { padding: 20px; }
            .pedido { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #25D366; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .pedido.entregado { border-left-color: #6c757d; opacity: 0.7; }
            .pedido.cancelado { border-left-color: #dc3545; opacity: 0.7; }
            .cliente { color: #666; font-size: 13px; }
            .pedido-texto { margin: 8px 0; font-size: 15px; }
            .fecha { color: #999; font-size: 12px; margin-bottom: 8px; }
            .estado-pendiente { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; background: #fff3cd; color: #856404; }
            .estado-entregado { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; background: #d4edda; color: #155724; }
            .estado-cancelado { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; background: #f8d7da; color: #721c24; }
            .btn-entregado { background: #25D366; color: white; border: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-left: 8px; }
            .btn-cancelado { background: #dc3545; color: white; border: none; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-left: 5px; }
            .vacio { text-align: center; color: #999; margin-top: 50px; }
            .export-btn { background: white; color: #25D366; border: 2px solid white; padding: 6px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: bold; }
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
                <div class="cliente">📱 ${p.numero_cliente}</div>
                <div class="pedido-texto">🛒 ${p.pedido.replace(/\n/g, '<br>')}</div>
                <div class="fecha">🕐 ${fecha}</div>
                <span class="${claseEstado}">${p.estado}</span>
                ${p.estado === 'pendiente' ? `
                <form method="POST" action="/panel/${req.params.slug}/pedido/${p._id}/estado" style="display:inline">
                    <button class="btn-entregado" name="estado" value="entregado">✅ Entregado</button>
                    <button class="btn-cancelado" name="estado" value="cancelado">❌ Cancelado</button>
                </form>` : ''}
            </div>`;
        });
    }

    html += `</div></body></html>`;
    res.send(html);
});

// Export a Excel
app.get('/panel/:slug/export', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    const { desde, hasta } = req.query;
    let filtro = { slug: req.params.slug };

    if (desde || hasta) {
        filtro.fecha = {};
        if (desde) filtro.fecha.$gte = new Date(desde);
        if (hasta) {
            const hastaFin = new Date(hasta);
            hastaFin.setHours(23, 59, 59);
            filtro.fecha.$lte = hastaFin;
        }
    }

    const pedidos = await Pedido.find(filtro).sort({ fecha: -1 });

    let csv = 'Fecha,Cliente,Pedido,Estado\n';
    pedidos.forEach(p => {
        const fecha = new Date(p.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        const pedidoLimpio = p.pedido.replace(/\n/g, ' ').replace(/,/g, ';');
        csv += `"${fecha}","${p.numero_cliente}","${pedidoLimpio}","${p.estado}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=pedidos-${req.params.slug}.csv`);
    res.send('\uFEFF' + csv);
});

// Cambiar estado de pedido
app.post('/panel/:slug/pedido/:id/estado', async (req, res) => {
    const negocio = buscarNegocioPorSlug(req.params.slug);
    if (!negocio) return res.status(404).send('No encontrado');

    await Pedido.findByIdAndUpdate(req.params.id, { estado: req.body.estado });
    res.redirect(`/panel/${req.params.slug}/pedidos`);
});

// Webhook WhatsApp
// Webhook Meta - verificacion
app.get('/webhook-meta', (req, res) => {
    const VERIFY_TOKEN = 'mitoken123';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verificado');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Webhook Meta - recibir mensajes
app.post('/webhook-meta', async (req, res) => {
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const change = entry?.changes?.[0];
        const message = change?.value?.messages?.[0];
        
        if (message) {
            const numeroCliente = message.from;
            const texto = message.text?.body;
            const numeroNegocio = change.value.metadata.display_phone_number.replace(/\D/g, '');
            
            console.log(`Mensaje de ${numeroCliente}: ${texto}`);
        }
    }
    
    res.sendStatus(200);
});
app.post('/webhook', async (req, res) => {
    const mensaje = req.body.Body.trim();
    const numeroCliente = req.body.From.replace('whatsapp:', '');
    const numeroNegocio = req.body.To.replace('whatsapp:', '');
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const mensajeLower = mensaje.toLowerCase();

    const negocio = negocios[numeroNegocio];

    if (!negocio) {
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Servicio no disponible.</Message></Response>`);
        return;
    }

    const sesionKey = `${numeroNegocio}_${numeroCliente}`;
    if (!sesiones[sesionKey]) {
        sesiones[sesionKey] = { estado: 'inicio' };
    }

    const sesion = sesiones[sesionKey];
    let respuesta = '';

    if (sesion.estado === 'inicio') {
        respuesta = generarMenu(negocio);
        sesion.estado = 'esperando_decision';

    } else if (sesion.estado === 'esperando_decision') {
        if (mensajeLower === 'si' || mensajeLower === 'sí') {
            respuesta = `Por favor escribenos tu pedido.\n\nEjemplo:\n1 kg de Producto 1\n2 Producto 2`;
            sesion.estado = 'esperando_pedido';
        } else if (mensajeLower === 'no') {
            respuesta = `Hasta luego! Fue un placer atenderte.`;
            sesion.estado = 'inicio';
        } else if (mensajeLower === 'asesor') {
            respuesta = `En breve un asesor se comunicara contigo. Gracias por tu paciencia.`;
            sesion.estado = 'inicio';
        } else {
            respuesta = `Por favor responde SI, NO o escribe ASESOR.`;
        }

    } else if (sesion.estado === 'esperando_pedido') {
        sesion.pedido = mensaje;
        respuesta = `Tu pedido es:\n\n${mensaje}\n\nConfirmas?\nResponde SI o NO`;
        sesion.estado = 'confirmando_pedido';

    } else if (sesion.estado === 'confirmando_pedido') {
        if (mensajeLower === 'si' || mensajeLower === 'sí') {
            await Pedido.create({
                negocio: negocio.nombre,
                slug: negocio.slug,
                numero_cliente: numeroCliente,
                pedido: sesion.pedido
            });

            console.log('================================');
            console.log(`NUEVO PEDIDO - ${negocio.nombre}`);
            console.log('================================');
            console.log(`Fecha:   ${fecha}`);
            console.log(`Cliente: ${numeroCliente}`);
            console.log('--------------------------------');
            console.log(sesion.pedido);
            console.log('================================');

            respuesta = `Pedido confirmado! Gracias por tu compra en ${negocio.nombre}!`;
            sesion.estado = 'inicio';
            sesion.pedido = null;

        } else if (mensajeLower === 'no') {
            respuesta = `Por favor escribenos tu pedido nuevamente.`;
            sesion.estado = 'esperando_pedido';
        } else {
            respuesta = `Por favor responde SI o NO.`;
        }
    } else {
        respuesta = generarMenu(negocio);
        sesion.estado = 'esperando_decision';
    }

    const twiml = respuesta
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${twiml}</Message></Response>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});