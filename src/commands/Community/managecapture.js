const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { 
    addCapturedPoint, 
    getFractionByName, 
    getSSUStatus, 
    getActiveBasepoints, 
    getBasepointByName,
    setSSUStatus,
    getActiveFractionCaptures,
    getCapturedPoints
} = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('capture')
        .setDescription('Správa capturing systému')
        .addSubcommand(subcommand =>
            subcommand
                .setName('zabrat')
                .setDescription('Zabere basepoint pro vaši frakci')
                .addStringOption(option =>
                    option
                        .setName('basepoint')
                        .setDescription('Název basepoint, který zabíráte')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addAttachmentOption(option =>
                    option
                        .setName('image')
                        .setDescription('Fotka potvrzující zabrání basepoint')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Zobrazí aktuální stav zabírání basepointů'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Zobrazí seznam všech aktuálně zabraných basepointů')
                .addStringOption(option =>
                    option
                        .setName('fraction')
                        .setDescription('Zobrazit pouze zabrání konkrétní frakce')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Spuštění počítání basepointů (SSU)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Ukončení počítání basepointů')),

    async autocomplete(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'zabrat') {
            const focusedValue = interaction.options.getFocused();
            
            try {
                const basepoints = await new Promise((resolve, reject) => {
                    getActiveBasepoints((err, bp) => {
                        if (err) reject(err);
                        else resolve(bp || []);
                    });
                });

                const filtered = basepoints
                    .filter(bp => bp.name.toLowerCase().includes(focusedValue.toLowerCase()))
                    .slice(0, 25) // Discord limit
                    .map(bp => ({
                        name: bp.name + (bp.description ? ` - ${bp.description}` : ''),
                        value: bp.name
                    }));

                await interaction.respond(filtered);
            } catch (error) {
                console.error('Error in autocomplete:', error);
                await interaction.respond([]);
            }
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'zabrat':
                await handleCapture(interaction);
                break;
            case 'status':
                await handleStatus(interaction);
                break;
            case 'list':
                await handleList(interaction);
                break;
            case 'start':
                await handleStart(interaction);
                break;
            case 'stop':
                await handleStop(interaction);
                break;
            default:
                await interaction.reply({ content: '❌ Neplatný subcommand.', ephemeral: true });
        }
    }
};

async function handleCapture(interaction) {
    try {
        await interaction.deferReply();

        // Kontrola, zda je SSU aktivní
        getSSUStatus((err, ssuStatus) => {
            if (err) {
                console.error('Error checking SSU status:', err);
                return interaction.editReply('❌ Nastala chyba při kontrole stavu SSU.');
            }

            if (!ssuStatus || !ssuStatus.is_active) {
                return interaction.editReply('❌ SSU není aktivní. Capturing není možný.');
            }

            // Získání frakce uživatele
            const member = interaction.member;
            const db = require('../../Database/database').db;
            
            db.all(`SELECT name FROM fractions`, [], async (err, rows) => {
                if (err) {
                    console.error('Error fetching fractions:', err);
                    return interaction.editReply('❌ Nastala chyba při načítání frakcí.');
                }

                const fractions = rows.map(row => row.name);
                const userFraction = member.roles.cache.find(role => fractions.includes(role.name))?.name;

                if (!userFraction) {
                    return interaction.editReply('❌ Nejste členem žádné frakce.');
                }

                const basepointName = interaction.options.getString('basepoint');
                const imageAttachment = interaction.options.getAttachment('image');

                // Kontrola, zda je basepoint povolen v databázi
                getBasepointByName(basepointName, async (err, basepoint) => {
                    if (err) {
                        console.error('Error checking basepoint:', err);
                        return interaction.editReply('❌ Nastala chyba při kontrole basepoint.');
                    }

                    if (!basepoint) {
                        return interaction.editReply('❌ Tento basepoint není povolen pro capturing. Použijte `/capture list` pro zobrazení povolených basepointů.');
                    }

                    // Kontrola, zda je příloha obrázek
                    if (!imageAttachment.contentType || !imageAttachment.contentType.startsWith('image/')) {
                        return interaction.editReply('❌ Příloha musí být obrázek.');
                    }

                    try {
                        // Přidání zabrání do databáze
                        const captureId = await addCapturedPoint(
                            userFraction,
                            basepointName,
                            interaction.user.tag,
                            imageAttachment.url
                        );

                        // Vytvoření embed zprávy
                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('🏴 Basepoint zabráno!')
                            .setDescription(`**${userFraction}** obsadili basepoint **${basepointName}** v čase **${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Etc/GMT-2' }).format(new Date())}**`)
                            .addFields(
                                { name: 'Frakce', value: userFraction, inline: true },
                                { name: 'Basepoint', value: basepointName, inline: true },
                                { name: 'Zabrali', value: interaction.user.tag, inline: true }
                            )
                            .setImage(imageAttachment.url)
                            .setTimestamp()
                            .setFooter({ text: `Capture ID: ${captureId}` });

                        // Přidání popisu basepoint, pokud existuje
                        if (basepoint.description) {
                            embed.addFields({ name: 'Popis basepoint', value: basepoint.description, inline: false });
                        }

                        await interaction.editReply({ embeds: [embed] });

                    } catch (error) {
                        console.error('Error adding captured point:', error);
                        await interaction.editReply('❌ Nastala chyba při ukládání zabrání.');
                    }
                });
            });
        });

    } catch (error) {
        console.error('Error in capture command:', error);
        await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
    }
}

async function handleStatus(interaction) {
    try {
        await interaction.deferReply();

        // Kontrola stavu SSU
        getSSUStatus((err, ssuStatus) => {
            if (err) {
                console.error('Error checking SSU status:', err);
                return interaction.editReply('❌ Nastala chyba při kontrole stavu SSU.');
            }

            getActiveFractionCaptures((err, fractionStats) => {
                if (err) {
                    console.error('Error fetching capture stats:', err);
                    return interaction.editReply('❌ Nastala chyba při načítání statistik.');
                }

                getCapturedPoints((err, allCaptures) => {
                    if (err) {
                        console.error('Error fetching all captures:', err);
                        return interaction.editReply('❌ Nastala chyba při načítání zabrání.');
                    }

                    const embed = new EmbedBuilder()
                        .setTimestamp();

                    if (ssuStatus && ssuStatus.is_active) {
                        embed
                            .setColor(0x00FF00)
                            .setTitle('🟢 SSU je aktivní!')
                            .setDescription('Counting systém běží a hráči mohou zabírat basepointy.');
                        
                        const startTime = new Date(ssuStatus.started_at);
                        const startTimeString = new Intl.DateTimeFormat('cs-CZ', {
                            hour: '2-digit',
                            minute: '2-digit',
                            day: '2-digit',
                            month: '2-digit',
                            timeZone: 'Etc/GMT-2'
                        }).format(startTime);
                        
                        embed.addFields(
                            { name: 'Spuštěno', value: startTimeString, inline: true },
                            { name: 'Spustil', value: `<@${ssuStatus.started_by}>`, inline: true }
                        );
                    } else {
                        embed
                            .setColor(0xFF0000)
                            .setTitle('🔴 SSU není aktivní')
                            .setDescription('Counting systém je zastaven. Hráči nemohou zabírat basepointy.');
                    }

                    // Statistiky frakcí
                    if (fractionStats && fractionStats.length > 0) {
                        const statsText = fractionStats
                            .map(stat => `**${stat.fraction_name}**: ${stat.capture_count} bodů`)
                            .join('\n');
                        
                        embed.addFields({
                            name: '📊 Aktuální skóre',
                            value: statsText,
                            inline: false
                        });
                    } else {
                        embed.addFields({
                            name: '📊 Aktuální skóre',
                            value: 'Žádné zabrané basepointy',
                            inline: false
                        });
                    }

                    // Poslední zabrání
                    if (allCaptures && allCaptures.length > 0) {
                        const recentCaptures = allCaptures
                            .slice(0, 5) // Posledních 5
                            .map(capture => {
                                const captureTime = new Date(capture.captured_at);
                                const timeString = new Intl.DateTimeFormat('cs-CZ', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'Etc/GMT-2'
                                }).format(captureTime);
                                
                                return `${timeString} - **${capture.fraction_name}** zabral **${capture.basepoint_name}**`;
                            })
                            .join('\n');

                        embed.addFields({
                            name: '🕐 Poslední zabrání',
                            value: recentCaptures,
                            inline: false
                        });
                    }

                    // Info o odměnách
                    if (ssuStatus && ssuStatus.is_active) {
                        embed.addFields({
                            name: 'ℹ️ Automatické odměny',
                            value: 'Každých 30 minut dostane každá frakce **2 body** za každý zabraný basepoint do frakčního rozpočtu.',
                            inline: false
                        });
                    }

                    interaction.editReply({ embeds: [embed] });
                });
            });
        });

    } catch (error) {
        console.error('Error in capture_status command:', error);
        await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
    }
}

