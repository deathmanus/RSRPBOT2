const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getCapturedPoints } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('captures_list')
        .setDescription('Zobrazí seznam všech aktuálně zabraných basepointů')
        .addStringOption(option =>
            option
                .setName('fraction')
                .setDescription('Zobrazit pouze zabrání konkrétní frakce')
                .setRequired(false)),

    async execute(interaction) {
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
};
