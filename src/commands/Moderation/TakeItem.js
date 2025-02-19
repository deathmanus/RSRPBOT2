const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('takeitem')
        .setDescription('Odebrat item frakci')
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

            let sections = [];
            let selectedFraction = null;
            let selectedSection = null;
            let selectedItem = null;

            const fractionMenu = new StringSelectMenuBuilder()
                .setCustomId('select-fraction')
                .setPlaceholder('Vyberte frakci')
                .addOptions(fractions.map(fraction => ({
                    label: fraction,
                    value: fraction
                })));

            const row = new ActionRowBuilder().addComponents(fractionMenu);
            const embed = new EmbedBuilder()
                .setTitle('Odebrání itemu frakci')
                .setDescription('Vyberte frakci, které chcete odebrat item.')
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
                        
                        const fractionPath = path.join(fractionsDir, selectedFraction);
                        sections = fs.readdirSync(fractionPath, { withFileTypes: true })
                            .filter(dirent => dirent.isDirectory())
                            .map(dirent => dirent.name);

                        if (sections.length === 0) {
                            return await i.editReply({
                                content: '❌ Tato frakce nemá žádné itemové sekce.',
                                components: []
                            });
                        }

                        const fractionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-fraction')
                            .setPlaceholder('Vyberte frakci')
                            .addOptions(fractions.map(fraction => ({
                                label: fraction,
                                value: fraction,
                                default: fraction === selectedFraction
                            })));

                        const sectionMenu = new StringSelectMenuBuilder()
                            .setCustomId('select-section')
                            .setPlaceholder('Vyberte sekci')
                            .addOptions(sections.map(section => ({
                                label: section,
                                value: section
                            })));

                        await i.editReply({
                            embeds: [embed.setDescription(`Vyberte sekci pro frakci ${selectedFraction}`)],
                            components: [
                                new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                new ActionRowBuilder().addComponents(sectionMenu)
                            ]
                        });
                    }
                    else if (i.customId === 'select-section') {
                        selectedSection = i.values[0];
                        const sectionPath = path.join(fractionsDir, selectedFraction, selectedSection);
                        
                        const items = fs.readdirSync(sectionPath)
                            .filter(file => file.endsWith('.json'))
                            .map(file => {
                                const itemData = JSON.parse(fs.readFileSync(path.join(sectionPath, file)));
                                return {
                                    label: `${itemData.name} (ID: ${itemData.id})`,
                                    value: file
                                };
                            });

                        if (items.length === 0) {
                            return await i.editReply({
                                content: '❌ Tato sekce neobsahuje žádné itemy.',
                                components: []
                            });
                        }

                        const fractionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-fraction')
                            .setPlaceholder('Vyberte frakci')
                            .addOptions(fractions.map(fraction => ({
                                label: fraction,
                                value: fraction,
                                default: fraction === selectedFraction
                            })));

                        const sectionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-section')
                            .setPlaceholder('Vyberte sekci')
                            .addOptions(sections.map(section => ({
                                label: section,
                                value: section,
                                default: section === selectedSection
                            })));

                        const itemMenu = new StringSelectMenuBuilder()
                            .setCustomId('select-item')
                            .setPlaceholder('Vyberte item')
                            .addOptions(items);

                        await i.editReply({
                            embeds: [embed.setDescription(`Vyberte item k odebrání z frakce ${selectedFraction}`)],
                            components: [
                                new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                new ActionRowBuilder().addComponents(sectionMenuUpdated),
                                new ActionRowBuilder().addComponents(itemMenu)
                            ]
                        });
                    }
                    else if (i.customId === 'select-item') {
                        selectedItem = i.values[0];
                        const itemPath = path.join(fractionsDir, selectedFraction, selectedSection, selectedItem);
                        
                        const itemData = JSON.parse(fs.readFileSync(itemPath));

                        const confirmationEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('Potvrzení odebrání')
                            .setDescription(`Opravdu chcete odebrat item **${itemData.name}**?`)
                            .addFields(
                                { name: 'Frakce', value: selectedFraction, inline: true },
                                { name: 'Sekce', value: selectedSection, inline: true }
                            );

                        const confirmButton = new ButtonBuilder()
                            .setCustomId('confirm-take')
                            .setLabel('Odebrat')
                            .setStyle(ButtonStyle.Danger);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel-take')
                            .setLabel('Zrušit')
                            .setStyle(ButtonStyle.Secondary);

                        const buttonRow = new ActionRowBuilder()
                            .addComponents(confirmButton, cancelButton);

                        await i.editReply({
                            embeds: [confirmationEmbed],
                            components: [buttonRow]
                        });
                    }
                    else if (i.customId === 'confirm-take') {
                        const itemPath = path.join(fractionsDir, selectedFraction, selectedSection, selectedItem);
                        const itemData = JSON.parse(fs.readFileSync(itemPath));

                        fs.unlinkSync(itemPath);

                        const sectionPath = path.join(fractionsDir, selectedFraction, selectedSection);
                        const remainingFiles = fs.readdirSync(sectionPath);
                        if (remainingFiles.length === 0) {
                            fs.rmdirSync(sectionPath);
                        }

                        const confirmEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('✅ Item odebrán')
                            .addFields(
                                { name: 'Frakce', value: selectedFraction, inline: true },
                                { name: 'Sekce', value: selectedSection, inline: true },
                                { name: 'Item', value: itemData.name, inline: true },
                                { name: 'Odebral', value: interaction.user.tag, inline: true }
                            );

                        await interaction.channel.send({ embeds: [confirmEmbed] });

                        await i.editReply({
                            content: '✅ Item byl úspěšně odebrán.',
                            embeds: [],
                            components: []
                        });

                        collector.stop();
                    }
                    else if (i.customId === 'cancel-take') {
                        await i.editReply({
                            content: '❌ Odebrání itemu bylo zrušeno.',
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                    }
                } catch (error) {
                    console.error('Error in takeitem collector:', error);
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
            console.error('Error in takeitem command:', error);
            await interaction.editReply({
                content: '❌ Nastala chyba při zpracování příkazu.',
                components: []
            });
        }
    }
};