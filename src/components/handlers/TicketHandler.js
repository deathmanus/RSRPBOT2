const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, PermissionsBitField, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

class TicketHandler {
    static usedResponses = new Map(); // Track used responses per channel

    static async handleTicketCreate(interaction) {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const category = config.categories.find(c => c.id === interaction.values[0]);
        
        if (!category) return;

        const channel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}-${interaction.user.id}`, // Přidáno ID uživatele do názvu
            type: ChannelType.GuildText,
            parent: category.categoryId,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
            ],
        });

        // Initialize used responses tracking for this channel
        this.usedResponses.set(channel.id, new Set());

        const embed = new EmbedBuilder()
            .setTitle(category.message.title)
            .setDescription(category.message.description)
            .setColor(category.message.color);

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel(config.buttons.close.label)
                    .setStyle(ButtonStyle[config.buttons.close.style])
                    .setEmoji(config.buttons.close.emoji),
                new ButtonBuilder()
                    .setCustomId('ticket_archive')
                    .setLabel(config.buttons.archive.label)
                    .setStyle(ButtonStyle[config.buttons.archive.style])
                    .setEmoji(config.buttons.archive.emoji)
            );

        const responseMenu = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_response')
                    .setPlaceholder('Select a response')
                    .addOptions(
                        category.responseOptions.map(option => ({
                            label: option.label,
                            description: option.description,
                            value: option.id
                        }))
                    )
            );

        await channel.send({ 
            content: `<@${interaction.user.id}>`,
            embeds: [embed],
            components: [responseMenu, buttons]
        });

        await interaction.update({ 
            components: [interaction.message.components[0]]
        });
    }

    static async handleTicketClose(interaction) {
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close_confirm')
                    .setLabel('Potvrdit zavření')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ticket_close_cancel')
                    .setLabel('Zrušit')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            content: 'Opravdu chcete zavřít tento ticket?',
            components: [confirmRow],
            ephemeral: true
        });
    }

    static async handleTicketCloseConfirm(interaction) {
        this.usedResponses.delete(interaction.channel.id);
        await interaction.channel.delete();
    }

    static async handleTicketCloseCancel(interaction) {
        await interaction.update({
            content: 'Zavření ticketu bylo zrušeno.',
            components: [],
            ephemeral: true
        });
    }

    static async handleTicketArchive(interaction) {
        this.usedResponses.delete(interaction.channel.id);
        
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const category = config.categories.find(c => 
            c.categoryId === interaction.channel.parent.id
        );

        if (category) {
            await interaction.channel.setParent(category.archiveCategoryId);
            await interaction.channel.permissionOverwrites.set([
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.SendMessages],
                    allow: [PermissionsBitField.Flags.ViewChannel],
                }
            ]);

            const unarchiveRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_unarchive')
                        .setLabel('Odarchivovat Ticket')
                        .setStyle(ButtonStyle.Primary)
                );

            await interaction.reply({ 
                content: 'Ticket byl archivován.',
                components: [unarchiveRow],
                ephemeral: false 
            });
        }
    }

    static async handleTicketUnarchive(interaction) {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const archivedCategory = config.categories.find(c => 
            c.archiveCategoryId === interaction.channel.parent.id
        );

        if (archivedCategory) {
            // Získání ID uživatele z názvu kanálu
            const channelName = interaction.channel.name;
            const userId = channelName.split('-').pop(); // Získá poslední část názvu, což je ID

            await interaction.channel.setParent(archivedCategory.categoryId);
            await interaction.channel.permissionOverwrites.set([
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.guild.members.me.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: userId,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                }
            ]);

            // Remove the unarchive button from the previous message
            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const archiveMessage = messages.find(m => 
                m.components.length > 0 && 
                m.components[0].components[0].customId === 'ticket_unarchive'
            );
            if (archiveMessage) {
                await archiveMessage.edit({ components: [] });
            }

            await interaction.reply({
                content: 'Ticket byl odarchivován.',
                ephemeral: false
            });
        }
    }

    static async handleTicketResponse(interaction) {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const categoryId = interaction.channel.parent.id;
        const category = config.categories.find(c => c.categoryId === categoryId);
        
        if (!category) return;

        const selectedOption = category.responseOptions.find(option => option.id === interaction.values[0]);
        if (!selectedOption) return;

        const response = new EmbedBuilder()
            .setColor(config.embedColor)
            .setTitle(selectedOption.label);

        try {
            if (selectedOption.type === 'image') {
                new URL(selectedOption.content);
                response.setImage(selectedOption.content);
            } else {
                response.setDescription(selectedOption.content);
            }

            // Find the original menu message
            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const menuMessage = messages.find(m => 
                m.components.length > 0 && 
                m.components[0].components[0].customId === 'ticket_response'
            );

            if (category.hideMenuAfterSelection) {
                // Hide the entire menu
                if (menuMessage) {
                    const buttons = menuMessage.components.find(row => 
                        row.components.some(comp => ['ticket_close', 'ticket_archive'].includes(comp.customId))
                    );
                    await menuMessage.edit({ components: buttons ? [buttons] : [] });
                }
            } else {
                // Original functionality - track used responses if not keepSelectable
                if (!selectedOption.keepSelectable) {
                    let usedChannelResponses = this.usedResponses.get(interaction.channel.id) || new Set();
                    usedChannelResponses.add(selectedOption.id);
                    this.usedResponses.set(interaction.channel.id, usedChannelResponses);
                }

                // Update the select menu with available options
                if (menuMessage) {
                    const usedResponses = this.usedResponses.get(interaction.channel.id) || new Set();
                    const availableOptions = category.responseOptions.filter(option => 
                        option.keepSelectable || !usedResponses.has(option.id)
                    );

                    const updatedMenu = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('ticket_response')
                                .setPlaceholder('Select a response')
                                .addOptions(
                                    availableOptions.map(option => ({
                                        label: option.label,
                                        description: option.description,
                                        value: option.id
                                    }))
                                )
                        );

                    const originalComponents = [...menuMessage.components];
                    originalComponents[0] = updatedMenu;
                    await menuMessage.edit({ components: originalComponents });
                }
            }

            await interaction.reply({
                embeds: [response],
                ephemeral: false
            });
        } catch (error) {
            console.error('Error processing response:', error);
            await interaction.reply({
                content: '❌ Chyba při zpracování odpovědi. Kontaktujte prosím administrátora.',
                ephemeral: true
            });
        }
    }
}

module.exports = TicketHandler;