const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ConfigSystem = require('../../systems/configSystem');
const IncomeSystem = require('../../systems/incomeSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Spravuje nastavení systému')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('Zobrazí aktuální nastavení')
                .addStringOption(option =>
                    option.setName('section')
                        .setDescription('Sekce nastavení')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Shop', value: 'shop' },
                            { name: 'Income', value: 'income' },
                            { name: 'Fractions', value: 'fractions' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Změní hodnotu nastavení')
                .addStringOption(option =>
                    option.setName('section')
                        .setDescription('Sekce nastavení')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Shop', value: 'shop' },
                            { name: 'Income', value: 'income' },
                            { name: 'Fractions', value: 'fractions' }
                        ))
                .addStringOption(option =>
                    option.setName('key')
                        .setDescription('Klíč nastavení (např. paymentTime)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('value')
                        .setDescription('Nová hodnota')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('income_history')
                .setDescription('Zobrazí historii income plateb')
                .addIntegerOption(option =>
                    option.setName('days')
                        .setDescription('Počet dní historie')
                        .setRequired(false))),

    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'view') {
                const section = interaction.options.getString('section');
                const config = ConfigSystem.get(section);

                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(`${section.charAt(0).toUpperCase() + section.slice(1)} Configuration`)
                    .setDescription('```json\n' + JSON.stringify(config, null, 2) + '\n```');

                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
            else if (subcommand === 'set') {
                const section = interaction.options.getString('section');
                const key = interaction.options.getString('key');
                const value = interaction.options.getString('value');

                // Try to parse the value as JSON if possible
                let parsedValue;
                try {
                    parsedValue = JSON.parse(value);
                } catch {
                    parsedValue = value;
                }

                const newConfig = ConfigSystem.set(section, key, parsedValue);

                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(`${section.charAt(0).toUpperCase() + section.slice(1)} Configuration Updated`)
                    .addFields(
                        { name: 'Updated Key', value: key, inline: true },
                        { name: 'New Value', value: value.toString(), inline: true }
                    )
                    .setDescription('New configuration:\n```json\n' + JSON.stringify(newConfig, null, 2) + '\n```');

                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
            else if (subcommand === 'income_history') {
                const days = interaction.options.getInteger('days') || 7;
                const history = IncomeSystem.getHistory(days);

                if (history.length === 0) {
                    await interaction.reply({ content: '❌ Žádná historie nenalezena', ephemeral: true });
                    return;
                }

                const embeds = history.map(entry => {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle(`Income Distribution - ${new Date(entry.timestamp).toLocaleDateString()}`)
                        .setTimestamp(new Date(entry.timestamp));

                    entry.distributions.forEach(dist => {
                        embed.addFields({
                            name: `Frakce: ${dist.fraction}`,
                            value: `Celkem: ${dist.totalIncome}\nČlenů: ${dist.memberIncomes.length}`,
                            inline: true
                        });
                    });

                    return embed;
                });

                for (let i = 0; i < embeds.length; i += 10) {
                    const embedBatch = embeds.slice(i, i + 10);
                    if (i === 0) {
                        await interaction.reply({ embeds: embedBatch, ephemeral: true });
                    } else {
                        await interaction.followUp({ embeds: embedBatch, ephemeral: true });
                    }
                }
            }
        } catch (error) {
            console.error('Error in config command:', error);
            await interaction.reply({ 
                content: '❌ Nastala chyba při zpracování příkazu',
                ephemeral: true 
            });
        }
    }
};