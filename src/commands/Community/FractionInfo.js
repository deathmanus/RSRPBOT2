const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    EmbedBuilder,
    AttachmentBuilder 
} = require('discord.js');
const { getEmoji, getCategoryEmoji } = require('../../utils/emojiUtils');
const fs = require('fs');
const path = require('path');
const { getFractionByName, getFractionItems } = require('../../Database/database');

// Update the getInventoryDetails function
async function getInventoryDetails(fractionName, category) {
    return new Promise((resolve) => {
        getFractionItems(fractionName, (err, items) => {
            if (err || !items || items.length === 0) {
                resolve({ count: 0, items: [] });
                return;
            }
            
            // Filter items by category based on shop_items.type
            const categoryItems = items.filter(item => {
                switch (category) {
                    case 'Air vehicles':
                        return item.type === 'air_vehicle';
                    case 'Ground vehicles':
                        return item.type === 'ground_vehicle';
                    case 'Equipment':
                        return item.type === 'equipment';
                    case 'Resources':
                        return item.type === 'resource';
                    default:
                        return false;
                }
            });
            
            const formattedItems = categoryItems.map(item => {
                return {
                    name: item.name,
                    id: item.id,
                    count: item.count,
                    type: item.type,
                    modifications: item.selected_mods ? JSON.parse(item.selected_mods) : []
                };
            });
            
            resolve({
                count: formattedItems.length,
                items: formattedItems
            });
        });
    });
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
            const { db } = require('../../Database/database');
            await interaction.deferReply({ ephemeral: true });

            const userId = interaction.user.id;

            // Pokud uživatel má aktivní collector, ukončíme ho
            if (activeCollectors.has(userId)) {
                activeCollectors.get(userId).stop('new_interaction');
            }

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

            if (fractions.length === 0) {
                return await interaction.followUp({ 
                    content: `${getEmoji('error')} Žádné frakce k zobrazení.`, 
                    ephemeral: true 
                });
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
                .setTitle(`${getEmoji('info')} Informace o frakci`)
                .setDescription('Vyberte frakci z dropdown menu pro zobrazení informací.');

            await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });

            const filter = i => i.customId === `select-fraction-info-${userId}` && i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            // Uložíme nový collector
            activeCollectors.set(userId, collector);

            collector.on('collect', async i => {
                try {
                    const selectedFraction = i.values[0];
                    
                    // Get fraction data from database
                    let fractionData;
                    await new Promise((resolve) => {
                        getFractionByName(selectedFraction, (err, fraction) => {
                            fractionData = fraction;
                            resolve();
                        });
                    });
                    
                    if (!fractionData) {
                        await i.update({ 
                            content: `${getEmoji('error')} Frakce nebyla nalezena v databázi.`, 
                            embeds: [], 
                            components: [] 
                        });
                        collector.stop('error');
                        return;
                    }

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
                    if (fractionData.logoPath) {
                        const logoPath = path.join(__dirname, '../../Database/Files/Fractions', fractionData.name, fractionData.logoPath);
                        if (fs.existsSync(logoPath)) {
                            const logoAttachment = new AttachmentBuilder(logoPath);
                            files.push(logoAttachment);
                        }
                    }

                    const fractionEmbed = new EmbedBuilder()
                        .setColor(fractionRole ? fractionRole.hexColor : 0x00FF00)
                        .setTitle(`${getEmoji('fraction')} ${fractionData.name}`);

                    // If we have a logo, set it as thumbnail
                    if (files.length > 0) {
                        fractionEmbed.setThumbnail(`attachment://${fractionData.logoPath}`);
                    }

                    // Continue with the rest of embed setup...
                    fractionEmbed.setDescription(`>>> ${fractionData.description || 'Žádný popis'}\n`)
                        .addFields(
                            { 
                                name: `${getEmoji('members')} Vedení`,
                                value: `\n${[
                                    `${getEmoji('leader')} **Velitel:** ${leader || 'Nikdo'}`,
                                    `${getEmoji('deputy')} **Zástupce:** ${deputy || 'Nikdo'}`,
                                    `${getEmoji('member')} **Počet členů:** ${fractionMembers.size || 0}`
                                ].join('\n')}\n`,
                                inline: false 
                            },
                            {
                                name: `${getEmoji('roles')} Role`,
                                value: `\n${[
                                    `${getEmoji('leader')} Velitel: ${leaderRole}`,
                                    `${getEmoji('deputy')} Zástupce: ${deputyRole}`,
                                    `${getEmoji('member')} Člen: ${fractionRole}`
                                ].join('\n')}\n`,
                                inline: false
                            },
                            {
                                name: `${getEmoji('stats')} Statistiky`,
                                value: `\n${[
                                    `${getEmoji('money')} **Peníze:** ${(fractionData.money || 0).toLocaleString()} ${getEmoji('money')}`,
                                    `${getEmoji('warns')} **Warny:** ${fractionData.warns || 0}/3`,
                                    `${getEmoji('dates')} **Založeno před:** ${fractionData.creationDate ? getTimeDifference(fractionData.creationDate) : 'Neznámo'}`,
                                    `${getEmoji('channel')} **Kanál:** ${room}`
                                ].join('\n')}\n`,
                                inline: false
                            }
                        );

                    // Get inventory details
                    const categories = ['Air vehicles', 'Ground vehicles', 'Equipment', 'Resources'];
                    
                    let totalItems = 0;
                    const inventoryByCategory = {};
                    
                    // Get inventory for each category
                    for (const category of categories) {
                        const inventory = await getInventoryDetails(fractionData.name, category);
                        totalItems += inventory.count;
                        inventoryByCategory[category] = inventory;
                    }

                    // Update the inventory display part
                    if (totalItems > 0) {
                        fractionEmbed.addFields({
                            name: `${getEmoji('inventory')} Inventář`,
                            value: `\nCelkem předmětů: ${totalItems}\n`,
                            inline: false
                        });

                        const categoryEmojis = {
                            'Air vehicles': '🚁',
                            'Ground vehicles': '🚗',
                            'Equipment': '🎖️',
                            'Resources': '📦'
                        };

                        for (const category of categories) {
                            const inventory = inventoryByCategory[category];
                            if (inventory.count > 0) {
                                const formattedItems = inventory.items.map(item => {
                                    if (item.type === 'countable' || item.type === 'resource') {
                                        return `• ${item.name} (${item.count}x)`;
                                    }
                                    if (item.modifications && item.modifications.length > 0) {
                                        const mods = item.modifications
                                            .map(mod => {
                                                let modText = mod.selected ? mod.selected.split(':')[1] : '';
                                                if (mod.subSelections && Object.keys(mod.subSelections).length > 0) {
                                                    modText += ': ' + Object.entries(mod.subSelections)
                                                        .map(([name, opt]) => `${opt.name}`)
                                                        .join(', ');
                                                }
                                                return modText;
                                            })
                                            .filter(mod => mod) // Filter out empty mods
                                            .join(' | ');
                                        return `• ${item.name}${mods ? ` (${mods})` : ''}`;
                                    }
                                    return `• ${item.name}`;
                                }).join('\n');

                                const categoryKey = category.toLowerCase().replace(' ', '_');
                                fractionEmbed.addFields({
                                    name: `${getCategoryEmoji(categoryKey) || categoryEmojis[category]} ${category} (${inventory.count})`,
                                    value: `\n${formattedItems}\n`,
                                    inline: false
                                });
                            }
                        }
                    } else {
                        fractionEmbed.addFields({
                            name: `${getEmoji('inventory')} Inventář`,
                            value: '\n> Žádné předměty\n',
                            inline: false
                        });
                    }

                    // Add footer with fraction ID
                    fractionEmbed.setFooter({ 
                        text: `ID Frakce: ${fractionData.id}` 
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
                            content: `${getEmoji('error')} Chyba při zobrazení informací o frakci.`, 
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
                    content: `${getEmoji('error')} Chyba při zpracování příkazu.`, 
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