const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getEmoji } = require('../../utils/emojiUtils');
const fs = require('fs');
const path = require('path');

// Helper function for logging
const logEdit = (action, data) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[EDIT LOG - ${timestamp}]`);
    console.log(`Action: ${action}`);
    console.log('Data:', JSON.stringify(data, null, 2));
    console.log('-'.repeat(50));
};

// Add these functions at the top level
function createModificationPages(modifications, selectedMods) {
    const allRows = [];

    Object.entries(modifications).forEach(([modName, modValues], index) => {
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
                    allRows.push(new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`select-submod-${index}-${subName}`)
                            .setPlaceholder(`Vyberte ${subName}`)
                            .addOptions(subValues.map(opt => ({
                                label: opt.name,
                                value: `${subName}:${opt.name}:${opt.price || 0}`,
                                default: currentMod.subSelections?.[subName]?.name === opt.name
                            })))
                    ));
                });
            }
        }
    });

    const pages = [];
    for (let i = 0; i < allRows.length; i += 4) {
        pages.push(allRows.slice(i, i + 4));
    }

    return {
        pages,
        totalModifications: allRows.length
    };
}

function updateModificationDisplay(itemData, selectedMods, priceDifference, currentPage = 0) {
    const { pages } = createModificationPages(itemData.modifications, selectedMods);
    
    currentPage = Math.max(0, Math.min(pages.length - 1, currentPage));
    const modRows = [...pages[currentPage]];
    
    modRows.push(new ActionRowBuilder().addComponents(
        ...[
            pages.length > 1 && new ButtonBuilder()
                .setCustomId('prev-page')
                .setLabel('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 0),
            pages.length > 1 && new ButtonBuilder()
                .setCustomId('next-page')
                .setLabel('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= pages.length - 1),
            new ButtonBuilder()
                .setCustomId('confirm-edit')
                .setLabel('Potvrdit')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('cancel-edit')
                .setLabel('Zrušit')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('sell-item')
                .setLabel('Prodat')
                .setStyle(ButtonStyle.Danger)
        ].filter(Boolean)
    ));

    const itemEmbed = createItemEmbed(itemData.name, priceDifference, selectedMods);
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
        .setName('edititem')
        .setDescription('Upravit nebo prodat předmět frakce'),

    async execute(interaction) {
        // Kontrola rolí
        if (!interaction.member.roles.cache.some(role => 
            role.name.startsWith('Velitel') || role.name.startsWith('Zástupce')
        )) {
            return interaction.reply({ 
                content: `${getEmoji('error')} Nemáš oprávnění použít tento příkaz! Pouze velitelé a zástupci frakcí mohou používat tento příkaz.`,
                ephemeral: true 
            });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            // Check fraction membership
            const member = interaction.member;
            const fractionRole = member.roles.cache.find(role => 
                fs.existsSync(path.join(__dirname, '../../files/Fractions', role.name)));

            if (!fractionRole) {
                return await interaction.editReply({
                    content: `${getEmoji('error')} Nejste členem žádné frakce.`,
                    components: []
                });
            }

            const fractionPath = path.join(__dirname, '../../files/Fractions', fractionRole.name);
            const fractionData = JSON.parse(fs.readFileSync(path.join(fractionPath, `${fractionRole.name}.json`)));

            // Get all sections with items
            const sections = fs.readdirSync(fractionPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (sections.length === 0) {
                return await interaction.editReply({
                    content: `${getEmoji('error')} Vaše frakce nemá žádné předměty.`,
                    components: []
                });
            }

            let selectedSection = null;
            let selectedItem = null;
            let originalItem = null;
            let selectedMods = [];
            let priceDifference = 0;
            let currentPage = 0;

            // Create section menu
            const sectionMenu = new StringSelectMenuBuilder()
                .setCustomId('select-section')
                .setPlaceholder('Vyberte sekci')
                .addOptions(sections.map(section => ({
                    label: section,
                    value: section
                })));

            const row = new ActionRowBuilder().addComponents(sectionMenu);
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Úprava předmětu')
                .setDescription('Vyberte sekci z menu.');

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

                    if (i.customId === 'select-section') {
                        selectedSection = i.values[0];
                        const sectionPath = path.join(fractionPath, selectedSection);
                        const items = fs.readdirSync(sectionPath)
                            .filter(file => file.endsWith('.json'))
                            .map(file => {
                                const itemData = JSON.parse(fs.readFileSync(path.join(sectionPath, file)));
                                return {
                                    label: `${itemData.name} (ID: ${itemData.id})`,
                                    value: file
                                };
                            });
                    
                        const sectionMenuUpdated = new StringSelectMenuBuilder()
                            .setCustomId('select-section')
                            .setPlaceholder('Vyberte sekci')
                            .addOptions(sections.map(section => ({
                                label: section,
                                value: section,
                                default: section === selectedSection  // Add this line
                            })));
                    
                        const itemMenu = new StringSelectMenuBuilder()
                            .setCustomId('select-item')
                            .setPlaceholder('Vyberte předmět')
                            .addOptions(items);
                    
                        await i.editReply({
                            embeds: [embed.setDescription('Vyberte předmět k úpravě:')],
                            components: [
                                new ActionRowBuilder().addComponents(sectionMenuUpdated),
                                new ActionRowBuilder().addComponents(itemMenu)
                            ]
                        });
                    }
                    // Update the select-item handler
                    else if (i.customId === 'select-item') {
                        const itemPath = path.join(fractionPath, selectedSection, i.values[0]);
                        originalItem = JSON.parse(fs.readFileSync(itemPath));
                        selectedItem = i.values[0];

                        const shopItemPath = path.join(__dirname, '../../files/Shop', selectedSection, `${originalItem.name}.json`);
                        const shopItem = JSON.parse(fs.readFileSync(shopItemPath));

                        selectedMods = JSON.parse(JSON.stringify(originalItem.selectedMods));
                        priceDifference = calculatePriceDifference(originalItem.selectedMods, selectedMods);

                        const display = updateModificationDisplay(shopItem, selectedMods, priceDifference, 0);
                        await i.editReply(display);
                    }
                    // Add page navigation handler
                    else if (i.customId === 'prev-page' || i.customId === 'next-page') {
                        currentPage += i.customId === 'next-page' ? 1 : -1;
                        
                        const shopItemPath = path.join(__dirname, '../../files/Shop', selectedSection, `${originalItem.name}.json`);
                        const shopItem = JSON.parse(fs.readFileSync(shopItemPath));
                        
                        const display = updateModificationDisplay(shopItem, selectedMods, priceDifference, currentPage);
                        await i.editReply(display);
                    }
                    // Update the select-mod handler
                    else if (i.customId.startsWith('select-mod-')) {
                        const modIndex = parseInt(i.customId.split('-')[2], 10);
                        const [modName, optName, optPrice] = i.values[0].split(':');

                        // Store original mods for comparison
                        const originalMods = JSON.parse(JSON.stringify(selectedMods));

                        // Update the modification
                        selectedMods[modIndex] = {
                            ...selectedMods[modIndex],
                            modName,
                            selected: `${modName}:${optName}:${optPrice}`,
                            subSelections: {} // Reset sub-selections when changing main selection
                        };

                        // Calculate new price difference
                        priceDifference = calculatePriceDifference(originalItem.selectedMods, selectedMods);

                        const shopItemPath = path.join(__dirname, '../../files/Shop', selectedSection, `${originalItem.name}.json`);
                        const shopItem = JSON.parse(fs.readFileSync(shopItemPath));
                        const selectedModification = shopItem.modifications[modName];
                        const selectedOption = selectedModification.find(opt => opt.name === optName);
                    
                        // Store original mod for price difference calculation
                        const originalMod = selectedMods[modIndex];
                    
                        // Update the modification
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
                    
                        // Calculate new price difference
                        priceDifference = calculatePriceDifference(originalItem.selectedMods, selectedMods);
                    
                        const display = updateModificationDisplay(shopItem, selectedMods, priceDifference, currentPage);
                        await i.editReply(display);
                    }
                    // Update the select-submod handler
                    else if (i.customId.startsWith('select-submod-')) {
                        const parts = i.customId.split('-');
                        const modIndex = parseInt(parts[2], 10);
                        const subModName = parts[3];
                        const [subMod, optName, optPrice] = i.values[0].split(':');
                    
                        const shopItemPath = path.join(__dirname, '../../files/Shop', selectedSection, `${originalItem.name}.json`);
                        const shopItem = JSON.parse(fs.readFileSync(shopItemPath));
                    
                        // Get main modification details
                        const mainModName = selectedMods[modIndex].modName;
                        const mainOptName = selectedMods[modIndex].selected.split(':')[1];
                        const mainMod = shopItem.modifications[mainModName];
                        const selectedMainOpt = mainMod.find(opt => opt.name === mainOptName);
                    
                        // Find the selected sub-option
                        const subOpt = selectedMainOpt.subOptions[subMod].find(opt => opt.name === optName);
                    
                        // Store original state for comparison
                        const originalMods = JSON.parse(JSON.stringify(selectedMods));

                        // Update the sub-selection
                        selectedMods[modIndex].subSelections[subMod] = {
                            name: optName,
                            price: Number(subOpt.price) || 0
                        };
                    
                        // Calculate new price difference immediately
                        priceDifference = calculatePriceDifference(originalItem.selectedMods, selectedMods);
                    
                        const display = updateModificationDisplay(shopItem, selectedMods, priceDifference, currentPage);
                        await i.editReply(display);
                    }
                    else if (i.customId === 'confirm-edit') {
                        if (priceDifference > 0 && fractionData.money < priceDifference) {
                            return await i.editReply({
                                content: `${getEmoji('error')} Nedostatek peněz pro úpravu. Potřebujete: ${priceDifference}$`,
                                components: []
                            });
                        }

                        // Update item file
                        originalItem.selectedMods = selectedMods;
                        fs.writeFileSync(
                            path.join(fractionPath, selectedSection, selectedItem),
                            JSON.stringify(originalItem, null, 2)
                        );

                        // Update fraction money
                        if (priceDifference !== 0) {
                            fractionData.money -= priceDifference;
                            fs.writeFileSync(
                                path.join(fractionPath, `${fractionRole.name}.json`),
                                JSON.stringify(fractionData, null, 2)
                            );
                        }

                        // Send confirmation message
                        const confirmEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`${getEmoji('success')} Předmět upraven`)
                            .addFields(
                                { name: 'Předmět', value: originalItem.name },
                                { name: 'Cenový rozdíl', value: `${priceDifference}$` },
                                { name: 'Nový stav účtu', value: `${fractionData.money}$` }
                            );

                        await interaction.channel.send({ embeds: [confirmEmbed] });
                        await i.editReply({
                            content: `${getEmoji('success')} Úpravy byly uloženy`,
                            components: [],
                            embeds: []
                        });
                    }
                    else if (i.customId === 'sell-item') {
                        const sellPrice = Math.floor(originalItem.totalPrice * 0.9);
                        const confirmSell = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle(`${getEmoji('warning')} Potvrzení prodeje`)
                            .setDescription(`Opravdu chcete prodat ${originalItem.name} za ${sellPrice}$?`);

                        const confirmButtons = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId('confirm-sell')
                                    .setLabel('Prodat')
                                    .setStyle(ButtonStyle.Danger),
                                new ButtonBuilder()
                                    .setCustomId('cancel-sell')
                                    .setLabel('Zrušit')
                                    .setStyle(ButtonStyle.Secondary)
                            );

                        await i.editReply({
                            embeds: [confirmSell],
                            components: [confirmButtons]
                        });
                    }
                    else if (i.customId === 'confirm-sell') {
                        const sellPrice = Math.floor(originalItem.totalPrice * 0.9);
                        
                        // Update fraction money
                        fractionData.money += sellPrice;
                        fs.writeFileSync(
                            path.join(fractionPath, `${fractionRole.name}.json`),
                            JSON.stringify(fractionData, null, 2)
                        );

                        // Delete item file
                        fs.unlinkSync(path.join(fractionPath, selectedSection, selectedItem));

                        // Check if section directory is empty and delete if it is
                        const sectionPath = path.join(fractionPath, selectedSection);
                        const remainingFiles = fs.readdirSync(sectionPath);
                        if (remainingFiles.length === 0) {
                            fs.rmdirSync(sectionPath);
                            logEdit('Directory Removed', {
                                section: selectedSection,
                                path: sectionPath
                            });
                        }

                        // Send confirmation
                        const sellEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`${getEmoji('success')} Předmět prodán`)
                            .addFields(
                                { name: 'Předmět', value: originalItem.name },
                                { name: 'Získáno', value: `${sellPrice}$` },
                                { name: 'Nový stav účtu', value: `${fractionData.money}$` }
                            );

                        await interaction.channel.send({ embeds: [sellEmbed] });
                        await i.editReply({
                            content: `${getEmoji('success')} Předmět byl prodán`,
                            components: [],
                            embeds: []
                        });
                    }
                    else if (i.customId === 'cancel-sell' || i.customId === 'cancel-edit') {
                        await i.editReply({
                            content: `${getEmoji('error')} Akce zrušena`,
                            components: [],
                            embeds: []
                        });
                    }
                } catch (error) {
                    console.error(error);
                    await i.editReply({
                        content: `${getEmoji('error')} Nastala chyba při zpracování akce`,
                        components: []
                    });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: '⌛ Časový limit vypršel',
                        components: [],
                        embeds: []
                    }).catch(() => {});
                }
            });

        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: `${getEmoji('error')} Nastala chyba při zpracování příkazu`,
                components: []
            });
        }
    }
};

function calculatePriceDifference(originalMods, newMods) {
    let originalTotal = 0;
    let newTotal = 0;

    // Calculate original price
    originalMods.forEach(mod => {
        if (mod?.selected) {
            const [,, price] = mod.selected.split(':');
            originalTotal += Number(price) || 0;
        }
        if (mod?.subSelections) {
            Object.values(mod.subSelections).forEach(subOpt => {
                originalTotal += Number(subOpt.price) || 0;
            });
        }
    });

    // Calculate new price
    newMods.forEach(mod => {
        if (mod?.selected) {
            const [,, price] = mod.selected.split(':');
            newTotal += Number(price) || 0;
        }
        if (mod?.subSelections) {
            Object.values(mod.subSelections).forEach(subOpt => {
                newTotal += Number(subOpt.price) || 0;
            });
        }
    });

    console.log('Price Calculation:', {
        originalTotal,
        newTotal,
        difference: newTotal - originalTotal
    });

    return newTotal - originalTotal;
}

function createItemEmbed(name, priceDifference, selectedMods) {
    // Convert priceDifference to number to ensure proper comparison
    priceDifference = Number(priceDifference);

    const embed = new EmbedBuilder()
        .setColor(priceDifference > 0 ? 0xFF0000 : priceDifference < 0 ? 0x00FF00 : 0xFFFFFF)
        .setTitle(`${getEmoji('edit')} Úprava: ${name}`)
        .setDescription(priceDifference === 0 ? 
            '✨ Žádné cenové změny' : 
            priceDifference > 0 ?
                `${getEmoji('money')} Doplatek: ${priceDifference} ${getEmoji('money')}` :
                `${getEmoji('money')} Vrácení: ${Math.abs(priceDifference)} ${getEmoji('money')}`
        )
        .addFields(selectedMods.map(mod => ({
            name: mod.modName,
            value: `${mod.selected.split(':')[1]}${
                mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                    '\n' + Object.entries(mod.subSelections)
                        .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') 
                    : ''
            }`,
            inline: true
        })));

    // Update footer based on actual price difference
    if (priceDifference !== 0) {
        embed.setFooter({ 
            text: priceDifference > 0 ? 
                `${getEmoji('error')} Tato úprava bude stát více peněz` : 
                `${getEmoji('success')} Za tuto úpravu dostanete peníze zpět`
        });
    }

    return embed;
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

    return modRows;
}