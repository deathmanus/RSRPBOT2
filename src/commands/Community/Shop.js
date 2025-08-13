const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ShopSystem, ShopLogger } = require('../../systems/shopSystem');
const { getEmoji } = require('../../utils/emojiUtils');
const { 
    getFractionByName, 
    getShopItems, 
    getFractionItems, 
    updateFractionMoney, 
    addFractionItem,
    db
} = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Procházet obchod a vybírat položky k nákupu.'),
    async execute(interaction) {
        try {
            ShopLogger.log('Command Started', {
                user: interaction.user.tag,
                userId: interaction.user.id,
                channel: interaction.channel.name,
                guildId: interaction.guildId
            });

            await interaction.deferReply({ ephemeral: true });

            // Get sections from database
            const sections = await new Promise((resolve, reject) => {
                db.all(`SELECT name FROM shop_sections ORDER BY name ASC`, [], (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(rows.map(row => row.name));
                });
            });

            ShopLogger.log('Loaded Shop Sections (DB)', { sections });

            if (sections.length === 0) {
                ShopLogger.log('Error', 'No shop sections available');
                return await interaction.followUp({ content: '❌ Žádné sekce obchodu k zobrazení.', flags: 64 });
            }

            let selectedSection = null;
            let selectedItem = null;
            let selectedMods = [];
            let itemState = null;
            let currentPage = 0;

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

            ShopLogger.log('Initial Shop Menu Created', {
                type: 'section_select',
                available_sections: sections
            });

            const collector = message.createMessageComponentCollector({ 
                filter: i => i.user.id === interaction.user.id,
                time: 300000 
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate().catch(error => {
                        console.error('Error deferring update:', error);
                    });

                    if (i.customId === 'select-shop-section') {
                        selectedSection = i.values[0];
                        ShopLogger.log('Section Selected', { selectedSection });

                        // Použití nového systému pro načtení sekce
                        const items = await ShopSystem.loadSection(selectedSection);
                        
                        const itemMenu = new StringSelectMenuBuilder()
                            .setCustomId('select-shop-item')
                            .setPlaceholder('Vyberte položku k zobrazení')
                            .addOptions(items.map(item => ({
                                label: item.name,
                                value: item.filename.replace('.json', '')
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
                        
                        // Get item data from database
                        const itemData = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT * FROM shop_items 
                                WHERE id = ? OR name = ?`, 
                                [selectedItem, selectedItem], 
                                (err, row) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    
                                    if (!row) {
                                        reject(new Error('Item not found'));
                                        return;
                                    }
                                    
                                    // Parse modifications if exists
                                    let modifications = null;
                                    if (row.modifications) {
                                        try {
                                            modifications = JSON.parse(row.modifications);
                                        } catch (e) {
                                            console.error('Error parsing modifications:', e);
                                        }
                                    }
                                    
                                    resolve({
                                        id: row.id,
                                        name: row.name,
                                        type: row.type,
                                        basePrice: row.base_price,
                                        maxCount: row.max_count,
                                        minCount: row.min_count,
                                        modifications: modifications,
                                        description: (row.description && row.description.length > 0) ? row.description : ' '
                                    });
                                }
                            );
                        });
                        
                        // Validace položky
                        const validationErrors = ShopSystem.validateItem(itemData);
                        if (validationErrors.length > 0) {
                            ShopLogger.log('Validation Error', {
                                item: selectedItem,
                                errors: validationErrors
                            });
                            await i.editReply({
                                content: '❌ Tato položka obsahuje chyby v datech a není momentálně dostupná.',
                                components: []
                            });
                            return;
                        }

                        switch (itemData.type) {
                            case 'countable':
                                const countDisplay = await createCountableDisplay(itemData, 1, selectedSection);
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
                                
                                const display = await updateModificationDisplay(i, itemData, selectedMods, 0);
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
                    
                        // Get item data from database
                        const itemData = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT * FROM shop_items 
                                WHERE id = ? OR name = ?`, 
                                [selectedItem, selectedItem], 
                                (err, row) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    
                                    if (!row) {
                                        reject(new Error('Item not found'));
                                        return;
                                    }
                                    
                                    // Parse modifications if exists
                                    let modifications = null;
                                    if (row.modifications) {
                                        try {
                                            modifications = JSON.parse(row.modifications);
                                        } catch (e) {
                                            console.error('Error parsing modifications:', e);
                                        }
                                    }
                                    
                                    resolve({
                                        id: row.id,
                                        name: row.name,
                                        type: row.type,
                                        basePrice: row.base_price,
                                        maxCount: row.max_count,
                                        minCount: row.min_count,
                                        modifications: modifications,
                                        description: row.description
                                    });
                                }
                            );
                        });
                        
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
                    
                        const display = await updateModificationDisplay(i, itemData, selectedMods, collector.currentPage || 0);
                        await i.editReply(display);
                    }
                    else if (i.customId.startsWith('select-submod-')) {
                        const parts = i.customId.split('-');
                        const modIndex = parseInt(parts[2], 10);  // Changed from parts[1]
                        const subModName = parts[3];  // Changed from parts[2]
                        const [subMod, optName, optPrice] = i.values[0].split(':');
                    
                        ShopLogger.log('Sub-Modification Attempt', {
                            modIndex,
                            subModName,
                            subMod,
                            optName,
                            optPrice,
                            currentMods: selectedMods
                        });
                    
                        // Get item data from database
                        const itemData = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT * FROM shop_items 
                                WHERE id = ? OR name = ?`, 
                                [selectedItem, selectedItem], 
                                (err, row) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    
                                    if (!row) {
                                        reject(new Error('Item not found'));
                                        return;
                                    }
                                    
                                    // Parse modifications if exists
                                    let modifications = null;
                                    if (row.modifications) {
                                        try {
                                            modifications = JSON.parse(row.modifications);
                                        } catch (e) {
                                            console.error('Error parsing modifications:', e);
                                        }
                                    }
                                    
                                    resolve({
                                        id: row.id,
                                        name: row.name,
                                        type: row.type,
                                        basePrice: row.base_price,
                                        maxCount: row.max_count,
                                        minCount: row.min_count,
                                        modifications: modifications,
                                        description: row.description
                                    });
                                }
                            );
                        });
                        
                        const { name, basePrice, modifications } = itemData;
                    
                        // Validate modIndex
                        if (typeof modIndex !== 'number' || !selectedMods[modIndex]) {
                            ShopLogger.log('Error', {
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
                            ShopLogger.log('Error', {
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
                            ShopLogger.log('Error', {
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
                    
                        ShopLogger.log('Sub-Modification Selected', {
                            modIndex,
                            mainMod: mainModName,
                            subModName: subMod,
                            optName,
                            price: subOpt.price,
                            updatedMod: selectedMods[modIndex]
                        });
                    
                        const display = await updateModificationDisplay(i, itemData, selectedMods, collector.currentPage || 0);
                        await i.editReply(display);
                    }
                    else if (i.customId === 'prev-page' || i.customId === 'next-page') {
                        const direction = i.customId === 'next-page' ? 1 : -1;
                        
                        // Get item data from database
                        const itemData = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT * FROM shop_items 
                                WHERE id = ? OR name = ?`, 
                                [selectedItem, selectedItem], 
                                (err, row) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    
                                    if (!row) {
                                        reject(new Error('Item not found'));
                                        return;
                                    }
                                    
                                    // Parse modifications if exists
                                    let modifications = null;
                                    if (row.modifications) {
                                        try {
                                            modifications = JSON.parse(row.modifications);
                                        } catch (e) {
                                            console.error('Error parsing modifications:', e);
                                        }
                                    }
                                    
                                    resolve({
                                        id: row.id,
                                        name: row.name,
                                        type: row.type,
                                        basePrice: row.base_price,
                                        maxCount: row.max_count,
                                        minCount: row.min_count,
                                        modifications: modifications,
                                        description: row.description
                                    });
                                }
                            );
                        });
                    
                        // Get current pages structure
                        const { pages, totalModifications } = createModificationPages(itemData.modifications, selectedMods);
                        
                        // Update current page with bounds checking
                        collector.currentPage = Math.max(0, Math.min(pages.length - 1, (collector.currentPage || 0) + direction));
                    
                        const display = await updateModificationDisplay(i, itemData, selectedMods, collector.currentPage);
                        await i.editReply(display);
                    }
                    else if (i.customId === 'select-count') {
                        const count = parseInt(i.values[0]);
                        
                        // Get item data from database
                        const itemData = await new Promise((resolve, reject) => {
                            db.get(`
                                SELECT * FROM shop_items 
                                WHERE id = ? OR name = ?`, 
                                [selectedItem, selectedItem], 
                                (err, row) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    
                                    if (!row) {
                                        reject(new Error('Item not found'));
                                        return;
                                    }
                                    
                                    resolve({
                                        id: row.id,
                                        name: row.name,
                                        type: row.type,
                                        basePrice: row.base_price,
                                        maxCount: row.max_count,
                                        minCount: row.min_count,
                                        description: row.description
                                    });
                                }
                            );
                        });
                        
                        itemState.selectedCount = count;
                        const countDisplay = await createCountableDisplay(itemData, count, selectedSection);
                        await i.editReply({
                            embeds: [countDisplay.embed],
                            components: countDisplay.components
                        });
                    }
                    else if (i.customId === 'buy-item') {
                        try {
                            // Buy-item logic
                            const member = interaction.member;
                            const fractionRole = member.roles.cache.find(role => {
                                return new Promise((resolve) => {
                                    getFractionByName(role.name, (err, fraction) => {
                                        resolve(fraction != null);
                                    });
                                });
                            });
                            
                            if (!fractionRole) {
                                return await i.editReply({
                                    content: '❌ Nejste členem žádné frakce.',
                                    components: [],
                                    embeds: []
                                });
                            }
                            
                            // Get fraction data
                            const fractionData = await new Promise((resolve, reject) => {
                                getFractionByName(fractionRole.name, (err, fraction) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    if (!fraction) {
                                        reject(new Error('Fraction not found'));
                                        return;
                                    }
                                    resolve(fraction);
                                });
                            });
                    
                            // Get item data from database
                            const itemData = await new Promise((resolve, reject) => {
                                db.get(`
                                    SELECT * FROM shop_items 
                                    WHERE id = ? OR name = ?`, 
                                    [selectedItem, selectedItem], 
                                    (err, row) => {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }
                                        
                                        if (!row) {
                                            reject(new Error('Item not found'));
                                            return;
                                        }
                                        
                                        // Parse modifications if exists
                                        let modifications = null;
                                        if (row.modifications) {
                                            try {
                                                modifications = JSON.parse(row.modifications);
                                            } catch (e) {
                                                console.error('Error parsing modifications:', e);
                                            }
                                        }
                                        
                                        resolve({
                                            id: row.id,
                                            name: row.name,
                                            type: row.type,
                                            basePrice: row.base_price,
                                            maxCount: row.max_count,
                                            minCount: row.min_count,
                                            modifications: modifications,
                                            description: row.description
                                        });
                                    }
                                );
                            });
                            
                            const { id, name, basePrice, maxCount } = itemData;

                            // For countable items, check current count and limits
                            if (itemData.type === 'countable') {
                                // Get all existing items of this type in the fraction
                                const currentCount = await new Promise((resolve, reject) => {
                                    db.get(`
                                        SELECT SUM(count) as totalCount 
                                        FROM purchases p
                                        JOIN shop_items si ON p.item_id = si.id
                                        WHERE p.fraction_id = ? AND si.name = ?`,
                                        [fractionData.id, name],
                                        (err, row) => {
                                            if (err) {
                                                reject(err);
                                                return;
                                            }
                                            resolve(row?.totalCount || 0);
                                        }
                                    );
                                });
                    
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
                                .setTitle(`${await getEmoji('store')} Potvrzení nákupu`)
                                .setDescription(`**Opravdu chcete koupit tento předmět?**`)
                                .addFields(
                                    { name: 'Položka', value: name, inline: true },
                                    { name: 'Sekce', value: selectedSection, inline: true },
                                    { name: 'Celková cena', value: `${totalPrice} ${await getEmoji('money')}`, inline: true },
                                    { name: 'Vybrané možnosti', value: selectedOptions.length > 0 ? selectedOptions.join('\n') : 'Žádné možnosti' },
                                    { name: 'Stav účtu frakce', value: `Současný: ${fractionData.money}${await getEmoji('money')}\nPo nákupu: ${fractionData.money - totalPrice}${await getEmoji('money')}` }
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
                    
                            try {
                                // Setup confirm collector
                                const confirmCollector = i.message.createMessageComponentCollector({
                                    filter: response => response.user.id === interaction.user.id,
                                    time: 30000,
                                    max: 1
                                });
                                
                                confirmCollector.on('collect', async confirm => {
                                    try {
                                        if (confirm.customId === 'confirm-purchase') {
                                            try {
                                                let purchaseData;
                                                let purchaseId;
                                
                                                if (itemData.type === 'countable') {
                                                    // Check if we already have this item
                                                    const existingItem = await new Promise((resolve, reject) => {
                                                        db.get(`
                                                            SELECT p.* 
                                                            FROM purchases p
                                                            JOIN shop_items si ON p.item_id = si.id
                                                            WHERE p.fraction_id = ? AND si.name = ?
                                                            LIMIT 1`,
                                                            [fractionData.id, itemData.name],
                                                            (err, row) => {
                                                                if (err) {
                                                                    reject(err);
                                                                    return;
                                                                }
                                                                resolve(row);
                                                            }
                                                        );
                                                    });
                                                    
                                                    if (existingItem) {
                                                        // Update existing item
                                                        const newCount = existingItem.count + itemState.selectedCount;
                                                        const newTotalPrice = newCount * itemData.basePrice;
                                                        
                                                        await new Promise((resolve, reject) => {
                                                            db.run(`
                                                                UPDATE purchases 
                                                                SET count = ?, total_price = ? 
                                                                WHERE id = ?`,
                                                                [newCount, newTotalPrice, existingItem.id],
                                                                (err) => {
                                                                    if (err) {
                                                                        reject(err);
                                                                        return;
                                                                    }
                                                                    resolve();
                                                                }
                                                            );
                                                        });
                                                        
                                                        purchaseId = existingItem.id;
                                                        purchaseData = {
                                                            id: purchaseId,
                                                            name: itemData.name,
                                                            basePrice: itemData.basePrice,
                                                            count: newCount,
                                                            totalPrice: newTotalPrice
                                                        };
                                                    } else {
                                                        // Create new item
                                                        const totalPrice = itemData.basePrice * itemState.selectedCount;
                                                        
                                                        purchaseId = await new Promise((resolve, reject) => {
                                                            db.run(`
                                                                INSERT INTO purchases (
                                                                    fraction_id, item_id, count, selected_mods, 
                                                                    total_price, purchase_date, buyer
                                                                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                                                [
                                                                    fractionData.id,
                                                                    itemData.id,
                                                                    itemState.selectedCount,
                                                                    null,
                                                                    totalPrice,
                                                                    new Date().toISOString(),
                                                                    interaction.user.tag
                                                                ],
                                                                function(err) {
                                                                    if (err) {
                                                                        reject(err);
                                                                        return;
                                                                    }
                                                                    resolve(this.lastID);
                                                                }
                                                            );
                                                        });
                                                        
                                                        purchaseData = {
                                                            id: purchaseId,
                                                            name: itemData.name,
                                                            basePrice: itemData.basePrice,
                                                            count: itemState.selectedCount,
                                                            totalPrice: totalPrice
                                                        };
                                                    }
                                                } else {
                                                    // Handle modifiable items
                                                    const totalPrice = calculateTotalPrice(itemData.basePrice, selectedMods);
                                                    const selectedModsJson = JSON.stringify(selectedMods);
                                                    
                                                    purchaseId = await new Promise((resolve, reject) => {
                                                        db.run(`
                                                            INSERT INTO purchases (
                                                                fraction_id, item_id, count, selected_mods, 
                                                                total_price, purchase_date, buyer
                                                            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                                            [
                                                                fractionData.id,
                                                                itemData.id,
                                                                1, // Modifiable items always have count=1
                                                                selectedModsJson,
                                                                totalPrice,
                                                                new Date().toISOString(),
                                                                interaction.user.tag
                                                            ],
                                                            function(err) {
                                                                if (err) {
                                                                    reject(err);
                                                                    return;
                                                                }
                                                                resolve(this.lastID);
                                                            }
                                                        );
                                                    });
                                                    
                                                    purchaseData = {
                                                        id: purchaseId,
                                                        name: itemData.name,
                                                        basePrice: itemData.basePrice,
                                                        selectedMods: selectedMods,
                                                        totalPrice: totalPrice,
                                                        count: 1
                                                    };
                                                }
                                
                                                // Update fraction money
                                                const totalPrice = itemData.type === 'countable' 
                                                    ? itemData.basePrice * itemState.selectedCount 
                                                    : calculateTotalPrice(itemData.basePrice, selectedMods);
                                                    
                                                try {
                                                    await updateFractionMoney(fractionData.id, totalPrice, false);
                                                } catch (moneyError) {
                                                    console.error('Error updating fraction money:', moneyError);
                                                    // Continue execution - the purchase data is already saved in the database
                                                    ShopLogger.log('Money Update Error', {
                                                        fractionId: fractionData.id,
                                                        totalPrice,
                                                        error: moneyError.message
                                                    });
                                                }
                                                
                                                // Create purchase confirmation embed with updated information
                                                const purchaseEmbed = new EmbedBuilder()
                                                    .setColor(0x00FF00)
                                                    .setTitle(`${await getEmoji('success')} Nákup dokončen`)
                                                    .setDescription(`**${interaction.user.tag}** zakoupil/a pro frakci **${fractionRole.name}**:`)
                                                    .addFields(
                                                        { name: 'Položka', value: name, inline: true },
                                                        { name: 'Sekce', value: selectedSection, inline: true },
                                                        { name: 'Celková cena', value: `${totalPrice} ${await getEmoji('money')}`, inline: true }
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
                                                    { name: 'Nový stav účtu', value: `${fractionData.money} ${await getEmoji('money')}` },
                                                    { name: 'ID předmětu', value: purchaseData.id }
                                                ).setTimestamp();
                                
                                                // Update original message
                                                try {
                                                    await confirm.update({
                                                        content: '✅ Nákup byl úspěšně dokončen',
                                                        embeds: [],
                                                        components: []
                                                    });
                                                } catch (updateError) {
                                                    console.error('Error updating confirmation message:', updateError);
                                                    // If updating fails, try to send a new message instead
                                                    try {
                                                        await interaction.followUp({
                                                            content: '✅ Nákup byl úspěšně dokončen',
                                                            ephemeral: true
                                                        });
                                                    } catch (followUpError) {
                                                        console.error('Failed to send follow-up message:', followUpError);
                                                    }
                                                }
                                
                                                // Send confirmation to channel
                                                await interaction.channel.send({ embeds: [purchaseEmbed] }).catch(err => {
                                                    console.error('Error sending purchase confirmation to channel:', err);
                                                });
                                
                                                ShopLogger.log('Purchase Completed', {
                                                    itemId: purchaseId,
                                                    buyer: interaction.user.tag,
                                                    fraction: fractionRole.name,
                                                    totalPrice
                                                });
                                
                                            } catch (error) {
                                                console.error('Purchase confirmation error:', error);
                                                try {
                                                    await confirm.update({
                                                        content: '❌ Nastala chyba při zpracování nákupu',
                                                        embeds: [],
                                                        components: []
                                                    });
                                                } catch (updateError) {
                                                    console.error('Error updating error message:', updateError);
                                                    try {
                                                        await interaction.followUp({
                                                            content: '❌ Nastala chyba při zpracování nákupu',
                                                            ephemeral: true
                                                        });
                                                    } catch (followUpError) {
                                                        console.error('Failed to send error follow-up:', followUpError);
                                                    }
                                                }
                                            }
                                        } else {
                                            // Handle purchase cancellation
                                            try {
                                                await confirm.update({
                                                    content: '❌ Nákup byl zrušen',
                                                    embeds: [],
                                                    components: []
                                                });
                                            } catch (updateError) {
                                                console.error('Error updating cancellation message:', updateError);
                                                try {
                                                    await interaction.followUp({
                                                        content: '❌ Nákup byl zrušen',
                                                        ephemeral: true
                                                    });
                                                } catch (followUpError) {
                                                    console.error('Failed to send cancellation follow-up:', followUpError);
                                                }
                                            }
                                        }
                                    } catch (collectError) {
                                        console.error('Error handling confirmation:', collectError);
                                        try {
                                            await interaction.followUp({
                                                content: '❌ Nastala chyba při zpracování vaší volby.',
                                                ephemeral: true
                                            });
                                        } catch (followUpError) {
                                            console.error('Failed to send error message:', followUpError);
                                        }
                                    }
                                });
                                
                                // Also setup end event handler
                                confirmCollector.on('end', async (collected, reason) => {
                                    if (reason === 'time') {
                                        try {
                                            await i.editReply({
                                                content: '⌛ Vypršel čas na potvrzení nákupu',
                                                embeds: [],
                                                components: []
                                            }).catch(error => {
                                                console.error('Timeout edit reply error:', error);
                                                interaction.followUp({
                                                    content: '⌛ Vypršel čas na potvrzení nákupu',
                                                    ephemeral: true
                                                }).catch(e => console.error('Failed to send timeout follow-up:', e));
                                            });
                                        } catch (error) {
                                            console.error('Timeout handler error:', error);
                                            // Try to send a follow-up message as a last resort
                                            try {
                                                await interaction.followUp({
                                                    content: '⌛ Vypršel čas na potvrzení nákupu',
                                                    ephemeral: true
                                                });
                                            } catch (e) {
                                                console.error('Failed to send any timeout message:', e);
                                            }
                                        }
                                    }
                                });
                            } catch (innerError) {
                                console.error('Error in buy-item inner block:', innerError);
                                ShopLogger.log('Purchase Inner Error', {
                                    error: innerError.message,
                                    stack: innerError.stack
                                });
                                
                                try {
                                    await i.editReply({
                                        content: '❌ Nastala vnitřní chyba při zpracování nákupu.',
                                        components: [],
                                        embeds: []
                                    });
                                } catch (replyError) {
                                    console.error('Error sending inner error message:', replyError);
                                }
                            }
                        } catch (error) {
                            console.error('Error in buy-item:', error);
                            ShopLogger.log('Purchase Error', {
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
                    else if (i.customId === 'back-to-items') {
                        try {
                            // Get items from database for the current section
                            const items = await new Promise((resolve, reject) => {
                                getShopItems(selectedSection, (err, rows) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    resolve(rows);
                                });
                            });
                    
                            const itemMenu = new StringSelectMenuBuilder()
                                .setCustomId('select-shop-item')
                                .setPlaceholder('Vyberte položku k zobrazení')
                                .addOptions(items.map(item => ({
                                    label: item.name,
                                    value: item.id.toString()
                                })));
                    
                            const sectionEmbed = new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle(`Sekce: ${selectedSection}`)
                                .setDescription('Vyberte položku z dropdown menu.');
                    
                            // Just use editReply directly without deferUpdate
                            await interaction.editReply({
                                embeds: [sectionEmbed],
                                components: [
                                    new ActionRowBuilder().addComponents(createSectionMenu(selectedSection)),
                                    new ActionRowBuilder().addComponents(itemMenu)
                                ],
                                files: [] // Clear any attachments
                            });
                    
                            // Reset states
                            selectedItem = null;
                            selectedMods = [];
                            currentPage = 0;
                            itemState = null;
                    
                        } catch (error) {
                            console.error('Error handling back button:', error);
                            logToFile('Interaction Error', {
                                error: error.message,
                                stack: error.stack
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error in interaction:', error);
                    ShopLogger.log('Error', {
                        action: 'collector',
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
                ShopLogger.log('Collector Ended', {
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
                        }).catch(error => {
                            console.error('Error updating timeout message:', error);
                            // If updating fails, try to send a new message instead
                            interaction.followUp({
                                content: '⌛ Časový limit vypršel. Pro nový nákup použijte příkaz znovu.',
                                ephemeral: true
                            }).catch(e => console.error('Failed to send timeout follow-up:', e));
                        });
                    } catch (error) {
                        console.error('Error in collector end:', error);
                        ShopLogger.log('Timeout Error', {
                            error: error.message,
                            stack: error.stack
                        });
                    }
                }
            });

        } catch (error) {
            console.error('Error in shop command:', error);
            ShopLogger.log('Command Error', {
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

async function createItemEmbed(name, basePrice, totalPrice, selectedMods) {
    return new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`${await getEmoji('store')} ${name}`)
        .setDescription(`Základní cena: ${basePrice} ${await getEmoji('money')}`)
        .addFields(selectedMods.map(mod => ({
            name: mod.modName,
            value: `${mod.selected.split(':')[1]}${
                mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                    '\n' + Object.entries(mod.subSelections)
                        .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') : ''
            }`,
            inline: true
        })))
        .addFields({ name: 'Celková cena', value: `${totalPrice} ${await getEmoji('money')}`, inline: true });
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
async function updateModificationDisplay(interaction, itemData, selectedMods, currentPage = 0) {
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
                    .setCustomId('back-to-items')
                    .setLabel('Zpět')
                    .setStyle(ButtonStyle.Secondary),
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
                    .setCustomId('back-to-items')
                    .setLabel('Zpět')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('buy-item')
                    .setLabel('Koupit')
                    .setStyle(ButtonStyle.Success)
            )
        );
    }

    const totalPrice = calculateTotalPrice(basePrice, selectedMods);
    const itemEmbed = await createItemEmbed(name, basePrice, totalPrice, selectedMods);
    
    if (pages.length > 1) {
        itemEmbed.setFooter({ text: `Stránka ${currentPage + 1}/${pages.length}` });
    }

    return {
        embeds: [itemEmbed],
        components: modRows
    };
}

// First, add item type check helpers
async function createCountableDisplay(itemData, count = 1, selectedSection = '') {
    const { name, basePrice, description, maxCount = 25, minCount = 1 } = itemData;
    const totalPrice = basePrice * count;
    
    // Calculate the range for dropdown options
    const startCount = Math.max(minCount, 1);
    const maxOptions = 25; // Maximum number of options to show in dropdown
    const endCount = Math.min(maxCount, startCount + maxOptions - 1);

    const moneyEmoji = await getEmoji('money');
    const storeEmoji = await getEmoji('store');

    // Check if this is Equipment section to hide price from dropdown
    const isEquipment = selectedSection === 'Equipment';

    const countMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select-count')
            .setPlaceholder('Vyberte množství')
            .addOptions(
                Array.from(
                    { length: endCount - startCount + 1 }, 
                    (_, i) => i + startCount
                ).map(num => ({
                    label: isEquipment ? `${num}x` : `${num}x (${num * basePrice}${moneyEmoji})`,
                    value: num.toString(),
                    default: num === count
                }))
            )
    );

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`${storeEmoji} ${name}`)
        .setDescription((description && description.length > 0) ? description : ' ')
        .addFields(
            { name: 'Cena za kus', value: `${basePrice} ${moneyEmoji}`, inline: true },
            { name: 'Množství', value: count.toString(), inline: true },
            { name: 'Celková cena', value: `${totalPrice} ${moneyEmoji}`, inline: true },
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
                    .setCustomId('back-to-items')
                    .setLabel('Zpět')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('buy-item')
                    .setLabel('Koupit')
                    .setStyle(ButtonStyle.Success)
            )
        ]
    };
}
