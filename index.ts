import { Client, GatewayIntentBits, Partials } from "discord.js";
import * as dotenv from "dotenv";
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, // needed to fetch all members
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const CHECKMARK = "✅";
const REMINDER_INTERVAL = 20 * 1000; // 2 seconds

// Tracks reactions per message: messageId -> Set of userIds
const messageReactionData = new Map<string, Set<string>>();

client.once("ready", async () => {
    console.log(`Logged in as ${client.user?.tag}`);

    // Set bot icon/avatar
    if (process.env.BOT_ICON_PATH) {
        try {
            await client.user?.setAvatar(process.env.BOT_ICON_PATH);
            console.log("✅ Bot icon set successfully");
        } catch (err) {
            console.warn("⚠️ Failed to set bot icon:", err);
        }
    }
});

// When a new message is posted in the announcement channel
client.on("messageCreate", async (message) => {
    if (message.channel.id !== process.env.ANNOUNCEMENT_CHANNEL_ID) return;
    if (message.author.bot) return;

    // React automatically
    await message.react(CHECKMARK);

    // Track who reacts
    messageReactionData.set(message.id, new Set());

    // Start sending reminders
    scheduleReminders(message);
});

// Track reactions
client.on("messageReactionAdd", (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== CHECKMARK) return;

    const reactedUsers = messageReactionData.get(reaction.message.id);
    reactedUsers?.add(user.id);
});

// Sends DM reminders every REMINDER_INTERVAL
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

        console.log(`⏰ Sending reminders to ${unreacted.size} users`);

        for (const [, member] of unreacted) {
            try {
                await member.send(
                    `Hi ${member.user.username}! Please check ✅ the latest announcement: ${message.url}`
                );
            } catch {
                console.warn(`⚠️ Couldn't DM ${member.user.tag}`);
            }
        }
    }, REMINDER_INTERVAL);
}

client.login(process.env.DISCORD_TOKEN);
