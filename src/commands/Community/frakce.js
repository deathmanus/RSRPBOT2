const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder,
    AttachmentBuilder,
    PermissionsBitField
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getEmoji, getCategoryEmoji } = require('../../utils/emojiUtils');
const { 
    db, 
    getFractionByName, 
    getFractionItems,
    updateFraction,
    addPermission, 
    addAuditLog 
} = require('../../Database/database');

let activeCollectors = new Map(); // Uložíme collectory pro každého uživatele

module.exports = {
    data: new SlashCommandBuilder()
        .setName('frakce')
        .setDescription('Správa frakcí - informace, úpravy a role')
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Zobrazí informace o frakci'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Upraví nastavení frakce')
                .addStringOption(option => 
                    option.setName('popis')
                        .setDescription('Nový popis frakce')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('barva')
                        .setDescription('Nová barva v hexadecimálním formátu (např. FF0000)')
                        .setRequired(false))
                .addAttachmentOption(option =>
                    option.setName('obrazek')
                        .setDescription('Nový obrázek frakce')
                        .setRequired(false)))
        .addSubcommandGroup(group =>
            group
                .setName('role')
                .setDescription('Správa rolí členů frakce')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('add')
                        .setDescription('Přidá uživatele do frakce')
                        .addUserOption(option =>
                            option
                                .setName('user')
                                .setDescription('Uživatel k přidání')
                                .setRequired(true))
                        .addBooleanOption(option =>
                            option
                                .setName('deputy')
                                .setDescription('Přidat jako zástupce')
                                .setRequired(false)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('remove')
                        .setDescription('Odebere uživatele z frakce')
                        .addUserOption(option =>
                            option
                                .setName('user')
                                .setDescription('Uživatel, kterému chcete odebrat roli')
                                .setRequired(true)))),

    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();
            const subcommandGroup = interaction.options.getSubcommandGroup();

            if (subcommand === 'info') {
                await handleInfo(interaction);
            } else if (subcommand === 'edit') {
                await handleEdit(interaction);
            } else if (subcommandGroup === 'role') {
                if (subcommand === 'add') {
                    await handleRoleAdd(interaction);
                } else if (subcommand === 'remove') {
                    await handleRoleRemove(interaction);
                }
            }
        } catch (error) {
            console.error('Error in frakce command:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ 
                        content: '❌ Nastala chyba při zpracování příkazu.', 
                        ephemeral: true 
                    });
                } else {
                    await interaction.editReply({ 
                        content: '❌ Nastala chyba při zpracování příkazu.',
                        embeds: [],
                        components: [],
                        files: []
                    });
                }
            } catch (replyError) {
                console.error('Error replying to interaction:', replyError);
            }
        }
    }
};

// Helper function to get inventory details
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

// Helper function to get time difference
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

