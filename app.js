const express = require('express');
const { Pool } = require('pg'); // Driver do PostgreSQL
const nodemailer = require('nodemailer');
const session = require('express-session');
const bodyParser = require('body-parser');
require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env

const app = express();
const PORT = process.env.PORT || 5432;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('views')); // Serve arquivos estáticos da pasta 'views'
app.use(express.static('public'));

// Configuração da sessão
app.use(session({
    secret: process.env.SECRET_KEY || 'uma_chave_secreta_segura', // Substitua por uma chave segura
    resave: false,
    saveUninitialized: true
}));

// Configuração do PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // URL do banco de dados fornecida pelo Railway ou outra plataforma
    ssl: {
        rejectUnauthorized: false // Necessário para conexões SSL no Railway
    }
});

// Função para criar tabelas no PostgreSQL
function criarTabelas() {
    console.log("Iniciando criação/verificação de tabelas...");

    const queryUsuarios = `
        CREATE TABLE IF NOT EXISTS usuarios (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            senha TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'colaborador'
        )
    `;

    const queryTokens = `
        CREATE TABLE IF NOT EXISTS tokens (
            id SERIAL PRIMARY KEY,
            nome_cliente TEXT NOT NULL,
            email_cliente TEXT NOT NULL,
            token TEXT NOT NULL,
            expiracao TIMESTAMP NOT NULL
        )
    `;

    pool.query(queryUsuarios, (err) => {
        if (err) {
            console.error("Erro ao criar tabela 'usuarios':", err);
        } else {
            console.log("Tabela 'usuarios' criada ou verificada com sucesso.");
        }
    });

    pool.query(queryTokens, (err) => {
        if (err) {
            console.error("Erro ao criar tabela 'tokens':", err);
        } else {
            console.log("Tabela 'tokens' criada ou verificada com sucesso.");
        }
    });
}

criarTabelas(); // Chama a função para criar as tabelas

// Função para gerar tokens
function gerarToken() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // Token de 6 dígitos
}

// Função para salvar token no banco de dados
function salvarToken(nome_cliente, email_cliente, token) {
    const expiracao = new Date(Date.now() + 5 * 60 * 1000); // Data de expiração (5 minutos)
    const query = 'INSERT INTO tokens (nome_cliente, email_cliente, token, expiracao) VALUES ($1, $2, $3, $4)';
    pool.query(query, [nome_cliente, email_cliente, token, expiracao], (err) => {
        if (err) {
            console.error("Erro ao salvar token no banco de dados:", err);
        } else {
            console.log(`Token salvo com sucesso para ${email_cliente}`);
        }
    });
}

// Função para validar token
function validarToken(tokenInserido) {
    return new Promise((resolve, reject) => {
        const query = 'SELECT * FROM tokens WHERE token = $1 AND expiracao > NOW()';
        pool.query(query, [tokenInserido], (err, result) => {
            if (err) {
                console.error("Erro ao validar token no banco de dados:", err);
                return reject(err);
            }
            console.log("Token validado:", result.rows.length > 0);
            resolve(result.rows.length > 0); // Retorna true se o token for válido
        });
    });
}

