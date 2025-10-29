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
const REMINDER_INTERVAL = parseInt(process.env.REMINDER_INTERVAL || '300000'); // 5 minutes
const MAX_MISSED_CHECKINS = parseInt(process.env.MAX_MISSED_CHECKINS || '5');

interface UserStatus {
    missedCheckins: number;
    moderatorNotified: boolean;
}

const userStatuses = new Map<string, UserStatus>();
const activeAnnouncements = new Map<string, Message>();

// === Bot Ready ===
client.once('ready', async () => {
    console.log(`✓ Bot connected: ${client.user?.tag}`);
    console.log(`✓ Gateway WebSocket: Connected`);
    console.log(`✓ Watching channel: ${ANNOUNCEMENT_CHANNEL_ID}`);
    console.log(`✓ Monitoring ${client.guilds.cache.size} guild(s)`);
    await syncAnnouncements();
    setInterval(processAnnouncements, REMINDER_INTERVAL);
    // Sync announcements every 30 seconds to catch new/deleted announcements
    setInterval(syncAnnouncements, 30000);
});

// === Track new announcements ===
client.on('messageCreate', (message) => {
    if (message.channel.id === ANNOUNCEMENT_CHANNEL_ID && !message.author.bot) {
        activeAnnouncements.set(message.id, message);
    }
});

// === Track reactions added ===
client.on(
    'messageReactionAdd',
    async (reaction: MessageReaction | any, user: User | PartialUser) => {
        try {
            if (user.bot) return;

            // Fetch partial reaction if needed
            if (reaction.partial) {
                await reaction.fetch();
            }

            // Fetch partial message if needed
            if (reaction.message.partial) {
                await reaction.message.fetch();
            }

            // Only track reactions in the announcement channel
            if (reaction.message.channelId !== ANNOUNCEMENT_CHANNEL_ID) return;

            if (reaction.emoji.name === CHECKMARK) {
                const key = `${user.id}-${reaction.message.id}`;
                const status = userStatuses.get(key);
                const wasNotified = status?.moderatorNotified || false;
                userStatuses.delete(key);

                // Update the announcement cache with the fresh message
                if (activeAnnouncements.has(reaction.message.id)) {
                    activeAnnouncements.set(reaction.message.id, reaction.message);
                }

                console.log(`✓ Reaction added: ${user.username || user.id} reacted to ${reaction.message.id.slice(-4)}${status ? ' (cleared from tracking)' : ''}`);

                // If moderator was notified and user just reacted, send update to moderator
                if (wasNotified) {
                    await notifyModeratorUpdate(user, reaction.message.url, 'resolved');
                }
            }
        } catch (err) {
            console.error('Error handling reaction add:', err);
        }
    }
);

// === Track reactions removed ===
client.on(
    'messageReactionRemove',
    async (reaction: MessageReaction | any, user: User | PartialUser) => {
        try {
            if (user.bot) return;

            // Fetch partial reaction if needed
            if (reaction.partial) {
                await reaction.fetch();
            }

            // Fetch partial message if needed
            if (reaction.message.partial) {
                await reaction.message.fetch();
            }

            // Only track reactions in the announcement channel
            if (reaction.message.channelId !== ANNOUNCEMENT_CHANNEL_ID) return;

            if (reaction.emoji.name === CHECKMARK) {
                const key = `${user.id}-${reaction.message.id}`;
                const existingStatus = userStatuses.get(key);
                const wasModeratorNotified = existingStatus?.moderatorNotified || false;

                // Clear the status so tracking will resume
                userStatuses.delete(key);

                console.log(`⚠️ Reaction removed: ${user.username || user.id} removed reaction from ${reaction.message.id.slice(-4)}${wasModeratorNotified ? ' (was previously reported)' : ''}`);

                // Update the announcement cache with the fresh message
                if (activeAnnouncements.has(reaction.message.id)) {
                    activeAnnouncements.set(reaction.message.id, reaction.message);
                }

                // If moderator was previously notified, send update about removal
                if (wasModeratorNotified) {
                    await notifyModeratorUpdate(user, reaction.message.url, 'unreacted');
                }
            }
        } catch (err) {
            console.error('Error handling reaction remove:', err);
        }
    }
);

