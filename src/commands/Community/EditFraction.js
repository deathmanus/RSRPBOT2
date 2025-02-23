const { 
    SlashCommandBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editfraction')
        .setDescription('Upraví nastavení frakce')
        .addStringOption(option => 
            option.setName('popis')
                .setDescription('Nový popis frakce')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('barva')
                .setDescription('Nová barva v hexadecimálním formátu (např. FF0000)')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('obrazek')
                .setDescription('Nový obrázek frakce')
                .setRequired(false)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Check if user is leader or deputy
            const member = interaction.member;
            const fractionRole = member.roles.cache.find(role => 
                fs.existsSync(path.join(__dirname, '../../files/Fractions', role.name)));
            
            if (!fractionRole) {
                return await interaction.editReply({
                    content: '❌ Nejste členem žádné frakce.',
                    components: []
                });
            }

            const isLeader = member.roles.cache.some(role => role.name.startsWith('Velitel'));
            const isDeputy = member.roles.cache.some(role => role.name.startsWith('Zástupce'));

            if (!isLeader && !isDeputy) {
                return await interaction.editReply({
                    content: '❌ Pouze velitelé a zástupci frakcí mohou upravovat nastavení.',
                    components: []
                });
            }

            const fractionPath = path.join(__dirname, '../../files/Fractions', fractionRole.name);
            const fractionData = JSON.parse(fs.readFileSync(path.join(fractionPath, `${fractionRole.name}.json`)));

            // Handle changes
            const newPopis = interaction.options.getString('popis');
            const newBarva = interaction.options.getString('barva');
            const newImage = interaction.options.getAttachment('obrazek');
            let changes = [];

            if (newPopis) {
                fractionData.popis = newPopis;
                changes.push('✏️ Popis');
            }

            if (newBarva) {
                if (!/^[0-9A-Fa-f]{6}$/.test(newBarva)) {
                    return await interaction.editReply({
                        content: '❌ Barva musí být hexadecimální kód o délce 6 znaků (např. FF0000).'
                    });
                }

                // Update roles color
                const guild = interaction.guild;
                const roles = [
                    guild.roles.cache.get(fractionData.fractionRoleId),
                    guild.roles.cache.get(fractionData.leaderRoleId),
                    guild.roles.cache.get(fractionData.deputyRoleId)
                ];

                for (const role of roles) {
                    if (role) {
                        await role.setColor(`#${newBarva}`);
                    }
                }

                changes.push('🎨 Barva');
            }

            if (newImage) {
                // Check if image is valid
                if (!newImage.contentType?.startsWith('image/')) {
                    return await interaction.editReply({
                        content: '❌ Nahrát lze pouze obrázky.'
                    });
                }

                // Download and save image
                const response = await axios.get(newImage.url, { responseType: 'arraybuffer' });
                const imageExt = newImage.contentType.split('/')[1];
                const imagePath = path.join(fractionPath, `logo.${imageExt}`);

                fs.writeFileSync(imagePath, response.data);
                fractionData.imageUrl = `logo.${imageExt}`;
                changes.push('🖼️ Obrázek');
            }

            if (changes.length === 0) {
                return await interaction.editReply({
                    content: '❌ Nebyla zadána žádná změna.'
                });
            }

            // Save changes
            fs.writeFileSync(
                path.join(fractionPath, `${fractionRole.name}.json`),
                JSON.stringify(fractionData, null, 2)
            );

            const resultEmbed = new EmbedBuilder()
                .setColor(`#${newBarva || fractionData.barva}`)
                .setTitle('✅ Frakce upravena')
                .setDescription(`Byly provedeny následující změny:\n${changes.join('\n')}`)
                .addFields({ 
                    name: 'Frakce', 
                    value: fractionRole.name, 
                    inline: true 
                });

            if (newImage) {
                resultEmbed.setThumbnail(newImage.url);
            }

            await interaction.editReply({
                embeds: [resultEmbed]
            });

        } catch (error) {
            console.error('Error in editfraction command:', error);
            await interaction.editReply({
                content: '❌ Nastala chyba při úpravě frakce.',
                components: []
            });
        }
    }
};