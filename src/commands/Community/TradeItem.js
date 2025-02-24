const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getEmoji } = require('../../utils/emojiUtils');
const fs = require('fs');
const path = require('path');

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
            const fractionPath = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

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
                            
                            const sellerItemsPath = path.join(fractionPath, sellerFraction);
                            const sections = fs.readdirSync(sellerItemsPath, { withFileTypes: true })
                                .filter(dirent => dirent.isDirectory())
                                .map(dirent => dirent.name);
                        
                            const itemOptions = [];
                            let hasItems = false;
                        
                            // Get first 25 items only
                            for (const section of sections) {
                                if (itemOptions.length >= 23) break; // Leave room for navigation
                                
                                const sectionPath = path.join(sellerItemsPath, section);
                                const items = fs.readdirSync(sectionPath)
                                    .filter(file => file.endsWith('.json'))
                                    .map(file => {
                                        try {
                                            const itemData = JSON.parse(fs.readFileSync(path.join(sectionPath, file)));
                                            const shopSectionPath = path.join(__dirname, '../../files/Shop', section);
                                            
                                            if (!fs.existsSync(shopSectionPath)) return null;
                                            
                                            const shopFiles = fs.readdirSync(shopSectionPath)
                                                .filter(f => f.endsWith('.json'));
                                            
                                            // ... rest of item loading logic
                                        } catch (error) {
                                            console.error(`Error loading item ${file}:`, error);
                                            return null;
                                        }
                                    })
                                    .filter(item => item !== null);
                                    
                                itemOptions.push(...items);
                            }
                        
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
                        
                            // ... rest of the code
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
                            const [section, file, shopFile] = i.values[0].split(':');
                            const itemPath = path.join(fractionPath, sellerFraction, section, file);
                            const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                            const originalItemPath = path.join(__dirname, '../../files/Shop', section, shopFile);
                            const originalItemData = JSON.parse(fs.readFileSync(originalItemPath, 'utf8'));
                            
                            selectedItem = { 
                                ...itemData,
                                type: originalItemData.type,
                                section,
                                file 
                            };
                        
                            if (originalItemData.type === 'countable') {
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
                        
                                if (itemData.selectedMods) {
                                    const modFields = itemData.selectedMods
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
                    
                        const tradesPath = path.join(__dirname, '../../files/Trades');
                        if (!fs.existsSync(tradesPath)) {
                            fs.mkdirSync(tradesPath, { recursive: true });
                        }
                    
                        fs.writeFileSync(
                            path.join(tradesPath, `${tradeId}.json`),
                            JSON.stringify(tradeData, null, 2)
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
                        } else if (selectedItem.selectedMods) {
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