// Função para enviar email
async function enviarEmail(destinatario, nome_cliente, token) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_REMETENTE, // Email do remetente (variável de ambiente)
            pass: process.env.SENHA_EMAIL     // Senha do email (variável de ambiente)
        }
    });

    const mailOptions = {
        from: process.env.EMAIL_REMETENTE,
        to: destinatario,
        subject: 'Seu Código de Verificação',
        text: `Olá, ${nome_cliente}\n\nSeu número do token é: ${token}\n\nEste é um email automático enviado pela G3FIBRA para validar seu atendimento. Por favor, informe este código ao colaborador.\n\nAtenciosamente,\nEquipe G3FIBRA`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email enviado com sucesso para ${destinatario}`);
    } catch (err) {
        console.error("Erro ao enviar email:", err);
        throw err;
    }
}

// Rota GET para exibir a página inicial
app.get('/', (req, res) => {
    console.log("Acessando a rota raiz (/)");
    if (!req.session.logado) {
        console.warn("Usuário não está logado. Redirecionando para /login...");
        return res.redirect('/login');
    }

    // Redireciona para o painel correspondente
    if (req.session.tipo_usuario === 'administrador') {
        console.log("Redirecionando para /painel_administrador...");
        return res.redirect('/painel_administrador');
    } else {
        console.log("Redirecionando para /painel_colaborador...");
        return res.redirect('/painel_colaborador');
    }
});

// Rota GET para exibir a página de login
app.get('/login', (req, res) => {
    console.log("Carregando página de login...");
    res.sendFile(__dirname + '/views/login.html');
});

// Rota POST para processar o login
app.post('/login', (req, res) => {
    console.log("Acessando a rota /login (POST)");
    const { email, senha } = req.body;

    // Validação básica dos campos
    if (!email || !senha) {
        return res.status(400).send('Todos os campos são obrigatórios.');
    }

    // Consulta o banco de dados para verificar as credenciais
    const query = 'SELECT id, tipo FROM usuarios WHERE email = $1 AND senha = $2';
    pool.query(query, [email, senha], (err, result) => {
        if (err) {
            console.error("Erro ao consultar o banco de dados na rota /login:", err);
            return res.status(500).send('Erro interno ao acessar o banco de dados.');
        }

        if (result.rows.length > 0) {
            const usuario = result.rows[0];
            console.log(`Login bem-sucedido para o usuário com ID: ${usuario.id}`);

            // Inicia a sessão
            req.session.logado = true;
            req.session.usuario_id = usuario.id;
            req.session.tipo_usuario = usuario.tipo;

            // Redireciona para o painel correspondente
            if (usuario.tipo === 'administrador') {
                console.log("Redirecionando para /painel_administrador...");
                return res.redirect('/painel_administrador');
            } else {
                console.log("Redirecionando para /painel_colaborador...");
                return res.redirect('/painel_colaborador');
            }
        } else {
            console.warn("Email ou senha incorretos.");
            return res.status(401).send('Email ou senha incorretos.');
        }
    });
});

// Rota GET para logout
app.get('/logout', (req, res) => {
    console.log("Encerrando sessão do usuário...");
    req.session.destroy((err) => {
        if (err) {
            console.error("Erro ao encerrar a sessão:", err);
            return res.status(500).send('Erro ao fazer logout.');
        }
        console.log("Logout realizado com sucesso. Redirecionando para /login...");
        res.redirect('/login');
    });
});

// Rota GET para exibir o painel do administrador
app.get('/painel_administrador', (req, res) => {
    console.log("Acessando a rota /painel_administrador");
    if (!req.session.logado || req.session.tipo_usuario !== 'administrador') {
        console.warn("Acesso negado à rota /painel_administrador. Redirecionando para /login...");
        return res.redirect('/login');
    }
    res.sendFile(__dirname + '/views/painel_administrador.html');
});

// Rota GET para exibir o painel do colaborador
app.get('/painel_colaborador', (req, res) => {
    console.log("Acessando a rota /painel_colaborador");
    if (!req.session.logado || req.session.tipo_usuario !== 'colaborador') {
        console.warn("Acesso negado à rota /painel_colaborador. Redirecionando para /login...");
        return res.redirect('/login');
    }
    res.sendFile(__dirname + '/views/painel_colaborador.html');
});

// Rota GET para exibir o formulário de envio de token
app.get('/enviar_token', (req, res) => {
    console.log("Acessando a rota /enviar_token");
    if (!req.session.logado) {
        console.warn("Acesso negado à rota /enviar_token. Redirecionando para /login...");
        return res.redirect('/login');
    }
    res.sendFile(__dirname + '/views/enviar_token.html');
});

// Rota POST para enviar token
app.post('/enviar_token', async (req, res) => {
    console.log("Acessando a rota /enviar_token (POST)");
    const { nome_cliente, email_cliente } = req.body;

    // Validação básica dos campos
    if (!nome_cliente || !email_cliente) {
        return res.status(400).send('Todos os campos são obrigatórios.');
    }

    try {
        const token = gerarToken();
        console.log(`Gerado novo token: ${token}`);
        salvarToken(nome_cliente, email_cliente, token);
        await enviarEmail(email_cliente, nome_cliente, token);
        res.redirect('/validar_token'); // Redireciona para a página de validação de token
    } catch (err) {
        console.error("Erro ao enviar token:", err);
        res.status(500).send('Erro ao enviar token.');
    }
});

// Rota GET para exibir a página de validação de token
app.get('/validar_token', (req, res) => {
    console.log("Acessando a rota /validar_token");
    if (!req.session.logado) {
        console.warn("Acesso negado à rota /validar_token. Redirecionando para /login...");
        return res.redirect('/login');
    }
    res.sendFile(__dirname + '/views/validar_token.html');
});

// Rota POST para validar token
app.post('/validar_token', async (req, res) => {
    console.log("Acessando a rota /validar_token (POST)");
    const { token } = req.body;

    try {
        // Validação básica do campo
        if (!token) {
            return res.status(400).send('Token é obrigatório.');
        }

        // Valida o token
        const isValid = await validarToken(token);

        // Define a mensagem com base na validação
        let mensagem;
        if (isValid) {
            mensagem = "Token válido!";
        } else {
            mensagem = "Token inválido ou expirado.";
        }

        // Verifica o tipo de usuário logado
        const tipoUsuario = req.session.tipo_usuario || 'colaborador'; // Define um valor padrão

        // Redireciona para a página correspondente ao tipo de usuário
        if (tipoUsuario === 'administrador') {
            console.log("Redirecionando para /painel_administrador...");
            return res.redirect('/painel_administrador');
        } else {
            console.log("Redirecionando para /painel_colaborador...");
            return res.redirect('/painel_colaborador');
        }
    } catch (err) {
        console.error("Erro ao validar token:", err);
        res.status(500).send('Erro ao validar token.');
    }
});

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});