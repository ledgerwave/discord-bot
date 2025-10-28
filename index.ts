import {
    Client,
    GatewayIntentBits,
    Partials,
    TextChannel,
    Message,
    MessageReaction,
    PartialUser,
    User,
    Collection,
    Guild,
} from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

const ANNOUNCEMENT_CHANNEL_ID = process.env.ANNOUNCEMENT_CHANNEL_ID!;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID!;
const MODERATOR_ID = process.env.MODERATOR_ID!;
const CHECKMARK = process.env.CHECKMARK || '✅';
const REMINDER_INTERVAL = parseInt(process.env.REMINDER_INTERVAL || '14400000');
const MAX_MISSED_CHECKINS = 2

interface UserStatus {
    missedCheckins: number;
    moderatorNotified: boolean;
}

const userStatuses = new Map<string, UserStatus>();
const activeAnnouncements = new Map<string, Message>();

// === Bot Ready ===
client.once('ready', async () => {
    console.log(`Logged in as ${client.user?.tag}!`);
    await removeAnnouncements();
    setInterval(processAnnouncements, REMINDER_INTERVAL);
});

// === Track new announcements ===
client.on('messageCreate', (message) => {
    if (message.channel.id === ANNOUNCEMENT_CHANNEL_ID && !message.author.bot) {
        activeAnnouncements.set(message.id, message);
    }
});

// === Track reactions ===
client.on(
    'messageReactionAdd',
    async (reaction: MessageReaction | any, user: User | PartialUser) => {
        if (user.bot) return;

        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (err) {
                console.error('Failed to fetch reaction:', err);
                return;
            }
        }

        if (reaction.emoji.name === CHECKMARK) {
            const key = `${user.id}-${reaction.message.id}`;
            userStatuses.delete(key);
        }
    }
);

// === Periodic check for reminders ===
async function processAnnouncements() {
    if (activeAnnouncements.size === 0) return;

    const guildId = activeAnnouncements.values().next().value?.guildId as string;
    const guild = await client.guilds.fetch(guildId) as unknown as Guild;
    await guild.members.fetch();
    const allUsers = guild.members.cache.filter((m) => !m.user.bot).map((m) => m.user);

    const moderatorSummary: Map<string, string[]> = new Map();

    for (const user of allUsers) {
        const unreactedAnnouncements: Message[] = [];
        const announcementsForModerator: string[] = [];

        for (const announcement of activeAnnouncements.values()) {
            const reactedUsers = await announcement.reactions.cache.get(CHECKMARK)?.users.fetch() || new Map();
            if (!reactedUsers.has(user.id)) {
                unreactedAnnouncements.push(announcement);

                const key = `${user.id}-${announcement.id}`;
                const status = userStatuses.get(key) || { missedCheckins: 0, moderatorNotified: false };
                status.missedCheckins += 1;
                userStatuses.set(key, status);

                if (status.missedCheckins >= MAX_MISSED_CHECKINS && !status.moderatorNotified) {
                    announcementsForModerator.push(announcement.url);
                }
            }
        }

        // Send batched DM to user
        if (unreactedAnnouncements.length > 0) {
            try {
                await user.send(
                    `Hello, <@${user.id}>!\n\n` +
                    `Please check the following announcements:\n` +
                    unreactedAnnouncements.map((m) => `• ${m.url}`).join('\n') +
                    `\n\nReact with ${CHECKMARK} to confirm your attendance.`
                );
            } catch (err) {
                console.error(`Could not DM <@${user.id}>:`, err);
            }
        }

        // Add to moderator summary if there are announcements to notify about
        if (announcementsForModerator.length > 0) {
            moderatorSummary.set(user.id, announcementsForModerator);
        }
    }

    // Send moderator notification
    if (moderatorSummary.size > 0) {
        try {
            const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);

            if (channel && channel.isTextBased()) {
                // Build a single batched message
                let notificationMessage = `Hi <@${MODERATOR_ID}>!\nThe following members have unconfirmed announcements:\n\n`;

                for (const [userId, announcements] of moderatorSummary.entries()) {
                    notificationMessage += `<@${userId}>:\n`;
                    notificationMessage += announcements.map((url) => `• ${url}`).join('\n');
                    notificationMessage += '\n\n';
                }

                await (channel as TextChannel).send(notificationMessage);
                console.log(`✓ Moderator notification sent for ${moderatorSummary.size} user(s)`);

                // Mark the specific announcements as moderatorNotified
                for (const [userId, announcements] of moderatorSummary.entries()) {
                    for (const announcementUrl of announcements) {
                        // Find the announcement ID from the URL
                        const announcementId = Array.from(activeAnnouncements.keys()).find(id => {
                            const announcement = activeAnnouncements.get(id);
                            return announcement?.url === announcementUrl;
                        });

                        if (announcementId) {
                            const key = `${userId}-${announcementId}`;
                            const status = userStatuses.get(key);
                            if (status) {
                                status.moderatorNotified = true;
                                userStatuses.set(key, status);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Failed to send moderator notification:', err);
        }
    }
}

// Remove announcements from tracking if all users reacted
async function removeAnnouncements() {
    const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
    if (!channel?.isTextBased() || !('messages' in channel)) return;

    let lastId: string | undefined;

    while (true) {
        const options: { limit: number; before?: string } = { limit: 100 };
        if (lastId) options.before = lastId;

        const messages: Collection<string, Message> = await (channel as TextChannel).messages.fetch(options);
        if (messages.size === 0) break;

        messages.forEach((msg: Message) => activeAnnouncements.set(msg.id, msg));
        lastId = messages.last()?.id;
    }

    console.log(`Fetched ${activeAnnouncements.size} total announcements.`);
}

client.login(process.env.DISCORD_TOKEN);
