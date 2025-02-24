const { Events } = require('discord.js');
const { handleRoleResponse, handlePermissionResponse } = require('../components/handlers/RoleHandler');
const { handleTicketCreate, handleTicketDelete, handleTicketArchive, handleTicketUnarchive, handleAddCategory, handleRemoveCategory, handleRewardClaim } = require('../components/handlers/TicketHandler');
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
                if (customId === 'create_ticket') await handleTicketCreate(interaction);
                else if (customId === 'delete_ticket') await handleTicketDelete(interaction);
                else if (customId === 'ticket_archive') await handleTicketArchive(interaction);
                else if (customId === 'ticket_unarchive') await handleTicketUnarchive(interaction);
                else if (customId === 'add_category') await handleAddCategory(interaction);
                else if (customId === 'remove_category') await handleRemoveCategory(interaction);
                
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

            // Reward claim button
            if (interaction.isStringSelectMenu() && interaction.customId === 'reward_select') {
                await handleRewardClaim(interaction);
                return;
            }

        } catch (error) {
            console.error('Error in interaction handler:', error);
        }
    },
};