// Handle /frakce info subcommand
async function handleInfo(interaction) {
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
            content: `${await getEmoji('error') || '❌'} Žádné frakce k zobrazení.`, 
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
        .setTitle(`${await getEmoji('info') || 'ℹ️'} Informace o frakci`)
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
                    content: `${await getEmoji('error') || '❌'} Frakce nebyla nalezena v databázi.`, 
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

            // Check for logo file
            const files = [];
            if (fractionData.logoPath) {
                const logoPath = path.join(__dirname, '../../Database/Files/Fractions', fractionData.name, fractionData.logoPath);
                if (fs.existsSync(logoPath)) {
                    const logoAttachment = new AttachmentBuilder(logoPath);
                    files.push(logoAttachment);
                }
            }

            // Pre-load all needed emojis
            const emojis = {
                fraction: await getEmoji('fraction') || '🏛️',
                members: await getEmoji('members') || '👥',
                leader: await getEmoji('leader') || '👑',
                deputy: await getEmoji('deputy') || '🥈',
                member: await getEmoji('member') || '👤',
                roles: await getEmoji('roles') || '🎭',
                stats: await getEmoji('stats') || '📊',
                money: await getEmoji('money') || '💰',
                warns: await getEmoji('warns') || '⚠️',
                dates: await getEmoji('dates') || '📅',
                channel: await getEmoji('channel') || '💬',
                inventory: await getEmoji('inventory') || '📦'
            };

            const fractionEmbed = new EmbedBuilder()
                .setColor(fractionRole ? fractionRole.hexColor : 0x00FF00)
                .setTitle(`${emojis.fraction} ${fractionData.name}`);

            // If we have a logo, set it as thumbnail
            if (files.length > 0) {
                fractionEmbed.setThumbnail(`attachment://${fractionData.logoPath}`);
            }

            fractionEmbed.setDescription(`>>> ${fractionData.description || 'Žádný popis'}\n`)
                .addFields(
                    { 
                        name: `${emojis.members} Vedení`,
                        value: `\n${[
                            `${emojis.leader} **Velitel:** ${leader || 'Nikdo'}`,
                            `${emojis.deputy} **Zástupce:** ${deputy || 'Nikdo'}`,
                            `${emojis.member} **Počet členů:** ${fractionMembers.size || 0}`
                        ].join('\n')}\n`,
                        inline: false 
                    },
                    {
                        name: `${emojis.roles} Role`,
                        value: `\n${[
                            `${emojis.leader} Velitel: ${leaderRole}`,
                            `${emojis.deputy} Zástupce: ${deputyRole}`,
                            `${emojis.member} Člen: ${fractionRole}`
                        ].join('\n')}\n`,
                        inline: false
                    },
                    {
                        name: `${emojis.stats} Statistiky`,
                        value: `\n${[
                            `${emojis.money} **Peníze:** ${(fractionData.money || 0).toLocaleString()} ${emojis.money}`,
                            `${emojis.warns} **Warny:** ${fractionData.warns || 0}/3`,
                            `${emojis.dates} **Založeno před:** ${fractionData.creationDate ? getTimeDifference(fractionData.creationDate) : 'Neznámo'}`,
                            `${emojis.channel} **Kanál:** ${room}`
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
                    name: `${emojis.inventory} Inventář`,
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
                    name: `${emojis.inventory} Inventář`,
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

            await i.update({ 
                embeds: [fractionEmbed], 
                files: files,
                components: [] 
            });

            collector.stop('completed');

        } catch (error) {
            console.error('Chyba při zobrazení informací o frakci:', error);
            try {
                await i.update({ 
                    content: `${await getEmoji('error') || '❌'} Chyba při zobrazení informací o frakci.`, 
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
            }
        } catch (error) {
            console.error('Chyba při ukončení collectoru:', error);
        }
    });
}

// Handle /frakce edit subcommand
async function handleEdit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Check if user is in a fraction
    const member = interaction.member;
    let fractionRole = null;
    
    for (const role of member.roles.cache.values()) {
        const fractionExists = await new Promise((resolve) => {
            getFractionByName(role.name, (err, fraction) => {
                resolve(fraction !== undefined && !err);
            });
        });
        if (fractionExists) {
            fractionRole = role;
            break;
        }
    }
    
    if (!fractionRole) {
        return await interaction.editReply({
            content: '❌ Nejste členem žádné frakce.',
            components: []
        });
    }
    
    // Get fraction data from database
    const fractionName = fractionRole.name;
    let fractionData;
    
    await new Promise((resolve) => {
        getFractionByName(fractionName, (err, fraction) => {
            fractionData = fraction;
            resolve();
        });
    });
    
    if (!fractionData) {
        return await interaction.editReply({
            content: '❌ Nastala chyba při načítání dat frakce.',
            components: []
        });
    }
    
    // Create directory for fraction files if it doesn't exist
    const fractionFilesDir = path.join(__dirname, '../../Database/Files/Fractions', fractionName);
    if (!fs.existsSync(fractionFilesDir)) {
        fs.mkdirSync(fractionFilesDir, { recursive: true });
    }

    // Handle changes
    const newPopis = interaction.options.getString('popis');
    const newBarva = interaction.options.getString('barva');
    const newImage = interaction.options.getAttachment('obrazek');
    let changes = [];

    if (newPopis) {
        fractionData.description = newPopis;
        changes.push('✏️ Popis');
    }

    if (newBarva) {
        if (!/^[0-9A-Fa-f]{6}$/.test(newBarva)) {
            return await interaction.editReply({
                content: '❌ Barva musí být hexadecimální kód o délce 6 znaků (např. FF0000).'
            });
        }

        // Update roles color
        const guild = interaction.guild;
        const roles = [
            guild.roles.cache.get(fractionData.fractionRoleId),
            guild.roles.cache.get(fractionData.leaderRoleId),
            guild.roles.cache.get(fractionData.deputyRoleId)
        ];

        for (const role of roles) {
            if (role) {
                await role.setColor(`#${newBarva}`);
            }
        }

        fractionData.color = newBarva;
        changes.push('🎨 Barva');
    }

    if (newImage) {
        // Check if image is valid
        if (!newImage.contentType?.startsWith('image/')) {
            return await interaction.editReply({
                content: '❌ Nahrát lze pouze obrázky.'
            });
        }

        // Download and save image
        const response = await axios.get(newImage.url, { responseType: 'arraybuffer' });
        const imageExt = newImage.contentType.split('/')[1];
        const imagePath = path.join(fractionFilesDir, `logo.${imageExt}`);

        fs.writeFileSync(imagePath, response.data);
        fractionData.logoPath = `logo.${imageExt}`;
        changes.push('🖼️ Obrázek');
    }

    if (changes.length === 0) {
        return await interaction.editReply({
            content: '❌ Nebyla zadána žádná změna.'
        });
    }

    // Save changes to database
    await new Promise((resolve) => {
        updateFraction(
            fractionData.id,
            fractionData.name,
            fractionData.description,
            fractionData.money,
            fractionData.color,
            fractionData.logoPath,
            fractionData.warns,
            fractionData.roomId,
            fractionData.leaderRoleId,
            fractionData.deputyRoleId,
            fractionData.fractionRoleId,
            fractionData.creationDate
        );
        resolve();
    });
    
    // Log the action
    addAuditLog(
        interaction.user.id,
        'edit_fraction',
        'fraction',
        fractionData.id.toString(),
        JSON.stringify(changes)
    );

    const resultEmbed = new EmbedBuilder()
        .setColor(`#${newBarva || fractionData.color}`)
        .setTitle('✅ Frakce upravena')
        .setDescription(`Byly provedeny následující změny:\n${changes.join('\n')}`)
        .addFields({ 
            name: 'Frakce', 
            value: fractionRole.name, 
            inline: true 
        });

    if (newImage) {
        resultEmbed.setThumbnail(newImage.url);
    }

    await interaction.editReply({
        embeds: [resultEmbed]
    });
}

