const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { db, getFractionByName, getFractionItems, addFractionItem, deleteFractionItem, addAuditLog } = require('../../Database/database');

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

// Add this function near other helper functions in manageItem.js
function createCountableDisplay(itemData, count = 1, isGiving = true) {
    const { name } = itemData;
    
    const countMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select-count')
            .setPlaceholder('Vyberte množství')
            .addOptions(
                Array.from(
                    { length: 25 }, 
                    (_, i) => i + 1
                ).map(num => ({
                    label: `${num}x`,
                    value: num.toString(),
                    default: num === count
                }))
            )
    );

    const embed = new EmbedBuilder()
        .setColor(isGiving ? 0x00FF00 : 0xFF0000)
        .setTitle(name)
        .addFields(
            { name: 'Množství', value: count.toString(), inline: true }
        );

    const actionButton = new ButtonBuilder()
        .setCustomId('confirm-action')
        .setLabel(isGiving ? 'Přidat' : 'Odebrat')
        .setStyle(isGiving ? ButtonStyle.Success : ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel-action')
        .setLabel('Zrušit')
        .setStyle(ButtonStyle.Secondary);

    return {
        embed,
        components: [
            countMenu,
            new ActionRowBuilder().addComponents(actionButton, cancelButton)
        ]
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

            const shopDir = path.join(__dirname, '../../files/Shop');
            
            // Načtení všech frakcí z databáze
            const fractions = [];
            await new Promise((resolve) => {
                db.all(`SELECT name FROM fractions ORDER BY name`, [], (err, rows) => {
                    if (!err && rows) {
                        rows.forEach(row => fractions.push(row.name));
                    }
                    resolve();
                });
            });

            if (fractions.length === 0) {
                return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
            }

            let selectedFraction = null;
            let selectedSection = null;
            let selectedItem = null;
            let selectedMods = [];
            let currentPage = 0;
            let itemState = { type: null, selectedCount: 1 };

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
                        
                        if (isGiving) {
                            // Pro přidání položky načítáme sekce ze shopDir
                            try {
                                const sections = fs.readdirSync(shopDir, { withFileTypes: true })
                                    .filter(dirent => dirent.isDirectory())
                                    .map(dirent => dirent.name);

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
                                console.error(`Error accessing shop directory`, error);
                                await i.editReply({
                                    content: '❌ Nastala chyba při načítání sekcí ze shopu.',
                                    components: []
                                });
                                collector.stop();
                            }
                        } else {
                            // Pro odebrání položky načítáme sekce z databáze
                            try {
                                // Nejprve získáme ID frakce
                                let fractionId = null;
                                await new Promise((resolve) => {
                                    getFractionByName(selectedFraction, (err, fraction) => {
                                        if (!err && fraction) {
                                            fractionId = fraction.id;
                                        }
                                        resolve();
                                    });
                                });
                                
                                if (!fractionId) {
                                    await i.editReply({
                                        content: '❌ Frakce nebyla nalezena v databázi.',
                                        components: []
                                    });
                                    return collector.stop();
                                }
                                
                                // Získáme typy sekcí z itemů frakce
                                const sectionTypes = new Set();
                                await new Promise((resolve) => {
                                    db.all(
                                        `SELECT DISTINCT shop_items.type 
                                         FROM purchases 
                                         JOIN shop_items ON purchases.item_id = shop_items.id 
                                         WHERE purchases.fraction_id = ?`,
                                        [fractionId],
                                        (err, rows) => {
                                            if (!err && rows) {
                                                rows.forEach(row => {
                                                    let section = 'Other';
                                                    if (row.type === 'air_vehicle') section = 'Air vehicles';
                                                    else if (row.type === 'ground_vehicle') section = 'Ground vehicles';
                                                    else if (row.type === 'equipment') section = 'Equipment';
                                                    else if (row.type === 'resource') section = 'Resources';
                                                    
                                                    sectionTypes.add(section);
                                                });
                                            }
                                            resolve();
                                        }
                                    );
                                });
                                
                                const sections = Array.from(sectionTypes);
                                
                                if (sections.length === 0) {
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
                                console.error(`Error accessing fraction items`, error);
                                await i.editReply({
                                    content: '❌ Nastala chyba při načítání sekcí frakce.',
                                    components: []
                                });
                                collector.stop();
                            }
                        }
                    }

                    else if (i.customId === 'select-section') {
                        selectedSection = i.values[0];
                        
                        if (isGiving) {
                            // Pro přidání položky načítáme itemy ze shop adresáře
                            const itemsPath = path.join(shopDir, selectedSection);
                            try {
                                const items = fs.readdirSync(itemsPath)
                                    .filter(file => file.endsWith('.json'))
                                    .map(file => {
                                        const itemData = JSON.parse(fs.readFileSync(path.join(itemsPath, file)));
                                        return {
                                            label: itemData.name || file.replace('.json', ''),
                                            value: file.replace('.json', ''),
                                            description: itemData.description?.substring(0, 100) || undefined
                                        };
                                    });

                                const itemMenu = new StringSelectMenuBuilder()
                                    .setCustomId('select-item')
                                    .setPlaceholder('Vyberte item')
                                    .addOptions(items);

                                const sectionMenuUpdated = new StringSelectMenuBuilder()
                                    .setCustomId('select-section')
                                    .setPlaceholder('Vyberte sekci')
                                    .addOptions(fs.readdirSync(shopDir, { withFileTypes: true })
                                        .filter(dirent => dirent.isDirectory())
                                        .map(dirent => ({
                                            label: dirent.name,
                                            value: dirent.name,
                                            default: dirent.name === selectedSection
                                        })));

                                await i.editReply({
                                    embeds: [embed.setDescription(`Vyberte item pro frakci ${selectedFraction}`)],
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
                        } else {
                            // Pro odebrání položky načítáme itemy z databáze
                            try {
                                // Získáme ID frakce
                                let fractionId = null;
                                await new Promise((resolve) => {
                                    getFractionByName(selectedFraction, (err, fraction) => {
                                        if (!err && fraction) {
                                            fractionId = fraction.id;
                                        }
                                        resolve();
                                    });
                                });
                                
                                if (!fractionId) {
                                    await i.editReply({
                                        content: '❌ Frakce nebyla nalezena v databázi.',
                                        components: []
                                    });
                                    return collector.stop();
                                }
                                
                                // Získáme položky frakce podle typu sekce
                                let itemType = '';
                                if (selectedSection === 'Air vehicles') itemType = 'air_vehicle';
                                else if (selectedSection === 'Ground vehicles') itemType = 'ground_vehicle';
                                else if (selectedSection === 'Equipment') itemType = 'equipment';
                                else if (selectedSection === 'Resources') itemType = 'resource';
                                
                                const items = [];
                                await new Promise((resolve) => {
                                    db.all(
                                        `SELECT purchases.id, purchases.count, shop_items.name, shop_items.type
                                         FROM purchases 
                                         JOIN shop_items ON purchases.item_id = shop_items.id 
                                         WHERE purchases.fraction_id = ? AND shop_items.type = ?`,
                                        [fractionId, itemType],
                                        (err, rows) => {
                                            if (!err && rows) {
                                                rows.forEach(row => {
                                                    items.push({
                                                        label: `${row.name} (ID: ${row.id})`,
                                                        value: row.id.toString(),
                                                        description: row.count ? `Množství: ${row.count}` : undefined
                                                    });
                                                });
                                            }
                                            resolve();
                                        }
                                    );
                                });
                                
                                if (items.length === 0) {
                                    return await i.editReply({
                                        content: '❌ Tato sekce neobsahuje žádné itemy.',
                                        components: []
                                    });
                                }
                                
                                const itemMenu = new StringSelectMenuBuilder()
                                    .setCustomId('select-item')
                                    .setPlaceholder('Vyberte item')
                                    .addOptions(items);

                                // Získáme dostupné sekce pro aktualizaci menu
                                const sectionTypes = new Set();
                                await new Promise((resolve) => {
                                    db.all(
                                        `SELECT DISTINCT shop_items.type 
                                         FROM purchases 
                                         JOIN shop_items ON purchases.item_id = shop_items.id 
                                         WHERE purchases.fraction_id = ?`,
                                        [fractionId],
                                        (err, rows) => {
                                            if (!err && rows) {
                                                rows.forEach(row => {
                                                    let section = 'Other';
                                                    if (row.type === 'air_vehicle') section = 'Air vehicles';
                                                    else if (row.type === 'ground_vehicle') section = 'Ground vehicles';
                                                    else if (row.type === 'equipment') section = 'Equipment';
                                                    else if (row.type === 'resource') section = 'Resources';
                                                    
                                                    sectionTypes.add(section);
                                                });
                                            }
                                            resolve();
                                        }
                                    );
                                });
                                
                                const sections = Array.from(sectionTypes);
                                
                                const sectionMenuUpdated = new StringSelectMenuBuilder()
                                    .setCustomId('select-section')
                                    .setPlaceholder('Vyberte sekci')
                                    .addOptions(sections.map(section => ({
                                        label: section,
                                        value: section,
                                        default: section === selectedSection
                                    })));

                                await i.editReply({
                                    embeds: [embed.setDescription(`Vyberte item k odebrání z frakce ${selectedFraction}`)],
                                    components: [
                                        new ActionRowBuilder().addComponents(sectionMenuUpdated),
                                        new ActionRowBuilder().addComponents(itemMenu)
                                    ]
                                });
                            } catch (error) {
                                console.error(`Error accessing items for fraction`, error);
                                await i.editReply({
                                    content: '❌ Nastala chyba při načítání itemů.',
                                    components: []
                                });
                                collector.stop();
                            }
                        }
                    }

                    // And modify the select-item handler for take functionality
                    else if (i.customId === 'select-item' && !isGiving) {
                        selectedItem = i.values[0];
                        
                        // Získáme data položky z databáze
                        let itemData = null;
                        await new Promise((resolve) => {
                            db.get(
                                `SELECT purchases.*, shop_items.name, shop_items.type 
                                 FROM purchases 
                                 JOIN shop_items ON purchases.item_id = shop_items.id 
                                 WHERE purchases.id = ?`,
                                [selectedItem],
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
                                content: '❌ Položka nebyla nalezena v databázi.',
                                components: []
                            });
                        }

                        const confirmationEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('Potvrzení odebrání')
                            .setDescription(`Opravdu chcete odebrat item **${itemData.name}**?`)
                            .addFields(
                                { name: 'Frakce', value: selectedFraction, inline: true },
                                { name: 'Sekce', value: selectedSection, inline: true }
                            );
                        
                        if (itemData.count && itemData.count > 1) {
                            confirmationEmbed.addFields({ 
                                name: 'Množství', 
                                value: `${itemData.count}x`, 
                                inline: true 
                            });
                        }

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

                    // Modify the select-item handler
                    else if (i.customId === 'select-item' && isGiving) {
                        selectedItem = i.values[0];
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                    
                        if (itemData.type === 'countable') {
                            itemState = { type: 'countable', selectedCount: 1 };
                            const display = createCountableDisplay(itemData, 1, isGiving);
                            await i.editReply({
                                embeds: [display.embed],
                                components: display.components
                            });
                        } else if (itemData.modifications) {
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
                            // Základní položka bez modifikací
                            itemState = { type: 'basic', selectedCount: 1 };
                            
                            const confirmButton = new ButtonBuilder()
                                .setCustomId('confirm-action')
                                .setLabel('Přidat')
                                .setStyle(ButtonStyle.Success);
                            
                            const cancelButton = new ButtonBuilder()
                                .setCustomId('cancel-action')
                                .setLabel('Zrušit')
                                .setStyle(ButtonStyle.Secondary);
                            
                            const basicEmbed = new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle(itemData.name)
                                .setDescription(`Chcete přidat tento předmět do frakce ${selectedFraction}?`);
                                
                            if (itemData.description) {
                                basicEmbed.addFields({ 
                                    name: 'Popis', 
                                    value: itemData.description.substring(0, 1024)
                                });
                            }
                            
                            await i.editReply({
                                embeds: [basicEmbed],
                                components: [new ActionRowBuilder().addComponents(confirmButton, cancelButton)]
                            });
                        }
                    }

                    // Add the select-count handler
                    else if (i.customId === 'select-count') {
                        const count = parseInt(i.values[0]);
                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        
                        itemState = { type: 'countable', selectedCount: count };
                        const display = createCountableDisplay(itemData, count, isGiving);
                        
                        await i.editReply({
                            embeds: [display.embed],
                            components: display.components
                        });
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

                    // Modify the confirm-action handler to handle countable items
                    else if (i.customId === 'confirm-action') {
                        try {
                            if (isGiving) {
                                // Přidání položky do frakce
                                const sourcePath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                                const itemData = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
                                
                                // Získáme ID frakce
                                let fractionId = null;
                                await new Promise((resolve) => {
                                    getFractionByName(selectedFraction, (err, fraction) => {
                                        if (!err && fraction) {
                                            fractionId = fraction.id;
                                        }
                                        resolve();
                                    });
                                });
                                
                                if (!fractionId) {
                                    await i.editReply({
                                        content: '❌ Frakce nebyla nalezena v databázi.',
                                        components: []
                                    });
                                    return collector.stop();
                                }
                                
                                // Získáme ID shop itemu
                                let shopItemId = null;
                                await new Promise((resolve) => {
                                    db.get(
                                        `SELECT id FROM shop_items WHERE name = ?`,
                                        [itemData.name],
                                        (err, row) => {
                                            if (!err && row) {
                                                shopItemId = row.id;
                                            }
                                            resolve();
                                        }
                                    );
                                });
                                
                                if (!shopItemId) {
                                    await i.editReply({
                                        content: '❌ Položka nebyla nalezena v databázi shopu.',
                                        components: []
                                    });
                                    return collector.stop();
                                }
                                
                                if (itemData.type === 'countable') {
                                    // Countable item - zkontrolujeme, zda už frakce tuto položku má
                                    let existingItem = null;
                                    await new Promise((resolve) => {
                                        db.get(
                                            `SELECT * FROM purchases WHERE fraction_id = ? AND item_id = ?`,
                                            [fractionId, shopItemId],
                                            (err, row) => {
                                                if (!err && row) {
                                                    existingItem = row;
                                                }
                                                resolve();
                                            }
                                        );
                                    });
                                    
                                    if (existingItem) {
                                        // Aktualizujeme existující položku
                                        const newCount = existingItem.count + itemState.selectedCount;
                                        await new Promise((resolve, reject) => {
                                            db.run(
                                                `UPDATE purchases SET count = ? WHERE id = ?`,
                                                [newCount, existingItem.id],
                                                function(err) {
                                                    if (err) reject(err);
                                                    else resolve();
                                                }
                                            );
                                        });
                                        
                                        // Přidáme audit log
                                        addAuditLog(
                                            interaction.user.id,
                                            'update_item',
                                            'purchase',
                                            existingItem.id.toString(),
                                            JSON.stringify({
                                                fractionName: selectedFraction,
                                                itemName: itemData.name,
                                                addedCount: itemState.selectedCount,
                                                newCount: newCount
                                            })
                                        );
                                        
                                        const resultEmbed = new EmbedBuilder()
                                            .setColor(0x00FF00)
                                            .setTitle('✅ Item aktualizován')
                                            .setDescription(`Množství bylo úspěšně přidáno do frakce ${selectedFraction}`)
                                            .addFields(
                                                { name: 'Item', value: itemData.name, inline: true },
                                                { name: 'Přidáno', value: `${itemState.selectedCount}x`, inline: true },
                                                { name: 'Nové množství', value: `${newCount}x`, inline: true },
                                                { name: 'ID', value: existingItem.id.toString(), inline: true }
                                            );
                                        
                                        await i.editReply({
                                            content: null,
                                            embeds: [resultEmbed],
                                            components: []
                                        });
                                    } else {
                                        // Vytvoříme novou položku
                                        let newItemId = null;
                                        await new Promise((resolve, reject) => {
                                            db.run(
                                                `INSERT INTO purchases 
                                                 (fraction_id, item_id, count, selected_mods, total_price, purchase_date, buyer)
                                                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                                [
                                                    fractionId,
                                                    shopItemId,
                                                    itemState.selectedCount,
                                                    null, // Countable itemy nemají modifikace
                                                    0,    // Cena je 0, protože je to admin přidání
                                                    new Date().toISOString(),
                                                    interaction.user.tag
                                                ],
                                                function(err) {
                                                    if (err) reject(err);
                                                    else {
                                                        newItemId = this.lastID;
                                                        resolve();
                                                    }
                                                }
                                            );
                                        });
                                        
                                        // Přidáme audit log
                                        addAuditLog(
                                            interaction.user.id,
                                            'add_item',
                                            'purchase',
                                            newItemId.toString(),
                                            JSON.stringify({
                                                fractionName: selectedFraction,
                                                itemName: itemData.name,
                                                count: itemState.selectedCount
                                            })
                                        );
                                        
                                        const resultEmbed = new EmbedBuilder()
                                            .setColor(0x00FF00)
                                            .setTitle('✅ Item přidán')
                                            .setDescription(`Item byl úspěšně přidán do frakce ${selectedFraction}`)
                                            .addFields(
                                                { name: 'Item', value: itemData.name, inline: true },
                                                { name: 'Množství', value: `${itemState.selectedCount}x`, inline: true },
                                                { name: 'ID', value: newItemId.toString(), inline: true }
                                            );
                                        
                                        await i.editReply({
                                            content: null,
                                            embeds: [resultEmbed],
                                            components: []
                                        });
                                    }
                                } else {
                                    // Nekountovatelný item s modifikacemi
                                    let newItemId = null;
                                    await new Promise((resolve, reject) => {
                                        db.run(
                                            `INSERT INTO purchases 
                                             (fraction_id, item_id, count, selected_mods, total_price, purchase_date, buyer)
                                             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                            [
                                                fractionId,
                                                shopItemId,
                                                1, // Vždy 1 pro nekountovatelné
                                                JSON.stringify(selectedMods),
                                                0, // Cena je 0, protože je to admin přidání
                                                new Date().toISOString(),
                                                interaction.user.tag
                                            ],
                                            function(err) {
                                                if (err) reject(err);
                                                else {
                                                    newItemId = this.lastID;
                                                    resolve();
                                                }
                                            }
                                        );
                                    });
                                    
                                    // Přidáme audit log
                                    addAuditLog(
                                        interaction.user.id,
                                        'add_item',
                                        'purchase',
                                        newItemId.toString(),
                                        JSON.stringify({
                                            fractionName: selectedFraction,
                                            itemName: itemData.name,
                                            modifications: selectedMods
                                        })
                                    );
                                    
                                    const resultEmbed = new EmbedBuilder()
                                        .setColor(0x00FF00)
                                        .setTitle('✅ Item přidán')
                                        .setDescription(`Item byl úspěšně přidán do frakce ${selectedFraction}`)
                                        .addFields(
                                            { name: 'Item', value: itemData.name, inline: true },
                                            { name: 'ID', value: newItemId.toString(), inline: true }
                                        );
                                    
                                    // Přidáme modifikace do výsledného embedu
                                    if (selectedMods.length > 0) {
                                        selectedMods.forEach(mod => {
                                            const modValue = `${mod.selected.split(':')[1]}${
                                                mod.subSelections && Object.keys(mod.subSelections).length > 0 ?
                                                    '\n' + Object.entries(mod.subSelections)
                                                        .map(([name, opt]) => `${name}: ${opt.name}`).join('\n') 
                                                    : ''
                                            }`;
                                            
                                            resultEmbed.addFields({ name: mod.modName, value: modValue, inline: true });
                                        });
                                    }
                                    
                                    await i.editReply({
                                        content: null,
                                        embeds: [resultEmbed],
                                        components: []
                                    });
                                }
                            } else {
                                // Odebrání položky z frakce
                                // Získáme data položky z databáze
                                let itemData = null;
                                await new Promise((resolve) => {
                                    db.get(
                                        `SELECT purchases.*, shop_items.name, shop_items.type 
                                         FROM purchases 
                                         JOIN shop_items ON purchases.item_id = shop_items.id 
                                         WHERE purchases.id = ?`,
                                        [selectedItem],
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
                                        content: '❌ Položka nebyla nalezena v databázi.',
                                        components: []
                                    });
                                }
                                
                                // Odstraníme položku z databáze
                                await new Promise((resolve, reject) => {
                                    db.run(
                                        `DELETE FROM purchases WHERE id = ?`,
                                        [selectedItem],
                                        function(err) {
                                            if (err) reject(err);
                                            else resolve();
                                        }
                                    );
                                });
                                
                                // Přidáme audit log
                                addAuditLog(
                                    interaction.user.id,
                                    'remove_item',
                                    'purchase',
                                    selectedItem,
                                    JSON.stringify({
                                        fractionName: selectedFraction,
                                        itemName: itemData.name,
                                        count: itemData.count || 1
                                    })
                                );
                                
                                const resultEmbed = new EmbedBuilder()
                                    .setColor(0xFF0000)
                                    .setTitle('✅ Item odebrán')
                                    .setDescription(`Item byl úspěšně odebrán z frakce ${selectedFraction}`)
                                    .addFields(
                                        { name: 'Item', value: itemData.name, inline: true },
                                        { name: 'Sekce', value: selectedSection, inline: true }
                                    );
                                
                                if (itemData.count && itemData.count > 1) {
                                    resultEmbed.addFields({ 
                                        name: 'Množství', 
                                        value: `${itemData.count}x`, 
                                        inline: true 
                                    });
                                }
                                
                                await i.editReply({
                                    content: null,
                                    embeds: [resultEmbed],
                                    components: []
                                });
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