const { REST } = require("@discordjs/rest");
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');

const clientId = '1229367542267514901';
const guildId = '1213225813844037734';

module.exports = (client) => {
    client.handleCommands = async (commandFolders, path) => {
        client.commandArray = [];
        const rest = new REST({ version: '9' }).setToken(process.env.token);
        
        try {
            console.log('Started loading commands...');

            // Load commands
            for (folder of commandFolders) {
                const commandFiles = fs.readdirSync(`${path}/${folder}`).filter(file => file.endsWith('.js'));
                for (const file of commandFiles) {
                    const command = require(`../commands/${folder}/${file}`);
                    console.log(`Loading command: ${command.data.name}`);
                    client.commands.set(command.data.name, command);
                    client.commandArray.push(command.data.toJSON());
                }
            }

            // Register commands only for the guild
            const data = await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: client.commandArray }
            );

            console.log(`Successfully loaded ${data.length} guild commands.`);
            
        } catch (error) {
            console.error('Error:', error);
        }
    };
};