const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ShopSystem, ShopLogger } = require('../../systems/shopSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('manageshop')
        .setDescription('Spravovat nastavení obchodu')
        .addSubcommand(subcommand =>
            subcommand
                .setName('clearcache')
                .setDescription('Vymazat cache obchodu'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('setcachetimeout')
                .setDescription('Nastavit časový limit pro cache')
                .addIntegerOption(option =>
                    option.setName('minutes')
                        .setDescription('Počet minut')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('viewlogs')
                .setDescription('Zobrazit logy obchodu')
                .addIntegerOption(option =>
                    option.setName('minutes')
                        .setDescription('Počet minut historie')
                        .setRequired(false))),

    async execute(interaction) {
        // Kontrola oprávnění
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            return await interaction.reply({
                content: '❌ Nemáte oprávnění pro použití tohoto příkazu.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'clearcache':
                ShopSystem.clearCache();
                await interaction.reply({
                    content: '✅ Cache obchodu byla vymazána.',
                    ephemeral: true
                });
                break;

            case 'setcachetimeout':
                const minutes = interaction.options.getInteger('minutes');
                if (minutes < 1) {
                    return await interaction.reply({
                        content: '❌ Časový limit musí být alespoň 1 minuta.',
                        ephemeral: true
                    });
                }
                ShopSystem.updateCacheTimeout(minutes);
                await interaction.reply({
                    content: `✅ Časový limit cache byl nastaven na ${minutes} minut.`,
                    ephemeral: true
                });
                break;

            case 'viewlogs':
                const timeWindow = interaction.options.getInteger('minutes') || 60;
                
                // Dočasná odpověď, protože získávání logů může trvat
                await interaction.deferReply({ ephemeral: true });
                
                try {
                    const logs = await ShopLogger.getRecentLogs(timeWindow);
                    
                    if (logs.length === 0) {
                        return await interaction.editReply({
                            content: '❌ Žádné logy nebyly nalezeny pro zadané časové období.',
                        });
                    }

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('Logy obchodu')
                        .setDescription(`Posledních ${timeWindow} minut`)
                        .addFields(
                            logs.slice(-10).map(log => ({
                                name: `${new Date(log.timestamp).toLocaleString()} - ${log.action}`,
                                value: '```json\n' + JSON.stringify(log.data, null, 2) + '\n```'
                            }))
                        )
                        .setFooter({ text: `Zobrazeno ${Math.min(logs.length, 10)} z ${logs.length} záznamů` });

                    await interaction.editReply({
                        embeds: [embed],
                    });
                } catch (error) {
                    console.error('Error fetching shop logs:', error);
                    await interaction.editReply({
                        content: '❌ Nastala chyba při načítání logů.',
                    });
                }
                break;
        }
    }
};