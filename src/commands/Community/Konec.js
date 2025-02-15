const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('zabírání_konec')
        .setDescription('Ukončení počítání basepointů'),
    async execute(interaction) {
        let now = new Date();
        let timeString = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Etc/GMT-2' }).format(now);
        await interaction.reply(`Konec zabírání: **${timeString}**`);
    }
};