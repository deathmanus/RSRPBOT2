const { Events } = require('discord.js');
const TicketHandler = require('../components/handlers/TicketHandler');
const { handleRoleResponse, handlePermissionResponse } = require('../components/handlers/RoleHandler');
const { handleTradeResponse } = require('../components/handlers/TradeHandler');

const logChannelId = '1213225816201240587';

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        try {
            // Command handling
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.commands.get(interaction.commandName);
                if (!command) return;

                try {
                    await command.execute(interaction);
                } catch (error) {
                    console.error(error);
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                    }
                }
                return;
            }

            // Button interactions
            if (interaction.isButton()) {
                const customId = interaction.customId;

                // Ticket system buttons
                if (customId === 'ticket_close') await TicketHandler.handleTicketClose(interaction);
                else if (customId === 'ticket_close_confirm') await TicketHandler.handleTicketCloseConfirm(interaction);
                else if (customId === 'ticket_close_cancel') await TicketHandler.handleTicketCloseCancel(interaction);
                else if (customId === 'ticket_archive') await TicketHandler.handleTicketArchive(interaction);
                else if (customId === 'ticket_unarchive') await TicketHandler.handleTicketUnarchive(interaction);
                // Handle reward claim buttons
                else if (customId.startsWith('reward_')) await TicketHandler.handleRewardClaim(interaction);
                
                // Role system buttons
                else if (customId.startsWith('accept-invite:') || customId.startsWith('decline-invite:')) {
                    await handleRoleResponse(interaction);
                }
                
                // Permission request buttons
                else if (customId.startsWith('perm-accept:') || customId.startsWith('perm-deny:')) {
                    await handlePermissionResponse(interaction);
                }

                // Trade system buttons
                else if (customId.startsWith('trade-accept:') || customId.startsWith('trade-decline:')) {
                    await handleTradeResponse(interaction);
                }

                return;
            }

            // Select menu interactions
            if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;

                // Ticket system select menus
                if (customId === 'ticket_create') await TicketHandler.handleTicketCreate(interaction);
                else if (customId === 'ticket_response') await TicketHandler.handleTicketResponse(interaction);

                return;
            }

        } catch (error) {
            console.error('Error in interaction handler:', error);
        }
    },
};