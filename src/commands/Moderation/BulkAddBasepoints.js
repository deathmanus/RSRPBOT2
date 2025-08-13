const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { addBasepoint } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bulk_add_basepoints')
        .setDescription('Hromadně přidá basepointy ze seznamu (oddělené čárkami)')
        .addStringOption(option =>
            option
                .setName('basepoints')
                .setDescription('Seznam basepointů oddělený čárkami (např: "Základna A, Základna B, Továrna")')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Kontrola oprávnění
            if (!interaction.member.permissions.has('Administrator') && 
                !interaction.member.roles.cache.some(role => role.name.toLowerCase().includes('moderator'))) {
                return interaction.editReply('❌ Nemáte oprávnění k použití tohoto příkazu.');
            }

            const basepointsString = interaction.options.getString('basepoints');
            const basepointNames = basepointsString
                .split(',')
                .map(name => name.trim())
                .filter(name => name.length > 0);

            if (basepointNames.length === 0) {
                return interaction.editReply('❌ Nebyl zadán žádný platný název basepoint.');
            }

            if (basepointNames.length > 20) {
                return interaction.editReply('❌ Můžete přidat maximálně 20 basepointů najednou.');
            }

            const results = {
                success: [],
                failed: [],
                duplicates: []
            };

            // Přidání basepointů jeden po druhém
            for (const name of basepointNames) {
                try {
                    const basepointId = await addBasepoint(name, null, interaction.user.id);
                    results.success.push({ name, id: basepointId });
                } catch (error) {
                    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                        results.duplicates.push(name);
                    } else {
                        results.failed.push({ name, error: error.message });
                    }
                }
            }

            // Vytvoření odpovědi
            const embed = new EmbedBuilder()
                .setTitle('📝 Hromadné přidání basepointů')
                .setTimestamp()
                .addFields(
                    { name: 'Přidal', value: interaction.user.tag, inline: true },
                    { name: 'Celkem zadáno', value: basepointNames.length.toString(), inline: true }
                );

            // Úspěšně přidané
            if (results.success.length > 0) {
                embed.setColor(0x00FF00);
                const successList = results.success
                    .map(bp => `✅ **${bp.name}** (ID: ${bp.id})`)
                    .join('\n');
                embed.addFields({ 
                    name: `✅ Úspěšně přidáno (${results.success.length})`, 
                    value: successList.length > 1024 ? successList.substring(0, 1020) + '...' : successList, 
                    inline: false 
                });
            }

            // Duplicity
            if (results.duplicates.length > 0) {
                if (results.success.length === 0) embed.setColor(0xFFAA00);
                const duplicatesList = results.duplicates
                    .map(name => `⚠️ **${name}**`)
                    .join('\n');
                embed.addFields({ 
                    name: `⚠️ Již existují (${results.duplicates.length})`, 
                    value: duplicatesList.length > 1024 ? duplicatesList.substring(0, 1020) + '...' : duplicatesList, 
                    inline: false 
                });
            }

            // Chyby
            if (results.failed.length > 0) {
                if (results.success.length === 0) embed.setColor(0xFF0000);
                const failedList = results.failed
                    .map(bp => `❌ **${bp.name}** - ${bp.error}`)
                    .join('\n');
                embed.addFields({ 
                    name: `❌ Chyby (${results.failed.length})`, 
                    value: failedList.length > 1024 ? failedList.substring(0, 1020) + '...' : failedList, 
                    inline: false 
                });
            }

            // Souhrn
            if (results.success.length === basepointNames.length) {
                embed.setDescription('🎉 Všechny basepointy byly úspěšně přidány!');
            } else if (results.success.length > 0) {
                embed.setDescription(`Částečný úspěch: ${results.success.length}/${basepointNames.length} basepointů přidáno.`);
            } else {
                embed.setDescription('❌ Žádné basepointy nebyly přidány.');
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in bulk_add_basepoints command:', error);
            await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
        }
    }
};