async function handleList(interaction) {
    try {
        await interaction.deferReply();

        const filterFraction = interaction.options.getString('fraction');

        getCapturedPoints((err, captures) => {
            if (err) {
                console.error('Error fetching captures:', err);
                return interaction.editReply('❌ Nastala chyba při načítání zabrání.');
            }

            if (!captures || captures.length === 0) {
                return interaction.editReply('📋 **Žádné aktivní zabrání basepointů**\n\nMomentálně nejsou zabrané žádné basepointy.');
            }

            // Filtrování podle frakce, pokud je zadáno
            let filteredCaptures = captures;
            if (filterFraction) {
                filteredCaptures = captures.filter(capture => 
                    capture.fraction_name.toLowerCase().includes(filterFraction.toLowerCase())
                );

                if (filteredCaptures.length === 0) {
                    return interaction.editReply(`📋 **Žádná zabrání pro "${filterFraction}"**\n\nTato frakce nemá momentálně zabrané žádné basepointy.`);
                }
            }

            // Seskupení podle frakcí
            const fractionGroups = {};
            filteredCaptures.forEach(capture => {
                if (!fractionGroups[capture.fraction_name]) {
                    fractionGroups[capture.fraction_name] = [];
                }
                fractionGroups[capture.fraction_name].push(capture);
            });

            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('📋 Seznam zabraných basepointů')
                .setTimestamp();

            if (filterFraction) {
                embed.setDescription(`Zabrání pro frakci: **${filterFraction}**`);
            } else {
                embed.setDescription(`Celkem zabraných basepointů: **${filteredCaptures.length}**`);
            }

            // Vytvoření polí pro každou frakci
            for (const fractionName in fractionGroups) {
                const fractionCaptures = fractionGroups[fractionName];
                
                const capturesText = fractionCaptures
                    .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at))
                    .map(capture => {
                        const captureTime = new Date(capture.captured_at);
                        const timeString = new Intl.DateTimeFormat('cs-CZ', {
                            hour: '2-digit',
                            minute: '2-digit',
                            day: '2-digit',
                            month: '2-digit',
                            timeZone: 'Etc/GMT-2'
                        }).format(captureTime);
                        
                        return `• **${capture.basepoint_name}** (${timeString}) - ID: ${capture.id}`;
                    })
                    .slice(0, 10) // Max 10 zabrání na frakci kvůli limitu Discord embeds
                    .join('\n');

                const fieldName = `${fractionName} (${fractionCaptures.length} ${fractionCaptures.length === 1 ? 'bod' : fractionCaptures.length < 5 ? 'body' : 'bodů'})`;
                
                embed.addFields({
                    name: fieldName,
                    value: capturesText || 'Žádná zabrání',
                    inline: false
                });
            }

            // Přidání informace o limitech
            if (Object.keys(fractionGroups).some(fraction => fractionGroups[fraction].length > 10)) {
                embed.addFields({
                    name: 'ℹ️ Poznámka',
                    value: 'Zobrazeno je pouze posledních 10 zabrání na frakci. Pro úplný seznam použijte filtry.',
                    inline: false
                });
            }

            embed.addFields({
                name: '🔧 Správa',
                value: 'Pro odebrání zabrání použijte `/de-capture` s ID zabrání.',
                inline: false
            });

            interaction.editReply({ embeds: [embed] });
        });

    } catch (error) {
        console.error('Error in captures_list command:', error);
        await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
    }
}

