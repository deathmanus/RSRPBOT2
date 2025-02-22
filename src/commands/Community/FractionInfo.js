const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');



// First, modify the item counting function to return more details
function getInventoryDetails(dirPath) {
    if (!fs.existsSync(dirPath)) return { count: 0, items: [] };
    
    const items = fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.json'))
        .map(file => {
            const itemData = JSON.parse(fs.readFileSync(path.join(dirPath, file)));
            return {
                name: itemData.name,
                id: itemData.id,
                modifications: itemData.selectedMods || []
            };
        });

    return {
        count: items.length,
        items: items
    };
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
                    const fractionFilePath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                    const fractionData = JSON.parse(fs.readFileSync(fractionFilePath, 'utf8'));

                    const { nazev, popis, roomId, leaderRoleId, deputyRoleId, fractionRoleId, money, warns, creationDate } = fractionData;

                    if (!nazev || !popis || !roomId || !leaderRoleId || !deputyRoleId || !fractionRoleId || money === undefined || warns === undefined || !creationDate) {
                        throw new Error('Invalid fraction data format');
                    }

                    const guild = interaction.guild;
                    const room = guild.channels.cache.get(roomId);
                    const leaderRole = guild.roles.cache.get(leaderRoleId);
                    const deputyRole = guild.roles.cache.get(deputyRoleId);
                    const fractionRole = guild.roles.cache.get(fractionRoleId);

                    const leader = leaderRole ? leaderRole.members.map(member => member.user.tag).join(', ') : 'N/A';
                    const deputy = deputyRole ? deputyRole.members.map(member => member.user.tag).join(', ') : 'N/A';
                    const fractionMembersCount = fractionRole ? fractionRole.members.size : 0;

                    const creationDateObj = new Date(creationDate);
                    const now = new Date();
                    const diffTime = Math.abs(now - creationDateObj);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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

                    // Modify the fractionEmbed creation
                    const fractionEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle(nazev)
                        .setDescription(popis)
                        .addFields(
                            { name: 'Zkratka frakce', value: selectedFraction, inline: true },
                            { name: 'Room', value: room ? `<#${room.id}>` : 'N/A', inline: true },
                            { name: 'Velitel', value: leader, inline: true },
                            { name: 'Zástupce', value: deputy, inline: true },
                            { name: 'Členové frakce', value: `${fractionMembersCount}`, inline: true },
                            { name: 'Peníze', value: money.toString(), inline: true },
                            { name: 'Frakční warny', value: warns.toString(), inline: true },
                            { name: 'Doba existence', value: `${diffDays} dní`, inline: true }
                        );

                    // Add total items count if any items exist
                    if (totalItems > 0) {
                        fractionEmbed.addFields({
                            name: 'Celkový počet předmětů',
                            value: `${totalItems}`,
                            inline: false
                        });
                    }

                    // Add inventory fields
                    if (inventoryFields.length > 0) {
                        fractionEmbed.addFields(...inventoryFields);
                    } else {
                        fractionEmbed.addFields({
                            name: 'Inventář',
                            value: 'Žádné předměty',
                            inline: false
                        });
                    }

                    await i.update({ embeds: [fractionEmbed], components: [] });

                    // Po úspěšné interakci collector ukončíme
                    collector.stop('completed');

                } catch (error) {
                    console.error('Chyba při zobrazení informací o frakci:', error);
                    await interaction.followUp({ content: '❌ Chyba při zobrazení informací o frakci.', ephemeral: true });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({ content: '⌛ Časový limit vypršel. Akce byla zrušena.', components: [], ephemeral: true });
                }

                // Odebereme collector z paměti, protože skončil
                activeCollectors.delete(userId);
            });

        } catch (error) {
            console.error('Chyba v příkazu fractioninfo:', error);
            await interaction.followUp({ content: '❌ Chyba při zpracování příkazu.', ephemeral: true });
        }
    }
};