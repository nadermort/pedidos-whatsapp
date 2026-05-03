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

app.post('/webhook', async (req, res) => {
    const mensaje = req.body.Body.trim();
    const numeroCliente = req.body.From.replace('whatsapp:', '');
    const numeroNegocio = req.body.To.replace('whatsapp:', '');
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const mensajeLower = mensaje.toLowerCase();

    // Buscar negocio por numero
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