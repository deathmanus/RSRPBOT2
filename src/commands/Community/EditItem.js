const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getEmoji } = require('../../utils/emojiUtils');
const fs = require('fs');
const path = require('path');
const { db, getFractionByName, getFractionItems, updateFractionMoney, addAuditLog } = require('../../Database/database');

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
            
            // Get user's fraction from database
            let fractionRole = null;
            let fractionData = null;
            
            const fractions = [];
            await new Promise((resolve) => {
                db.all(`SELECT name FROM fractions`, [], (err, rows) => {
                    if (!err && rows) {
                        rows.forEach(row => fractions.push(row.name));
                    }
                    resolve();
                });
            });
            
            fractionRole = member.roles.cache.find(role => fractions.includes(role.name));
            
            if (!fractionRole) {
                return await interaction.editReply({
                    content: `${getEmoji('error')} Nejste členem žádné frakce.`,
                    components: []
                });
            }
            
            // Get fraction data from database
            await new Promise((resolve) => {
                getFractionByName(fractionRole.name, (err, fraction) => {
                    fractionData = fraction;
                    resolve();
                });
            });
            
            if (!fractionData) {
                return await interaction.editReply({
                    content: `${getEmoji('error')} Nastala chyba při načítání dat frakce.`,
                    components: []
                });
            }

            // Get all sections with items
            const sections = [];
            const shopSections = [];
            
            // Get shop sections
            await new Promise((resolve) => {
                db.all(`SELECT name FROM shop_sections`, [], (err, rows) => {
                    if (!err && rows) {
                        rows.forEach(row => shopSections.push(row.name));
                    }
                    resolve();
                });
            });
            
            // Get fraction's purchased items by category
            await new Promise((resolve) => {
                getFractionItems(fractionRole.name, (err, items) => {
                    if (!err && items) {
                        // Group items by section
                        const groupedItems = {};
                        items.forEach(item => {
                            // Determine section based on item type
                            let section = 'Other';
                            if (item.type === 'air_vehicle') section = 'Air vehicles';
                            else if (item.type === 'ground_vehicle') section = 'Ground vehicles';
                            else if (item.type === 'equipment') section = 'Equipment';
                            else if (item.type === 'resource') section = 'Resources';
                            
                            if (!groupedItems[section]) {
                                groupedItems[section] = [];
                                sections.push(section);
                            }
                            groupedItems[section].push(item);
                        });
                    }
                    resolve();
                });
            });

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
                        
                        // Get items from the database for the selected section
                        const items = [];
                        await new Promise((resolve) => {
                            getFractionItems(fractionRole.name, (err, allItems) => {
                                if (!err && allItems) {
                                    // Filter items by type to match section
                                    allItems.forEach(item => {
                                        let itemSection = 'Other';
                                        if (item.type === 'air_vehicle') itemSection = 'Air vehicles';
                                        else if (item.type === 'ground_vehicle') itemSection = 'Ground vehicles';
                                        else if (item.type === 'equipment') itemSection = 'Equipment';
                                        else if (item.type === 'resource') itemSection = 'Resources';
                                        
                                        if (itemSection === selectedSection) {
                                            items.push({
                                                label: `${item.name} (ID: ${item.id})`,
                                                value: item.id.toString()
                                            });
                                        }
                                    });
                                }
                                resolve();
                            });
                        });
                    
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
                        const itemId = i.values[0];
                        
                        // Get item data from database
                        let selectedItemData = null;
                        await new Promise((resolve) => {
                            db.get(
                                `SELECT purchases.*, shop_items.* 
                                 FROM purchases 
                                 JOIN shop_items ON purchases.item_id = shop_items.id 
                                 WHERE purchases.id = ?`,
                                [itemId],
                                (err, row) => {
                                    if (!err && row) {
                                        selectedItemData = row;
                                    }
                                    resolve();
                                }
                            );
                        });
                        
                        if (!selectedItemData) {
                            return await i.editReply({
                                content: `${getEmoji('error')} Předmět nebyl nalezen v databázi.`,
                                components: []
                            });
                        }
                        
                        selectedItem = itemId;
                        originalItem = {
                            id: selectedItemData.id,
                            name: selectedItemData.name,
                            selectedMods: selectedItemData.selected_mods ? JSON.parse(selectedItemData.selected_mods) : []
                        };
                        
                        // Get shop item details
                        const shopItem = {
                            name: selectedItemData.name,
                            modifications: selectedItemData.modifications ? JSON.parse(selectedItemData.modifications) : {}
                        };

                        selectedMods = JSON.parse(JSON.stringify(originalItem.selectedMods));
                        priceDifference = calculatePriceDifference(originalItem.selectedMods, selectedMods);

                        const display = updateModificationDisplay(shopItem, selectedMods, priceDifference, 0);
                        await i.editReply(display);
                    }
                    else if (i.customId === 'prev-page' || i.customId === 'next-page') {
                        currentPage += i.customId === 'next-page' ? 1 : -1;
                        
                        // Get shop item details again from database
                        let shopItem = null;
                        await new Promise((resolve) => {
                            db.get(
                                `SELECT shop_items.* 
                                 FROM purchases 
                                 JOIN shop_items ON purchases.item_id = shop_items.id 
                                 WHERE purchases.id = ?`,
                                [selectedItem],
                                (err, row) => {
                                    if (!err && row) {
                                        shopItem = {
                                            name: row.name,
                                            modifications: row.modifications ? JSON.parse(row.modifications) : {}
                                        };
                                    }
                                    resolve();
                                }
                            );
                        });
                        
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

                        // Update item in database
                        await new Promise((resolve) => {
                            db.run(
                                `UPDATE purchases SET selected_mods = ? WHERE id = ?`,
                                [JSON.stringify(selectedMods), selectedItem],
                                (err) => {
                                    if (err) {
                                        console.error('Error updating item:', err);
                                    }
                                    resolve();
                                }
                            );
                        });

                        // Update fraction money if needed
                        if (priceDifference !== 0) {
                            try {
                                await updateFractionMoney(fractionData.id, Math.abs(priceDifference), priceDifference < 0);
                                
                                // Update fractionData with new money amount
                                fractionData.money = priceDifference > 0 
                                    ? fractionData.money - priceDifference 
                                    : fractionData.money + Math.abs(priceDifference);
                            } catch (error) {
                                console.error('Error updating fraction money:', error);
                            }
                        }
                        
                        // Log the action
                        addAuditLog(
                            interaction.user.id,
                            'edit_item',
                            'purchase',
                            selectedItem,
                            JSON.stringify({
                                fractionName: fractionRole.name,
                                itemName: originalItem.name,
                                priceDifference: priceDifference,
                                modifications: selectedMods
                            })
                        );

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
                        // Get item price from database
                        let originalItemPrice = 0;
                        await new Promise((resolve) => {
                            db.get(
                                `SELECT shop_items.price 
                                 FROM purchases 
                                 JOIN shop_items ON purchases.item_id = shop_items.id 
                                 WHERE purchases.id = ?`,
                                [selectedItem],
                                (err, row) => {
                                    if (!err && row) {
                                        originalItemPrice = row.price;
                                    }
                                    resolve();
                                }
                            );
                        });
                        
                        const sellPrice = Math.floor(originalItemPrice * 0.9);
                        
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
                        // Get item price from database
                        let originalItemPrice = 0;
                        await new Promise((resolve) => {
                            db.get(
                                `SELECT shop_items.price 
                                 FROM purchases 
                                 JOIN shop_items ON purchases.item_id = shop_items.id 
                                 WHERE purchases.id = ?`,
                                [selectedItem],
                                (err, row) => {
                                    if (!err && row) {
                                        originalItemPrice = row.price;
                                    }
                                    resolve();
                                }
                            );
                        });
                        
                        const sellPrice = Math.floor(originalItemPrice * 0.9);

                        // Delete item from database
                        await new Promise((resolve) => {
                            db.run(
                                `DELETE FROM purchases WHERE id = ?`,
                                [selectedItem],
                                (err) => {
                                    if (err) {
                                        console.error('Error deleting item:', err);
                                    }
                                    resolve();
                                }
                            );
                        });

                        // Update fraction money
                        try {
                            await updateFractionMoney(fractionData.id, sellPrice, true); // Add money
                            fractionData.money += sellPrice; // Update local copy
                        } catch (error) {
                            console.error('Error updating fraction money:', error);
                        }

                        // Log the action
                        addAuditLog(
                            interaction.user.id,
                            'sell_item',
                            'purchase',
                            selectedItem,
                            JSON.stringify({
                                fractionName: fractionRole.name,
                                itemName: originalItem.name,
                                sellPrice: sellPrice
                            })
                        );

                        // Send confirmation message
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