// === Track message deletions ===
client.on('messageDelete', async (message: Message | any) => {
    try {
        if (message.channelId === ANNOUNCEMENT_CHANNEL_ID) {
            if (activeAnnouncements.has(message.id)) {
                console.log(`Announcement ${message.id} deleted, removing from tracking`);

                // Check if any user was notified about this announcement
                const notifiedUsers: string[] = [];
                for (const [statusKey, status] of userStatuses.entries()) {
                    if (statusKey.endsWith(`-${message.id}`) && status.moderatorNotified) {
                        const userId = statusKey.split('-')[0];
                        notifiedUsers.push(userId);
                    }
                }

                activeAnnouncements.delete(message.id);

                // Clean up all user statuses for this announcement
                for (const [statusKey] of userStatuses.entries()) {
                    if (statusKey.endsWith(`-${message.id}`)) {
                        userStatuses.delete(statusKey);
                    }
                }

                // Notify moderator that the announcement was deleted
                if (notifiedUsers.length > 0) {
                    await notifyModeratorUpdate(null, message.id, 'deleted', notifiedUsers);
                }
            }
        }
    } catch (err) {
        console.error('Error handling message deletion:', err);
    }
});

// === Helper: Notify moderator of status changes ===
async function notifyModeratorUpdate(
    user: User | PartialUser | null,
    announcementRef: string,
    action: 'resolved' | 'deleted' | 'unreacted',
    affectedUsers?: string[]
) {
    try {
        const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) return;

        let message = '';
        if (action === 'resolved' && user) {
            message = `✅ **Update:** <@${user.id}> has now reacted to announcement: ${announcementRef}`;
        } else if (action === 'unreacted' && user) {
            message = `⚠️ **Alert:** <@${user.id}> has removed their reaction from announcement: ${announcementRef}\nThey will be tracked again for reminders.`;
        } else if (action === 'deleted') {
            const userList = affectedUsers?.map(id => `<@${id}>`).join(', ') || 'users';
            message = `🗑️ **Update:** Announcement \`${announcementRef}\` was deleted. Previously pending for: ${userList}`;
        }

        if (message) {
            // await (channel as TextChannel).send(message);
            console.log(message);
        }
    } catch (err) {
        console.error('Failed to send moderator update:', err);
    }
}

