const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnfraction')
        .setDescription('Nastavit varování frakci')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (fractions.length === 0) {
                return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
            }

            let selectedFraction = null;
            let selectedWarns = null;
            const WARN_LIMIT = 3; // Maximální počet warnů

            const fractionMenu = new StringSelectMenuBuilder()
                .setCustomId('select-fraction')
                .setPlaceholder('Vyberte frakci')
                .addOptions(fractions.map(fraction => ({
                    label: fraction,
                    value: fraction
                })));

            const row = new ActionRowBuilder().addComponents(fractionMenu);
            const embed = new EmbedBuilder()
                .setTitle('Nastavení warnů frakce')
                .setDescription('Vyberte frakci pro nastavení warnů.')
                .setColor(0xFF0000);

            const message = await interaction.editReply({
                embeds: [embed],
                components: [row]
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    if (i.customId === 'select-fraction') {
                        selectedFraction = i.values[0];
                        const fractionPath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                        const fractionData = JSON.parse(fs.readFileSync(fractionPath));

                        const fractionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-fraction')
                            .setPlaceholder('Vyberte frakci')
                            .addOptions(fractions.map(fraction => ({
                                label: fraction,
                                value: fraction,
                                default: fraction === selectedFraction
                            })));

                        const warnMenu = new StringSelectMenuBuilder()
                            .setCustomId('select-warns')
                            .setPlaceholder('Vyberte počet warnů')
                            .addOptions(
                                Array.from({ length: WARN_LIMIT + 1 }, (_, index) => ({
                                    label: `${index} warnů`,
                                    value: index.toString(),
                                    default: index === fractionData.warns
                                }))
                            );

                        const confirmButton = new ButtonBuilder()
                            .setCustomId('confirm-warns')
                            .setLabel('Potvrdit')
                            .setStyle(ButtonStyle.Success);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel-warns')
                            .setLabel('Zrušit')
                            .setStyle(ButtonStyle.Danger);

                        const buttonRow = new ActionRowBuilder()
                            .addComponents(confirmButton, cancelButton);

                        const warnEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle(`Warny frakce ${selectedFraction}`)
                            .setDescription(`Aktuální počet warnů: ${fractionData.warns}`)
                            .addFields(
                                { name: 'Frakce', value: selectedFraction, inline: true },
                                { name: 'Limit warnů', value: WARN_LIMIT.toString(), inline: true }
                            );

                        await i.editReply({
                            embeds: [warnEmbed],
                            components: [
                                new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                new ActionRowBuilder().addComponents(warnMenu),
                                buttonRow
                            ]
                        });
                    }
                    else if (i.customId === 'select-warns') {
                        selectedWarns = parseInt(i.values[0]);
                        const fractionPath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                        const fractionData = JSON.parse(fs.readFileSync(fractionPath));

                        const fractionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-fraction')
                            .setPlaceholder('Vyberte frakci')
                            .addOptions(fractions.map(fraction => ({
                                label: fraction,
                                value: fraction,
                                default: fraction === selectedFraction
                            })));

                        const warnMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-warns')
                            .setPlaceholder('Vyberte počet warnů')
                            .addOptions(
                                Array.from({ length: WARN_LIMIT + 1 }, (_, index) => ({
                                    label: `${index} warnů`,
                                    value: index.toString(),
                                    default: index === selectedWarns
                                }))
                            );

                        const warnEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle(`Warny frakce ${selectedFraction}`)
                            .setDescription(`Nový počet warnů: ${selectedWarns}`)
                            .addFields(
                                { name: 'Frakce', value: selectedFraction, inline: true },
                                { name: 'Původní počet', value: fractionData.warns.toString(), inline: true },
                                { name: 'Limit warnů', value: WARN_LIMIT.toString(), inline: true }
                            );

                        const confirmButton = new ButtonBuilder()
                            .setCustomId('confirm-warns')
                            .setLabel('Potvrdit')
                            .setStyle(ButtonStyle.Success);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel-warns')
                            .setLabel('Zrušit')
                            .setStyle(ButtonStyle.Danger);

                        const buttonRow = new ActionRowBuilder()
                            .addComponents(confirmButton, cancelButton);

                        await i.editReply({
                            embeds: [warnEmbed],
                            components: [
                                new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                new ActionRowBuilder().addComponents(warnMenuUpdated),
                                buttonRow
                            ]
                        });
                    }
                    else if (i.customId === 'confirm-warns') {
                        const fractionPath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                        const fractionData = JSON.parse(fs.readFileSync(fractionPath));
                        
                        fractionData.warns = selectedWarns;
                        fs.writeFileSync(fractionPath, JSON.stringify(fractionData, null, 2));

                        const confirmEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('✅ Warny aktualizovány')
                            .addFields(
                                { name: 'Frakce', value: selectedFraction, inline: true },
                                { name: 'Nový počet warnů', value: selectedWarns.toString(), inline: true }
                            );

                        await interaction.channel.send({ embeds: [confirmEmbed] });
                        await i.editReply({
                            content: '✅ Počet warnů byl úspěšně aktualizován.',
                            embeds: [],
                            components: []
                        });

                        collector.stop();
                    }
                    else if (i.customId === 'cancel-warns') {
                        await i.editReply({
                            content: '❌ Aktualizace warnů zrušena.',
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                    }
                } catch (error) {
                    console.error('Error in warnfraction collector:', error);
                    await i.editReply({
                        content: '❌ Nastala chyba při zpracování požadavku.',
                        components: []
                    });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: '⌛ Časový limit vypršel.',
                        components: [],
                        embeds: []
                    });
                }
            });

        } catch (error) {
            console.error('Error in warnfraction command:', error);
            await interaction.editReply({
                content: '❌ Nastala chyba při zpracování příkazu.',
                components: []
            });
        }
    }
};