const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { removeCapturedPoint, getCapturedPoints } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('de-capture')
        .setDescription('Odebere zabrání basepoint (pouze pro administrátory)')
        .addIntegerOption(option =>
            option
                .setName('capture_id')
                .setDescription('ID zabrání k odebrání')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Kontrola oprávnění (pouze administrátoři nebo moderátoři)
            if (!interaction.member.permissions.has('Administrator') && 
                !interaction.member.roles.cache.some(role => role.name.toLowerCase().includes('moderator'))) {
                return interaction.editReply('❌ Nemáte oprávnění k použití tohoto příkazu.');
            }

            const captureId = interaction.options.getInteger('capture_id');

            // Najít zabrání v databázi
            getCapturedPoints((err, captures) => {
                if (err) {
                    console.error('Error fetching captures:', err);
                    return interaction.editReply('❌ Nastala chyba při načítání zabrání.');
                }

                const capture = captures.find(c => c.id === captureId);
                if (!capture) {
                    return interaction.editReply('❌ Zabrání s tímto ID nebylo nalezeno nebo již bylo odebráno.');
                }

                // Odebrání zabrání
                removeCapturedPoint(captureId)
                    .then(async (success) => {
                        if (success) {
                            const embed = new EmbedBuilder()
                                .setColor(0xFF0000)
                                .setTitle('🚫 Zabrání odebráno!')
                                .setDescription(`Zabrání basepoint **${capture.basepoint_name}** od frakce **${capture.fraction_name}** bylo odebráno.`)
                                .addFields(
                                    { name: 'Původní frakce', value: capture.fraction_name, inline: true },
                                    { name: 'Basepoint', value: capture.basepoint_name, inline: true },
                                    { name: 'Odebral', value: interaction.user.tag, inline: true },
                                    { name: 'Původně zabrali', value: capture.captured_by, inline: true }
                                )
                                .setTimestamp()
                                .setFooter({ text: `Capture ID: ${captureId}` });

                            await interaction.editReply({ embeds: [embed] });
                        } else {
                            await interaction.editReply('❌ Nastala chyba při odebírání zabrání.');
                        }
                    })
                    .catch(async (error) => {
                        console.error('Error removing captured point:', error);
                        await interaction.editReply('❌ Nastala chyba při odebírání zabrání.');
                    });
            });

        } catch (error) {
            console.error('Error in de-capture command:', error);
            await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
        }
    }
};
