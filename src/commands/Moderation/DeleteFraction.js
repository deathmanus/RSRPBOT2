const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletefraction')
        .setDescription('Odstranění frakce'),
    async execute(interaction) {
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
                    const confirmationMessage = await interaction.followUp({ embeds: [confirmEmbed], components: [confirmRow], ephemeral: true });

                    const confirmFilter = btn => ['yes-delete', 'no-delete'].includes(btn.customId) && btn.user.id === interaction.user.id;
                    const confirmCollector = interaction.channel.createMessageComponentCollector({ filter: confirmFilter, time: 60000 });

                    confirmCollector.on('collect', async btn => {
                        try {
                            await btn.deferUpdate();

                            if (btn.customId === 'yes-delete') {
                                const guild = interaction.guild;
                                const backupChannel = guild.channels.cache.get('1213225816201240587');

                                if (!backupChannel) {
                                    console.error('Backup channel not found');
                                    return await btn.editReply({
                                        content: '❌ Chyba: Záložní kanál nenalezen',
                                        components: [],
                                        ephemeral: true
                                    });
                                }

                                // Create backup of all files
                                const fractionPath = path.join(fractionsDir, selectedFraction);

                                // Function to recursively get all files
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

                                // Send backup message
                                const backupEmbed = new EmbedBuilder()
                                    .setColor(0xFF0000)
                                    .setTitle(`📤 Záloha frakce ${selectedFraction}`)
                                    .setDescription(`Záloha souborů před odstraněním frakce **${selectedFraction}**`)
                                    .setTimestamp();

                                await backupChannel.send({ embeds: [backupEmbed] });

                                // Send all files
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

                                // Send completion message
                                await backupChannel.send({
                                    embeds: [new EmbedBuilder()
                                        .setColor(0xFF0000)
                                        .setTitle(`📥 Záloha dokončena`)
                                        .setDescription(`Celkem zálohováno: ${allFiles.length} souborů`)
                                        .setTimestamp()]
                                });

                                // Delete fraction resources
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

                                // Delete fraction directory
                                fs.rmSync(fractionPath, { recursive: true, force: true });

                                const fractionEmbed = new EmbedBuilder()
                                    .setColor(0xFF0000)
                                    .setTitle(`✅ Odstranění frakce ${selectedFraction}`)
                                    .setDescription(`Frakce **${selectedFraction}** byla úspěšně odstraněna.`);

                                await interaction.editReply({ embeds: [fractionEmbed], components: [], ephemeral: true });
                            } else {
                                await interaction.editReply({ content: '❌ Odstranění frakce bylo zrušeno.', components: [], ephemeral: true });
                            }

                            confirmCollector.stop();
                        } catch (error) {
                            console.error('Chyba v potvrzení:', error);
                            await interaction.editReply({ content: '❌ Nastala chyba při odstraňování frakce.', components: [], ephemeral: true });
                        }
                    });

                    confirmCollector.on('end', async (collected, reason) => {
                        if (reason === 'time') {
                            await interaction.editReply({ content: '⌛ Časový limit vypršel. Odstranění frakce bylo zrušeno.', components: [], ephemeral: true });
                        }
                    });
                } catch (error) {
                    console.error('Chyba při výběru frakce:', error);
                    await interaction.editReply({ content: '❌ Nastala chyba při zpracování výběru frakce.', components: [], ephemeral: true });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({ content: '⌛ Časový limit vypršel. Akce byla zrušena.', components: [], ephemeral: true });
                }
            });
        } catch (error) {
            console.error('Chyba v příkazu deletefraction:', error);
            await interaction.editReply({ content: '❌ Nastala chyba při zpracování příkazu.', components: [], ephemeral: true });
        }
    }
};