const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

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
            await interaction.deferReply({ ephemeral: true });

            const price = interaction.options.getNumber('price');
            const fractionPath = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            // Remove seller's fraction from options
            const sellerFraction = interaction.member.roles.cache
                .find(role => fractions.includes(role.name))?.name;

            if (!sellerFraction) {
                return await interaction.editReply('❌ Nemáte přiřazenou žádnou frakci.');
            }

            const buyerOptions = fractions
                .filter(fraction => fraction !== sellerFraction)
                .map(fraction => ({
                    label: fraction,
                    value: fraction
                }));

            const buyerMenu = new StringSelectMenuBuilder()
                .setCustomId('select-buyer')
                .setPlaceholder('Vyberte frakci pro prodej')
                .addOptions(buyerOptions);

            const embed = new EmbedBuilder()
                .setTitle('Prodej předmětu')
                .setDescription(`Prodávající frakce: ${sellerFraction}\nCena: ${price}$`)
                .setColor(0x0099FF);

            await interaction.editReply({
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(buyerMenu)]
            });

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
                    if (i.customId === 'select-buyer') {
                        await i.deferUpdate();
                        selectedBuyer = i.values[0];
                        
                        // Load seller's items
                        const sellerItemsPath = path.join(fractionPath, sellerFraction);
                        const sections = fs.readdirSync(sellerItemsPath, { withFileTypes: true })
                            .filter(dirent => dirent.isDirectory())
                            .map(dirent => dirent.name);
                    
                        const itemOptions = [];
                        let hasItems = false;

                        for (const section of sections) {
                            const sectionPath = path.join(sellerItemsPath, section);
                            const items = fs.readdirSync(sectionPath)
                                .filter(file => file.endsWith('.json'))
                                .map(file => {
                                    try {
                                        const itemData = JSON.parse(fs.readFileSync(path.join(sectionPath, file)));
                                        // Get all shop files in the section
                                        const shopSectionPath = path.join(__dirname, '../../files/Shop', section);
                                        const shopFiles = fs.readdirSync(shopSectionPath)
                                            .filter(f => f.endsWith('.json'));
                                        
                                        // Find matching shop file by name (case insensitive)
                                        const shopFile = shopFiles.find(f => {
                                            const shopItemData = JSON.parse(fs.readFileSync(path.join(shopSectionPath, f)));
                                            return shopItemData.name.toLowerCase() === itemData.name.toLowerCase();
                                        });

                                        if (!shopFile) {
                                            console.warn(`Shop file not found for item: ${itemData.name}`);
                                            return null;
                                        }

                                        const originalItemData = JSON.parse(
                                            fs.readFileSync(path.join(shopSectionPath, shopFile), 'utf8')
                                        );

                                        hasItems = true;
                                        return {
                                            label: `${itemData.name} ${originalItemData.type === 'countable' ? `(${itemData.count}x)` : ''}`,
                                            value: `${section}:${file}:${shopFile}`, // Store shop file name for later
                                            description: originalItemData.type === 'countable' ? 'Množstevní předmět' : 'Předmět s modifikacemi'
                                        };
                                    } catch (error) {
                                        console.error(`Error loading item ${file}:`, error);
                                        return null;
                                    }
                                })
                                .filter(item => item !== null); // Remove any failed items
                            itemOptions.push(...items);
                        }

                        if (!hasItems) {
                            await i.editReply({
                                content: '❌ Vaše frakce nemá žádné předměty k prodeji.',
                                embeds: [],
                                components: []
                            });
                            collector.stop();
                            return;
                        }
                    
                        const itemMenu = new StringSelectMenuBuilder()
                            .setCustomId('select-item')
                            .setPlaceholder('Vyberte předmět k prodeji')
                            .addOptions(itemOptions);
                    
                        embed.setDescription(
                            `Prodávající frakce: ${sellerFraction}\n` +
                            `Kupující frakce: ${selectedBuyer}\n` +
                            `Cena: ${price}$`
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
                    }
                    // Inside select-item handler
                    else if (i.customId === 'select-item') {
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
                                            label: `${num}x`,
                                            value: num.toString()
                                        }))
                                );
                    
                            embed.setDescription(
                                `Prodávající frakce: ${sellerFraction}\n` +
                                `Kupující frakce: ${selectedBuyer}\n` +
                                `Předmět: ${itemData.name}\n` +
                                `Dostupné množství: ${itemData.count}\n` +
                                `Cena: ${price}$`
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
                                `Cena: ${price}$`
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
                            `Cena: ${price}$`
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
                            .setTitle('🤝 Nová obchodní nabídka')
                            .setDescription(
                                `Frakce **${sellerFraction}** nabízí frakci **${selectedBuyer}** následující předmět:`
                            )
                            .setColor(0x00FF00)
                            .addFields(
                                { name: 'Předmět', value: selectedItem.name, inline: true },
                                { name: 'Cena', value: `${price}$`, inline: true }
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
                            content: '✅ Obchodní nabídka byla úspěšně odeslána.',
                            embeds: [],
                            components: []
                        });
                    
                        collector.stop();
                    }
                    else if (i.customId === 'cancel-trade') {
                        await i.deferUpdate();
                        await i.editReply({
                            content: '❌ Obchodní nabídka byla zrušena.',
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                    }
                    } catch (error) {
                        console.error('Error in trade collector:', error);
                        if (!i.replied && !i.deferred) {
                            await i.reply({
                                content: '❌ Nastala chyba při zpracování požadavku.',
                                ephemeral: true
                            });
                        } else {
                            await i.editReply({
                                content: '❌ Nastala chyba při zpracování požadavku.',
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
                content: '❌ Nastala chyba při zpracování příkazu.',
                components: []
            });
        }
    }
};