const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('embed_message_with_buttons')
        .setDescription('Odeslání zprávy s tlačítky'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Title of the Embed')
            .setDescription('Description of the Embed')
            .setColor('Blue');

        const button = new ButtonBuilder()
            .setCustomId('button1')
            .setLabel('Button 1')
            .setStyle(1);

        const row = new ActionRowBuilder()
            .addComponents(button);

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};