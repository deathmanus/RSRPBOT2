const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSSUStatus, getActiveFractionCaptures, getCapturedPoints } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('capture_status')
        .setDescription('Zobrazí aktuální stav zabírání basepointů'),

    async execute(interaction) {
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
};
