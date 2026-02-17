const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const VIP_LINK = process.env.VIP_LINK;

const USERS_FILE = './users.json';

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { polling: true });
console.log("Bot running...");

// ===== WEB SERVER (Render requirement) =====
const app = express();
app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// ===== HELPERS =====
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function getPlanInfo(plan) {
    plan = plan.toLowerCase();

    if (plan === "basic") {
        return { duration: "7 days", price: "$65" };
    }
    if (plan === "premium") {
        return { duration: "30 days", price: "$90" };
    }
    if (plan === "elite") {
        return { duration: "Lifetime", price: "$120" };
    }
    return { duration: "Unknown", price: "$0" };
}

function generateOrderId() {
    return Math.floor(100000 + Math.random() * 900000);
}

// ===== START FROM WEBSITE =====
bot.onText(/\/start (.+)/, (msg, match) => {
    const payload = match[1]; // PLAN_username
    const [planRaw, username] = payload.split("_");

    const userId = msg.chat.id;
    const plan = planRaw.toLowerCase();
    const planInfo = getPlanInfo(plan);
    const orderId = generateOrderId();

    const users = loadUsers();

    users[userId] = {
        plan,
        username,
        duration: planInfo.duration,
        price: planInfo.price,
        orderId,
        status: "waiting_proof"
    };

    saveUsers(users);

    // Message to customer
    bot.sendMessage(userId,
`Order received ✅

Plan: ${plan.toUpperCase()}
Duration: ${planInfo.duration}
Price: ${planInfo.price}

Please send your payment screenshot here.

You will be notified when your subscription is approved.`
    );
});

// ===== RECEIVE SCREENSHOT =====
bot.on('photo', async (msg) => {
    const userId = msg.chat.id;
    const users = loadUsers();

    if (!users[userId] || users[userId].status !== "waiting_proof") {
        return;
    }

    const user = users[userId];
    user.status = "pending_admin";
    saveUsers(users);

    const fileId = msg.photo[msg.photo.length - 1].file_id;

    const adminText =
`🆕 New order processed

Plan: ${user.plan.toUpperCase()}
Duration: ${user.duration}
Price: ${user.price}
Username: @${user.username}
User ID: ${userId}
Order ID: ${user.orderId}`;

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

    // Send photo to admin
    bot.sendPhoto(ADMIN_ID, fileId, { caption: adminText, ...opts });

    bot.sendMessage(userId, "Screenshot received. Waiting for admin approval.");
});

// ===== APPROVE / REJECT =====
bot.on('callback_query', (query) => {
    const data = query.data;
    const userId = parseInt(data.split("_")[1]);

    const users = loadUsers();
    if (!users[userId]) return;

    const user = users[userId];

    if (data.startsWith("approve")) {
        user.status = "approved";
        saveUsers(users);

        bot.sendMessage(userId,
`🎉 Payment confirmed!

Plan: ${user.plan.toUpperCase()}
Duration: ${user.duration}

Join VIP:
${VIP_LINK}`
        );

        bot.answerCallbackQuery(query.id, { text: "Approved" });
    }

    if (data.startsWith("reject")) {
        user.status = "rejected";
        saveUsers(users);

        bot.sendMessage(userId,
`❌ Payment rejected.

The access link will not be sent.
If you believe this is a mistake, contact support:
@wachazzin`
        );

        bot.answerCallbackQuery(query.id, { text: "Rejected" });
    }
});

