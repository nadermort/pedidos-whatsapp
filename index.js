const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/webhook', (req, res) => {
    const mensaje = req.body.Body;
    const numero = req.body.From;

    console.log('Nuevo pedido recibido');
    console.log('De:', numero);
    console.log('Mensaje:', mensaje);

    res.set('Content-Type', 'text/xml');
    res.send(`
        <Response>
            <Message>Pedido recibido. En breve lo procesamos.</Message>
        </Response>
    `);
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Servidor corriendo en puerto 3000');
});