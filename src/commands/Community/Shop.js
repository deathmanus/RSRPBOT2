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
                        const { name, basePrice, modifications } = itemData;

                        logShop('Item Selected', {
                            item: selectedItem,
                            basePrice,
                            availableModifications: Object.keys(modifications)
                        });

                        // Initialize modifications with default selections
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

                        logShop('Initial Modifications Set', { selectedMods });

                        const modRows = [];

                        // Create modification menus
                        Object.entries(modifications).forEach(([modName, modValues], index) => {
                            modRows.push(
                                new ActionRowBuilder().addComponents(
                                    new StringSelectMenuBuilder()
                                        .setCustomId(`select-mod-${index}`)
                                        .setPlaceholder(`Vyberte ${modName}`)
                                        .addOptions(modValues.map((opt, idx) => ({
                                            label: opt.name,
                                            value: `${modName}:${opt.name}:${opt.price || 0}`,
                                            default: idx === 0
                                        })))
                                )
                            );

                            // Add sub-option menus if available
                            if (modValues[0].subOptions) {
                                Object.entries(modValues[0].subOptions).forEach(([subName, subValues]) => {
                                    modRows.push(
                                        new ActionRowBuilder().addComponents(
                                            new StringSelectMenuBuilder()
                                                .setCustomId(`select-submod-${index}-${subName}`)
                                                .setPlaceholder(`Vyberte ${subName}`)
                                                .addOptions(subValues.map((opt, idx) => ({
                                                    label: opt.name,
                                                    value: `${subName}:${opt.name}:${opt.price || 0}`,
                                                    default: idx === 0
                                                })))
                                        )
                                    );
                                });
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

                        const totalPrice = calculateTotalPrice(basePrice, selectedMods);

                        logShop('Price Calculation', {
                            basePrice,
                            totalPrice,
                            modifications: selectedMods
                        });

                        const itemEmbed = createItemEmbed(name, basePrice, totalPrice, selectedMods);

                        await i.editReply({
                            embeds: [itemEmbed],
                            components: modRows
                        });
                    }
                    else if (i.customId.startsWith('select-mod-')) {
                        const modIndex = parseInt(i.customId.split('-')[2], 10);
                        const [modName, optName, optPrice] = i.values[0].split(':');

                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const { name, basePrice, modifications } = itemData;

                        const selectedModification = modifications[modName];
                        const selectedOption = selectedModification.find(opt => opt.name === optName);

                        // Update only the changed modification
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

                        logShop('Modification Selected', {
                            modIndex,
                            modName,
                            optName,
                            price: selectedOption.price,
                            subOptions: selectedOption.subOptions
                        });

                        const modRows = createModificationRows(modifications, selectedMods);
                        const totalPrice = calculateTotalPrice(basePrice, selectedMods);
                        const itemEmbed = createItemEmbed(name, basePrice, totalPrice, selectedMods);

                        await i.editReply({
                            embeds: [itemEmbed],
                            components: modRows
                        });
                    }
                    else if (i.customId.startsWith('select-submod-')) {
                        const [, modIndex, subModName] = i.customId.split('-');
                        const [subMod, optName, optPrice] = i.values[0].split(':');

                        const itemPath = path.join(shopDir, selectedSection, `${selectedItem}.json`);
                        const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const { name, basePrice, modifications } = itemData;

                        // Update sub-selection
                        if (!selectedMods[modIndex].subSelections) {
                            selectedMods[modIndex].subSelections = {};
                        }

                        const mainModName = selectedMods[modIndex].modName;
                        const mainOptName = selectedMods[modIndex].selected.split(':')[1];
                        const mainOpt = modifications[mainModName].find(opt => opt.name === mainOptName);
                        const subOpt = mainOpt.subOptions[subMod].find(opt => opt.name === optName);

                        selectedMods[modIndex].subSelections[subMod] = {
                            name: optName,
                            price: subOpt.price || 0
                        };

                        logShop('Sub-Modification Selected', {
                            modIndex,
                            subModName,
                            optName,
                            price: subOpt.price
                        });

                        const modRows = createModificationRows(modifications, selectedMods);
                        const totalPrice = calculateTotalPrice(basePrice, selectedMods);
                        const itemEmbed = createItemEmbed(name, basePrice, totalPrice, selectedMods);

                        await i.editReply({
                            embeds: [itemEmbed],
                            components: modRows
                        });
                    }
                    // ... rest of your code (buy-item handler, etc.)
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