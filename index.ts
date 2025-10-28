import { Client, GatewayIntentBits, Partials, TextChannel } from "discord.js";
import * as dotenv from "dotenv";
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ✅ CONFIG
const CHECKMARK = "✅";
const REMINDER_INTERVAL = process.env.REMINDER_INTERVAL ? parseInt(process.env.REMINDER_INTERVAL) * 60 * 60 * 1000 : 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const MAX_MISSED_CHECKINS = process.env.MAX_MISSED_CHECKINS ? parseInt(process.env.MAX_MISSED_CHECKINS) : 5; // 5 missed check-ins = 24h timeout
const TIMEOUT_DURATION = process.env.TIMEOUT_DURATION ? parseInt(process.env.TIMEOUT_DURATION) * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 24 hours in milliseconds   

// ✅ MEMORY STORAGE
const messageReactionData = new Map<string, Set<string>>();
const missedCheckins = new Map<string, number>(); // userId → missed count
const timedOutUsers = new Set<string>(); // userId → currently timed out

client.once("ready", async () => {
    console.log(`🤖 Logged in as ${client.user?.tag}`);

    if (process.env.BOT_ICON_PATH) {
        try {
            await client.user?.setAvatar(process.env.BOT_ICON_PATH);
            console.log("✅ Bot icon set successfully");
        } catch (err) {
            console.warn("⚠️ Failed to set bot icon:", err);
        }
    }
});

// ✅ Detect new announcement messages
client.on("messageCreate", async (message) => {
    if (message.channel.id !== process.env.ANNOUNCEMENT_CHANNEL_ID) return;
    if (message.author.bot) return;

    await message.react(CHECKMARK);
    messageReactionData.set(message.id, new Set());

    console.log(`📢 New announcement detected: ${message.url}`);
    scheduleReminders(message);
});

// ✅ Track user reactions
client.on("messageReactionAdd", (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== CHECKMARK) return;

    const reactedUsers = messageReactionData.get(reaction.message.id);
    reactedUsers?.add(user.id);
});

// ✅ Reminder + Timeout System
async function scheduleReminders(message: any) {
    const guild = message.guild;
    if (!guild) return;

    const interval = setInterval(async () => {
        const reactedUsers = messageReactionData.get(message.id);
        if (!reactedUsers) return;

        const allMembers = await guild.members.fetch();
        const unreacted = allMembers.filter(
            (m: any) => !m.user.bot && !reactedUsers.has(m.user.id)
        );

        if (unreacted.size === 0) {
            clearInterval(interval);
            console.log("✅ Everyone reacted. Stopping reminders.");
            return;
        }

        console.log(`⏰ Sending reminders to ${unreacted.size} users...`);

        for (const [, member] of unreacted) {
            if (timedOutUsers.has(member.id)) continue; // skip if in timeout

            try {
                await member.send(
                    `👋 Hello ${member.user.username},\n\n` +
                    `Please don't forget to check the latest announcement and react with ✅ here:\n${message.url}\n\n` +
                    `Your participation keeps our community active and informed!\n\n` +
                    `✨ Thank you for your attention!\n— The Community Team`
                );
            } catch {
                console.warn(`⚠️ Couldn't DM ${member.user.tag}`);
            }

            // Increment missed count
            const missed = (missedCheckins.get(member.id) || 0) + 1;
            missedCheckins.set(member.id, missed);

            // If user misses 5 reminders → timeout for 24h
            if (missed >= MAX_MISSED_CHECKINS) {
                try {
                    await member.timeout(TIMEOUT_DURATION, "Missed 5 check-ins (24h timeout)");
                    timedOutUsers.add(member.id);
                    missedCheckins.set(member.id, 0); // reset count
                    console.log(`⏱️ Timed out ${member.user.tag} for 24 hours`);

                    // Notify user via DM
                    try {
                        await member.send(
                            `🚫 Hello ${member.user.username},\n\n` +
                            `You’ve been placed in a **24-hour timeout** for missing 5 announcement check-ins.\n\n` +
                            `Please make sure to react with ✅ to future announcements to stay active.\n\n` +
                            `✨ We'll automatically remove the timeout after 24 hours.\n— The Community Team`
                        );
                    } catch {
                        console.warn(`⚠️ Couldn't DM timeout notice to ${member.user.tag}`);
                    }

                    // Auto-remove timeout tracking after 24h
                    setTimeout(() => {
                        timedOutUsers.delete(member.id);
                        console.log(`✅ ${member.user.tag} timeout expired.`);
                    }, TIMEOUT_DURATION);
                } catch (err) {
                    console.warn(`❌ Failed to timeout ${member.user.tag}`, err);
                }
            }
        }
    }, REMINDER_INTERVAL);
}

client.login(process.env.DISCORD_TOKEN);
