const { SlashCommandBuilder, EmbedBuilder } = require('@discordjs/builders');
const { getCapturedPoints, getSSUStatus, getActiveFractionCaptures } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('count')
        .setDescription('Na počítání basepointů'),
    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Kontrola stavu SSU
            getSSUStatus((err, ssuStatus) => {
                if (err) {
                    console.error('Error checking SSU status:', err);
                    return interaction.editReply('❌ Nastala chyba při kontrole stavu SSU.');
                }

                // Získání všech aktivních zabrání
                getCapturedPoints((err, captures) => {
                    if (err) {
                        console.error('Error fetching captures:', err);
                        return interaction.editReply('❌ Nastala chyba při načítání zabrání.');
                    }

                    // Získání statistik frakcí
                    getActiveFractionCaptures((err, fractionStats) => {
                        if (err) {
                            console.error('Error fetching fraction stats:', err);
                            return interaction.editReply('❌ Nastala chyba při načítání statistik.');
                        }

                        // Formátování data
                        const now = new Date();
                        const day = String(now.getDate()).padStart(2, '0');
                        const month = String(now.getMonth() + 1).padStart(2, '0');
                        const formattedDate = `${day}. ${month}.`;

                        // Vytvoření výstupu
                        let output = `# Zabírání z ${formattedDate}\n\n`;

                        if (!fractionStats || fractionStats.length === 0) {
                            output += '**Žádné zabrané basepointy**\n';
                        } else {
                            // Seskupení zabrání podle basepointů
                            const basepointGroups = {};
                            
                            captures.forEach(capture => {
                                if (!basepointGroups[capture.basepoint_name]) {
                                    basepointGroups[capture.basepoint_name] = [];
                                }
                                basepointGroups[capture.basepoint_name].push({
                                    fraction: capture.fraction_name,
                                    time: new Date(capture.captured_at)
                                });
                            });

                            // Seřazení podle času pro každý basepoint a určení vítěze
                            for (const basepoint in basepointGroups) {
                                const captures = basepointGroups[basepoint].sort((a, b) => a.time - b.time);
                                
                                // Simulace counting logiky - určení, kdo drží basepoint nejdéle
                                let currentHolder = null;
                                let maxTime = 0;
                                let lastChangeTime = null;
                                
                                const now = ssuStatus && ssuStatus.ended_at ? new Date(ssuStatus.ended_at) : new Date();
                                
                                captures.forEach((capture, index) => {
                                    const startTime = capture.time;
                                    const nextCaptureTime = index + 1 < captures.length 
                                        ? captures[index + 1].time 
                                        : now;
                                    
                                    const holdTime = nextCaptureTime - startTime;
                                    
                                    if (holdTime > maxTime) {
                                        maxTime = holdTime;
                                        currentHolder = capture.fraction;
                                    }
                                });

                                output += `**${basepoint}:** ${currentHolder || 'Nikdo'}\n`;
                            }
                        }

                        // Přidání informace o stavu SSU
                        if (ssuStatus && ssuStatus.is_active) {
                            output += "\n*SSU je aktivní - capturing probíhá*";
                        } else if (ssuStatus && ssuStatus.ended_at) {
                            const endTime = new Date(ssuStatus.ended_at);
                            const timeString = new Intl.DateTimeFormat('en-GB', { 
                                hour: '2-digit', 
                                minute: '2-digit', 
                                hour12: false, 
                                timeZone: 'Etc/GMT-2' 
                            }).format(endTime);
                            output += `\n*Konec zabírání: ${timeString}*`;
                        }

                        output += "\n*Obsazuje se 45 minut po začátku SSU*";

                        // Odeslání odpovědi
                        interaction.editReply(output);
                    });
                });
            });

        } catch (error) {
            console.error('Error in count command:', error);
            await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
        }
    }
};