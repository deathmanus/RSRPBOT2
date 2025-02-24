const { Interaction, EmbedBuilder, PermissionsBitField } = require("discord.js");
const { handleTradeResponse } = require("../components/handlers/TradeHandler");
const { handleRoleResponse } = require('../components/handlers/RoleHandler');
const TicketHandler = require('../components/handlers/TicketHandler');
const fs = require('fs');
const path = require('path');

const logChannelId = '1213225816201240587';

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        try {
            // Handle commands
            if (interaction.isCommand()) {
                // Check custom permissions
                const permissionsPath = path.join(__dirname, '../files/permissions.json');
                if (fs.existsSync(permissionsPath)) {
                    const permissions = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));
                    
                    if (permissions[interaction.commandId]) {
                        // Check if user has admin permissions or any of the allowed roles
                        const allowedRoles = permissions[interaction.commandId].roles;
                        const hasPermission = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                            interaction.member.roles.cache.some(role => 
                                allowedRoles.includes(role.id)
                            );
                        
                        if (!hasPermission) {
                            await interaction.reply({
                                content: '❌ Nemáte oprávnění pro použití tohoto příkazu.',
                                ephemeral: true
                            });
                            return;
                        }
                    }
                }

                // Log the command usage
                const logChannel = interaction.guild.channels.cache.get(logChannelId);
                const embed = new EmbedBuilder()
                    .setTitle('Command log')
                    .setDescription('User: ' + `<@${interaction.user.id}>, id - ${interaction.user.id}\n`+ 'Command: ' + interaction.commandName)
                    .setColor(2);
                await logChannel.send({ embeds: [embed] });

                // Execute the command
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

            // Handle select menu interactions
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'ticket_create') {
                    await TicketHandler.handleTicketCreate(interaction);
                    return;
                }
                if (interaction.customId === 'ticket_response') {
                    await TicketHandler.handleTicketResponse(interaction);
                    return;
                }
            }

            // Handle button interactions
            if (interaction.isButton()) {
                const [action] = interaction.customId.split(':');
                
                // Ticket system buttons
                switch (interaction.customId) {
                    case 'ticket_close':
                        await TicketHandler.handleTicketClose(interaction);
                        return;
                    case 'ticket_close_confirm':
                        await TicketHandler.handleTicketCloseConfirm(interaction);
                        return;
                    case 'ticket_close_cancel':
                        await TicketHandler.handleTicketCloseCancel(interaction);
                        return;
                    case 'ticket_archive':
                        await TicketHandler.handleTicketArchive(interaction);
                        return;
                    case 'ticket_unarchive':
                        await TicketHandler.handleTicketUnarchive(interaction);
                        return;
                }

                // Existing button handlers
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
                } else if (['accept-invite', 'decline-invite'].includes(action)) {
                    try {
                        await handleRoleResponse(interaction);
                    } catch (error) {
                        console.error('Role response error:', error);
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