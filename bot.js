const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const VIP_LINK = process.env.VIP_LINK;

const USERS_FILE = './users.json';

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("Bot running...");

// ===== EXPRESS (Render keep alive) =====
const app = express();
app.get("/", (req,res)=> res.send("Bot alive"));
app.listen(3000);

// ===== HELPERS =====
function loadUsers(){
    if(!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data){
    fs.writeFileSync(USERS_FILE, JSON.stringify(data,null,2));
}

function getPlanDetails(plan){
    plan = plan.toLowerCase();

    if(plan === "basic"){
        return {days:7, price:65};
    }
    if(plan === "premium"){
        return {days:30, price:120};
    }
    if(plan === "elite"){
        return {days:"Lifetime", price:250};
    }
    return {days:7, price:0};
}

function generateOrderId(){
    return Math.floor(100000 + Math.random() * 900000);
}

function getExpireDate(plan){
    const now = new Date();
    if(plan === "basic") now.setDate(now.getDate()+7);
    if(plan === "premium") now.setDate(now.getDate()+30);
    if(plan === "elite") return "lifetime";
    return now.toISOString();
}

// ===== START WITH PLAN FROM SITE =====
bot.onText(/\/start (.+)/, (msg, match)=>{
    const payload = match[1]; // PLAN_username
    const [planRaw, username] = payload.split("_");

    const plan = planRaw.toLowerCase();
    const userId = msg.chat.id;
    const name = msg.from.first_name;

    const orderId = generateOrderId();
    const details = getPlanDetails(plan);

    const users = loadUsers();
    users[userId] = {
        name,
        telegram: username,
        pendingPlan: plan,
        orderId
    };
    saveUsers(users);

    // ===== MESSAGE TO CLIENT =====
    bot.sendMessage(userId,
`✅ Order received

Plan: ${plan.toUpperCase()}
Duration: ${details.days}
Price: $${details.price}

You will be notified before your subscription expires.

Please wait. Your access link will be sent shortly after payment verification.`
    );

    // ===== ADMIN MESSAGE =====
    const opts = {
        reply_markup:{
            inline_keyboard:[
                [
                    {text:"Approve", callback_data:`approve_${userId}`},
                    {text:"Reject", callback_data:`reject_${userId}`}
                ]
            ]
        }
    };

    bot.sendMessage(ADMIN_ID,
`📥 New order processed

Order ID: ${orderId}
Plan: ${plan.toUpperCase()}
Duration: ${details.days}
Price: $${details.price}

Telegram: @${username}
User ID: ${userId}`,
    opts);
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', query=>{
    const data = query.data;
    const userId = parseInt(data.split("_")[1]);

    const users = loadUsers();
    if(!users[userId]) return;

    const plan = users[userId].pendingPlan;

    if(data.startsWith("approve")){
        const expire = getExpireDate(plan);

        users[userId].plan = plan;
        users[userId].expires = expire;
        delete users[userId].pendingPlan;

        saveUsers(users);

        bot.sendMessage(userId,
`🎉 Payment confirmed!

Plan: ${plan.toUpperCase()}

Here is your VIP access:
${VIP_LINK}

Thank you for your purchase!`
        );

        bot.answerCallbackQuery(query.id,{text:"Approved"});
    }

    if(data.startsWith("reject")){
        delete users[userId].pendingPlan;
        saveUsers(users);

        bot.sendMessage(userId,
`❌ Payment rejected.

The access link will not be sent.

If you believe this is a mistake, please contact support:
@wachazzin`
        );

        bot.answerCallbackQuery(query.id,{text:"Rejected"});
    }
});
