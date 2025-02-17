const { SlashCommandBuilder, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('createfraction')
        .setDescription('Vytvoření frakce')
        .addStringOption(option => 
            option.setName('zkratka')
                .setDescription('Zkratka frakce')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('nazev')
                .setDescription('Celý název frakce')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('popis')
                .setDescription('Popis frakce')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('barva')
                .setDescription('Barva v hexadecimálním formátu (např. FF0000)')
                .setRequired(true)),
            
    async execute(interaction) {
        await interaction.deferReply();

        const zkratka = interaction.options.getString('zkratka');
        const nazev = interaction.options.getString('nazev');
        const popis = interaction.options.getString('popis');
        const barva = interaction.options.getString('barva');

        if (!/^#[0-9A-Fa-f]{6}$/.test(`#${barva}`)) {
            return interaction.editReply({ content: '❌ Barva musí být hexadecimální kód o délce 6 znaků (např. FF0000).' });
        }

        const guild = interaction.guild;
        const roleHierarchy = '1226981850933755966';
        const categoryID = '1213225814502408218';

        const fractionRole = await guild.roles.create({
            name: `${zkratka}`,
            color: `#${barva}`,
            position: guild.roles.cache.get(roleHierarchy).position - 1
        });

        const deputyRole = await guild.roles.create({
            name: `Zástupce ${zkratka}`,
            color: `#${barva}`,
            position: guild.roles.cache.get(roleHierarchy).position - 1
        });

        const leaderRole = await guild.roles.create({
            name: `Velitel ${zkratka}`,
            color: `#${barva}`,
            position: guild.roles.cache.get(roleHierarchy).position - 1
        });

        const room = await guild.channels.create({
            name: `frakce-${zkratka.toLowerCase()}`,
            type: 0,
            parent: categoryID,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.SendMessages]
                },
                {
                    id: deputyRole.id,
                    allow: [PermissionsBitField.Flags.SendMessages]
                },
                {
                    id: leaderRole.id,
                    allow: [PermissionsBitField.Flags.SendMessages]
                }
            ]
        });

        const fractionDir = path.join(__dirname, '../../files/Fractions', zkratka);
        fs.mkdirSync(fractionDir, { recursive: true });

        const fractionData = {
            nazev,
            popis,
            roomId: room.id,
            leaderRoleId: leaderRole.id,
            deputyRoleId: deputyRole.id,
            fractionRoleId: fractionRole.id,
            money: 0,
            warns: 0,
            creationDate: new Date().toISOString().split('T')[0]
        };
        fs.writeFileSync(path.join(fractionDir, `${zkratka}.json`), JSON.stringify(fractionData, null, 2));

        const attachment = new AttachmentBuilder(path.join(fractionDir, `${zkratka}.json`));

       
        
        await interaction.editReply({ content: `✅ Kanál ${room} byl vytvořen! Role ${leaderRole}, ${deputyRole}, ${fractionRole} taky.`, files: [attachment] });
    }
};