const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveitem')
        .setDescription('Přidat item frakci')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const shopDir = path.join(__dirname, '../../files/Shop');
            
            // Define sections at this scope
            const sections = fs.readdirSync(shopDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (fractions.length === 0) {
                return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
            }

            let selectedFraction = null;
            let selectedSection = null;
            let selectedItem = null;
            let selectedMods = [];

            const fractionMenu = new StringSelectMenuBuilder()
                .setCustomId('select-fraction')
                .setPlaceholder('Vyberte frakci')
                .addOptions(fractions.map(fraction => ({
                    label: fraction,
                    value: fraction
                })));

            const row = new ActionRowBuilder().addComponents(fractionMenu);
            const embed = new EmbedBuilder()
                .setTitle('Přidání itemu frakci')
                .setDescription('Vyberte frakci, které chcete přidat item.')
                .setColor(0x00FF00);

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
                        
                        // No need to redefine sections here, use the one from outer scope
                        const fractionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-fraction')
                            .setPlaceholder('Vyberte frakci')
                            .addOptions(fractions.map(fraction => ({
                                label: fraction,
                                value: fraction,
                                default: fraction === selectedFraction // Add default flag
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
                        const sectionPath = path.join(__dirname, '../../files/Shop', selectedSection);
                        
                        const items = fs.readdirSync(sectionPath)
                            .filter(file => file.endsWith('.json'))
                            .map(file => file.replace('.json', ''));
                    
                        // Keep fraction selection
                        const fractionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-fraction')
                            .setPlaceholder('Vyberte frakci')
                            .addOptions(fractions.map(fraction => ({
                                label: fraction,
                                value: fraction,
                                default: fraction === selectedFraction
                            })));
                    
                        // Update section menu with selected option
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
                            .addOptions(items.map(item => ({
                                label: item,
                                value: item
                            })));
                    
                        await i.editReply({
                            embeds: [embed.setDescription(`Vyberte item pro frakci ${selectedFraction}`)],
                            components: [
                                new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                new ActionRowBuilder().addComponents(sectionMenuUpdated),
                                new ActionRowBuilder().addComponents(itemMenu)
                            ]
                        });
                    }
                    else if (i.customId === 'select-item') {
                        selectedItem = i.values[0];
                        const itemPath = path.join(__dirname, '../../files/Shop', selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const { name, modifications } = itemData;

                        selectedMods = Object.entries(modifications).map(([modName, modValues]) => {
                            const defaultOption = modValues[0];
                            return {
                                modName,
                                selected: `${modName}:${defaultOption.name}:${defaultOption.price || 0}`,
                                subSelections: defaultOption.subOptions ? 
                                    Object.fromEntries(
                                        Object.entries(defaultOption.subOptions).map(([subName, subValues]) => [
                                            subName,
                                            {
                                                name: subValues[0].name,
                                                price: subValues[0].price || 0
                                            }
                                        ])
                                    ) : {}
                            };
                        });

                        const modRows = createModificationRows(modifications, selectedMods);
                        const itemEmbed = createItemEmbed(name, selectedMods);

                        await i.editReply({
                            embeds: [itemEmbed],
                            components: modRows
                        });
                    }
                    else if (i.customId.startsWith('select-mod-')) {
                        const modIndex = parseInt(i.customId.split('-')[2], 10);
                        const [modName, optName, optPrice] = i.values[0].split(':');

                        const itemPath = path.join(__dirname, '../../files/Shop', selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const { modifications } = itemData;

                        const selectedModification = modifications[modName];
                        const selectedOption = selectedModification.find(opt => opt.name === optName);

                        selectedMods[modIndex] = {
                            ...selectedMods[modIndex],
                            modName,
                            selected: `${modName}:${optName}:${selectedOption.price || 0}`,
                            subSelections: selectedOption.subOptions ?
                                Object.fromEntries(
                                    Object.entries(selectedOption.subOptions).map(([subName, subValues]) => [
                                        subName,
                                        {
                                            name: subValues[0].name,
                                            price: subValues[0].price || 0
                                        }
                                    ])
                                ) : {}
                        };

                        const modRows = createModificationRows(modifications, selectedMods);
                        const itemEmbed = createItemEmbed(itemData.name, selectedMods);

                        await i.editReply({
                            embeds: [itemEmbed],
                            components: modRows
                        });
                    }
                    else if (i.customId.startsWith('select-submod-')) {
                        const parts = i.customId.split('-');
                        const modIndex = parseInt(parts[2], 10);
                        const subModName = parts[3];
                        const [subMod, optName, optPrice] = i.values[0].split(':');

                        const itemPath = path.join(__dirname, '../../files/Shop', selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const { modifications } = itemData;

                        const mainModName = selectedMods[modIndex].modName;
                        const mainOptName = selectedMods[modIndex].selected.split(':')[1];
                        const mainMod = modifications[mainModName];
                        const selectedMainOpt = mainMod.find(opt => opt.name === mainOptName);

                        if (!selectedMainOpt?.subOptions?.[subMod]) {
                            throw new Error('Invalid sub-modification configuration');
                        }

                        const subOpt = selectedMainOpt.subOptions[subMod].find(opt => opt.name === optName);
                        if (!subOpt) {
                            throw new Error('Sub-option not found');
                        }

                        selectedMods[modIndex].subSelections[subMod] = {
                            name: optName,
                            price: Number(subOpt.price) || 0
                        };

                        const modRows = createModificationRows(modifications, selectedMods);
                        const itemEmbed = createItemEmbed(itemData.name, selectedMods);

                        await i.editReply({
                            embeds: [itemEmbed],
                            components: modRows
                        });
                    }
                    else if (i.customId === 'confirm-give') {
                        const fractionItemPath = path.join(fractionsDir, selectedFraction, selectedSection);
                        fs.mkdirSync(fractionItemPath, { recursive: true });

                        const itemId = `${selectedItem}_${Date.now()}`;
                        const newItem = {
                            id: itemId,
                            name: selectedItem,
                            addedBy: interaction.user.tag,
                            addedDate: new Date().toISOString(),
                            selectedMods
                        };

                        fs.writeFileSync(
                            path.join(fractionItemPath, `${itemId}.json`),
                            JSON.stringify(newItem, null, 2)
                        );

                        const confirmEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('✅ Item přidán')
                            .addFields(
                                { name: 'Frakce', value: selectedFraction, inline: true },
                                { name: 'Sekce', value: selectedSection, inline: true },
                                { name: 'Item', value: selectedItem, inline: true }
                            );

                        await interaction.channel.send({ embeds: [confirmEmbed] });
                        await i.editReply({
                            content: '✅ Item byl úspěšně přidán.',
                            embeds: [],
                            components: []
                        });

                        collector.stop();
                    }
                    else if (i.customId === 'cancel-give') {
                        await i.editReply({
                            content: '❌ Přidání itemu zrušeno.',
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                    }
                } catch (error) {
                    console.error('Error in giveitem collector:', error);
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
            console.error('Error in giveitem command:', error);
            await interaction.editReply({
                content: '❌ Nastala chyba při zpracování příkazu.',
                components: []
            });
        }
    }
};

function createItemEmbed(name, selectedMods) {
    return new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(name)
        .addFields(selectedMods.map(mod => ({
            name: mod.modName,
            value: `${mod.selected.split(':')[1]}${
                mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                    '\n' + Object.entries(mod.subSelections)
                        .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') : ''
            }`,
            inline: true
        })));
}

function createModificationRows(modifications, selectedMods) {
    const modRows = [];

    Object.entries(modifications).forEach(([modName, modValues], index) => {
        modRows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`select-mod-${index}`)
                    .setPlaceholder(`Vyberte ${modName}`)
                    .addOptions(modValues.map(opt => ({
                        label: opt.name,
                        value: `${modName}:${opt.name}:${opt.price || 0}`,
                        default: selectedMods[index]?.selected === `${modName}:${opt.name}:${opt.price || 0}`
                    })))
            )
        );

        const currentMod = selectedMods[index];
        if (currentMod?.selected) {
            const [selectedModName, selectedOptName] = currentMod.selected.split(':');
            const selectedOption = modValues.find(opt => opt.name === selectedOptName);

            if (selectedOption?.subOptions) {
                Object.entries(selectedOption.subOptions).forEach(([subName, subValues]) => {
                    modRows.push(
                        new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`select-submod-${index}-${subName}`)
                                .setPlaceholder(`Vyberte ${subName}`)
                                .addOptions(subValues.map(opt => ({
                                    label: opt.name,
                                    value: `${subName}:${opt.name}:${opt.price || 0}`,
                                    default: currentMod.subSelections?.[subName]?.name === opt.name
                                })))
                        )
                    );
                });
            }
        }
    });

    modRows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm-give')
                .setLabel('Přidat')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('cancel-give')
                .setLabel('Zrušit')
                .setStyle(ButtonStyle.Danger)
        )
    );

    return modRows;
}