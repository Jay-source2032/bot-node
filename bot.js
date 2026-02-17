const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

const bot = new TelegramBot(TOKEN, { polling: true });

const app = express();
app.use(express.json());

// Rota de teste (importante para Render)
app.get("/", (req, res) => {
    res.send("Bot está online!");
});

// Recebe /start com parâmetros
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;

    // Se não vier parâmetro
    if (!match[1]) {
        bot.sendMessage(chatId, "Bem-vindo! Use o link de confirmação do site.");
        return;
    }

    const data = match[1];

    let plan = "Desconhecido";
    let username = "Não informado";

    if (data.includes("_")) {
        const parts = data.split("_");
        plan = parts[0];
        username = parts[1];
    }

    // Mensagem para o cliente
    bot.sendMessage(chatId,
`✅ Pedido recebido!

Plano: ${plan}
Usuário: @${username}

Aguarde a confirmação do administrador.`);

    // Notificação para o admin
    bot.sendMessage(ADMIN_ID,
`📥 NOVO PEDIDO

Plano: ${plan}
Usuário: @${username}
Chat ID: ${chatId}`);
});

// Porta do Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Servidor rodando na porta " + PORT);
});
