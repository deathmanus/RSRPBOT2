const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('income')
        .setDescription('Spravuje income role')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Přidá novou income roli')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role pro income')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Denní částka')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Odebere income roli')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role k odebrání')
                        .setRequired(true))),

    async execute(interaction) {
        const incomeFile = path.join(__dirname, '../../files/Income/income-config.json');
        const config = JSON.parse(fs.readFileSync(incomeFile, 'utf8'));

        if (interaction.options.getSubcommand() === 'add') {
            const role = interaction.options.getRole('role');
            const amount = interaction.options.getInteger('amount');

            config.roles.push({
                roleId: role.id,
                dailyIncome: amount,
                description: role.name
            });

            fs.writeFileSync(incomeFile, JSON.stringify(config, null, 2));
            await interaction.reply(`✅ Role ${role.name} byla přidána s denním income ${amount}`);
        }
        else if (interaction.options.getSubcommand() === 'remove') {
            const role = interaction.options.getRole('role');
            const index = config.roles.findIndex(r => r.roleId === role.id);

            if (index === -1) {
                return interaction.reply('❌ Tato role nemá nastavený income');
            }

            config.roles.splice(index, 1);
            fs.writeFileSync(incomeFile, JSON.stringify(config, null, 2));
            await interaction.reply(`✅ Role ${role.name} byla odebrána z income systému`);
        }
    }
};