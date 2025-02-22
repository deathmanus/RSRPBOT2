const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

function createModificationPages(modifications, selectedMods) {
    const allRows = [];

    Object.entries(modifications).forEach(([modName, modValues], index) => {
        // Hlavní modification menu zůstává stejné
        allRows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`select-mod-${index}`)
                .setPlaceholder(`Vyberte ${modName}`)
                .addOptions(modValues.map(opt => ({
                    label: opt.name,
                    value: `${modName}:${opt.name}:${opt.price || 0}`,
                    default: selectedMods[index]?.selected === `${modName}:${opt.name}:${opt.price || 0}`
                })))
        ));

        const currentMod = selectedMods[index];
        if (currentMod?.selected) {
            const [selectedModName, selectedOptName] = currentMod.selected.split(':');
            const selectedOption = modValues.find(opt => opt.name === selectedOptName);

            if (selectedOption?.subOptions) {
                Object.entries(selectedOption.subOptions).forEach(([subName, subValues]) => {
                    // Zajistíme, že existuje subSelections pro tento mod
                    if (!currentMod.subSelections[subName] && subValues.length > 0) {
                        currentMod.subSelections[subName] = {
                            name: subValues[0].name,
                            price: subValues[0].price || 0
                        };
                    }

                    allRows.push(new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`select-submod-${index}-${subName}`)
                            .setPlaceholder(`Vyberte ${subName}`)
                            .addOptions(subValues.map(opt => ({
                                label: opt.name,
                                value: `${subName}:${opt.name}:${opt.price || 0}`,
                                default: currentMod.subSelections[subName]?.name === opt.name
                            })))
                    ));
                });
            }
        }
    });

    // Rozdělení do stránek
    const pages = [];
    for (let i = 0; i < allRows.length; i += 4) {
        pages.push(allRows.slice(i, i + 4));
    }

    return {
        pages,
        totalModifications: allRows.length
    };
}

function createItemEmbed(itemData, selectedMods, isGiving = true) {
    const embed = new EmbedBuilder()
        .setColor(isGiving ? 0x00FF00 : 0xFF0000)
        .setTitle(itemData.name);

    if (selectedMods.length > 0) {
        embed.addFields(selectedMods.map(mod => ({
            name: mod.modName,
            value: `${mod.selected.split(':')[1]}${
                mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                    '\n' + Object.entries(mod.subSelections)
                        .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') : ''
            }`,
            inline: true
        })));
    }

    return embed;
}

