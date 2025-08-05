const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const { getTicketConfig, initTicketConfig } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Setup the ticket system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
        try {
            // Zkusíme načíst konfiguraci z databáze
            const config = await new Promise((resolve, reject) => {
                getTicketConfig((err, config) => {
                    if (err) reject(err);
                    else resolve(config);
                });
            });
            
            // Pokud konfigurace neexistuje, inicializujeme ji
            if (!config) {
                await initTicketConfig();
                await interaction.reply({ 
                    content: 'Inicializuji konfiguraci ticket systému...',
                    ephemeral: true
                });
                return;
            }
            
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
        } catch (error) {
            console.error('Error executing ticket command:', error);
            await interaction.reply({ 
                content: 'Nastala chyba při načítání ticket systému.',
                ephemeral: true
            });
        }
    }
}