const { REST } = require("@discordjs/rest");
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');

const clientId = '1229367542267514901';
const guildId = '1213225813844037734';

module.exports = (client) => {
    client.handleCommands = async (commandFolders, path) => {
        client.commandArray = [];
        
        // First, delete all existing commands
        const rest = new REST({ version: '9' }).setToken(process.env.token);
        
        try {
            
            

            // Load new commands
            for (folder of commandFolders) {
                const commandFiles = fs.readdirSync(`${path}/${folder}`).filter(file => file.endsWith('.js'));
                for (const file of commandFiles) {
                    const command = require(`../commands/${folder}/${file}`);
                    console.log(`Loading command: ${command.data.name}`);
                    client.commands.set(command.data.name, command);
                    client.commandArray.push(command.data.toJSON());
                }
            }

            // Register only guild commands
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: client.commandArray }
            );

            console.log('Successfully registered application commands.');
            
        } catch (error) {
            console.error('Error:', error);
        }
    };
};