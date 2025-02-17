const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');

const clientId = '1229367542267514901'; // Add this line

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Znovu načte příkazy bota')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
            
            console.log('\x1b[33m%s\x1b[0m', '[RELOAD] Command reload initiated by ' + interaction.user.tag);
            
            // Reload commands
            const client = interaction.client;
            const commandFolders = fs.readdirSync("./src/commands");
            
            // Clear existing commands
            client.commands.clear();
            client.commandArray = [];

            // Reload commands
            for (const folder of commandFolders) {
                const commandFiles = fs.readdirSync(`./src/commands/${folder}`).filter(file => file.endsWith('.js'));
                for (const file of commandFiles) {
                    delete require.cache[require.resolve(`../${folder}/${file}`)];
                    const command = require(`../${folder}/${file}`);
                    client.commands.set(command.data.name, command);
                    client.commandArray.push(command.data.toJSON());
                }
            }

            // Update commands with Discord API using clientId directly
            const rest = new REST({ version: '9' }).setToken(process.env.token);
            await rest.put(
                Routes.applicationCommands(clientId), { // Changed this line
                    body: client.commandArray
                }
            );
            
            console.log('\x1b[32m%s\x1b[0m', '[RELOAD] Commands successfully reloaded');
            
            await interaction.editReply({ 
                content: '✅ Příkazy byly úspěšně znovu načteny.',
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