const express = require('express');
const { Pool } = require('pg'); // Driver do PostgreSQL
const nodemailer = require('nodemailer');
const session = require('express-session');
const bodyParser = require('body-parser');
require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
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

// Rotas do sistema
app.get('/', (req, res) => {
    res.send("Bem-vindo ao sistema!");
});

// Rota POST para criar usuário
app.post('/criar_usuario', (req, res) => {
    console.log("Acessando a rota /criar_usuario (POST)");
    const { nome, email, senha, tipo } = req.body;

    // Validação básica dos campos
    if (!nome || !email || !senha || !tipo) {
        return res.status(400).send('Todos os campos são obrigatórios.');
    }

    // Verifica se o email já existe no banco de dados
    const queryCheck = 'SELECT id FROM usuarios WHERE email = $1';
    pool.query(queryCheck, [email], (err, result) => {
        if (err) {
            console.error("Erro ao consultar o banco de dados na rota /criar_usuario:", err);
            return res.status(500).send('Erro interno ao acessar o banco de dados.');
        }

        if (result.rows.length > 0) {
            console.warn("Email já cadastrado.");
            return res.status(400).send('Email já cadastrado.');
        }

        // Insere o novo usuário no banco de dados
        const queryInsert = 'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4)';
        pool.query(queryInsert, [nome, email, senha, tipo], (err) => {
            if (err) {
                console.error("Erro ao inserir usuário no banco de dados:", err);
                return res.status(500).send('Erro ao criar usuário.');
            }
            console.log(`Usuário criado com sucesso: ${nome} (${email})`);
            res.send('Usuário criado com sucesso.'); // Alterado para evitar redirecionamentos desnecessários
        });
    });
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
        res.send('Token enviado com sucesso.'); // Alterado para evitar redirecionamentos desnecessários
    } catch (err) {
        console.error("Erro ao enviar token:", err);
        res.status(500).send('Erro ao enviar token.');
    }
});

// Rota POST para validar token
app.post('/validar_token', async (req, res) => {
    console.log("Acessando a rota /validar_token (POST)");
    const { token } = req.body;

    // Validação básica do campo
    if (!token) {
        return res.status(400).send('Token é obrigatório.');
    }

    try {
        const isValid = await validarToken(token);

        // Renderiza a página com a mensagem de validação
        let mensagem;
        if (isValid) {
            mensagem = "Token válido!";
        } else {
            mensagem = "Token inválido ou expirado.";
        }

        // Determina o botão "INÍCIO" com base no tipo de usuário
        const tipoUsuario = req.session.tipo_usuario || 'colaborador'; // Define um valor padrão
        const botaoInicio = tipoUsuario === 'administrador' 
            ? '<a href="/painel_administrador"><button>INÍCIO</button></a>' 
            : '<a href="/painel_colaborador"><button>INÍCIO</button></a>';

        // Envia a resposta com a mensagem e o botão
        res.send(`
            <h1>${mensagem}</h1>
            <p>${botaoInicio}</p>
        `);
    } catch (err) {
        console.error("Erro ao validar token:", err);
        res.status(500).send('Erro ao validar token.');
    }
});

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});