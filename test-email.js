require('dotenv').config();
const nodemailer = require('nodemailer');

async function sendTestEmail() {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_REMETENTE,
                pass: process.env.SENHA_EMAIL
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_REMETENTE,
            to: 'destinatario@teste.com', // Substitua pelo email de teste
            subject: 'Teste de Envio de Email',
            text: 'Este é um email de teste enviado pelo Nodemailer.'
        };

        await transporter.sendMail(mailOptions);
        console.log('Email enviado com sucesso!');
    } catch (err) {
        console.error('Erro ao enviar email:', err);
    }
}

sendTestEmail();