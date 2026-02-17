const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const cron = require('node-cron');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;      // Bot token do Render
const ADMIN_ID = parseInt(process.env.ADMIN_ID); // Admin Telegram ID do Render
const VIP_LINK = process.env.VIP_LINK;    // Link VIP para enviar ao cliente
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

function generateOrderID() {
    return Math.random().toString(36).substr(2,9).toUpperCase();
}

// ===== RECEBENDO CLIENTE DO CONFIRM.HTML =====
bot.onText(/\/start (.+)/, async (msg, match) => {
    const payload = match[1];             // ex: "Premium_username"
    const [plan, telegram] = payload.split("_");
    const userId = msg.chat.id;
    const name = msg.from.first_name;

    const orderID = generateOrderID();

    const users = loadUsers();
    if(!users[userId]) users[userId] = {};

    users[userId].pendingPlan = plan.toLowerCase();
    users[userId].telegram = telegram;
    users[userId].orderID = orderID;

    saveUsers(users);

    // ===== Mensagem para Admin =====
    const adminOpts = {
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
        `🆕 New order processed\nName: ${name}\nUsername: @${telegram}\nPlan: ${plan}\nOrder ID: ${orderID}\nPrice: ${
            plan.toLowerCase()==='basic'?'$65':plan.toLowerCase()==='premium'?'$120':'$250'
        }`,
        adminOpts
    );

    // ===== Mensagem para Cliente =====
    bot.sendMessage(userId,
        `✅ Order received!\nPlan: ${plan}\nDuration: ${
            plan.toLowerCase()==='basic'?'7 days':plan.toLowerCase()==='premium'?'30 days':'Lifetime'
        }\nPrice: ${
            plan.toLowerCase()==='basic'?'$65':plan.toLowerCase()==='premium'?'$120':'$250'
        }\nYou will be notified near the end of the subscription.\nLink will arrive in 1 minute.`
    );

    bot.sendMessage(userId, "Please upload a screenshot of your payment as proof.", {
        reply_markup: { force_reply: true, input_field_placeholder: "Send screenshot here..." }
    });
});

// ===== RECEBENDO COMPROVANTE =====
bot.on('photo', async (msg) => {
    const userId = msg.chat.id;
    const users = loadUsers();

    if(!users[userId] || !users[userId].pendingPlan){
        bot.sendMessage(userId, "⚠️ No pending order found. Make sure you started via confirm page.");
        return;
    }

    users[userId].proof = msg.photo[msg.photo.length-1].file_id;
    saveUsers(users);

    bot.sendMessage(userId, "✅ Payment proof received. Waiting for admin approval.");
    bot.sendMessage(ADMIN_ID, `📸 Payment proof received from @${users[userId].telegram} for order ${users[userId].orderID}.`);
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', query => {
    const data = query.data;
    const userId = parseInt(data.split('_')[1]);

    const users = loadUsers();
    if(!users[userId]) return bot.answerCallbackQuery(query.id, {text:"User not found"});

    if(data.startsWith('approve')) {
        const plan = users[userId].pendingPlan || 'basic';
        const expire = getExpire(plan);

        users[userId].plan = plan;
        users[userId].expires = expire;
        delete users[userId].pendingPlan;

        saveUsers(users);

        bot.sendMessage(userId, `🎉 Payment confirmed!\nPlan: ${plan.toUpperCase()}\nJoin VIP here: ${VIP_LINK}`);
        bot.answerCallbackQuery(query.id, { text: "Approved" });

    } else if(data.startsWith('reject')) {
        bot.sendMessage(userId, "❌ Payment not confirmed. Contact support in case of error: @wachazzin");
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

app.get('/', (req, res) => res.send('Bot is running'));
app.listen(3000, () => console.log('Web server running'));
