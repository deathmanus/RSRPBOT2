const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('request')
        .setDescription('Požádá o oprávnění')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Typ žádosti')
                .setRequired(true)
                .addChoices(
                    { name: 'Zástupce', value: 'deputy' }
                ))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Důvod žádosti')
                .setRequired(true)),

    async execute(interaction) {
        try {
            // Check if user is in a fraction
            const member = interaction.member;
            const fractionPath = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            const userFraction = member.roles.cache.find(role => fractions.includes(role.name))?.name;

            if (!userFraction) {
                return await interaction.reply({
                    content: '❌ Nejste členem žádné frakce.',
                    ephemeral: true
                });
            }

            // Check if user already has deputy role for deputy requests
            const requestType = interaction.options.getString('type');
            if (requestType === 'deputy') {
                const deputyRole = interaction.guild.roles.cache.find(r => r.name === `Zástupce ${userFraction}`);
                if (member.roles.cache.has(deputyRole.id)) {
                    return await interaction.reply({
                        content: '❌ Již jste zástupcem frakce.',
                        ephemeral: true
                    });
                }
            }

            const reason = interaction.options.getString('reason');
            
            // Create embed for the request
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('📝 Žádost o oprávnění')
                .setDescription(`${interaction.user} žádá o ${requestType === 'deputy' ? 'pozici zástupce' : 'oprávnění'}`)
                .addFields(
                    { name: 'Frakce', value: userFraction, inline: true },
                    { name: 'Typ', value: requestType === 'deputy' ? 'Zástupce' : 'Jiné', inline: true },
                    { name: 'Důvod', value: reason }
                )
                .setTimestamp();

            // Create buttons for leaders to respond
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`perm-accept:${interaction.user.id}:${userFraction}:${requestType}`)
                        .setLabel('Schválit')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`perm-deny:${interaction.user.id}:${userFraction}:${requestType}`)
                        .setLabel('Zamítnout')
                        .setStyle(ButtonStyle.Danger)
                );

            // Send the request
            await interaction.reply({
                content: `<@&${interaction.guild.roles.cache.find(r => r.name === `Velitel ${userFraction}`).id}>`,
                embeds: [embed],
                components: [buttons]
            });

        } catch (error) {
            console.error('Error in permission request:', error);
            await interaction.reply({
                content: '❌ Nastala chyba při zpracování žádosti.',
                ephemeral: true
            });
        }
    }
};