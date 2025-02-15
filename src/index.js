const { Client, GatewayIntentBits, PermissionsBitField, Permissions, MessageManager, Embed, Collection, ClientPresence } = require(`discord.js`);
const { EmbedBuilder } = require(`@discordjs/builders`);
const fs = require('fs');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.commands = new Collection();

require('dotenv').config();

const functions = fs.readdirSync("./src/functions").filter(file => file.endsWith(".js"));
const eventFiles = fs.readdirSync("./src/events").filter(file => file.endsWith(".js"));
const commandFolders = fs.readdirSync("./src/commands");

// Get the log channel
const logChannelId = '1213225816201240587';

(async () => {
    for (file of functions) {
        require(`./functions/${file}`)(client);
    }
    client.handleEvents(eventFiles, "./src/events");
    client.handleCommands(commandFolders, "./src/commands");

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) return;

        const { commandName } = interaction;

        // Get the log channel
        const logChannel = interaction.guild.channels.cache.get(logChannelId);

        // Create an embed for the log message
        const embed = new EmbedBuilder()
            .setTitle('Command log')
            .setDescription('User: ' + `<@${interaction.user.id}>, id - ${interaction.user.id}\n`+ 'Command: ' + commandName)
            .setColor(2);

        // Send the embed to the log channel
        logChannel.send({ embeds: [embed] });
    });

    client.once('ready', () => {
    });
    
    
    client.login(process.env.token)
})();