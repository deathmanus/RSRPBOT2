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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fraction')
        .setDescription('Správa frakcí')
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
                        .setRequired(true)))
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

        if (!/^#[0-9A-Fa-f]{6}$/.test(`#${barva}`)) {
            return interaction.editReply({ content: '❌ Barva musí být hexadecimální kód o délce 6 znaků (např. FF0000).' });
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

        const fractionDir = path.join(__dirname, '../../files/Fractions', zkratka);
        fs.mkdirSync(fractionDir, { recursive: true });

        const fractionData = {
            nazev,
            popis,
            roomId: room.id,
            leaderRoleId: leaderRole.id,
            deputyRoleId: deputyRole.id,
            fractionRoleId: fractionRole.id,
            money: 0,
            warns: 0,
            creationDate: new Date().toISOString().split('T')[0]
        };
        fs.writeFileSync(path.join(fractionDir, `${zkratka}.json`), JSON.stringify(fractionData, null, 2));

        const attachment = new AttachmentBuilder(path.join(fractionDir, `${zkratka}.json`));

        await interaction.editReply({ 
            content: `✅ Kanál ${room} byl vytvořen! Role ${leaderRole}, ${deputyRole}, ${fractionRole} taky. Oprávnění pro příkazy byly nastaveny.`, 
            files: [attachment] 
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

        const fractionsDir = path.join(__dirname, '../../files/Fractions');
        const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (fractions.length === 0) {
            return await interaction.followUp({ content: '❌ Žádné frakce k odstranění.', ephemeral: true });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select-fraction')
            .setPlaceholder('Vyberte frakci k odstranění')
            .addOptions(fractions.map(fraction => ({ label: fraction, value: fraction })));

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('Odstranění frakce')
            .setDescription('Vyberte frakci k odstranění z dropdown menu a potvrďte.');

        await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });

        const filter = i => i.customId === 'select-fraction' && i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();
                const selectedFraction = i.values[0];
                const fractionFilePath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                const fractionData = JSON.parse(fs.readFileSync(fractionFilePath, 'utf8'));
                const { roomId, leaderRoleId, deputyRoleId, fractionRoleId } = fractionData;

                const confirmEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('Potvrzení odstranění')
                    .setDescription(`Opravdu chcete odstranit frakci **${selectedFraction}**?`);

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
                            const backupChannel = guild.channels.cache.get('1213225816201240587');

                            if (!backupChannel) {
                                console.error('Backup channel not found');
                                await btn.followUp({
                                    content: '❌ Chyba: Záložní kanál nenalezen',
                                    ephemeral: true
                                });
                                return;
                            }

                            const fractionPath = path.join(fractionsDir, selectedFraction);
                            const getAllFiles = (dirPath, arrayOfFiles = []) => {
                                const files = fs.readdirSync(dirPath);
                                files.forEach(file => {
                                    const fullPath = path.join(dirPath, file);
                                    if (fs.statSync(fullPath).isDirectory()) {
                                        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
                                    } else {
                                        arrayOfFiles.push({
                                            path: fullPath,
                                            relativePath: path.relative(fractionPath, fullPath)
                                        });
                                    }
                                });
                                return arrayOfFiles;
                            };

                            const allFiles = getAllFiles(fractionPath);

                            const backupEmbed = new EmbedBuilder()
                                .setColor(0xFF0000)
                                .setTitle(`📤 Záloha frakce ${selectedFraction}`)
                                .setDescription(`Záloha souborů před odstraněním frakce **${selectedFraction}**`)
                                .setTimestamp();

                            await backupChannel.send({ embeds: [backupEmbed] });

                            for (const file of allFiles) {
                                const fileContent = fs.readFileSync(file.path);
                                const attachment = new AttachmentBuilder(fileContent, {
                                    name: file.relativePath
                                });
                                await backupChannel.send({
                                    content: `📁 ${file.relativePath}`,
                                    files: [attachment]
                                });
                            }

                            await backupChannel.send({
                                embeds: [new EmbedBuilder()
                                    .setColor(0xFF0000)
                                    .setTitle(`📥 Záloha dokončena`)
                                    .setDescription(`Celkem zálohováno: ${allFiles.length} souborů`)
                                    .setTimestamp()]
                            });

                            try {
                                if (roomId) {
                                    const channel = guild.channels.cache.get(roomId);
                                    if (channel) await channel.delete().catch(console.error);
                                }
                                if (leaderRoleId) {
                                    const leaderRole = guild.roles.cache.get(leaderRoleId);
                                    if (leaderRole) await leaderRole.delete().catch(console.error);
                                }
                                if (deputyRoleId) {
                                    const deputyRole = guild.roles.cache.get(deputyRoleId);
                                    if (deputyRole) await deputyRole.delete().catch(console.error);
                                }
                                if (fractionRoleId) {
                                    const fractionRole = guild.roles.cache.get(fractionRoleId);
                                    if (fractionRole) await fractionRole.delete().catch(console.error);
                                }

                                fs.rmSync(fractionPath, { recursive: true, force: true });

                                await btn.followUp({
                                    content: `✅ Frakce **${selectedFraction}** byla úspěšně odstraněna.`,
                                    ephemeral: true
                                });
                            } catch (deleteError) {
                                console.error('Error deleting fraction resources:', deleteError);
                                await btn.followUp({
                                    content: '❌ Nastala chyba při odstraňování frakce.',
                                    ephemeral: true
                                });
                            }
                        } else {
                            await btn.followUp({
                                content: '❌ Odstranění frakce bylo zrušeno.',
                                ephemeral: true
                            });
                        }

                        confirmCollector.stop();
                    } catch (error) {
                        console.error('Error in confirmation:', error);
                        try {
                            await btn.followUp({
                                content: '❌ Nastala chyba při zpracování požadavku.',
                                ephemeral: true
                            });
                        } catch (followUpError) {
                            console.error('Error sending followUp:', followUpError);
                        }
                    }
                });

                confirmCollector.on('end', async (collected, reason) => {
                    if (reason === 'time') {
                        try {
                            await interaction.followUp({
                                content: '⌛ Časový limit vypršel. Odstranění frakce bylo zrušeno.',
                                ephemeral: true
                            });
                        } catch (error) {
                            console.error('Error sending timeout message:', error);
                        }
                    }
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

        const fractionsDir = path.join(__dirname, '../../files/Fractions');
        const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (fractions.length === 0) {
            return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
        }

        let selectedFraction = null;
        let selectedWarns = null;
        const WARN_LIMIT = 3;

        const fractionMenu = new StringSelectMenuBuilder()
            .setCustomId('select-fraction')
            .setPlaceholder('Vyberte frakci')
            .addOptions(fractions.map(fraction => ({
                label: fraction,
                value: fraction
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
                    selectedFraction = i.values[0];
                    const fractionPath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                    const fractionData = JSON.parse(fs.readFileSync(fractionPath));

                    const fractionMenuUpdated = new StringSelectMenuBuilder()
                        .setCustomId('select-fraction')
                        .setPlaceholder('Vyberte frakci')
                        .addOptions(fractions.map(fraction => ({
                            label: fraction,
                            value: fraction,
                            default: fraction === selectedFraction
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
                        .setTitle(`Warny frakce ${selectedFraction}`)
                        .setDescription(`Aktuální počet warnů: ${fractionData.warns}`)
                        .addFields(
                            { name: 'Frakce', value: selectedFraction, inline: true },
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
                }
                else if (i.customId === 'select-warns') {
                    selectedWarns = parseInt(i.values[0]);
                    const fractionPath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                    const fractionData = JSON.parse(fs.readFileSync(fractionPath));

                    const fractionMenuUpdated = new StringSelectMenuBuilder()
                        .setCustomId('select-fraction')
                        .setPlaceholder('Vyberte frakci')
                        .addOptions(fractions.map(fraction => ({
                            label: fraction,
                            value: fraction,
                            default: fraction === selectedFraction
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
                        .setTitle(`Warny frakce ${selectedFraction}`)
                        .setDescription(`Nový počet warnů: ${selectedWarns}`)
                        .addFields(
                            { name: 'Frakce', value: selectedFraction, inline: true },
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
                }
                else if (i.customId === 'confirm-warns') {
                    const fractionPath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                    const fractionData = JSON.parse(fs.readFileSync(fractionPath));
                    
                    fractionData.warns = selectedWarns;
                    fs.writeFileSync(fractionPath, JSON.stringify(fractionData, null, 2));

                    const confirmEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('✅ Warny aktualizovány')
                        .addFields(
                            { name: 'Frakce', value: selectedFraction, inline: true },
                            { name: 'Nový počet warnů', value: selectedWarns.toString(), inline: true }
                        );

                    await interaction.channel.send({ embeds: [confirmEmbed] });
                    await i.editReply({
                        content: '✅ Počet warnů byl úspěšně aktualizován.',
                        embeds: [],
                        components: []
                    });

                    collector.stop();
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

        const fractionsDir = path.join(__dirname, '../../files/Fractions');
        const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (fractions.length === 0) {
            return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
        }

        const embed = new EmbedBuilder()
            .setTitle('Seznam frakcí a jejich itemů')
            .setColor(0x00FF00)
            .setTimestamp();

        for (const fraction of fractions) {
            let fractionText = '';
            const fractionPath = path.join(fractionsDir, fraction);
            const sections = fs.readdirSync(fractionPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const section of sections) {
                const sectionPath = path.join(fractionPath, section);
                const items = fs.readdirSync(sectionPath)
                    .filter(file => file.endsWith('.json'))
                    .map(file => {
                        const itemData = JSON.parse(fs.readFileSync(path.join(sectionPath, file)));
                        let itemText = `**${itemData.name}** - `;
                        
                        // Add modifications
                        if (itemData.selectedMods && itemData.selectedMods.length > 0) {
                            const mods = itemData.selectedMods.map(mod => {
                                let modText = mod.selected.split(':')[1];
                                if (mod.subSelections && Object.keys(mod.subSelections).length > 0) {
                                    modText += ': ' + Object.entries(mod.subSelections)
                                        .map(([name, opt]) => `${opt.name}`)
                                        .join(', ');
                                }
                                return modText;
                            }).join(' | ');
                            itemText += mods;
                        } else {
                            itemText += 'Žádné modifikace';
                        }
                        return itemText;
                    });

                if (items.length > 0) {
                    fractionText += `\n__${section}:__\n${items.join('\n')}\n`;
                }
            }

            if (fractionText) {
                embed.addFields({
                    name: `📍 ${fraction}`,
                    value: fractionText || 'Žádné itemy',
                    inline: false
                });
            }
        }

        // Split embed if it's too long
        if (embed.data.fields?.join('\n').length > 6000) {
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
        } else {
            await interaction.editReply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Error in spawn command:', error);
        await interaction.editReply({
            content: '❌ Nastala chyba při zpracování příkazu.',
        });
    }
}