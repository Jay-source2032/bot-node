require('dotenv').config(); // lê variáveis do .env
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ===== CONFIG VIA .ENV =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const VIP_LINK = process.env.VIP_LINK || 'https://t.me/+me0ODDBwdas4NmU1';
const USERS_FILE = path.join(__dirname, 'users.json');

// ===== INIT BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
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

function generateOrderId() {
    return Math.random().toString(36).substr(2, 9);
}

// ===== START / PAYMENTS =====
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const payload = match[1]; // opcional

    if(!payload){
        bot.sendMessage(chatId, "Welcome! Start your order from the website.");
        return;
    }

    const [plan, username] = payload.split("_");
    const users = loadUsers();
    if(!users[chatId]) users[chatId] = {};

    const orderId = generateOrderId();
    users[chatId].pendingPlan = plan.toLowerCase();
    users[chatId].username = username;
    users[chatId].orderId = orderId;
    saveUsers(users);

    // Mensagem para o usuário
    bot.sendMessage(chatId,
`✅ Order received
Plan: ${plan.charAt(0).toUpperCase() + plan.slice(1)}
Price: ${
  plan.toLowerCase() === 'basic' ? '$65' :
  plan.toLowerCase() === 'premium' ? '$135' :
  '$180'
}
Duration: ${
  plan.toLowerCase() === 'basic' ? '7 days' :
  plan.toLowerCase() === 'premium' ? '30 days' :
  'Lifetime'
}

You will be notified near the end of your subscription.
Please send your payment screenshot here.`
    );

    // Mensagem para o admin
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "Approve ✅", callback_data: `approve_${chatId}` },
                    { text: "Reject ❌", callback_data: `reject_${chatId}` }
                ]
            ]
        }
    };

    bot.sendMessage(
        ADMIN_ID,
        `🆕 New order processed
Plan: ${plan.charAt(0).toUpperCase() + plan.slice(1)}
Username: ${username}
Order ID: ${orderId}
Price: ${
          plan.toLowerCase() === 'basic' ? '$65' :
          plan.toLowerCase() === 'premium' ? '$135' :
          '$180'
        }`,
        opts
    );
});

// ===== UPLOAD DE FOTO =====
bot.on('photo', msg => {
    const chatId = msg.chat.id;
    const users = loadUsers();
    if(!users[chatId] || !users[chatId].pendingPlan) return;

    const fileId = msg.photo[msg.photo.length-1].file_id;
    bot.downloadFile(fileId, './uploads').then(filePath => {
        users[chatId].paymentProof = filePath;
        saveUsers(users);

        bot.sendMessage(chatId, "📸 Payment screenshot received. Waiting for admin approval.");
        bot.sendMessage(ADMIN_ID, `📸 Payment screenshot received for Order ID: ${users[chatId].orderId}`);
    }).catch(err=>{
        console.error(err);
        bot.sendMessage(chatId, "❌ Error uploading screenshot. Try again.");
    });
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', query => {
    const data = query.data;
    const chatId = parseInt(data.split('_')[1]);
    const users = loadUsers();
    if(!users[chatId]) return;

    if(data.startsWith('approve')) {
        const plan = users[chatId].pendingPlan;
        const expire = getExpire(plan);
        users[chatId].plan = plan;
        users[chatId].expires = expire;
        delete users[chatId].pendingPlan;
        saveUsers(users);

        bot.sendMessage(chatId, `🎉 Payment confirmed!\nYour plan: ${plan.charAt(0).toUpperCase()+plan.slice(1)}\nJoin VIP here: ${VIP_LINK}`);
        bot.answerCallbackQuery(query.id, { text: "Approved" });

    } else if(data.startsWith('reject')) {
        bot.sendMessage(chatId, "❌ Payment rejected. Please contact support @wachazzin.");
        delete users[chatId].pendingPlan;
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
    bot.sendMessage(ADMIN_ID, `📊 Subscribers:
Basic: ${basic}
Premium: ${premium}
Elite: ${elite}`);
});

// ===== EXPRESS SERVER =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running'));
