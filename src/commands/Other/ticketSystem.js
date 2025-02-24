const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Setup the ticket system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        
        const embed = new EmbedBuilder()
            .setTitle('Ticket System')
            .setDescription('Select a category to create a ticket')
            .setColor(config.embedColor);

        const selectMenu = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_create')
                    .setPlaceholder('Select ticket category')
                    .addOptions(
                        config.categories.map(category => ({
                            label: category.label,
                            description: category.description,
                            value: category.id
                        }))
                    )
            );

        await interaction.reply({ 
            embeds: [embed], 
            components: [selectMenu]
        });
    }
}