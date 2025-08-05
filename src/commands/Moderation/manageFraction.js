const { 
    SlashCommandBuilder, 
    PermissionsBitField, 
    AttachmentBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { 
    db,
    addFraction, 
    updateFraction, 
    getFractionById, 
    getFractionByName, 
    deleteFractionById,
    addPermission, 
    addAuditLog,
    getFractionItems
} = require('../../Database/database');

// Command IDs for permission management
const RESTRICTED_COMMANDS = [
    '1343535946779594803',
    '1343535946288857150',
    '1343535946288857149',
    '1343535946779594802',
    '1343535946779594804'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fraction')
        .setDescription('Správa frakcí')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator) // Set default to admin
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Vytvoření frakce')
                .addStringOption(option =>
                    option.setName('zkratka')
                        .setDescription('Zkratka frakce')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('nazev')
                        .setDescription('Celý název frakce')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('popis')
                        .setDescription('Popis frakce')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('barva')
                        .setDescription('Barva v hexadecimálním formátu (např. FF0000)')
                        .setRequired(true))
                .addAttachmentOption(option =>
                    option.setName('logo')
                        .setDescription('Logo frakce')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Odstranění frakce'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('warn')
                .setDescription('Nastavení varování frakce'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('spawn')
                .setDescription('Zobrazí seznam frakcí a jejich itemů')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            await handleCreate(interaction);
        } else if (subcommand === 'delete') {
            await handleDelete(interaction);
        } else if (subcommand === 'warn') {
            await handleWarn(interaction);
        } else if (subcommand === 'spawn') {
            await handleSpawn(interaction);
        }
    }
};

async function handleCreate(interaction) {
    try {
        await interaction.deferReply();

        const zkratka = interaction.options.getString('zkratka');
        const nazev = interaction.options.getString('nazev');
        const popis = interaction.options.getString('popis');
        const barva = interaction.options.getString('barva');
        const logo = interaction.options.getAttachment('logo');

        if (!/^#?[0-9A-Fa-f]{6}$/.test(`#${barva}`)) {
            return interaction.editReply({ content: '❌ Barva musí být hexadecimální kód o délce 6 znaků (např. FF0000).' });
        }

        if (logo && !logo.contentType?.startsWith('image/')) {
            return interaction.editReply({ 
                content: '❌ Logo musí být obrázek.'
            });
        }

        const guild = interaction.guild;
        const roleHierarchy = '1226981850933755966';
        const categoryID = '1213225814502408218';

        const fractionRole = await guild.roles.create({
            name: `${zkratka}`,
            color: `#${barva}`,
            position: guild.roles.cache.get(roleHierarchy).position - 1
        });

        const deputyRole = await guild.roles.create({
            name: `Zástupce ${zkratka}`,
            color: `#${barva}`,
            position: guild.roles.cache.get(roleHierarchy).position - 1
        });

        const leaderRole = await guild.roles.create({
            name: `Velitel ${zkratka}`,
            color: `#${barva}`,
            position: guild.roles.cache.get(roleHierarchy).position - 1
        });

        // Store permissions
        for (const commandId of RESTRICTED_COMMANDS) {
            addPermission(leaderRole.id, null, 'leader', interaction.user.id);
            addPermission(deputyRole.id, null, 'deputy', interaction.user.id);
        }

        const room = await guild.channels.create({
            name: `frakce-${zkratka.toLowerCase()}`,
            type: 0,
            parent: categoryID,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.SendMessages]
                },
                {
                    id: deputyRole.id,
                    allow: [PermissionsBitField.Flags.SendMessages]
                },
                {
                    id: leaderRole.id,
                    allow: [PermissionsBitField.Flags.SendMessages]
                }
            ]
        });

        let logoPath = null;
        if (logo) {
            try {
                const response = await axios.get(logo.url, { responseType: 'arraybuffer' });
                const imageExt = logo.contentType.split('/')[1];
                logoPath = `logo.${imageExt}`;
                
                // Create directory for assets if it doesn't exist
                const assetsDir = path.join(__dirname, '../../Database/Files', zkratka);
                fs.mkdirSync(assetsDir, { recursive: true });
                
                // Save logo to assets directory
                fs.writeFileSync(path.join(assetsDir, logoPath), response.data);
            } catch (error) {
                console.error('Error saving logo:', error);
            }
        }

        // Add fraction to database
        addFraction(
            zkratka,
            popis,
            0, // money
            barva,
            logoPath,
            0, // warns
            room.id,
            leaderRole.id,
            deputyRole.id,
            fractionRole.id,
            new Date().toISOString().split('T')[0] // creation date
        );

        // Log the action
        addAuditLog(
            interaction.user.id,
            'create',
            'fraction',
            zkratka,
            JSON.stringify({
                name: zkratka,
                description: popis,
                color: barva,
                roles: {
                    fraction: fractionRole.id,
                    leader: leaderRole.id,
                    deputy: deputyRole.id
                },
                roomId: room.id
            })
        );

        const resultEmbed = new EmbedBuilder()
            .setColor(`#${barva}`)
            .setTitle('✅ Frakce vytvořena')
            .setDescription(`Frakce ${zkratka} byla úspěšně vytvořena!`)
            .addFields(
                { name: 'Název', value: nazev, inline: true },
                { name: 'Zkratka', value: zkratka, inline: true },
                { name: 'Role', value: `${leaderRole}, ${deputyRole}, ${fractionRole}`, inline: false },
                { name: 'Kanál', value: `${room}`, inline: true }
            );

        if (logo) {
            resultEmbed.setThumbnail(logo.url);
        }

        await interaction.editReply({ 
            embeds: [resultEmbed]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
                content: 'Nastala chyba při vytváření frakce.', 
                ephemeral: true 
            });
        } else {
            await interaction.editReply({ 
                content: 'Nastala chyba při vytváření frakce.' 
            });
        }
    }
}

