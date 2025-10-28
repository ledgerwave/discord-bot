module.exports = {
    apps: [{
        name: 'discord-bot',
        script: './node_modules/.bin/ts-node',
        args: 'index.ts',
        cwd: '/root/dev/discord-bot',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'production'
        }
    }]
};

