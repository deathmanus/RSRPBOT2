const { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const channelId = '1213225815085420621';
const userId = '1230518218859483198';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('capture_delete')
        .setDescription('odstranění všech zabrání z kanálu'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Odstranění')
            .setDescription('Odstranění všech zabrání z kanálu?')
            .setColor('Red');

        const deleteButton = new ButtonBuilder()
            .setCustomId('delete')
            .setLabel('ANO')
            .setStyle(4); // 4 corresponds to ButtonStyle.DANGER

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel')
            .setLabel('NE')
            .setStyle(2); // 2 corresponds to ButtonStyle.SECONDARY

        const row = new ActionRowBuilder()
            .addComponents(deleteButton, cancelButton);

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        const filter = i => i.customId === 'delete' || i.customId === 'cancel';

        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

        collector.once('collect', async i => {
            if (i.customId === 'delete') {
                const channel = interaction.guild.channels.cache.get(channelId);
                const user = interaction.guild.members.cache.get(userId);

                let messages = await channel.messages.fetch({});
                messages = messages.filter(m => m.author.id === userId);

                // Delete messages
                await channel.bulkDelete(messages);

                await i.update({ content: 'Messages deleted.', components: [], embeds: [], ephemeral: true });
            }

            if (i.customId === 'cancel') {
                await i.update({ content: 'Odstraňování přerušeno.', components: [], embeds: [], ephemeral: true });
            }
        });

        collector.on('end', collected => console.log(`Collected ${collected.size} items`));
    }
};