// === Periodic check for reminders ===
// Runs every REMINDER_INTERVAL (5 minutes)
// 1. Sends DM reminders to users who haven't reacted
// 2. Tracks missed check-ins (increments counter)
// 3. When user reaches MAX_MISSED_CHECKINS (5), sends IMMEDIATE alert to moderator
// 4. NO periodic status reports - moderator only gets alerts when threshold crossed
async function processAnnouncements() {
    if (activeAnnouncements.size === 0) return;

    try {
        const guildId = activeAnnouncements.values().next().value?.guildId as string;
        if (!guildId) return;

        const guild = await client.guilds.fetch(guildId) as unknown as Guild;
        await guild.members.fetch();
        const allUsers = guild.members.cache.filter((m) => !m.user.bot).map((m) => m.user);

        // Collect users who crossed threshold in this cycle
        const thresholdAlerts = new Map<string, string[]>(); // userId -> announcement URLs

        for (const user of allUsers) {
            const unreactedAnnouncements: Message[] = [];
            const announcementsForModerator: string[] = [];

            for (const announcement of activeAnnouncements.values()) {
                // Refetch the message to get the latest reactions
                try {
                    const freshMessage = await announcement.fetch();
                    activeAnnouncements.set(freshMessage.id, freshMessage); // Update cache with fresh data

                    const reaction = freshMessage.reactions.cache.get(CHECKMARK);
                    // Fetch the latest reaction users
                    const reactedUsers = reaction ? await reaction.users.fetch() : new Collection<string, User>();

                    const key = `${user.id}-${announcement.id}`;
                    const hasReacted = reactedUsers.has(user.id);

                    // Check if user status exists but user has reacted (indicating a detection issue)
                    const existingStatus = userStatuses.get(key);
                    if (existingStatus && hasReacted) {
                        console.log(`⚠️  Found stale status for ${user.username || user.id} on announcement ${announcement.id.slice(-4)} - user already reacted, cleaning up`);
                    }

                    if (!hasReacted) {
                        unreactedAnnouncements.push(freshMessage);

                        const status = userStatuses.get(key) || { missedCheckins: 0, moderatorNotified: false };
                        const previousMissed = status.missedCheckins;
                        status.missedCheckins += 1;
                        userStatuses.set(key, status);

                        // If JUST crossed threshold, add to immediate alert list
                        if (status.missedCheckins >= MAX_MISSED_CHECKINS && previousMissed < MAX_MISSED_CHECKINS) {
                            announcementsForModerator.push(freshMessage.url);
                        }
                    } else {
                        // User has reacted, clear their status
                        userStatuses.delete(key);
                    }
                } catch (err) {
                    // Message was deleted or can't be fetched - remove it from tracking
                    console.log(`Removing announcement ${announcement.id} (deleted or inaccessible)`);
                    activeAnnouncements.delete(announcement.id);

                    // Clean up all user statuses for this announcement
                    for (const [statusKey] of userStatuses.entries()) {
                        if (statusKey.endsWith(`-${announcement.id}`)) {
                            userStatuses.delete(statusKey);
                        }
                    }
                }
            }

            // Send batched DM to user
            if (unreactedAnnouncements.length > 0) {
                try {
                    await user.send(
                        `⚠️ **Reminder: Unconfirmed Announcements** ⚠️\n\n` +
                        `Please react with ${CHECKMARK} to the following announcement(s) **in the announcement channel**:\n\n` +
                        unreactedAnnouncements.map((m, i) => `${i + 1}. ${m.url}`).join('\n') +
                        `\n\n⚠️ You must react directly on each announcement message in <#${ANNOUNCEMENT_CHANNEL_ID}>, not in this DM.`
                    );
                } catch (err) {
                    console.error(`Could not DM <@${user.id}>:`, err);
                }
            }

            // Build COMPLETE status for this user (all pending announcements)
            const allPendingAnnouncements: string[] = [];
            for (const [announcement] of activeAnnouncements.entries()) {
                const key = `${user.id}-${announcement}`;
                const status = userStatuses.get(key);

                // Include if user has ANY missed checkins for this announcement
                if (status && status.missedCheckins > 0) {
                    const announcementObj = activeAnnouncements.get(announcement);
                    if (announcementObj) {
                        allPendingAnnouncements.push(announcementObj.url);
                    }
                }
            }

            // Collect users who JUST crossed threshold for batched alert
            if (announcementsForModerator.length > 0) {
                thresholdAlerts.set(user.id, announcementsForModerator);

                // Mark as notified
                for (const url of announcementsForModerator) {
                    const announcementId = Array.from(activeAnnouncements.keys()).find(id => {
                        const announcement = activeAnnouncements.get(id);
                        return announcement?.url === url;
                    });

                    if (announcementId) {
                        const key = `${user.id}-${announcementId}`;
                        const status = userStatuses.get(key);
                        if (status) {
                            status.moderatorNotified = true;
                            userStatuses.set(key, status);
                        }
                    }
                }
            }
        }

        // Send ONE batched alert for ALL users who crossed threshold
        if (thresholdAlerts.size > 0) {
            try {
                const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);
                if (channel && channel.isTextBased()) {
                    let totalAnnouncements = 0;
                    thresholdAlerts.forEach(announcements => totalAnnouncements += announcements.length);

                    let alertMessage = `🚨 <@${MODERATOR_ID}> **URGENT ALERT**\n`;
                    alertMessage += `**${thresholdAlerts.size}** member(s) have not confirmed after **${MAX_MISSED_CHECKINS} reminders**:\n\n`;

                    for (const [userId, announcements] of thresholdAlerts.entries()) {
                        alertMessage += `<@${userId}> (${announcements.length} pending):\n`;
                        alertMessage += announcements.map((url) => `• ${url}`).join('\n');
                        alertMessage += '\n\n';
                    }

                    await (channel as TextChannel).send(alertMessage);
                    console.log(`🚨 URGENT alert sent for ${thresholdAlerts.size} user(s), ${totalAnnouncements} total announcement(s)`);
                }
            } catch (err) {
                console.error('Failed to send batched threshold alert:', err);
            }
        }

        // Check for users who were notified but have now resolved all issues
        const resolvedUsers: string[] = [];
        const notifiedUserIds = new Set<string>();

        // Find all users who have been notified
        for (const [key, status] of userStatuses.entries()) {
            if (status.moderatorNotified) {
                const userId = key.split('-')[0];
                notifiedUserIds.add(userId);
            }
        }

        // Check if any notified users now have no pending announcements
        for (const userId of notifiedUserIds) {
            const hasPendingIssues = Array.from(userStatuses.entries()).some(
                ([key, status]) => key.startsWith(userId) && status.missedCheckins > 0
            );

            if (!hasPendingIssues) {
                resolvedUsers.push(userId);
                // Clean up all statuses for this user
                for (const [key] of userStatuses.entries()) {
                    if (key.startsWith(userId)) {
                        userStatuses.delete(key);
                    }
                }
            }
        }

        // Send update about resolved users
        if (resolvedUsers.length > 0) {
            try {
                const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);
                if (channel && channel.isTextBased()) {
                    const userMentions = resolvedUsers.map(id => `<@${id}>`).join(', ');
                    await (channel as TextChannel).send(
                        `✅ **Status Update:** The following member(s) have completed all pending check-ins: ${userMentions}`
                    );
                    console.log(`✓ Sent resolution update for ${resolvedUsers.length} user(s)`);
                }
            } catch (err) {
                console.error('Failed to send resolution update:', err);
            }
        }

        // Note: Periodic status reports disabled
        // Moderator only receives:
        // 1. Immediate urgent alerts when users cross threshold (5 missed check-ins)
        // 2. Real-time updates for reactions/removals/deletions
        // 3. Resolution notices when users complete all pending check-ins
    } catch (err) {
        console.error('Failed to process announcements:', err);
    }
}