async function handleStart(interaction) {
    try {
        await interaction.deferReply();

        // Kontrola oprávnění
        if (!interaction.member.permissions.has('Administrator') && 
            !interaction.member.roles.cache.some(role => role.name.toLowerCase().includes('moderator'))) {
            return interaction.editReply('❌ Nemáte oprávnění k použití tohoto příkazu.');
        }

        // Kontrola, zda již není SSU aktivní
        getSSUStatus((err, ssuStatus) => {
            if (err) {
                console.error('Error checking SSU status:', err);
                return interaction.editReply('❌ Nastala chyba při kontrole stavu SSU.');
            }

            if (ssuStatus && ssuStatus.is_active) {
                return interaction.editReply('❌ SSU je již aktivní.');
            }

            // Spuštění SSU
            setSSUStatus(true, interaction.user.id)
                .then(() => {
                    const now = new Date();
                    const timeString = new Intl.DateTimeFormat('en-GB', { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        hour12: false, 
                        timeZone: 'Etc/GMT-2' 
                    }).format(now);

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('🚀 SSU spuštěno!')
                        .setDescription(`Začátek zabírání: **${timeString}**`)
                        .addFields(
                            { name: 'Spustil', value: interaction.user.tag, inline: true },
                            { name: 'Čas spuštění', value: timeString, inline: true }
                        )
                        .addFields({ 
                            name: 'ℹ️ Info', 
                            value: 'Hráči mohou nyní používat `/capture zabrat` pro zabírání basepointů.\nKaždých 30 minut budou uděleny 2 body do frakčního rozpočtu za každý zabraný basepoint.', 
                            inline: false 
                        })
                        .setTimestamp();

                    interaction.editReply({ embeds: [embed] });
                })
                .catch((error) => {
                    console.error('Error starting SSU:', error);
                    interaction.editReply('❌ Nastala chyba při spuštění SSU.');
                });
        });

    } catch (error) {
        console.error('Error in start command:', error);
        await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
    }
}

