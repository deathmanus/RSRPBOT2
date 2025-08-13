const { SlashCommandBuilder, EmbedBuilder } = require('@discordjs/builders');
const { setSSUStatus, getSSUStatus, getActiveFractionCaptures } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('zabírání_konec')
        .setDescription('Ukončení počítání basepointů'),
    async execute(interaction) {
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
            console.error('Error in konec command:', error);
            await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
        }
    }
};