function updateModificationDisplay(itemData, selectedMods, currentPage = 0) {
    const { pages } = createModificationPages(itemData.modifications, selectedMods);
    
    // Ensure current page is valid
    currentPage = Math.max(0, Math.min(pages.length - 1, currentPage));

    const modRows = [...pages[currentPage]];
    
    const navigationRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('prev-page')
            .setLabel('◀️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('next-page')
            .setLabel('▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage >= pages.length - 1),
        new ButtonBuilder()
            .setCustomId('confirm-action')  // Changed from confirm-give
            .setLabel('Přidat')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('cancel-action')   // Changed from cancel-give
            .setLabel('Zrušit')
            .setStyle(ButtonStyle.Danger)
    );

    modRows.push(navigationRow);

    const itemEmbed = createItemEmbed(itemData, selectedMods);
    if (pages.length > 1) {
        itemEmbed.setFooter({ text: `Stránka ${currentPage + 1}/${pages.length}` });
    }

    return {
        embeds: [itemEmbed],
        components: modRows
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('item')
        .setDescription('Spravuje itemy frakcí')
        .addSubcommand(subcommand =>
            subcommand
                .setName('give')
                .setDescription('Přidá item frakci'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('take')
                .setDescription('Odebere item frakci')),

    async execute(interaction) {
        const isGiving = interaction.options.getSubcommand() === 'give';
        
        try {
            await interaction.deferReply({ ephemeral: true }).catch(console.error);

            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const shopDir = path.join(__dirname, '../../files/Shop');
            
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
            let currentPage = 0;

            const fractionMenu = new StringSelectMenuBuilder()
                .setCustomId('select-fraction')
                .setPlaceholder('Vyberte frakci')
                .addOptions(fractions.map(fraction => ({
                    label: fraction,
                    value: fraction
                })));

            const embed = new EmbedBuilder()
                .setTitle(isGiving ? 'Přidání itemu' : 'Odebrání itemu')
                .setDescription('Vyberte frakci.')
                .setColor(isGiving ? 0x00FF00 : 0xFF0000);

            const message = await interaction.editReply({
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(fractionMenu)]
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate().catch(console.error);

                    if (i.customId === 'select-fraction') {
                        selectedFraction = i.values[0];
                        const selectionsPath = isGiving ? shopDir : path.join(fractionsDir, selectedFraction);
                        
                        try {
                            const sections = fs.readdirSync(selectionsPath, { withFileTypes: true })
                                .filter(dirent => dirent.isDirectory())
                                .map(dirent => dirent.name);

                            if (!isGiving && sections.length === 0) {
                                await i.editReply({
                                    content: '❌ Tato frakce nemá žádné itemy.',
                                    components: []
                                });
                                return collector.stop();
                            }

                            const sectionMenu = new StringSelectMenuBuilder()
                                .setCustomId('select-section')
                                .setPlaceholder('Vyberte sekci')
                                .addOptions(sections.map(section => ({
                                    label: section,
                                    value: section
                                })));

                            const fractionMenuUpdated = new StringSelectMenuBuilder()
                                .setCustomId('select-fraction')
                                .setPlaceholder('Vyberte frakci')
                                .addOptions(fractions.map(fraction => ({
                                    label: fraction,
                                    value: fraction,
                                    default: fraction === selectedFraction
                                })));

                            await i.editReply({
                                embeds: [embed.setDescription(`Vyberte sekci pro frakci ${selectedFraction}`)],
                                components: [
                                    new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                    new ActionRowBuilder().addComponents(sectionMenu)
                                ]
                            });
                        } catch (error) {
                            console.error(`Error accessing directory: ${selectionsPath}`, error);
                            await i.editReply({
                                content: '❌ Nastala chyba při načítání sekcí.',
                                components: []
                            });
                            collector.stop();
                        }
                    }

                    // In the else if (i.customId === 'select-section') block for take items
                    else if (i.customId === 'select-section') {
                        selectedSection = i.values[0];
                        const itemsPath = isGiving ? 
                            path.join(shopDir, selectedSection) :
                            path.join(fractionsDir, selectedFraction, selectedSection);

                        try {
                            const items = fs.readdirSync(itemsPath)
                                .filter(file => file.endsWith('.json'))
                                .map(file => {
                                    const itemData = JSON.parse(fs.readFileSync(path.join(itemsPath, file)));
                                    return isGiving ? {
                                        label: itemData.name || file.replace('.json', ''),
                                        value: file.replace('.json', ''),
                                        description: itemData.description?.substring(0, 100) || undefined
                                    } : {
                                        label: `${itemData.name} (ID: ${itemData.id})`,
                                        value: file
                                    };
                                });

                            if (!isGiving && items.length === 0) {
                                return await i.editReply({
                                    content: '❌ Tato sekce neobsahuje žádné itemy.',
                                    components: []
                                });
                            }

                            const itemMenu = new StringSelectMenuBuilder()
                                .setCustomId('select-item')
                                .setPlaceholder('Vyberte item')
                                .addOptions(items);

                            const sectionMenuUpdated = new StringSelectMenuBuilder()
                                .setCustomId('select-section')
                                .setPlaceholder('Vyberte sekci')
                                .addOptions(fs.readdirSync(isGiving ? shopDir : path.join(fractionsDir, selectedFraction), { withFileTypes: true })
                                    .filter(dirent => dirent.isDirectory())
                                    .map(dirent => ({
                                        label: dirent.name,
                                        value: dirent.name,
                                        default: dirent.name === selectedSection
                                    })));

                            await i.editReply({
                                embeds: [embed.setDescription(`Vyberte item ${isGiving ? 'pro' : 'k odebrání z'} frakce ${selectedFraction}`)],
                                components: [
                                    new ActionRowBuilder().addComponents(sectionMenuUpdated),
                                    new ActionRowBuilder().addComponents(itemMenu)
                                ]
                            });
                        } catch (error) {
                            console.error(`Error accessing items in: ${itemsPath}`, error);
                            await i.editReply({
                                content: '❌ Nastala chyba při načítání itemů.',
                                components: []
                            });
                            collector.stop();
                        }
                    }

                    // And modify the select-item handler for take functionality
                    else if (i.customId === 'select-item' && !isGiving) {
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
                            .setCustomId('confirm-action')
                            .setLabel('Odebrat')
                            .setStyle(ButtonStyle.Danger);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel-action')
                            .setLabel('Zrušit')
                            .setStyle(ButtonStyle.Secondary);

                        await i.editReply({
                            embeds: [confirmationEmbed],
                            components: [new ActionRowBuilder().addComponents(confirmButton, cancelButton)]
                        });
                    }

                    else if (i.customId === 'select-item') {
                        selectedItem = i.values[0];
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));

                        if (isGiving && itemData.modifications) {
                            // Initialize selectedMods with proper default selections
                            selectedMods = Object.entries(itemData.modifications).map(([modName, modValues]) => {
                                const defaultOption = modValues[0]; // Get first option as default
                                const mod = {
                                    modName,
                                    selected: `${modName}:${defaultOption.name}:${defaultOption.price || 0}`,
                                    subSelections: {}
                                };

                                // Initialize sub-selections if they exist
                                if (defaultOption.subOptions) {
                                    Object.entries(defaultOption.subOptions).forEach(([subName, subValues]) => {
                                        if (Array.isArray(subValues) && subValues.length > 0) {
                                            mod.subSelections[subName] = {
                                                name: subValues[0].name,
                                                price: subValues[0].price || 0
                                            };
                                        }
                                    });
                                }

                                return mod;
                            });

                            currentPage = 0;
                            const display = updateModificationDisplay(itemData, selectedMods, currentPage);
                            await i.editReply(display);
                        } else {
                            const actionButton = new ButtonBuilder()
                                .setCustomId('confirm-action')
                                .setLabel(isGiving ? 'Přidat' : 'Odebrat')
                                .setStyle(isGiving ? ButtonStyle.Success : ButtonStyle.Danger);

                            const cancelButton = new ButtonBuilder()
                                .setCustomId('cancel-action')
                                .setLabel('Zrušit')
                                .setStyle(ButtonStyle.Secondary);

                            await i.editReply({
                                embeds: [createItemEmbed(itemData, [], isGiving)],
                                components: [new ActionRowBuilder().addComponents(actionButton, cancelButton)]
                            });
                        }
                    }

                    else if (i.customId.startsWith('select-mod-')) {
                        const modIndex = parseInt(i.customId.replace('select-mod-', ''));
                        const [modName, selectedValue, price] = i.values[0].split(':');
                        
                        // Get the selected modification data
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const selectedMod = itemData.modifications[modName].find(mod => mod.name === selectedValue);
                    
                        // Update the mod with default sub-selections
                        selectedMods[modIndex] = {
                            modName,
                            selected: i.values[0],
                            subSelections: {}
                        };
                    
                        // Initialize default sub-selections if they exist
                        if (selectedMod?.subOptions) {
                            Object.entries(selectedMod.subOptions).forEach(([subName, subValues]) => {
                                if (Array.isArray(subValues) && subValues.length > 0) {
                                    selectedMods[modIndex].subSelections[subName] = {
                                        name: subValues[0].name,
                                        price: subValues[0].price || 0
                                    };
                                }
                            });
                        }
                    
                        const display = updateModificationDisplay(itemData, selectedMods, currentPage);
                        await i.editReply(display);
                    }

                    // Replace the select-submod- handler with this corrected version
                    else if (i.customId.startsWith('select-submod-')) {
                        const parts = i.customId.split('-');
                        const modIndex = parseInt(parts[2], 10);
                        const subModName = parts[3];
                        const [subMod, optName, optPrice] = i.values[0].split(':');
                    
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
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
                    
                        // Update the specific sub-selection while preserving others
                        selectedMods[modIndex].subSelections = {
                            ...selectedMods[modIndex].subSelections,
                            [subMod]: {
                                name: optName,
                                price: Number(subOpt.price) || 0
                            }
                        };
                    
                        const display = updateModificationDisplay(itemData, selectedMods, currentPage);
                        await i.editReply(display);
                    }

                    else if (i.customId === 'prev-page' || i.customId === 'next-page') {
                        currentPage += i.customId === 'next-page' ? 1 : -1;
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        
                        const display = updateModificationDisplay(itemData, selectedMods, currentPage);
                        await i.editReply(display);
                    }

                    else if (i.customId === 'confirm-action') {
                        try {
                            if (isGiving) {
                                const sourcePath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                                const targetDir = path.join(fractionsDir, selectedFraction, selectedSection);
                                fs.mkdirSync(targetDir, { recursive: true });
                    
                                const itemData = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
                                const newItemData = {
                                    ...itemData,
                                    id: `${selectedItem}_${Date.now()}`,
                                    addedBy: interaction.user.tag,
                                    addedDate: new Date().toISOString(),
                                    selectedMods
                                };
                    
                                const resultEmbed = new EmbedBuilder()
                                    .setColor(0x00FF00)
                                    .setTitle('✅ Item přidán')
                                    .setDescription(`Item byl úspěšně přidán do frakce ${selectedFraction}`)
                                    .addFields(
                                        { name: 'Item', value: itemData.name, inline: true },
                                        { name: 'Sekce', value: selectedSection, inline: true },
                                        { name: 'ID', value: newItemData.id, inline: true }
                                    );
                    
                                fs.writeFileSync(
                                    path.join(targetDir, `${newItemData.id}.json`),
                                    JSON.stringify(newItemData, null, 2)
                                );
                    
                                await i.editReply({
                                    content: null,
                                    embeds: [resultEmbed],
                                    components: []
                                });
                            } else {
                                // Remove the .json extension since it's already in the selectedItem
                                const itemPath = path.join(fractionsDir, selectedFraction, selectedSection, selectedItem);
                                try {
                                    const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                                    
                                    const resultEmbed = new EmbedBuilder()
                                        .setColor(0xFF0000)
                                        .setTitle('✅ Item odebrán')
                                        .setDescription(`Item byl úspěšně odebrán z frakce ${selectedFraction}`)
                                        .addFields(
                                            { name: 'Item', value: itemData.name, inline: true },
                                            { name: 'Sekce', value: selectedSection, inline: true }
                                        );
                                
                                    fs.unlinkSync(itemPath);
                                
                                    // Check if section is empty and remove if it is
                                    const sectionPath = path.join(fractionsDir, selectedFraction, selectedSection);
                                    const remainingFiles = fs.readdirSync(sectionPath).filter(f => f.endsWith('.json'));
                                    if (remainingFiles.length === 0) {
                                        fs.rmdirSync(sectionPath);
                                    }
                                
                                    await i.editReply({
                                        content: null,
                                        embeds: [resultEmbed],
                                        components: []
                                    });
                                } catch (error) {
                                    console.error('Error reading or removing item:', error);
                                    await i.editReply({
                                        content: '❌ Nastala chyba při odebírání itemu.',
                                        components: []
                                    });
                                }
                            }
                            collector.stop();
                        } catch (error) {
                            console.error(`Error ${isGiving ? 'adding' : 'removing'} item:`, error);
                            await i.editReply({
                                content: `❌ Nastala chyba při ${isGiving ? 'přidávání' : 'odebírání'} itemu.`,
                                components: []
                            });
                            collector.stop();
                        }
                    }

                    else if (i.customId === 'cancel-action') {
                        await i.editReply({
                            content: '❌ Akce zrušena.',
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                    }

                } catch (error) {
                    console.error('Error in collector:', error);
                    try {
                        await i.editReply({
                            content: '❌ Nastala chyba při zpracování požadavku.',
                            components: []
                        }).catch(console.error);
                    } catch (e) {
                        console.error('Error sending error message:', e);
                    }
                    collector.stop('error');
                }
            });
            
            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    try {
                        await interaction.editReply({
                            content: '⌛ Časový limit vypršel.',
                            components: [],
                            embeds: []
                        }).catch(console.error);
                    } catch (error) {
                        console.error('Error in collector end:', error);
                    }
                }
            });

        } catch (error) {
            console.error('Error in command:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ Nastala chyba při zpracování příkazu.',
                    ephemeral: true 
                }).catch(console.error);
            } else {
                await interaction.editReply({
                    content: '❌ Nastala chyba při zpracování příkazu.',
                    components: []
                }).catch(console.error);
            }
        }
    }
};