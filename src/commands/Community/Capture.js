const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { addCapturedPoint, getFractionByName, getSSUStatus, getActiveBasepoints, getBasepointByName } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('capture')
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
                .setRequired(true)),

    async autocomplete(interaction) {
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
    },

    async execute(interaction) {
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
                            return interaction.editReply('❌ Tento basepoint není povolen pro capturing. Použijte `/manage_basepoints list` pro zobrazení povolených basepointů.');
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
};
