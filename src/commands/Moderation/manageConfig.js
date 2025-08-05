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
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('Uživatel pro filtrování historie')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('days')
                        .setDescription('Počet dní historie')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('all')
                .setDescription('Zobrazí všechny konfigurace v databázi')),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'view') {
                const section = interaction.options.getString('section');
                try {
                    const config = await ConfigSystem.get(section);

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle(`${section.charAt(0).toUpperCase() + section.slice(1)} Configuration`)
                        .setDescription('```json\n' + JSON.stringify(config, null, 2) + '\n```');

                    await interaction.editReply({ embeds: [embed], ephemeral: true });
                } catch (error) {
                    console.error(`Error getting config for ${section}:`, error);
                    await interaction.editReply({ 
                        content: `❌ Nastala chyba při načítání konfigurace: ${error.message}`,
                        ephemeral: true 
                    });
                }
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

                try {
                    const newConfig = await ConfigSystem.set(section, key, parsedValue);

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle(`${section.charAt(0).toUpperCase() + section.slice(1)} Configuration Updated`)
                        .addFields(
                            { name: 'Updated Key', value: key, inline: true },
                            { name: 'New Value', value: value.toString(), inline: true }
                        )
                        .setDescription('New configuration:\n```json\n' + JSON.stringify(newConfig, null, 2) + '\n```');

                    await interaction.editReply({ embeds: [embed], ephemeral: true });
                } catch (error) {
                    console.error(`Error setting config for ${section}:`, error);
                    await interaction.editReply({ 
                        content: `❌ Nastala chyba při aktualizaci konfigurace: ${error.message}`,
                        ephemeral: true 
                    });
                }
            }
            else if (subcommand === 'income_history') {
                const days = interaction.options.getInteger('days') || 7;
                const user = interaction.options.getUser('user');
                
                try {
                    const history = await IncomeSystem.getHistory(user?.id, days);

                    if (history.length === 0) {
                        await interaction.editReply({ content: '❌ Žádná historie nenalezena', ephemeral: true });
                        return;
                    }

                    const embeds = history.map(entry => {
                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`Income Distribution - ${entry.date}`)
                            .setTimestamp();

                        // Přidání informací o distribucích
                        let totalDistributions = 0;
                        let uniqueUsers = new Set();
                        
                        entry.distributions.forEach(dist => {
                            uniqueUsers.add(dist.userId);
                            totalDistributions += dist.amount;
                        });

                        // Pokud je filtrován uživatel, zobrazit detaily
                        if (user) {
                            const userDistributions = entry.distributions.filter(d => d.userId === user.id);
                            if (userDistributions.length > 0) {
                                embed.setDescription(`Income pro uživatele: ${user.tag}`);
                                userDistributions.forEach(dist => {
                                    embed.addFields({
                                        name: `Role: ${dist.roleName || 'Neznámá role'}`,
                                        value: `Částka: ${dist.amount}`,
                                        inline: true
                                    });
                                });
                            } else {
                                embed.setDescription(`Žádný income pro uživatele ${user.tag} v tento den`);
                            }
                        } else {
                            // Celkový přehled
                            embed.setDescription(`Celkem rozděleno: ${totalDistributions}\nPočet uživatelů: ${uniqueUsers.size}`);
                        }

                        return embed;
                    });

                    for (let i = 0; i < embeds.length; i += 10) {
                        const embedBatch = embeds.slice(i, i + 10);
                        if (i === 0) {
                            await interaction.editReply({ embeds: embedBatch, ephemeral: true });
                        } else {
                            await interaction.followUp({ embeds: embedBatch, ephemeral: true });
                        }
                    }
                } catch (error) {
                    console.error('Error fetching income history:', error);
                    await interaction.editReply({ 
                        content: `❌ Nastala chyba při získávání historie: ${error.message}`,
                        ephemeral: true 
                    });
                }
            }
            else if (subcommand === 'all') {
                try {
                    const allConfigs = await ConfigSystem.getAllConfigs();
                    
                    if (Object.keys(allConfigs).length === 0) {
                        await interaction.editReply({ 
                            content: '❌ Žádné konfigurace nenalezeny v databázi',
                            ephemeral: true 
                        });
                        return;
                    }
                    
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('Všechny konfigurace')
                        .setDescription('Seznam všech konfigurací v databázi:');
                    
                    for (const [key, config] of Object.entries(allConfigs)) {
                        embed.addFields({
                            name: key.charAt(0).toUpperCase() + key.slice(1),
                            value: `Aktualizováno: ${new Date(config.updatedAt).toLocaleString()}\n` +
                                   '```json\n' + JSON.stringify(config.data, null, 2).substring(0, 1000) + 
                                   (JSON.stringify(config.data, null, 2).length > 1000 ? '...' : '') + 
                                   '\n```',
                            inline: false
                        });
                    }
                    
                    await interaction.editReply({ embeds: [embed], ephemeral: true });
                } catch (error) {
                    console.error('Error fetching all configs:', error);
                    await interaction.editReply({ 
                        content: `❌ Nastala chyba při získávání konfigurací: ${error.message}`,
                        ephemeral: true 
                    });
                }
            }
        } catch (error) {
            console.error('Error in config command:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: `❌ Nastala chyba při zpracování příkazu: ${error.message}`,
                    ephemeral: true 
                });
            } else {
                await interaction.editReply({ 
                    content: `❌ Nastala chyba při zpracování příkazu: ${error.message}`,
                    ephemeral: true 
                });
            }
        }
    }
};