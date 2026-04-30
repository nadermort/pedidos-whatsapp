const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/webhook', (req, res) => {
    const mensaje = req.body.Body;
    const numero = req.body.From.replace('whatsapp:', '');
    const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

    console.log('================================');
    console.log('       NUEVO PEDIDO');
    console.log('================================');
    console.log(`Fecha:   ${fecha}`);
    console.log(`Cliente: ${numero}`);
    console.log('--------------------------------');
    console.log('PEDIDO:');
    console.log(mensaje);
    console.log('================================');

    res.set('Content-Type', 'text/xml');
    res.send(`
        <Response>
            <Message>✅ Pedido recibido. En breve lo procesamos.</Message>
        </Response>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});