async function handleStop(interaction) {
    try {
        await interaction.deferReply();

        // Kontrola oprávnění
        if (!interaction.member.permissions.has('Administrator') && 
            !interaction.member.roles.cache.some(role => role.name.toLowerCase().includes('moderator'))) {
            return interaction.editReply('❌ Nemáte oprávnění k použití tohoto příkazu.');
        }

        // Kontrola, zda je SSU aktivní
        getSSUStatus((err, ssuStatus) => {
            if (err) {
                console.error('Error checking SSU status:', err);
                return interaction.editReply('❌ Nastala chyba při kontrole stavu SSU.');
            }

            if (!ssuStatus || !ssuStatus.is_active) {
                return interaction.editReply('❌ SSU není aktivní.');
            }

            // Ukončení SSU
            setSSUStatus(false, interaction.user.id)
                .then(() => {
                    // Získání statistik zabrání
                    getActiveFractionCaptures((err, captures) => {
                        if (err) {
                            console.error('Error fetching capture stats:', err);
                        }

                        const now = new Date();
                        const timeString = new Intl.DateTimeFormat('en-GB', { 
                            hour: '2-digit', 
                            minute: '2-digit', 
                            hour12: false, 
                            timeZone: 'Etc/GMT-2' 
                        }).format(now);

                        const embed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('🏁 SSU ukončeno!')
                            .setDescription(`Konec zabírání: **${timeString}**`)
                            .addFields(
                                { name: 'Ukončil', value: interaction.user.tag, inline: true },
                                { name: 'Čas ukončení', value: timeString, inline: true }
                            )
                            .setTimestamp();

                        // Přidání statistik zabrání, pokud jsou k dispozici
                        if (captures && captures.length > 0) {
                            const statsField = captures
                                .map(capture => `**${capture.fraction_name}**: ${capture.capture_count} bodů`)
                                .join('\n');
                            embed.addFields({ name: 'Konečné skóre', value: statsField, inline: false });
                        }

                        embed.addFields({ 
                            name: 'ℹ️ Info', 
                            value: 'Zabrané basepointy zůstávají v systému a při dalším SSU bude pokračovat udělování bodů.', 
                            inline: false 
                        });

                        interaction.editReply({ embeds: [embed] });
                    });
                })
                .catch((error) => {
                    console.error('Error ending SSU:', error);
                    interaction.editReply('❌ Nastala chyba při ukončování SSU.');
                });
        });

    } catch (error) {
        console.error('Error in stop command:', error);
        await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
    }
}
