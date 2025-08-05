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
const { getFractionByName, updateFraction, addAuditLog } = require('../../Database/database');

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

            // Check if user is in a fraction
            const member = interaction.member;
            const fractionRole = member.roles.cache.find(role => {
                return new Promise((resolve) => {
                    getFractionByName(role.name, (err, fraction) => {
                        resolve(fraction !== undefined);
                    });
                });
            });
            
            if (!fractionRole) {
                return await interaction.editReply({
                    content: '❌ Nejste členem žádné frakce.',
                    components: []
                });
            }
            
            // Get fraction data from database
            const fractionName = fractionRole.name;
            let fractionData;
            
            await new Promise((resolve) => {
                getFractionByName(fractionName, (err, fraction) => {
                    fractionData = fraction;
                    resolve();
                });
            });
            
            if (!fractionData) {
                return await interaction.editReply({
                    content: '❌ Nastala chyba při načítání dat frakce.',
                    components: []
                });
            }
            
            // Create directory for fraction files if it doesn't exist
            const fractionFilesDir = path.join(__dirname, '../../Database/Files/Fractions', fractionName);
            if (!fs.existsSync(fractionFilesDir)) {
                fs.mkdirSync(fractionFilesDir, { recursive: true });
            }

            // Handle changes
            const newPopis = interaction.options.getString('popis');
            const newBarva = interaction.options.getString('barva');
            const newImage = interaction.options.getAttachment('obrazek');
            let changes = [];

            if (newPopis) {
                fractionData.description = newPopis;
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

                fractionData.color = newBarva;
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
                const imagePath = path.join(fractionFilesDir, `logo.${imageExt}`);

                fs.writeFileSync(imagePath, response.data);
                fractionData.logoPath = `logo.${imageExt}`;
                changes.push('🖼️ Obrázek');
            }

            if (changes.length === 0) {
                return await interaction.editReply({
                    content: '❌ Nebyla zadána žádná změna.'
                });
            }

            // Save changes to database
            await new Promise((resolve) => {
                updateFraction(
                    fractionData.id,
                    fractionData.name,
                    fractionData.description,
                    fractionData.money,
                    fractionData.color,
                    fractionData.logoPath,
                    fractionData.warns,
                    fractionData.roomId,
                    fractionData.leaderRoleId,
                    fractionData.deputyRoleId,
                    fractionData.fractionRoleId,
                    fractionData.creationDate
                );
                resolve();
            });
            
            // Log the action
            addAuditLog(
                interaction.user.id,
                'edit_fraction',
                'fraction',
                fractionData.id.toString(),
                JSON.stringify(changes)
            );

            const resultEmbed = new EmbedBuilder()
                .setColor(`#${newBarva || fractionData.color}`)
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