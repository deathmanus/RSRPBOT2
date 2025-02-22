const { Interaction } = require("discord.js");
const { handleTradeResponse } = require("../components/handlers/TradeHandler");

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        try {
            // Handle commands
            if (interaction.isCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;

                try {
                    await command.execute(interaction, client);
                } catch (error) {
                    console.error('Command execution error:', error);
                    await interaction.reply({
                        content: 'There was an error while executing this command!',
                        ephemeral: true
                    });
                }
                return;
            }

            // Handle button interactions
            if (interaction.isButton()) {
                const [action] = interaction.customId.split(':');
                if (action === 'accept-trade' || action === 'decline-trade') {
                    try {
                        await handleTradeResponse(interaction);
                    } catch (error) {
                        console.error('Trade response error:', error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                content: '❌ Nastala chyba při zpracování odpovědi.',
                                ephemeral: true
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Interaction handling error:', error);
        }
    }
};