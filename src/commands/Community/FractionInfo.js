const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    EmbedBuilder,
    AttachmentBuilder 
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// Update the getInventoryDetails function
function getInventoryDetails(dirPath) {
    if (!fs.existsSync(dirPath)) return { count: 0, items: [] };
    
    const items = fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.json'))
        .map(file => {
            const itemData = JSON.parse(fs.readFileSync(path.join(dirPath, file)));
            return {
                name: itemData.name,
                id: itemData.id,
                count: itemData.count,
                type: itemData.type,
                modifications: itemData.selectedMods || []
            };
        });

    return {
        count: items.length,
        items: items
    };
}

function getTimeDifference(dateString) {
    const creationDate = new Date(dateString);
    const now = new Date();
    
    const diffTime = Math.abs(now - creationDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Dnes';
    if (diffDays === 1) return 'Včera';
    
    const weeks = Math.floor(diffDays / 7);
    const remainingDays = diffDays % 7;
    
    let timeString = '';
    if (weeks > 0) {
        timeString += `${weeks} ${weeks === 1 ? 'týden' : weeks < 5 ? 'týdny' : 'týdnů'}`;
        if (remainingDays > 0) timeString += ` a ${remainingDays} ${remainingDays === 1 ? 'den' : remainingDays < 5 ? 'dny' : 'dní'}`;
    } else {
        timeString = `${diffDays} ${diffDays === 1 ? 'den' : diffDays < 5 ? 'dny' : 'dní'}`;
    }
    
    return timeString;
}

let activeCollectors = new Map(); // Uložíme collectory pro každého uživatele

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fractioninfo')
        .setDescription('Zobrazí informace o frakci'),
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const userId = interaction.user.id;

            // Pokud uživatel má aktivní collector, ukončíme ho
            if (activeCollectors.has(userId)) {
                activeCollectors.get(userId).stop('new_interaction');
            }

            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (fractions.length === 0) {
                return await interaction.followUp({ content: '❌ Žádné frakce k zobrazení.', ephemeral: true });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`select-fraction-info-${userId}`)
                .setPlaceholder('Vyberte frakci k zobrazení informací')
                .addOptions(fractions.map(fraction => ({
                    label: fraction,
                    value: fraction
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Informace o frakci')
                .setDescription('Vyberte frakci z dropdown menu pro zobrazení informací.');

            await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });

            const filter = i => i.customId === `select-fraction-info-${userId}` && i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            // Uložíme nový collector
            activeCollectors.set(userId, collector);

            collector.on('collect', async i => {
                try {
                    const selectedFraction = i.values[0];
                    const fractionPath = path.join(fractionsDir, selectedFraction);
                    const fractionData = JSON.parse(fs.readFileSync(path.join(fractionPath, `${selectedFraction}.json`)));

                    // Get guild roles and channel
                    const guild = interaction.guild;
                    const fractionRole = guild.roles.cache.get(fractionData.fractionRoleId);
                    const leaderRole = guild.roles.cache.get(fractionData.leaderRoleId);
                    const deputyRole = guild.roles.cache.get(fractionData.deputyRoleId);
                    const room = guild.channels.cache.get(fractionData.roomId);

                    // Get members with roles
                    const fractionMembers = fractionRole ? guild.members.cache.filter(m => m.roles.cache.has(fractionRole.id)) : [];
                    const leader = leaderRole ? guild.members.cache.find(m => m.roles.cache.has(leaderRole.id))?.user.tag : 'Není';
                    const deputy = deputyRole ? guild.members.cache.find(m => m.roles.cache.has(deputyRole.id))?.user.tag : 'Není';

                    // Before creating fractionEmbed, add this code
                    const files = [];
                    if (fractionData.logoUrl || fractionData.imageUrl) {
                        const logoPath = path.join(fractionPath, fractionData.logoUrl || fractionData.imageUrl);
                        if (fs.existsSync(logoPath)) {
                            const logoAttachment = new AttachmentBuilder(logoPath);
                            files.push(logoAttachment);
                        }
                    }

                    const fractionEmbed = new EmbedBuilder()
                        .setColor(fractionRole ? fractionRole.hexColor : 0x00FF00)
                        .setTitle(`ℹ️ ${fractionData.nazev}`);

                    // If we have a logo, set it as thumbnail
                    if (files.length > 0) {
                        fractionEmbed.setThumbnail(`attachment://${fractionData.logoUrl || fractionData.imageUrl}`);
                    }

                    // Continue with the rest of embed setup...
                    fractionEmbed.setDescription(`>>> ${fractionData.popis || 'Žádný popis'}\n`)
                        .addFields(
                            { 
                                name: '👥 Vedení',
                                value: `\n${[
                                    `👑 **Velitel:** ${leader || 'Nikdo' }`,
                                    `🎖️ **Zástupce:** ${deputy || 'Nikdo' }`,
                                    `👤 **Počet členů:** ${fractionMembers.size || 0}`
                                ].join('\n')}\n`,
                                inline: false 
                            },
                            {
                                name: '🎭 Role',
                                value: `\n${[
                                    `⭐ Velitel: ${leaderRole}`,
                                    `🌟 Zástupce: ${deputyRole}`,
                                    `👥 Člen: ${fractionRole}`
                                ].join('\n')}\n`,
                                inline: false
                            },
                            {
                                name: '📊 Statistiky',
                                value: `\n${[
                                    `💰 **Peníze:** ${(fractionData.money || 0).toLocaleString()} $`,
                                    `⚠️ **Warny:** ${fractionData.warns || 0}/3`,
                                    `📅 **Založeno před:** ${fractionData.creationDate ? getTimeDifference(fractionData.creationDate) : 'Neznámo'}`,                                    `💬 **Kanál:** ${room}`
                                ].join('\n')}\n`,
                                inline: false
                            }
                        );

                    // Get inventory details
                    const categories = {
                        'Air vehicles': path.join(fractionsDir, selectedFraction, 'Air vehicles'),
                        'Ground vehicles': path.join(fractionsDir, selectedFraction, 'Ground vehicles'),
                        'Equipment': path.join(fractionsDir, selectedFraction, 'Equipment'),
                        'Resources': path.join(fractionsDir, selectedFraction, 'Resources')
                    };

                    let inventoryDetails = '';
                    let totalItems = 0;
                    const inventoryFields = [];

                    for (const [category, categoryPath] of Object.entries(categories)) {
                        const inventory = getInventoryDetails(categoryPath);
                        totalItems += inventory.count;

                        if (inventory.count > 0) {
                            const itemsList = inventory.items.map(item => {
                                let itemText = item.name;
                                if (item.modifications && item.modifications.length > 0) {
                                    const mods = item.modifications
                                        .map(mod => {
                                            let modText = mod.selected.split(':')[1];
                                            if (mod.subSelections && Object.keys(mod.subSelections).length > 0) {
                                                modText += ': ' + Object.entries(mod.subSelections)
                                                    .map(([name, opt]) => `${opt.name}`)
                                                    .join(', ');
                                            }
                                            return modText;
                                        })
                                        .join(' | ');
                                    itemText += ` (${mods})`;
                                }
                                return itemText;
                            });

                            inventoryFields.push({
                                name: `${category} (${inventory.count})`,
                                value: itemsList.join('\n'),
                                inline: false
                            });
                        }
                    }

                    // Update the inventory display part in the collector's collect event
                    if (totalItems > 0) {
                        fractionEmbed.addFields({
                            name: '🎒 Inventář',
                            value: `\nCelkem předmětů: ${totalItems}\n`,
                            inline: false
                        });

                        const categoryEmojis = {
                            'Air vehicles': '🚁',
                            'Ground vehicles': '🚗',
                            'Equipment': '🎖️',
                            'Resources': '📦'
                        };

                        for (const [category, categoryPath] of Object.entries(categories)) {
                            const inventory = getInventoryDetails(categoryPath);
                            if (inventory.count > 0) {
                                const formattedItems = inventory.items.map(item => {
                                    if (item.type === 'countable') {
                                        return `• ${item.name} (${item.count}x)`;
                                    }
                                    if (item.modifications && item.modifications.length > 0) {
                                        const mods = item.modifications
                                            .map(mod => {
                                                let modText = mod.selected.split(':')[1];
                                                if (mod.subSelections && Object.keys(mod.subSelections).length > 0) {
                                                    modText += ': ' + Object.entries(mod.subSelections)
                                                        .map(([name, opt]) => `${opt.name}`)
                                                        .join(', ');
                                                }
                                                return modText;
                                            })
                                            .join(' | ');
                                        return `• ${item.name} (${mods})`;
                                    }
                                    return `• ${item.name}`;
                                }).join('\n');

                                fractionEmbed.addFields({
                                    name: `${categoryEmojis[category]} ${category} (${inventory.count})`,
                                    value: `\n${formattedItems}\n`,
                                    inline: false
                                });
                            }
                        }
                    } else {
                        fractionEmbed.addFields({
                            name: '🎒 Inventář',
                            value: '\n> Žádné předměty\n',
                            inline: false
                        });
                    }

                    // Add footer with fraction ID
                    fractionEmbed.setFooter({ 
                        text: `ID Frakce: ${selectedFraction}` 
                    });

                    // Add timestamp
                    fractionEmbed.setTimestamp();

                    // Update the i.update call to include files
                    await i.update({ 
                        embeds: [fractionEmbed], 
                        files: files,
                        components: [] 
                    });

                    // Po úspěšné interakci collector ukončíme
                    collector.stop('completed');

                } catch (error) {
                    console.error('Chyba při zobrazení informací o frakci:', error);
                    try {
                        await i.update({ 
                            content: '❌ Chyba při zobrazení informací o frakci.', 
                            embeds: [], 
                            components: [], 
                            files: [] 
                        });
                    } catch (updateError) {
                        console.error('Chyba při aktualizaci zprávy:', updateError);
                    }
                    collector.stop('error');
                }
            });

            collector.on('end', async (collected, reason) => {
                try {
                    // Remove collector from memory
                    activeCollectors.delete(userId);

                    if (reason === 'time') {
                        await interaction.editReply({ 
                            content: '⌛ Časový limit vypršel. Akce byla zrušena.', 
                            embeds: [], 
                            components: [], 
                            files: [] 
                        });
                    } else if (reason === 'error') {
                        // Error already handled in collect event
                        return;
                    } else if (reason === 'completed') {
                        // Successfully completed, no need for additional message
                        return;
                    }
                } catch (error) {
                    console.error('Chyba při ukončení collectoru:', error);
                }
            });

        } catch (error) {
            console.error('Chyba v příkazu fractioninfo:', error);
            try {
                await interaction.editReply({ 
                    content: '❌ Chyba při zpracování příkazu.', 
                    embeds: [], 
                    components: [], 
                    files: [] 
                });
            } catch (replyError) {
                console.error('Chyba při odeslání chybové zprávy:', replyError);
            }
        }
    }
};