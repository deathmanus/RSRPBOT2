const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletefraction')
        .setDescription('Odstranění frakce'),
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (fractions.length === 0) {
                return await interaction.followUp({ content: '❌ Žádné frakce k odstranění.', ephemeral: true });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select-fraction')
                .setPlaceholder('Vyberte frakci k odstranění')
                .addOptions(fractions.map(fraction => ({
                    label: fraction,
                    value: fraction
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Odstranění frakce')
                .setDescription('Vyberte frakci k odstranění z dropdown menu a potvrďte.');

            await interaction.followUp({ embeds: [embed], components: [row] });

            const filter = i => i.customId === 'select-fraction' && i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    const selectedFraction = i.values[0];

                    const confirmEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('Potvrzení odstranění')
                        .setDescription(`Opravdu chcete odstranit frakci **${selectedFraction}**?`);

                    const yesButton = new ButtonBuilder()
                        .setCustomId('yes-delete')
                        .setLabel('Ano')
                        .setStyle(ButtonStyle.Danger);

                    const noButton = new ButtonBuilder()
                        .setCustomId('no-delete')
                        .setLabel('Ne')
                        .setStyle(ButtonStyle.Secondary);

                    const confirmRow = new ActionRowBuilder().addComponents(yesButton, noButton);

                    await interaction.followUp({ embeds: [confirmEmbed], components: [confirmRow] });

                    const confirmFilter = btn => (btn.customId === 'yes-delete' || btn.customId === 'no-delete') && btn.user.id === interaction.user.id;
                    const confirmCollector = interaction.channel.createMessageComponentCollector({ filter: confirmFilter, time: 60000 });

                    confirmCollector.on('collect', async btn => {
                        try {
                            await btn.deferUpdate();

                            if (btn.customId === 'yes-delete') {
                                const fractionPath = path.join(fractionsDir, selectedFraction);
                                const files = fs.readdirSync(fractionPath);

                                const fractionEmbed = new EmbedBuilder()
                                    .setColor(0xFF0000)
                                    .setTitle(`✅ Odstranění frakce ${selectedFraction}`)
                                    .setDescription(`Frakce **${selectedFraction}** byla úspěšně odstraněna.`)
                                    .addFields(files.map(file => ({ name: file, value: '📂 Odstraněno' })));

                                fs.rmSync(fractionPath, { recursive: true, force: true });

                                await interaction.followUp({ embeds: [fractionEmbed], components: [] });
                            } else {
                                await interaction.followUp({ content: '❌ Odstranění frakce bylo zrušeno.', components: [] });
                            }

                            confirmCollector.stop();
                        } catch (error) {
                            console.error('Chyba v potvrzení:', error);
                        }
                    });

                    confirmCollector.on('end', async (collected, reason) => {
                        if (reason === 'time') {
                            await interaction.followUp({ content: '⌛ Časový limit vypršel. Odstranění frakce bylo zrušeno.', components: [] });
                        }
                    });
                } catch (error) {
                    console.error('Chyba při výběru frakce:', error);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.followUp({ content: '⌛ Časový limit vypršel. Akce byla zrušena.', components: [] });
                }
            });

        } catch (error) {
            console.error('Chyba v příkazu deletefraction:', error);
        }
    }
};
