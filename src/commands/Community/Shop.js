const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Helper function for logging with timestamps
const logShop = (action, data) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[SHOP LOG - ${timestamp}]`);
    console.log(`Action: ${action}`);
    console.log('Data:', JSON.stringify(data, null, 2));
    console.log('-'.repeat(50));
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Procházet obchod a vybírat položky k nákupu.'),
    async execute(interaction) {
        try {
            logShop('Command Started', {
                user: interaction.user.tag,
                userId: interaction.user.id,
                channel: interaction.channel.name,
                guildId: interaction.guildId
            });

            await interaction.deferReply({ flags: 64 });

            const shopDir = path.join(__dirname, '../../files/Shop');
            const sections = fs.readdirSync(shopDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            logShop('Loaded Shop Sections', { sections });

            if (sections.length === 0) {
                logShop('Error', 'No shop sections available');
                return await interaction.followUp({ content: '❌ Žádné sekce obchodu k zobrazení.', flags: 64 });
            }

            let selectedSection = null;
            let selectedItem = null;
            let selectedMods = [];
            let itemState = null;

            const createSectionMenu = (selected = null) => {
                return new StringSelectMenuBuilder()
                    .setCustomId('select-shop-section')
                    .setPlaceholder('Vyberte sekci obchodu')
                    .addOptions(sections.map(section => ({
                        label: section,
                        value: section,
                        default: section === selected
                    })));
            };

            const row = new ActionRowBuilder().addComponents(createSectionMenu());
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Obchod')
                .setDescription('Vyberte sekci obchodu z dropdown menu.');

            const message = await interaction.editReply({ 
                embeds: [embed], 
                components: [row]
            });

            logShop('Initial Shop Menu Created', {
                type: 'section_select',
                available_sections: sections
            });

            const collector = message.createMessageComponentCollector({ 
                filter: i => i.user.id === interaction.user.id,
                time: 300000 
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    if (i.customId === 'select-shop-section') {
                        selectedSection = i.values[0];
                        logShop('Section Selected', { selectedSection });

                        const sectionDir = path.join(shopDir, selectedSection);
                        const items = fs.readdirSync(sectionDir, { withFileTypes: true })
                            .filter(dirent => dirent.isFile() && dirent.name.endsWith('.json'))
                            .map(dirent => dirent.name.replace('.json', ''));

                        logShop('Items Loaded', { 
                            section: selectedSection,
                            availableItems: items 
                        });

                        const itemMenu = new StringSelectMenuBuilder()
                            .setCustomId('select-shop-item')
                            .setPlaceholder('Vyberte položku k zobrazení')
                            .addOptions(items.map(item => ({
                                label: item,
                                value: item
                            })));

                        const sectionEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`Sekce: ${selectedSection}`)
                            .setDescription('Vyberte položku z dropdown menu.');

                        await i.editReply({
                            embeds: [sectionEmbed],
                            components: [
                                new ActionRowBuilder().addComponents(createSectionMenu(selectedSection)),
                                new ActionRowBuilder().addComponents(itemMenu)
                            ]
                        });
                    }
                    else if (i.customId === 'select-shop-item') {
                        selectedItem = i.values[0];
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));

                        switch (itemData.type) {
                            case 'countable':
                                const countDisplay = createCountableDisplay(itemData);
                                await i.editReply({
                                    embeds: [countDisplay.embed],
                                    components: countDisplay.components
                                });
                                itemState = { type: 'countable', selectedCount: 1 };
                                break;

                            case 'modifiable':
                                // Existing modifiable item code...
                                selectedMods = Object.entries(itemData.modifications).map(([modName, modValues]) => {
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

                                const { pages, totalModifications } = createModificationPages(itemData.modifications, selectedMods);
                                collector.pages = pages;
                                collector.currentPage = 0;
                                
                                const display = updateModificationDisplay(i, itemData, selectedMods, 0);
                                await i.editReply(display);
                                itemState = { type: 'modifiable', selectedMods };
                                break;

                            default:
                                await i.editReply({
                                    content: '❌ Neplatný typ předmětu.',
                                    components: []
                                });
                                return;
                        }
                    }
                    else if (i.customId.startsWith('select-mod-')) {
                        const modIndex = parseInt(i.customId.split('-')[2], 10);
                        const [modName, optName, optPrice] = i.values[0].split(':');
                    
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const { modifications } = itemData;
                    
                        // Update the selected modification
                        selectedMods[modIndex] = {
                            ...selectedMods[modIndex],
                            modName,
                            selected: `${modName}:${optName}:${optPrice}`,
                            subSelections: {} // Reset sub-selections when changing main selection
                        };
                    
                        // Get the selected option's subOptions if any
                        const selectedModification = modifications[modName];
                        const selectedOption = selectedModification.find(opt => opt.name === optName);
                        if (selectedOption?.subOptions) {
                            Object.entries(selectedOption.subOptions).forEach(([subName, subValues]) => {
                                selectedMods[modIndex].subSelections[subName] = {
                                    name: subValues[0].name,
                                    price: subValues[0].price || 0
                                };
                            });
                        }
                    
                        const display = updateModificationDisplay(i, itemData, selectedMods, collector.currentPage || 0);
                        await i.editReply(display);
                    }
                    else if (i.customId.startsWith('select-submod-')) {
                        const parts = i.customId.split('-');
                        const modIndex = parseInt(parts[2], 10);  // Changed from parts[1]
                        const subModName = parts[3];  // Changed from parts[2]
                        const [subMod, optName, optPrice] = i.values[0].split(':');
                    
                        logShop('Sub-Modification Attempt', {
                            modIndex,
                            subModName,
                            subMod,
                            optName,
                            optPrice,
                            currentMods: selectedMods
                        });
                    
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const { name, basePrice, modifications } = itemData;
                    
                        // Validate modIndex
                        if (typeof modIndex !== 'number' || !selectedMods[modIndex]) {
                            logShop('Error', {
                                message: 'Invalid modification index',
                                modIndex,
                                selectedMods
                            });
                            throw new Error('Invalid modification index');
                        }
                    
                        // Get main modification details
                        const mainModName = selectedMods[modIndex].modName;
                        const mainOptName = selectedMods[modIndex].selected.split(':')[1];
                        const mainMod = modifications[mainModName];
                        const selectedMainOpt = mainMod.find(opt => opt.name === mainOptName);
                    
                        // Validate sub-modification exists
                        if (!selectedMainOpt?.subOptions?.[subMod]) {
                            logShop('Error', {
                                message: 'Invalid sub-modification',
                                mainModName,
                                mainOptName,
                                subMod,
                                availableSubMods: selectedMainOpt?.subOptions
                            });
                            throw new Error('Invalid sub-modification configuration');
                        }
                    
                        // Find the selected sub-option
                        const subOpt = selectedMainOpt.subOptions[subMod].find(opt => opt.name === optName);
                        if (!subOpt) {
                            logShop('Error', {
                                message: 'Sub-option not found',
                                subMod,
                                optName,
                                availableOptions: selectedMainOpt.subOptions[subMod]
                            });
                            throw new Error('Sub-option not found');
                        }
                    
                        // Update the sub-selection
                        selectedMods[modIndex].subSelections[subMod] = {
                            name: optName,
                            price: Number(subOpt.price) || 0
                        };
                    
                        logShop('Sub-Modification Selected', {
                            modIndex,
                            mainMod: mainModName,
                            subModName: subMod,
                            optName,
                            price: subOpt.price,
                            updatedMod: selectedMods[modIndex]
                        });
                    
                        const display = updateModificationDisplay(i, itemData, selectedMods, collector.currentPage || 0);
                        await i.editReply(display);
                    }
                    else if (i.customId === 'prev-page' || i.customId === 'next-page') {
                        const direction = i.customId === 'next-page' ? 1 : -1;
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                    
                        // Get current pages structure
                        const { pages, totalModifications } = createModificationPages(itemData.modifications, selectedMods);
                        
                        // Update current page with bounds checking
                        collector.currentPage = Math.max(0, Math.min(pages.length - 1, (collector.currentPage || 0) + direction));
                    
                        const display = updateModificationDisplay(i, itemData, selectedMods, collector.currentPage);
                        await i.editReply(display);
                    }
                    else if (i.customId === 'select-count') {
                        const count = parseInt(i.values[0]);
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        
                        itemState.selectedCount = count;
                        const countDisplay = createCountableDisplay(itemData, count);
                        
                        await i.editReply({
                            embeds: [countDisplay.embed],
                            components: countDisplay.components
                        });
                    }
                    else if (i.customId === 'buy-item') {
                        try {
                            // Kontrola členství ve frakci
                            const member = interaction.member;
                            const fractionRole = member.roles.cache.find(role => 
                                fs.existsSync(path.join(__dirname, '../../files/Fractions', role.name)));
                            
                            if (!fractionRole) {
                                return await i.editReply({
                                    content: '❌ Nejste členem žádné frakce.',
                                    components: [],
                                    embeds: []
                                });
                            }

                            const isLeader = member.roles.cache.some(role => role.name.startsWith('Velitel'));
                            const isDeputy = member.roles.cache.some(role => role.name.startsWith('Zástupce'));

                            if (!isLeader && !isDeputy) {
                                return await i.editReply({
                                content: '❌ Pouze velitelé a zástupci frakcí mohou nakupovat.',
                                components: [],
                                embeds: []
                            });
                    }

                    
                            const fractionPath = path.join(__dirname, '../../files/Fractions', fractionRole.name);
                            const fractionData = JSON.parse(fs.readFileSync(path.join(fractionPath, `${fractionRole.name}.json`)));
                    
                            const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                            const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                            const { name, basePrice, maxCount } = itemData;

                            // For countable items, check current count and limits
                            if (itemData.type === 'countable') {
                                // Get all existing items of this type in the fraction
                                const fractionSectionPath = path.join(fractionPath, selectedSection);
                                let currentCount = 0;
                    
                                if (fs.existsSync(fractionSectionPath)) {
                                    const existingFiles = fs.readdirSync(fractionSectionPath)
                                        .filter(file => file.endsWith('.json'));
                    
                                    for (const file of existingFiles) {
                                        const existingItem = JSON.parse(
                                            fs.readFileSync(path.join(fractionSectionPath, file))
                                        );
                                        if (existingItem.name === name) {
                                            currentCount += existingItem.count || 0;
                                        }
                                    }
                                }
                    
                                // Check if new purchase would exceed limit
                                const newTotalCount = currentCount + itemState.selectedCount;
                                if (newTotalCount > maxCount) {
                                    return await i.editReply({
                                        content: `❌ Nelze zakoupit. Limit pro tento item je ${maxCount} ks.\nAktuálně máte: ${currentCount} ks\nMůžete ještě koupit: ${Math.max(0, maxCount - currentCount)} ks`,
                                        components: [],
                                        embeds: []
                                    });
                                }
                            }
                    
                            let totalPrice = 0;
                            let purchaseDescription = '';

                            switch (itemData.type) {
                                case 'countable':
                                    totalPrice = itemData.basePrice * itemState.selectedCount;
                                    purchaseDescription = `${itemState.selectedCount}x ${itemData.name}`;
                                    break;

                                case 'modifiable':
                                    totalPrice = calculateTotalPrice(itemData.basePrice, itemState.selectedMods);
                                    purchaseDescription = `${itemData.name} s modifikacemi`;
                                    break;
                            }
                    
                            // Kontrola financí frakce
                            if (fractionData.money < totalPrice) {
                                return await i.editReply({
                                    content: `❌ Vaše frakce nemá dostatek peněz. Potřebujete: ${totalPrice}$, máte: ${fractionData.money}$`,
                                    components: [],
                                    embeds: []
                                });
                            }
                    
                            const selectedOptions = selectedMods.map(mod => {
                                const modInfo = [];
                                if (mod?.selected) {
                                    const [modName, optName] = mod.selected.split(':');
                                    modInfo.push(`${modName}: ${optName}`);
                    
                                    if (mod.subSelections) {
                                        Object.entries(mod.subSelections).forEach(([subName, subOpt]) => {
                                            modInfo.push(`  ${subName}: ${subOpt.name}`);
                                        });
                                    }
                                }
                                return modInfo.join('\n');
                            }).filter(Boolean);
                    
                            // Vytvoření potvrzovacího embedu
                            const confirmEmbed = new EmbedBuilder()
                                .setColor(0xFFAA00)
                                .setTitle('🛍️ Potvrzení nákupu')
                                .setDescription(`**Opravdu chcete koupit tento předmět?**`)
                                .addFields(
                                    { name: 'Položka', value: name, inline: true },
                                    { name: 'Sekce', value: selectedSection, inline: true },
                                    { name: 'Celková cena', value: `${totalPrice} $`, inline: true },
                                    { name: 'Vybrané možnosti', value: selectedOptions.length > 0 ? selectedOptions.join('\n') : 'Žádné možnosti' },
                                    { name: 'Stav účtu frakce', value: `Současný: ${fractionData.money}$\nPo nákupu: ${fractionData.money - totalPrice}$` }
                                );
                    
                            const confirmRow = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('confirm-purchase')
                                        .setLabel('Potvrdit')
                                        .setStyle(ButtonStyle.Success),
                                    new ButtonBuilder()
                                        .setCustomId('cancel-purchase')
                                        .setLabel('Zrušit')
                                        .setStyle(ButtonStyle.Danger)
                                );
                    
                            await i.editReply({
                                embeds: [confirmEmbed],
                                components: [confirmRow]
                            });
                    
                            // Collector pro potvrzení
                            const confirmCollector = i.message.createMessageComponentCollector({
                                filter: response => response.user.id === interaction.user.id,
                                time: 30000,
                                max: 1
                            });
                    
                            confirmCollector.on('collect', async confirm => {
                                if (confirm.customId === 'confirm-purchase') {
                                    try {
                                        const fractionSectionPath = path.join(fractionPath, selectedSection);
                                        if (!fs.existsSync(fractionSectionPath)) {
                                            fs.mkdirSync(fractionSectionPath, { recursive: true });
                                        }
                            
                                        let purchaseData;
                                        let uniqueId;
                            
                                        if (itemData.type === 'countable') {
                                            const existingFiles = fs.readdirSync(fractionSectionPath)
                                                .filter(file => file.endsWith('.json'));
                                            
                                            let existingItem = null;
                                            let existingItemPath = null;
                            
                                            for (const file of existingFiles) {
                                                const itemPath = path.join(fractionSectionPath, file);
                                                const item = JSON.parse(fs.readFileSync(itemPath));
                                                
                                                if (item.name === name && item.basePrice === basePrice) {
                                                    existingItem = item;
                                                    existingItemPath = itemPath;
                                                    uniqueId = file.replace('.json', ''); // Get existing ID
                                                    break;
                                                }
                                            }
                            
                                            if (existingItem) {
                                                // Update existing item
                                                existingItem.count += itemState.selectedCount;
                                                existingItem.totalPrice = existingItem.count * basePrice;
                                                fs.writeFileSync(existingItemPath, JSON.stringify(existingItem, null, 2));
                                                purchaseData = existingItem;
                                            } else {
                                                // Create new item
                                                uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2);
                                                purchaseData = {
                                                    id: uniqueId,
                                                    name,
                                                    basePrice,
                                                    count: itemState.selectedCount,
                                                    totalPrice: itemData.basePrice * itemState.selectedCount,
                                                    purchaseDate: new Date().toISOString(),
                                                    buyer: interaction.user.tag
                                                };
                            
                                                fs.writeFileSync(
                                                    path.join(fractionSectionPath, `${uniqueId}.json`),
                                                    JSON.stringify(purchaseData, null, 2)
                                                );
                                            }
                                        } else {
                                            // Handle modifiable items
                                            uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2);
                                            purchaseData = {
                                                id: uniqueId,
                                                name,
                                                basePrice,
                                                selectedMods,
                                                totalPrice,
                                                purchaseDate: new Date().toISOString(),
                                                buyer: interaction.user.tag
                                            };
                            
                                            fs.writeFileSync(
                                                path.join(fractionSectionPath, `${uniqueId}.json`),
                                                JSON.stringify(purchaseData, null, 2)
                                            );
                                        }
                            
                                        // Update fraction money
                                        fractionData.money -= totalPrice;
                                        fs.writeFileSync(
                                            path.join(fractionPath, `${fractionRole.name}.json`),
                                            JSON.stringify(fractionData, null, 2)
                                        );
                            
                                        // Create purchase confirmation embed with updated information
                                        const purchaseEmbed = new EmbedBuilder()
                                            .setColor(0x00FF00)
                                            .setTitle('✅ Nákup dokončen')
                                            .setDescription(`**${interaction.user.tag}** zakoupil/a pro frakci **${fractionRole.name}**:`)
                                            .addFields(
                                                { name: 'Položka', value: name, inline: true },
                                                { name: 'Sekce', value: selectedSection, inline: true },
                                                { name: 'Celková cena', value: `${totalPrice} $`, inline: true }
                                            );
                            
                                        // Add type-specific fields
                                        if (itemData.type === 'countable') {
                                            purchaseEmbed.addFields(
                                                { name: 'Přidané množství', value: `${itemState.selectedCount}x`, inline: true },
                                                { name: 'Celkové množství', value: `${purchaseData.count}x`, inline: true }
                                            );
                                        } else {
                                            purchaseEmbed.addFields(
                                                { name: 'Vybrané možnosti', value: selectedOptions.length > 0 ? selectedOptions.join('\n') : 'Žádné možnosti' }
                                            );
                                        }
                            
                                        purchaseEmbed.addFields(
                                            { name: 'Nový stav účtu', value: `${fractionData.money} $` },
                                            { name: 'ID předmětu', value: purchaseData.id }
                                        ).setTimestamp();
                            
                                        // Update original message
                                        await i.editReply({
                                            content: '✅ Nákup byl úspěšně dokončen',
                                            embeds: [],
                                            components: []
                                        });
                            
                                        // Send confirmation to channel
                                        await interaction.channel.send({ embeds: [purchaseEmbed] });
                            
                                        logShop('Purchase Completed', {
                                            itemId: uniqueId,
                                            buyer: interaction.user.tag,
                                            fraction: fractionRole.name,
                                            totalPrice
                                        });
                            
                                    } catch (error) {
                                        console.error('Purchase confirmation error:', error);
                                        await i.editReply({
                                            content: '❌ Nastala chyba při zpracování nákupu',
                                            embeds: [],
                                            components: []
                                        });
                                    }
                                } else {
                                    // Handle purchase cancellation
                                    await i.editReply({
                                        content: '❌ Nákup byl zrušen',
                                        embeds: [],
                                        components: []
                                    });
                                }
                            });
                            
                            confirmCollector.on('end', async (collected, reason) => {
                                if (reason === 'time' && !collected.size) {
                                    try {
                                        await i.editReply({
                                            content: '⌛ Vypršel čas na potvrzení nákupu',
                                            embeds: [],
                                            components: []
                                        });
                                    } catch (error) {
                                        console.error('Timeout handler error:', error);
                                    }
                                }
                            });
                            
                            confirmCollector.on('end', async (collected, reason) => {
                                if (reason === 'time') {
                                    try {
                                        await i.editReply({
                                            content: '⌛ Vypršel čas na potvrzení nákupu',
                                            components: [],
                                            embeds: []
                                        });
                                    } catch (error) {
                                        console.error('Timeout handler error:', error);
                                    }
                                }
                            });
                    
                        } catch (error) {
                            console.error('Error in buy-item:', error);
                            logShop('Purchase Error', {
                                error: error.message,
                                stack: error.stack
                            });
                    
                            await i.editReply({
                                content: '❌ Chyba při zpracování nákupu.',
                                components: [],
                                embeds: []
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error in interaction:', error);
                    logShop('Interaction Error', {
                        error: error.message,
                        stack: error.stack
                    });

                    await i.editReply({
                        content: '❌ Nastala chyba při zpracování vaší volby.',
                        components: [],
                        embeds: []
                    });
                }
            });

            // ... rest of your code (collector end handler, etc.)
            collector.on('end', async (collected, reason) => {
                logShop('Collector Ended', {
                    reason,
                    interactionsCollected: collected.size
                });

                if (reason === 'time') {
                    try {
                        const timeoutEmbed = new EmbedBuilder()
                            .setColor(0x808080)
                            .setTitle('Časový limit vypršel')
                            .setDescription('Pro nový nákup použijte příkaz znovu.');

                        await interaction.editReply({
                            embeds: [timeoutEmbed],
                            components: []
                        }).catch(() => {});
                    } catch (error) {
                        console.error('Error in collector end:', error);
                        logShop('Timeout Error', {
                            error: error.message,
                            stack: error.stack
                        });
                    }
                }
            });

        } catch (error) {
            console.error('Error in shop command:', error);
            logShop('Command Error', {
                error: error.message,
                stack: error.stack
            });
            await interaction.editReply({
                content: '❌ Chyba při zpracování příkazu.',
                components: [],
                embeds: []
            }).catch(console.error);
        }
    }
};

// Helper functions
function calculateTotalPrice(basePrice, selectedMods) {
    let total = Number(basePrice);
    selectedMods.forEach(mod => {
        if (mod?.selected) {
            const [,, price] = mod.selected.split(':');
            total += Number(price) || 0;
        }
        if (mod?.subSelections) {
            Object.values(mod.subSelections).forEach(subOpt => {
                total += Number(subOpt.price) || 0;
            });
        }
    });
    return total;
}

function createItemEmbed(name, basePrice, totalPrice, selectedMods) {
    return new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(name)
        .setDescription(`Základní cena: ${basePrice} $`)
        .addFields(selectedMods.map(mod => ({
            name: mod.modName,
            value: `${mod.selected.split(':')[1]}${
                mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                    '\n' + Object.entries(mod.subSelections)
                        .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') : ''
            }`,
            inline: true
        })))
        .addFields({ name: 'Celková cena', value: `${totalPrice} $`, inline: true });
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

    if (modRows.length < 5) {
        modRows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('buy-item')
                    .setLabel('Koupit')
                    .setStyle(ButtonStyle.Success)
            )
        );
    }

    return modRows;
}

function createNavigationRow(currentPage, totalPages) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('prev-page')
                .setLabel('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 0),
            new ButtonBuilder()
                .setCustomId('next-page')
                .setLabel('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId('buy-item')
                .setLabel('Koupit')
                .setStyle(ButtonStyle.Success)
        );
}

function createModificationPages(modifications, selectedMods) {
    const allRows = [];

    // Collect all rows first
    Object.entries(modifications).forEach(([modName, modValues], index) => {
        // Add main modification
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

        // Add sub-selections immediately after their parent mod
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

    // Split into pages of 4 rows each
    const pages = [];
    for (let i = 0; i < allRows.length; i += 4) {
        pages.push(allRows.slice(i, i + 4));
    }

    return {
        pages,
        totalModifications: allRows.length
    };
}

// Update the updateModificationDisplay function
function updateModificationDisplay(interaction, itemData, selectedMods, currentPage = 0) {
    const { pages, totalModifications } = createModificationPages(itemData.modifications, selectedMods);
    const { name, basePrice } = itemData;

    // Ensure current page is valid
    currentPage = Math.max(0, Math.min(pages.length - 1, currentPage));

    const modRows = [...pages[currentPage]];
    
    // Always show navigation if there are multiple pages
    if (pages.length > 1) {
        modRows.push(
            new ActionRowBuilder().addComponents(
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
                    .setCustomId('buy-item')
                    .setLabel('Koupit')
                    .setStyle(ButtonStyle.Success)
            )
        );
    } else {
        modRows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('buy-item')
                    .setLabel('Koupit')
                    .setStyle(ButtonStyle.Success)
            )
        );
    }

    const totalPrice = calculateTotalPrice(basePrice, selectedMods);
    const itemEmbed = createItemEmbed(name, basePrice, totalPrice, selectedMods);
    
    if (pages.length > 1) {
        itemEmbed.setFooter({ text: `Stránka ${currentPage + 1}/${pages.length}` });
    }

    return {
        embeds: [itemEmbed],
        components: modRows
    };
}

// First, add item type check helpers
function createCountableDisplay(itemData, count = 1) {
    const { name, basePrice, description, maxCount = 25, minCount = 1 } = itemData;
    const totalPrice = basePrice * count;
    
    // Calculate the range for dropdown options
    const startCount = Math.max(minCount, 1);
    const maxOptions = 25; // Maximum number of options to show in dropdown
    const endCount = Math.min(maxCount, startCount + maxOptions - 1);

    const countMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select-count')
            .setPlaceholder('Vyberte množství')
            .addOptions(
                Array.from(
                    { length: endCount - startCount + 1 }, 
                    (_, i) => i + startCount
                ).map(num => ({
                    label: `${num}x (${num * basePrice}$)`,
                    value: num.toString(),
                    default: num === count
                }))
            )
    );

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(name)
        .setDescription(description || '')
        .addFields(
            { name: 'Cena za kus', value: `${basePrice} $`, inline: true },
            { name: 'Množství', value: count.toString(), inline: true },
            { name: 'Celková cena', value: `${totalPrice} $`, inline: true },
            { 
                name: 'Limity', 
                value: `Minimum: ${minCount} ks\nMaximum: ${maxCount} ks`, 
                inline: false 
            }
        );

    return {
        embed,
        components: [
            countMenu,
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('buy-item')
                    .setLabel('Koupit')
                    .setStyle(ButtonStyle.Success)
            )
        ]
    };
}