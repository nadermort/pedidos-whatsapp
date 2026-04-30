const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const sesiones = {};

const MENU = `Bienvenido a Flores Gomez
Nuestros productos:

- Producto 1 - $20 MXN
- Producto 2 - $60 MXN
- Producto 3 - $120 MXN

Te gustaria hacer un pedido?
Responde SI o NO
Escribe ASESOR para hablar con alguien`;

app.post('/webhook', (req, res) => {
    const mensaje = req.body.Body.trim();
    const numero = req.body.From.replace('whatsapp:', '');
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const mensajeLower = mensaje.toLowerCase();

    if (!sesiones[numero]) {
        sesiones[numero] = { estado: 'inicio' };
    }

    const sesion = sesiones[numero];
    let respuesta = '';

    if (sesion.estado === 'inicio') {
        respuesta = MENU;
        sesion.estado = 'esperando_decision';

    } else if (sesion.estado === 'esperando_decision') {
        if (mensajeLower === 'si' || mensajeLower === 'si') {
            respuesta = `Por favor escribenos tu pedido.\n\nEjemplo:\n1 kg de Producto 1\n2 Producto 2`;
            sesion.estado = 'esperando_pedido';
        } else if (mensajeLower === 'no') {
            respuesta = `Hasta luego! Fue un placer atenderte. Cualquier cosa estamos aqui.`;
            sesion.estado = 'inicio';
        } else if (mensajeLower === 'asesor') {
            respuesta = `En breve un asesor se comunicara contigo. Gracias por tu paciencia.`;
            sesion.estado = 'inicio';
        } else {
            respuesta = `Por favor responde SI, NO o escribe ASESOR para hablar con alguien.`;
        }

    } else if (sesion.estado === 'esperando_pedido') {
        sesion.pedido = mensaje;
        respuesta = `Tu pedido es:\n\n${mensaje}\n\nConfirmas tu pedido?\nResponde SI para confirmar o NO para modificarlo.`;
        sesion.estado = 'confirmando_pedido';

    } else if (sesion.estado === 'confirmando_pedido') {
        if (mensajeLower === 'si' || mensajeLower === 'si') {
            console.log('================================');
            console.log('       NUEVO PEDIDO');
            console.log('================================');
            console.log(`Fecha:   ${fecha}`);
            console.log(`Cliente: ${numero}`);
            console.log('--------------------------------');
            console.log('PEDIDO:');
            console.log(sesion.pedido);
            console.log('================================');

            respuesta = `Pedido confirmado! En breve lo procesamos. Gracias por tu compra en Flores Gomez!`;
            sesion.estado = 'inicio';
            sesion.pedido = null;

        } else if (mensajeLower === 'no') {
            respuesta = `Por favor escribenos tu pedido nuevamente.`;
            sesion.estado = 'esperando_pedido';
        } else {
            respuesta = `Por favor responde SI para confirmar o NO para modificar tu pedido.`;
        }
    } else {
        respuesta = MENU;
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