const { SlashCommandBuilder, EmbedBuilder } = require('@discordjs/builders');
const { setSSUStatus, getSSUStatus } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('zabírání_start')
        .setDescription('Spuštění počítání basepointů (SSU)'),
    async execute(interaction) {
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
                                value: 'Hráči mohou nyní používat `/capture` pro zabírání basepointů.\nKaždých 30 minut budou uděleny 2 body do frakčního rozpočtu za každý zabraný basepoint.', 
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
};
