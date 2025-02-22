const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');

const clientId = '1229367542267514901';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Znovu načte příkazy bota'),
        

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
            
            const client = interaction.client;
            console.log('\x1b[33m%s\x1b[0m', '[RELOAD] Full command reload initiated by ' + interaction.user.tag);
            
            client.commands.clear();
            client.commandArray = [];

            const commandFolders = fs.readdirSync("./src/commands");
            for (const folder of commandFolders) {
                const commandFiles = fs.readdirSync(`./src/commands/${folder}`).filter(file => file.endsWith('.js'));
                for (const file of commandFiles) {
                    delete require.cache[require.resolve(`../${folder}/${file}`)];
                    const command = require(`../${folder}/${file}`);
                    client.commands.set(command.data.name, command);
                    client.commandArray.push(command.data.toJSON());
                }
            }

            const rest = new REST({ version: '9' }).setToken(process.env.token);
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: client.commandArray }
            );

            console.log('\x1b[32m%s\x1b[0m', '[RELOAD] All commands successfully reloaded');
            
            await interaction.editReply({
                content: '✅ Všechny příkazy byly úspěšně přenačteny.',
                ephemeral: true
            });
        } catch (error) {
            console.error('\x1b[31m%s\x1b[0m', '[RELOAD ERROR]', error);
            await interaction.editReply({
                content: '❌ Chyba při načítání příkazů.',
                ephemeral: true
            });
        }
    }
};