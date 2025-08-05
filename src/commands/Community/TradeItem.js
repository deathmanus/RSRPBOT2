const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getEmoji } = require('../../utils/emojiUtils');
const fs = require('fs');
const path = require('path');
const { db, getFractionByName, getFractionItems, updateFractionMoney, addAuditLog } = require('../../Database/database');

// Modify the createItemMenus function
function createItemMenus(items, currentPage = 0) {
    const itemsPerPage = 24;
    const totalPages = Math.ceil(items.length / itemsPerPage);
    currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));
    
    const startIdx = currentPage * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    
    let options = [];
    
    if (totalPages > 1) {
        options.push({
            label: `Stránka ${currentPage + 1}/${totalPages}`,
            value: `page_${currentPage}`,
            description: `Aktuální stránka`,
            default: true
        });
    }
    
    options = options.concat(items.slice(startIdx, endIdx));
    
    return {
        options,
        currentPage,
        totalPages
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tradeitem')
        .setDescription('Vytvoří nabídku na prodej předmětu jiné frakci')
        .addNumberOption(option => 
            option.setName('price')
            .setDescription('Cena za kterou chcete předmět prodat')
            .setRequired(true)
            .setMinValue(0)),

    async execute(interaction) {
        try {
            // Check roles
            if (!interaction.member.roles.cache.some(role => 
                role.name.startsWith('Velitel') || role.name.startsWith('Zástupce')
            )) {
                return interaction.reply({ 
                    content: `${getEmoji('error')} Nemáš oprávnění použít tento příkaz! Pouze velitelé a zástupci frakcí mohou používat tento příkaz.`,
                    ephemeral: true 
                });
            }

            await interaction.deferReply();
            const price = interaction.options.getNumber('price');

            // Get seller's fraction
            const member = interaction.member;
            
            // Get all fractions from database
            const fractions = [];
            await new Promise((resolve) => {
                db.all(`SELECT name FROM fractions`, [], (err, rows) => {
                    if (!err && rows) {
                        rows.forEach(row => fractions.push(row.name));
                    }
                    resolve();
                });
            });

            const sellerFraction = member.roles.cache.find(role => fractions.includes(role.name))?.name;

            if (!sellerFraction) {
                return await interaction.editReply(`${getEmoji('error')} Nemáte přiřazenou žádnou frakci.`);
            }

            const buyerOptions = fractions
                .filter(fraction => fraction !== sellerFraction)
                .map(fraction => ({
                    label: fraction,
                    value: fraction
                }));

            if (buyerOptions.length === 0) {
                return await interaction.editReply({
                    ephemeral: true,
                    content: `${getEmoji('error')} Nejsou k dispozici žádné jiné frakce pro obchod.`,
                    embeds: [],
                    components: [],
                });
            }

            // Create buyer menu with limited options
            const buyerMenu = new StringSelectMenuBuilder()
                .setCustomId('select-buyer')
                .setPlaceholder('Vyberte frakci pro prodej')
                .addOptions(buyerOptions.slice(0, 25)); // Limit to 25 options

            const embed = new EmbedBuilder()
                .setTitle(`${getEmoji('trade')} Prodej předmětu`)
                .setDescription(`Prodávající frakce: ${sellerFraction}\nCena: ${price} ${getEmoji('money')}`)
                .setColor(0x0099FF);

            const message = await interaction.editReply({
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(buyerMenu)]
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            });

            let selectedBuyer = null;
            let selectedItem = null;
            let selectedCount = null;

            collector.on('collect', async i => {
                try {
                    // Inside the select-buyer handler
                    if (i.customId === 'select-buyer') {
                        try {
                            await i.deferUpdate();
                            selectedBuyer = i.values[0];
                            
                            // Get seller's items from database
                            let fractionItems = [];
                            await new Promise((resolve) => {
                                getFractionItems(sellerFraction, (err, items) => {
                                    if (!err && items) {
                                        fractionItems = items;
                                    }
                                    resolve();
                                });
                            });
                            
                            const itemOptions = [];
                            let hasItems = fractionItems.length > 0;
                            
                            // Organize items by section
                            const sectionMap = {};
                            fractionItems.forEach(item => {
                                let section = 'Other';
                                if (item.type === 'air_vehicle') section = 'Air vehicles';
                                else if (item.type === 'ground_vehicle') section = 'Ground vehicles';
                                else if (item.type === 'equipment') section = 'Equipment';
                                else if (item.type === 'resource') section = 'Resources';
                                
                                if (!sectionMap[section]) {
                                    sectionMap[section] = [];
                                }
                                
                                sectionMap[section].push({
                                    label: `${item.name} (ID: ${item.id})`,
                                    value: `${section}:${item.id}:${item.name}`,
                                    description: `Typ: ${item.type}`
                                });
                            });
                            
                            // Add items to options (up to 25 items)
                            Object.entries(sectionMap).forEach(([section, items]) => {
                                if (itemOptions.length < 23) { // Leave room for navigation
                                    const sectionItems = items.slice(0, 23 - itemOptions.length);
                                    itemOptions.push(...sectionItems);
                                }
                            });
                            
                            if (!hasItems) {
                                return await i.editReply({
                                    content: `${getEmoji('error')} Vaše frakce nemá žádné předměty k prodeji.`,
                                    embeds: [],
                                    components: []
                                });
                            }
                            
                            const { options, currentPage, totalPages } = createItemMenus(itemOptions);
                            
                            if (options.length === 0) {
                                return await i.editReply({
                                    content: `${getEmoji('error')} Žádné předměty k zobrazení.`,
                                    embeds: [],
                                    components: []
                                });
                            }
                            
                            const itemMenu = new StringSelectMenuBuilder()
                                .setCustomId('select-item')
                                .setPlaceholder('Vyberte předmět k prodeji')
                                .addOptions(options);
                            
                            embed.setDescription(
                                `Prodávající frakce: ${sellerFraction}\n` +
                                `Kupující frakce: ${selectedBuyer}\n` +
                                `Cena: ${price} ${getEmoji('money')}`
                            );
                            
                            if (totalPages > 1) {
                                embed.setFooter({ text: `Stránka ${currentPage + 1}/${totalPages}` });
                            }
                            
                            await i.editReply({
                                embeds: [embed],
                                components: [
                                    new ActionRowBuilder().addComponents(
                                        new StringSelectMenuBuilder(buyerMenu.data)
                                            .setOptions(buyerOptions)
                                            .spliceOptions(0, buyerOptions.length, ...buyerOptions.map(opt => ({
                                                ...opt,
                                                default: opt.value === selectedBuyer
                                            })))
                                    ),
                                    new ActionRowBuilder().addComponents(itemMenu)
                                ]
                            });
                        } catch (error) {
                            console.error('Error in select-buyer handler:', error);
                            await i.editReply({
                                content: `${getEmoji('error')} Nastala chyba při zpracování požadavku.`,
                                components: []
                            });
                        }
                    }
                    // Inside select-item handler
                    else if (i.customId === 'select-item') {
                        if (i.values[0].startsWith('page_')) {
                            await i.deferUpdate();
                            const newPage = parseInt(i.values[0].split('_')[1]);
                            const { options, currentPage, totalPages } = createItemMenus(itemOptions, newPage);
                    
                            const itemMenu = new StringSelectMenuBuilder()
                                .setCustomId('select-item')
                                .setPlaceholder('Vyberte předmět k prodeji')
                                .addOptions(options);
                    
                            embed.setDescription(
                                `Prodávající frakce: ${sellerFraction}\n` +
                                `Kupující frakce: ${selectedBuyer}\n` +
                                `Cena: ${price} ${getEmoji('money')}\n` +
                                `Stránka ${currentPage + 1}/${totalPages}`
                            );
                    
                            await i.editReply({
                                embeds: [embed],
                                components: [
                                    new ActionRowBuilder().addComponents(
                                        new StringSelectMenuBuilder(buyerMenu.data)
                                            .setOptions(buyerOptions)
                                            .spliceOptions(0, buyerOptions.length, ...buyerOptions.map(opt => ({
                                                ...opt,
                                                default: opt.value === selectedBuyer
                                            })))
                                    ),
                                    new ActionRowBuilder().addComponents(itemMenu)
                                ]
                            });
                        } else {
                            await i.deferUpdate();
                            const [section, itemId, itemName] = i.values[0].split(':');
                            
                            // Get item data from database
                            let itemData = null;
                            await new Promise((resolve) => {
                                db.get(
                                    `SELECT purchases.*, shop_items.* 
                                     FROM purchases 
                                     JOIN shop_items ON purchases.item_id = shop_items.id 
                                     WHERE purchases.id = ?`,
                                    [itemId],
                                    (err, row) => {
                                        if (!err && row) {
                                            itemData = row;
                                        }
                                        resolve();
                                    }
                                );
                            });
                            
                            if (!itemData) {
                                return await i.editReply({
                                    content: `${getEmoji('error')} Předmět nebyl nalezen v databázi.`,
                                    components: []
                                });
                            }
                            
                            selectedItem = { 
                                id: itemData.id,
                                name: itemData.name,
                                type: itemData.type,
                                count: itemData.count || 1,
                                selectedMods: itemData.selected_mods ? JSON.parse(itemData.selected_mods) : [],
                                price: itemData.base_price
                            };
                        
                            if (itemData.type === 'countable') {
                                const countMenu = new StringSelectMenuBuilder()
                                    .setCustomId('select-count')
                                    .setPlaceholder('Vyberte množství')
                                    .addOptions(
                                        Array.from({ length: Math.min(25, itemData.count) }, (_, i) => i + 1)
                                            .map(num => ({
                                                label: `${num}x (${num * price} ${getEmoji('money')})`,
                                                value: num.toString()
                                            }))
                                    );
                        
                                embed.setDescription(
                                    `Prodávající frakce: ${sellerFraction}\n` +
                                    `Kupující frakce: ${selectedBuyer}\n` +
                                    `Předmět: ${itemData.name}\n` +
                                    `Dostupné množství: ${itemData.count}\n` +
                                    `Cena: ${price} ${getEmoji('money')}`
                                );
                        
                                await i.editReply({
                                    embeds: [embed],
                                    components: [
                                        new ActionRowBuilder().addComponents(countMenu)
                                    ]
                                });
                            } else {
                                selectedCount = 1;
                                const confirmButton = new ButtonBuilder()
                                    .setCustomId('confirm-trade')
                                    .setLabel('Odeslat nabídku')
                                    .setStyle(ButtonStyle.Success);
                        
                                const cancelButton = new ButtonBuilder()
                                    .setCustomId('cancel-trade')
                                    .setLabel('Zrušit')
                                    .setStyle(ButtonStyle.Danger);
                        
                                embed.setDescription(
                                    `Prodávající frakce: ${sellerFraction}\n` +
                                    `Kupující frakce: ${selectedBuyer}\n` +
                                    `Předmět: ${itemData.name}\n` +
                                    `Cena: ${price} ${getEmoji('money')}`
                                );
                        
                                if (selectedItem.selectedMods && selectedItem.selectedMods.length > 0) {
                                    const modFields = selectedItem.selectedMods
                                        .filter(mod => mod && mod.modName)
                                        .map(mod => ({
                                            name: mod.modName,
                                            value: `${mod.selected.split(':')[1]}${
                                                mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                                                    '\n' + Object.entries(mod.subSelections)
                                                        .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') 
                                                    : ''
                                            }`
                                        }));
                                    
                                    if (modFields.length > 0) {
                                        embed.addFields(modFields);
                                    }
                                }
                        
                                await i.editReply({
                                    embeds: [embed],
                                    components: [
                                        new ActionRowBuilder().addComponents(confirmButton, cancelButton)
                                    ]
                                });
                            }
                        }
                    }
                    else if (i.customId === 'select-count') {
                        await i.deferUpdate();
                        selectedCount = parseInt(i.values[0]);
                        
                        const confirmButton = new ButtonBuilder()
                            .setCustomId('confirm-trade')
                            .setLabel('Odeslat nabídku')
                            .setStyle(ButtonStyle.Success);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel-trade')
                            .setLabel('Zrušit')
                            .setStyle(ButtonStyle.Danger);

                        embed.setDescription(
                            `Prodávající frakce: ${sellerFraction}\n` +
                            `Kupující frakce: ${selectedBuyer}\n` +
                            `Předmět: ${selectedItem.name}\n` +
                            `Množství: ${selectedCount}x\n` +
                            `Cena: ${price} ${getEmoji('money')}`
                        );

                        await i.editReply({
                            embeds: [embed],
                            components: [
                                new ActionRowBuilder().addComponents(confirmButton, cancelButton)
                            ]
                        });
                    }
                    else if (i.customId === 'confirm-trade') {
                        await i.deferUpdate();
                        // Create trade offer
                        const tradeId = Date.now().toString(36) + Math.random().toString(36).substr(2);
                        const tradeData = {
                            id: tradeId,
                            seller: sellerFraction,
                            buyer: selectedBuyer,
                            item: selectedItem,
                            count: selectedCount,
                            price: price,
                            status: 'pending',
                            createdAt: new Date().toISOString(),
                            createdBy: interaction.user.tag
                        };
                        
                        try {
                            // Uložit obchodní nabídku do databáze
                            await createTrade(tradeData);
                            
                            // Přidat audit log
                            addAuditLog(
                                interaction.user.id,
                                'create_trade',
                                'trade',
                                tradeId,
                                JSON.stringify({
                                    seller: sellerFraction,
                                    buyer: selectedBuyer,
                                    itemId: selectedItem.id,
                                    itemName: selectedItem.name,
                                    count: selectedCount,
                                    price: price
                                })
                            );
                        
                            const tradeEmbed = new EmbedBuilder()
                                .setTitle(`${getEmoji('trade')} Nová obchodní nabídka`)
                                .setDescription(
                                    `Frakce **${sellerFraction}** nabízí frakci **${selectedBuyer}** následující předmět:`
                                )
                                .setColor(0x00FF00)
                                .addFields(
                                    { name: 'Předmět', value: selectedItem.name, inline: true },
                                    { name: 'Cena', value: `${price} ${getEmoji('money')}`, inline: true }
                                );

                            // Přidat pole podle typu předmětu
                            if (selectedItem.type === 'countable') {
                                tradeEmbed.addFields({
                                    name: 'Množství',
                                    value: `${selectedCount}x`,
                                    inline: true
                                });
                            } else if (selectedItem.selectedMods && selectedItem.selectedMods.length > 0) {
                                // Přidat modifikace pokud existují
                                const modFields = selectedItem.selectedMods
                                    .filter(mod => mod && mod.modName)
                                    .map(mod => ({
                                        name: mod.modName,
                                        value: `${mod.selected.split(':')[1]}${
                                            mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                                                '\n' + Object.entries(mod.subSelections)
                                                    .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') 
                                                : ''
                                        }`
                                    }));

                                if (modFields.length > 0) {
                                    tradeEmbed.addFields(modFields);
                                }
                            }

                            tradeEmbed.setFooter({ text: `Trade ID: ${tradeId}` });
                        
                            const acceptButton = new ButtonBuilder()
                                .setCustomId(`accept-trade:${tradeId}`)
                                .setLabel('Přijmout')
                                .setStyle(ButtonStyle.Success);
                        
                            const declineButton = new ButtonBuilder()
                                .setCustomId(`decline-trade:${tradeId}`)
                                .setLabel('Odmítnout')
                                .setStyle(ButtonStyle.Danger);
                        
                            const tradeMessage = await interaction.channel.send({
                                content: `<@&${interaction.guild.roles.cache.find(r => r.name === selectedBuyer).id}>`,
                                embeds: [tradeEmbed],
                                components: [new ActionRowBuilder().addComponents(acceptButton, declineButton)]
                            });
                        
                            await i.editReply({
                                content: `${getEmoji('success')} Obchodní nabídka byla úspěšně odeslána.`,
                                embeds: [],
                                components: []
                            });
                        
                            collector.stop();
                        } catch (error) {
                            console.error('Error creating trade:', error);
                            await i.editReply({
                                content: `${getEmoji('error')} Nastala chyba při vytváření obchodní nabídky.`,
                                embeds: [],
                                components: []
                            });
                        }
                    }
                    else if (i.customId === 'cancel-trade') {
                        await i.deferUpdate();
                        await i.editReply({
                            content: `${getEmoji('error')} Obchodní nabídka byla zrušena.`,
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                    }
                    } catch (error) {
                        console.error('Error in trade collector:', error);
                        if (!i.replied && !i.deferred) {
                            await i.reply({
                                content: `${getEmoji('error')} Nastala chyba při zpracování požadavku.`,
                                ephemeral: true
                            });
                        } else {
                            await i.editReply({
                                content: `${getEmoji('error')} Nastala chyba při zpracování požadavku.`,
                                components: []
                            });
                        }
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
            console.error('Error in tradeitem command:', error);
            await interaction.editReply({
                content: `${getEmoji('error')} Nastala chyba při zpracování příkazu.`,
                components: []
            });
        }
    }
};