async function handleDelete(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Get all fractions from database
        db.all(`SELECT * FROM fractions`, async (err, fractions) => {
            if (err) {
                console.error('Error fetching fractions:', err);
                return await interaction.editReply({ 
                    content: '❌ Nastala chyba při načítání frakcí.', 
                    ephemeral: true 
                });
            }

            if (fractions.length === 0) {
                return await interaction.editReply({ 
                    content: '❌ Žádné frakce k odstranění.', 
                    ephemeral: true 
                });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select-fraction')
                .setPlaceholder('Vyberte frakci k odstranění')
                .addOptions(fractions.map(fraction => ({ 
                    label: fraction.name, 
                    value: fraction.id.toString() 
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Odstranění frakce')
                .setDescription('Vyberte frakci k odstranění z dropdown menu a potvrďte.');

            await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });

            const filter = i => i.customId === 'select-fraction' && i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();
                    const selectedFractionId = parseInt(i.values[0]);
                    
                    // Get fraction details from database
                    getFractionById(selectedFractionId, async (err, fractionData) => {
                        if (err || !fractionData) {
                            console.error('Error fetching fraction details:', err);
                            return await i.editReply({ 
                                content: '❌ Nastala chyba při načítání detailů frakce.', 
                                components: [], 
                                ephemeral: true 
                            });
                        }

                        const { name, roomId, leaderRoleId, deputyRoleId, fractionRoleId } = fractionData;

                        const confirmEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('Potvrzení odstranění')
                            .setDescription(`Opravdu chcete odstranit frakci **${name}**?`);

                        const yesButton = new ButtonBuilder()
                            .setCustomId('yes-delete')
                            .setLabel('Ano')
                            .setStyle(ButtonStyle.Danger);

                        const noButton = new ButtonBuilder()
                            .setCustomId('no-delete')
                            .setLabel('Ne')
                            .setStyle(ButtonStyle.Secondary);

                        const confirmRow = new ActionRowBuilder().addComponents(yesButton, noButton);
                        
                        const confirmMessage = await interaction.followUp({ 
                            embeds: [confirmEmbed], 
                            components: [confirmRow], 
                            ephemeral: true 
                        });

                        collector.stop();

                        const confirmFilter = btn => 
                            ['yes-delete', 'no-delete'].includes(btn.customId) && 
                            btn.user.id === interaction.user.id;

                        const confirmCollector = confirmMessage.createMessageComponentCollector({ 
                            filter: confirmFilter, 
                            time: 60000 
                        });

                        confirmCollector.on('collect', async btn => {
                            try {
                                await btn.deferUpdate();

                                if (btn.customId === 'yes-delete') {
                                    const guild = interaction.guild;

                                    // Delete fraction's Discord objects
                                    try {
                                        const channel = await guild.channels.fetch(roomId).catch(() => null);
                                        if (channel) await channel.delete();

                                        const leaderRole = await guild.roles.fetch(leaderRoleId).catch(() => null);
                                        if (leaderRole) await leaderRole.delete();

                                        const deputyRole = await guild.roles.fetch(deputyRoleId).catch(() => null);
                                        if (deputyRole) await deputyRole.delete();

                                        const fractionRole = await guild.roles.fetch(fractionRoleId).catch(() => null);
                                        if (fractionRole) await fractionRole.delete();
                                    } catch (error) {
                                        console.error('Error deleting Discord objects:', error);
                                    }

                                    // Delete fraction from database
                                    deleteFractionById(selectedFractionId);

                                    // Log the action
                                    addAuditLog(
                                        interaction.user.id,
                                        'delete',
                                        'fraction',
                                        name,
                                        JSON.stringify(fractionData)
                                    );

                                    // Also delete any assets associated with the fraction
                                    const assetsDir = path.join(__dirname, '../../Database/Files', name);
                                    if (fs.existsSync(assetsDir)) {
                                        fs.rmdirSync(assetsDir, { recursive: true });
                                    }

                                    await btn.editReply({
                                        content: `✅ Frakce **${name}** byla úspěšně odstraněna.`,
                                        embeds: [],
                                        components: []
                                    });
                                } else {
                                    await btn.editReply({
                                        content: '❌ Akce byla zrušena.',
                                        embeds: [],
                                        components: []
                                    });
                                }

                                confirmCollector.stop();
                            } catch (error) {
                                console.error('Error in confirmation:', error);
                                try {
                                    await btn.editReply({
                                        content: '❌ Nastala chyba při zpracování požadavku.',
                                        embeds: [],
                                        components: []
                                    });
                                } catch (followUpError) {
                                    console.error('Follow-up error:', followUpError);
                                }
                            }
                        });

                        confirmCollector.on('end', async (collected, reason) => {
                            if (reason === 'time') {
                                try {
                                    await confirmMessage.edit({
                                        content: '⌛ Časový limit vypršel. Akce byla zrušena.',
                                        embeds: [],
                                        components: []
                                    });
                                } catch (error) {
                                    console.error('Error editing timed out message:', error);
                                }
                            }
                        });
                    });
                } catch (error) {
                    console.error('Chyba při výběru frakce:', error);
                    await i.editReply({ 
                        content: '❌ Nastala chyba při zpracování výběru frakce.', 
                        components: [], 
                        ephemeral: true 
                    });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({ 
                        content: '⌛ Časový limit vypršel. Akce byla zrušena.', 
                        components: [], 
                        ephemeral: true 
                    });
                }
            });
        });
    } catch (error) {
        console.error('Chyba v příkazu deletefraction:', error);
        await interaction.editReply({ 
            content: '❌ Nastala chyba při zpracování příkazu.', 
            components: [], 
            ephemeral: true 
        });
    }
}

