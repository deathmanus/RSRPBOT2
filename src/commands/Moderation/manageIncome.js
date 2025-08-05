const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { addIncomeRole, removeIncomeRole, addAuditLog } = require('../../Database/database');

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
        try {
            if (interaction.options.getSubcommand() === 'add') {
                const role = interaction.options.getRole('role');
                const amount = interaction.options.getInteger('amount');

                // Přidání role do databáze
                await addIncomeRole(role.id, role.name, amount, interaction.user.id);
                
                // Zápis do audit logu
                addAuditLog(
                    interaction.user.id,
                    'add_income_role',
                    'role',
                    role.id,
                    JSON.stringify({ 
                        roleName: role.name, 
                        dailyIncome: amount 
                    })
                );
                
                await interaction.reply(`✅ Role ${role.name} byla přidána s denním income ${amount}`);
            }
            else if (interaction.options.getSubcommand() === 'remove') {
                const role = interaction.options.getRole('role');
                
                // Odebrání role z databáze
                removeIncomeRole(role.id, async (err, success) => {
                    if (err || !success) {
                        return interaction.reply('❌ Tato role nemá nastavený income');
                    }
                    
                    // Zápis do audit logu
                    addAuditLog(
                        interaction.user.id,
                        'remove_income_role',
                        'role',
                        role.id,
                        JSON.stringify({ roleName: role.name })
                    );
                    
                    await interaction.reply(`✅ Role ${role.name} byla odebrána z income systému`);
                });
            }
        } catch (error) {
            console.error('Error in income command:', error);
            await interaction.reply({
                content: '❌ Nastala chyba při zpracování příkazu.',
                ephemeral: true
            });
        }
    }
};