// Sync announcements from the announcement channel
async function syncAnnouncements() {
    try {
        const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
        if (!channel?.isTextBased() || !('messages' in channel)) return;

        const currentAnnouncements = new Map<string, Message>();
        let lastId: string | undefined;

        // Fetch all messages from the announcement channel
        while (true) {
            const options: { limit: number; before?: string } = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages: Collection<string, Message> = await (channel as TextChannel).messages.fetch(options);
            if (messages.size === 0) break;

            messages.forEach((msg: Message) => currentAnnouncements.set(msg.id, msg));
            lastId = messages.last()?.id;
        }

        // Remove announcements that no longer exist in the channel
        for (const [id] of activeAnnouncements.entries()) {
            if (!currentAnnouncements.has(id)) {
                console.log(`Announcement ${id} was deleted, removing from tracking`);
                activeAnnouncements.delete(id);

                // Clean up user statuses for deleted announcement
                for (const [statusKey] of userStatuses.entries()) {
                    if (statusKey.endsWith(`-${id}`)) {
                        userStatuses.delete(statusKey);
                    }
                }
            }
        }

        // Add or update announcements
        currentAnnouncements.forEach((msg, id) => activeAnnouncements.set(id, msg));

        console.log(`Synced ${activeAnnouncements.size} total announcements.`);
    } catch (err) {
        console.error('Failed to sync announcements:', err);
    }
}

client.login(process.env.DISCORD_TOKEN);
