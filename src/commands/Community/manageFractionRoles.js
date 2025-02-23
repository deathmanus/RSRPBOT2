const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Správa rolí frakce') // Added main command description
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Přidá uživateli roli frakce')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Uživatel, kterému chcete přidat roli')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option
                        .setName('deputy')
                        .setDescription('Přidat i roli zástupce?')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Odebere uživateli roli frakce')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Uživatel, kterému chcete odebrat roli')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            // Check if user has leader/deputy permissions
            const member = interaction.member;
            const isLeader = member.roles.cache.some(r => r.name.startsWith('Velitel'));
            const isDeputy = member.roles.cache.some(r => r.name.startsWith('Zástupce'));

            if (!isLeader && !isDeputy) {
                return await interaction.editReply('❌ Nemáte oprávnění používat tento příkaz.');
            }

            // Get user's fraction
            const fractionPath = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            const userFraction = member.roles.cache.find(role => fractions.includes(role.name))?.name;

            if (!userFraction) {
                return await interaction.editReply('❌ Nejste členem žádné frakce.');
            }

            const targetUser = interaction.options.getUser('user');

            // Add self-modification prevention
            if (targetUser.id === interaction.user.id) {
                return await interaction.editReply('❌ Nemůžete upravovat své vlastní role.');
            }

            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'add') {
                await handleRoleAdd(interaction, targetMember, userFraction);
            } else if (subcommand === 'remove') {
                await handleRoleRemove(interaction, targetMember, userFraction);
            }

        } catch (error) {
            console.error('Error in role command:', error);
            await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
        }
    }
};

async function handleRoleAdd(interaction, targetMember, userFraction) {
    const makeDeputy = interaction.options.getBoolean('deputy') ?? false;
    const fractionRole = interaction.guild.roles.cache.find(r => r.name === userFraction);
    const deputyRole = interaction.guild.roles.cache.find(r => r.name === `Zástupce ${userFraction}`);

    // Check if user is already in any fraction
    const hasAnyFraction = targetMember.roles.cache.some(r => r.name.endsWith('PD') || r.name.endsWith('EMS'));

    // Check if user is already in this fraction
    if (targetMember.roles.cache.has(fractionRole.id)) {
        if (makeDeputy && !targetMember.roles.cache.has(deputyRole.id)) {
            await targetMember.roles.add(deputyRole);
            return await interaction.editReply(`✅ ${targetMember} byl povýšen na zástupce.`);
        } else if (!makeDeputy && targetMember.roles.cache.has(deputyRole.id)) {
            await targetMember.roles.remove(deputyRole);
            return await interaction.editReply(`✅ ${targetMember} byl degradován z pozice zástupce.`);
        }
        return await interaction.editReply(`❌ ${targetMember} je již členem frakce ${userFraction}.`);
    }

    if (hasAnyFraction) {
        return await interaction.editReply(`❌ ${targetMember} je již členem jiné frakce.`);
    }

    // Create confirmation embed
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📝 Pozvánka do frakce')
        .setDescription(`${targetMember}, byli jste pozváni do frakce ${userFraction}${makeDeputy ? ' jako zástupce' : ''}.`)
        .addFields(
            { name: 'Frakce', value: userFraction, inline: true },
            { name: 'Pozval', value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`accept-invite:${targetMember.id}:${userFraction}:${makeDeputy}`)
                .setLabel('Přijmout')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline-invite:${targetMember.id}:${userFraction}`)
                .setLabel('Odmítnout')
                .setStyle(ButtonStyle.Danger)
        );

    await interaction.editReply({
        content: `${targetMember}`,
        embeds: [embed],
        components: [buttons]
    });
}

async function handleRoleRemove(interaction, targetMember, userFraction) {
    const fractionRole = interaction.guild.roles.cache.find(r => r.name === userFraction);
    const deputyRole = interaction.guild.roles.cache.find(r => r.name === `Zástupce ${userFraction}`);

    if (!targetMember.roles.cache.has(fractionRole.id)) {
        return await interaction.editReply(`❌ ${targetMember} není členem frakce ${userFraction}.`);
    }

    await targetMember.roles.remove([fractionRole.id, deputyRole.id]);
    await interaction.editReply(`✅ ${targetMember} byl odebrán z frakce ${userFraction}.`);
}