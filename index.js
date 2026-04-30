const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const sesiones = {};

const MENU = `🛒 *Flores Gomez*
Nuestros productos:

🔹 Producto 1 - $20 MXN
🔹 Producto 2 - $60 MXN
🔹 Producto 3 - $120 MXN

¿Te gustaría hacer un pedido?
Responde *SI* o *NO*
Escribe *ASESOR* para hablar con alguien`;

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
        respuesta = `👋 ¡Bienvenido a *Flores Gomez*!\n\n${MENU}`;
        sesion.estado = 'esperando_decision';

    } else if (sesion.estado === 'esperando_decision') {
        if (mensajeLower === 'si' || mensajeLower === 'sí') {
            respuesta = `📝 Por favor escríbenos tu pedido.\n\nEjemplo:\n1 kg de Producto 1\n2 Producto 2`;
            sesion.estado = 'esperando_pedido';
        } else if (mensajeLower === 'no') {
            respuesta = `👋 ¡Hasta luego! Fue un placer atenderte.\nCualquier cosa estamos aquí. 😊`;
            sesion.estado = 'inicio';
        } else if (mensajeLower === 'asesor') {
            respuesta = `👤 En breve un asesor se comunicará contigo.\nGracias por tu paciencia. 🙏`;
            sesion.estado = 'inicio';
        } else {
            respuesta = `Por favor responde *SI*, *NO* o escribe *ASESOR* para hablar con alguien.`;
        }

    } else if (sesion.estado === 'esperando_pedido') {
        sesion.pedido = mensaje;
        respuesta = `📋 Tu pedido es:\n\n${mensaje}\n\n¿Confirmas tu pedido?\nResponde *SI* para confirmar o *NO* para modificarlo.`;
        sesion.estado = 'confirmando_pedido';

    } else if (sesion.estado === 'confirmando_pedido') {
        if (mensajeLower === 'si' || mensajeLower === 'sí') {
            console.log('================================');
            console.log('       NUEVO PEDIDO');
            console.log('================================');
            console.log(`Fecha:   ${fecha}`);
            console.log(`Cliente: ${numero}`);
            console.log('--------------------------------');
            console.log('PEDIDO:');
            console.log(sesion.pedido);
            console.log('================================');

            respuesta = `✅ ¡Pedido confirmado! En breve lo procesamos.\n¡Gracias por tu compra en *Flores Gomez*! 🌸`;
            sesion.estado = 'inicio';
            sesion.pedido = null;

        } else if (mensajeLower === 'no') {
            respuesta = `📝 Por favor escríbenos tu pedido nuevamente.`;
            sesion.estado = 'esperando_pedido';
        } else {
            respuesta = `Por favor responde *SI* para confirmar o *NO* para modificar tu pedido.`;
        }
    } else {
        respuesta = `👋 ¡Bienvenido a *Flores Gomez*!\n\n${MENU}`;
        sesion.estado = 'esperando_decision';
    }

    res.set('Content-Type', 'text/xml');
    res.send(`
        <Response>
            <Message>${respuesta}</Message>
        </Response>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});