// Handle /frakce role add subcommand
async function handleRoleAdd(interaction) {
    await interaction.deferReply();
    
    // Get user's fraction from database
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
    
    const userFraction = member.roles.cache.find(role => fractions.includes(role.name))?.name;

    if (!userFraction) {
        return await interaction.editReply('❌ Nejste členem žádné frakce.');
    }

    const targetUser = interaction.options.getUser('user');

    // Add self-modification prevention
    if (targetUser.id === interaction.user.id) {
        return await interaction.editReply('❌ Nemůžete upravovat své vlastní role.');
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id);
    const makeDeputy = interaction.options.getBoolean('deputy') ?? false;
    const fractionRole = interaction.guild.roles.cache.find(r => r.name === userFraction);
    const deputyRole = interaction.guild.roles.cache.find(r => r.name === `Zástupce ${userFraction}`);

    // Get fraction data from database
    let fractionData;
    await new Promise((resolve) => {
        getFractionByName(userFraction, (err, fraction) => {
            fractionData = fraction;
            resolve();
        });
    });

    if (!fractionData) {
        return await interaction.editReply('❌ Nastala chyba při načítání dat frakce.');
    }

    // Check if user is already in any fraction
    let hasAnyFraction = false;
    for (const role of targetMember.roles.cache.values()) {
        const fractionExists = await new Promise((resolve) => {
            getFractionByName(role.name, (err, fraction) => {
                resolve(fraction !== undefined && !err);
            });
        });
        if (fractionExists) {
            hasAnyFraction = true;
            break;
        }
    }

    // Check if user is already in this fraction
    if (targetMember.roles.cache.has(fractionRole.id)) {
        if (makeDeputy && !targetMember.roles.cache.has(deputyRole.id)) {
            await targetMember.roles.add(deputyRole);
            
            // Add permission to database
            addPermission(
                targetMember.id,
                fractionData.id,
                'deputy',
                interaction.user.id
            );
            
            // Log action
            addAuditLog(
                interaction.user.id,
                'promote_deputy',
                'fraction_role',
                targetMember.id,
                JSON.stringify({ fraction: userFraction })
            );
            
            return await interaction.editReply(`✅ ${targetMember} byl povýšen na zástupce.`);
        } else if (!makeDeputy && targetMember.roles.cache.has(deputyRole.id)) {
            await targetMember.roles.remove(deputyRole);
            
            // Log action
            addAuditLog(
                interaction.user.id,
                'demote_deputy',
                'fraction_role',
                targetMember.id,
                JSON.stringify({ fraction: userFraction })
            );
            
            // Remove permission from database
            db.run(
                `DELETE FROM permissions WHERE user_id = ? AND fraction_id = ? AND role = 'deputy'`,
                [targetMember.id, fractionData.id]
            );
            
            return await interaction.editReply(`✅ ${targetMember} byl degradován z pozice zástupce.`);
        }
        return await interaction.editReply(`❌ ${targetMember} je již členem frakce ${userFraction}.`);
    }

    if (hasAnyFraction) {
        return await interaction.editReply(`❌ ${targetMember} je již členem jiné frakce.`);
    }

    // Create confirmation embed
    const embed = new EmbedBuilder()
        .setColor(fractionData.color ? `#${fractionData.color}` : 0x0099FF)
        .setTitle('📝 Pozvánka do frakce')
        .setDescription(`${targetMember}, byli jste pozváni do frakce ${userFraction}${makeDeputy ? ' jako zástupce' : ''}.`)
        .addFields(
            { name: 'Frakce', value: userFraction, inline: true },
            { name: 'Pozval', value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`accept-invite:${targetMember.id}:${userFraction}:${makeDeputy}:${fractionData.id}`)
                .setLabel('Přijmout')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline-invite:${targetMember.id}:${userFraction}`)
                .setLabel('Odmítnout')
                .setStyle(ButtonStyle.Danger)
        );

    await interaction.editReply({
        content: `${targetMember}`,
        embeds: [embed],
        components: [buttons]
    });
}

// Handle /frakce role remove subcommand
async function handleRoleRemove(interaction) {
    await interaction.deferReply();
    
    // Get user's fraction from database
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
    
    const userFraction = member.roles.cache.find(role => fractions.includes(role.name))?.name;

    if (!userFraction) {
        return await interaction.editReply('❌ Nejste členem žádné frakce.');
    }

    const targetUser = interaction.options.getUser('user');

    // Add self-modification prevention
    if (targetUser.id === interaction.user.id) {
        return await interaction.editReply('❌ Nemůžete upravovat své vlastní role.');
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id);
    const fractionRole = interaction.guild.roles.cache.find(r => r.name === userFraction);
    const deputyRole = interaction.guild.roles.cache.find(r => r.name === `Zástupce ${userFraction}`);

    // Get fraction data from database
    let fractionData;
    await new Promise((resolve) => {
        getFractionByName(userFraction, (err, fraction) => {
            fractionData = fraction;
            resolve();
        });
    });

    if (!fractionData) {
        return await interaction.editReply('❌ Nastala chyba při načítání dat frakce.');
    }

    if (!targetMember.roles.cache.has(fractionRole.id)) {
        return await interaction.editReply(`❌ ${targetMember} není členem frakce ${userFraction}.`);
    }

    await targetMember.roles.remove([fractionRole.id, deputyRole.id]);
    
    // Remove permissions from database
    db.run(
        `DELETE FROM permissions WHERE user_id = ? AND fraction_id = ?`,
        [targetMember.id, fractionData.id]
    );
    
    // Log action
    addAuditLog(
        interaction.user.id,
        'remove_member',
        'fraction_role',
        targetMember.id,
        JSON.stringify({ fraction: userFraction })
    );
    
    await interaction.editReply(`✅ ${targetMember} byl odebrán z frakce ${userFraction}.`);
}