async function handleWarn(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Get all fractions from database
        db.all(`SELECT * FROM fractions`, async (err, fractions) => {
            if (err) {
                console.error('Error fetching fractions:', err);
                return await interaction.editReply({ 
                    content: '❌ Nastala chyba při načítání frakcí.', 
                    ephemeral: true 
                });
            }

            if (fractions.length === 0) {
                return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
            }

            let selectedFractionId = null;
            let selectedWarns = null;
            const WARN_LIMIT = 3;

            const fractionMenu = new StringSelectMenuBuilder()
                .setCustomId('select-fraction')
                .setPlaceholder('Vyberte frakci')
                .addOptions(fractions.map(fraction => ({
                    label: fraction.name,
                    value: fraction.id.toString()
                })));

            const row = new ActionRowBuilder().addComponents(fractionMenu);
            const embed = new EmbedBuilder()
                .setTitle('Nastavení warnů frakce')
                .setDescription('Vyberte frakci pro nastavení warnů.')
                .setColor(0xFF0000);

            const message = await interaction.editReply({
                embeds: [embed],
                components: [row]
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    if (i.customId === 'select-fraction') {
                        selectedFractionId = parseInt(i.values[0]);
                        
                        // Get fraction details from database
                        getFractionById(selectedFractionId, async (err, fractionData) => {
                            if (err || !fractionData) {
                                console.error('Error fetching fraction details:', err);
                                return await i.editReply({ 
                                    content: '❌ Nastala chyba při načítání detailů frakce.', 
                                    components: [], 
                                    ephemeral: true 
                                });
                            }

                            const fractionMenuUpdated = new StringSelectMenuBuilder()
                                .setCustomId('select-fraction')
                                .setPlaceholder('Vyberte frakci')
                                .addOptions(fractions.map(fraction => ({
                                    label: fraction.name,
                                    value: fraction.id.toString(),
                                    default: fraction.id === selectedFractionId
                                })));

                            const warnMenu = new StringSelectMenuBuilder()
                                .setCustomId('select-warns')
                                .setPlaceholder('Vyberte počet warnů')
                                .addOptions(
                                    Array.from({ length: WARN_LIMIT + 1 }, (_, index) => ({
                                        label: `${index} warnů`,
                                        value: index.toString(),
                                        default: index === fractionData.warns
                                    }))
                                );

                            const confirmButton = new ButtonBuilder()
                                .setCustomId('confirm-warns')
                                .setLabel('Potvrdit')
                                .setStyle(ButtonStyle.Success);

                            const cancelButton = new ButtonBuilder()
                                .setCustomId('cancel-warns')
                                .setLabel('Zrušit')
                                .setStyle(ButtonStyle.Danger);

                            const buttonRow = new ActionRowBuilder()
                                .addComponents(confirmButton, cancelButton);

                            const warnEmbed = new EmbedBuilder()
                                .setColor(0xFF0000)
                                .setTitle(`Warny frakce ${fractionData.name}`)
                                .setDescription(`Aktuální počet warnů: ${fractionData.warns}`)
                                .addFields(
                                    { name: 'Frakce', value: fractionData.name, inline: true },
                                    { name: 'Limit warnů', value: WARN_LIMIT.toString(), inline: true }
                                );

                            await i.editReply({
                                embeds: [warnEmbed],
                                components: [
                                    new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                    new ActionRowBuilder().addComponents(warnMenu),
                                    buttonRow
                                ]
                            });
                        });
                    }
                    else if (i.customId === 'select-warns') {
                        selectedWarns = parseInt(i.values[0]);
                        
                        getFractionById(selectedFractionId, async (err, fractionData) => {
                            if (err || !fractionData) {
                                console.error('Error fetching fraction details:', err);
                                return;
                            }

                            const fractionMenuUpdated = new StringSelectMenuBuilder()
                                .setCustomId('select-fraction')
                                .setPlaceholder('Vyberte frakci')
                                .addOptions(fractions.map(fraction => ({
                                    label: fraction.name,
                                    value: fraction.id.toString(),
                                    default: fraction.id === selectedFractionId
                                })));

                            const warnMenuUpdated = new StringSelectMenuBuilder()
                                .setCustomId('select-warns')
                                .setPlaceholder('Vyberte počet warnů')
                                .addOptions(
                                    Array.from({ length: WARN_LIMIT + 1 }, (_, index) => ({
                                        label: `${index} warnů`,
                                        value: index.toString(),
                                        default: index === selectedWarns
                                    }))
                                );

                            const warnEmbed = new EmbedBuilder()
                                .setColor(0xFF0000)
                                .setTitle(`Warny frakce ${fractionData.name}`)
                                .setDescription(`Nový počet warnů: ${selectedWarns}`)
                                .addFields(
                                    { name: 'Frakce', value: fractionData.name, inline: true },
                                    { name: 'Původní počet', value: fractionData.warns.toString(), inline: true },
                                    { name: 'Limit warnů', value: WARN_LIMIT.toString(), inline: true }
                                );

                            const confirmButton = new ButtonBuilder()
                                .setCustomId('confirm-warns')
                                .setLabel('Potvrdit')
                                .setStyle(ButtonStyle.Success);

                            const cancelButton = new ButtonBuilder()
                                .setCustomId('cancel-warns')
                                .setLabel('Zrušit')
                                .setStyle(ButtonStyle.Danger);

                            const buttonRow = new ActionRowBuilder()
                                .addComponents(confirmButton, cancelButton);

                            await i.editReply({
                                embeds: [warnEmbed],
                                components: [
                                    new ActionRowBuilder().addComponents(fractionMenuUpdated),
                                    new ActionRowBuilder().addComponents(warnMenuUpdated),
                                    buttonRow
                                ]
                            });
                        });
                    }
                    else if (i.customId === 'confirm-warns') {
                        if (selectedFractionId === null || selectedWarns === null) {
                            return await i.editReply({
                                content: '❌ Musíte vybrat frakci a počet warnů.',
                                components: []
                            });
                        }

                        getFractionById(selectedFractionId, async (err, fractionData) => {
                            if (err || !fractionData) {
                                console.error('Error fetching fraction details:', err);
                                return;
                            }

                            // Update the warns in the database
                            updateFraction(
                                fractionData.id,
                                fractionData.name,
                                fractionData.description,
                                fractionData.money,
                                fractionData.color,
                                fractionData.logoPath,
                                selectedWarns, // new warns count
                                fractionData.roomId,
                                fractionData.leaderRoleId,
                                fractionData.deputyRoleId,
                                fractionData.fractionRoleId,
                                fractionData.creationDate
                            );

                            // Log the action
                            addAuditLog(
                                interaction.user.id,
                                'update',
                                'fraction_warns',
                                fractionData.name,
                                JSON.stringify({
                                    old: fractionData.warns,
                                    new: selectedWarns
                                })
                            );

                            const confirmEmbed = new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle('✅ Warny aktualizovány')
                                .addFields(
                                    { name: 'Frakce', value: fractionData.name, inline: true },
                                    { name: 'Nový počet warnů', value: selectedWarns.toString(), inline: true }
                                );

                            await interaction.followUp({ embeds: [confirmEmbed] });
                            await i.editReply({
                                content: `✅ Počet warnů pro frakci ${fractionData.name} byl úspěšně aktualizován.`,
                                embeds: [],
                                components: []
                            });

                            collector.stop();
                        });
                    }
                    else if (i.customId === 'cancel-warns') {
                        await i.editReply({
                            content: '❌ Aktualizace warnů zrušena.',
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                    }
                } catch (error) {
                    console.error('Error in warnfraction collector:', error);
                    await i.editReply({
                        content: '❌ Nastala chyba při zpracování požadavku.',
                        components: []
                    });
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
        });
    } catch (error) {
        console.error('Error in warn command:', error);
        await interaction.editReply({
            content: '❌ Nastala chyba při zpracování příkazu.',
            components: []
        });
    }
}

async function handleSpawn(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Get all fractions from database
        db.all(`SELECT * FROM fractions`, async (err, fractions) => {
            if (err) {
                console.error('Error fetching fractions:', err);
                return await interaction.editReply({ 
                    content: '❌ Nastala chyba při načítání frakcí.', 
                    ephemeral: true 
                });
            }

            if (fractions.length === 0) {
                return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('Seznam frakcí a jejich modifikovatelných itemů')
                .setColor(0x00FF00)
                .setTimestamp();

            for (const fraction of fractions) {
                // Get all items for this fraction
                getFractionItems(fraction.name, (err, items) => {
                    if (err) {
                        console.error(`Error fetching items for fraction ${fraction.name}:`, err);
                        return;
                    }

                    if (items.length === 0) {
                        return;
                    }

                    // Group items by section/type
                    const itemsByType = {};
                    for (const item of items) {
                        // Get section from shop_items table
                        const itemType = item.type || 'Other';
                        if (!itemsByType[itemType]) {
                            itemsByType[itemType] = [];
                        }

                        // Only include modifiable items
                        if (item.type === 'modifiable') {
                            const mods = item.selected_mods ? JSON.parse(item.selected_mods) : [];
                            let itemText = `**${item.name}** - `;
                            
                            if (mods.length > 0) {
                                const modsText = mods.map(mod => {
                                    let modText = mod.selected ? mod.selected.split(':')[1] : 'N/A';
                                    if (mod.subSelections && Object.keys(mod.subSelections).length > 0) {
                                        modText += ': ' + Object.entries(mod.subSelections)
                                            .map(([name, opt]) => `${opt.name}`)
                                            .join(', ');
                                    }
                                    return modText;
                                }).join(' | ');
                                itemText += modsText;
                            } else {
                                itemText += 'Žádné modifikace';
                            }

                            itemsByType[itemType].push(itemText);
                        }
                    }

                    // Build fraction field content
                    let fractionText = '';
                    for (const [type, typeItems] of Object.entries(itemsByType)) {
                        if (typeItems.length > 0) {
                            fractionText += `\n__${type}:__\n${typeItems.join('\n')}\n`;
                        }
                    }

                    if (fractionText) {
                        embed.addFields({
                            name: `📍 ${fraction.name}`,
                            value: fractionText,
                            inline: false
                        });
                    }
                });
            }

            // Wait for all database queries to complete
            setTimeout(async () => {
                // Split embed if it's too long
                if (embed.data.fields?.length > 0 && embed.data.fields.join('\n').length > 6000) {
                    const embeds = [];
                    let currentEmbed = new EmbedBuilder()
                        .setTitle('Seznam frakcí a jejich itemů (1)')
                        .setColor(0x00FF00)
                        .setTimestamp();
                    let currentLength = 0;
                    let embedCount = 1;

                    for (const field of embed.data.fields) {
                        if (currentLength + field.value.length > 5900) {
                            embeds.push(currentEmbed);
                            embedCount++;
                            currentEmbed = new EmbedBuilder()
                                .setTitle(`Seznam frakcí a jejich itemů (${embedCount})`)
                                .setColor(0x00FF00)
                                .setTimestamp();
                            currentLength = 0;
                        }
                        currentEmbed.addFields(field);
                        currentLength += field.value.length;
                    }
                    embeds.push(currentEmbed);

                    await interaction.editReply({ embeds });
                } else if (embed.data.fields?.length > 0) {
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ 
                        content: 'Žádné frakce nemají modifikovatelné itemy.' 
                    });
                }
            }, 1000); // Wait 1 second for DB queries to complete
        });
    } catch (error) {
        console.error('Error in spawn command:', error);
        await interaction.editReply({
            content: '❌ Nastala chyba při zpracování příkazu.',
        });
    }
}