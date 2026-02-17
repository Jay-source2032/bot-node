const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const cron = require('node-cron');

// ===== CONFIG =====
const TOKEN = '8534659329:AAFw8ksVcBwRI0ZW03CPlLwk33gj38RDVK8'; // Coloque seu token
const ADMIN_ID = 8320256438; // Seu Telegram ID
const VIP_LINK = 'https://t.me/+me0ODDBwdas4NmU1';
const USERS_FILE = './users.json';

// ===== INIT BOT =====
const bot = new TelegramBot(TOKEN, { polling: true });
console.log('Bot running...');

// ===== HELPERS =====
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function getExpire(plan) {
    const now = new Date();
    if(plan === 'basic') now.setDate(now.getDate()+7);
    if(plan === 'premium') now.setDate(now.getDate()+30);
    if(plan === 'elite') return 'lifetime';
    return now.toISOString();
}

// ===== RECEBENDO CLIENTE DO SITE =====
bot.onText(/\/start (.+)/, (msg, match) => {
    const payload = match[1];             // ex: "PREMIUM_username"
    const [plan, telegram] = payload.split("_");
    const userId = msg.chat.id;
    const name = msg.from.first_name;

    const users = loadUsers();
    if(!users[userId]) users[userId] = {};

    users[userId].pendingPlan = plan.toLowerCase();
    users[userId].telegram = telegram;

    saveUsers(users);

    const opts = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "Approve", callback_data: `approve_${userId}` },
                    { text: "Reject", callback_data: `reject_${userId}` }
                ]
            ]
        }
    };

    bot.sendMessage(
        ADMIN_ID,
        `🆕 New customer\nName: ${name}\nID: ${userId}\nPlan: ${plan}\nTelegram: ${telegram}`,
        opts
    );

    bot.sendMessage(userId, "✅ Request received. Waiting for admin approval.");
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', query => {
    const data = query.data;
    const userId = parseInt(data.split('_')[1]);

    const users = loadUsers();
    if(!users[userId]) users[userId] = {};

    if(data.startsWith('approve')) {
        const plan = users[userId].pendingPlan || 'basic';
        const expire = getExpire(plan);

        users[userId].plan = plan;
        users[userId].expires = expire;
        delete users[userId].pendingPlan;

        saveUsers(users);

        bot.sendMessage(userId, `🎉 Payment confirmed!\nPlan: ${plan.toUpperCase()}\n\nJoin VIP here:\n${VIP_LINK}`);
        bot.answerCallbackQuery(query.id, { text: "Approved" });

    } else if(data.startsWith('reject')) {
        bot.sendMessage(userId, "❌ Payment not confirmed.");
        delete users[userId].pendingPlan;
        saveUsers(users);
        bot.answerCallbackQuery(query.id, { text: "Rejected" });
    }
});

// ===== STATS =====
bot.onText(/\/stats/, msg => {
    if(msg.chat.id !== ADMIN_ID) return;

    const users = loadUsers();
    let basic=0, premium=0, elite=0;

    Object.values(users).forEach(u=>{
        if(u.plan==='basic') basic++;
        if(u.plan==='premium') premium++;
        if(u.plan==='elite') elite++;
    });

    bot.sendMessage(ADMIN_ID, `📊 Subscribers:\nBasic: ${basic}\nPremium: ${premium}\nElite: ${elite}`);
});

// ===== LEMBRETES DIÁRIOS =====
cron.schedule('0 12 * * *', () => {
    const users = loadUsers();
    const now = new Date();

    Object.keys(users).forEach(id=>{
        const user = users[id];

        if(user.expires && user.expires!=='lifetime') {
            const exp = new Date(user.expires);
            const diff = (exp-now)/(1000*60*60*24);

            if(diff <= 2 && diff > 1) {
                bot.sendMessage(id, "⚠️ Your subscription expires soon.");
            }

            if(diff <= 0) {
                bot.sendMessage(id, "⏰ Your subscription expired. Please renew.");
                delete users[id].plan;
                delete users[id].expires;
            }
        }
    });

    saveUsers(users);
});
const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('Bot is running');
});

app.listen(3000, () => {
    console.log('Web server running');
});

