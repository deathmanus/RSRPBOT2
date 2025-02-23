const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

async function handleRoleResponse(interaction) {
    const [action, userId, fractionName, makeDeputy] = interaction.customId.split(':');
    
    if (!['accept-invite', 'decline-invite'].includes(action)) return;

    try {
        await interaction.deferUpdate();

        // Verify user permissions
        if (interaction.user.id !== userId) {
            return await interaction.followUp({
                content: '❌ Tato pozvánka není pro vás.',
                ephemeral: true
            });
        }

        if (action === 'accept-invite') {
            await processRoleAccept(interaction, fractionName, makeDeputy === 'true');
        } else {
            await processRoleDecline(interaction, fractionName);
        }

    } catch (error) {
        console.error('Error handling role response:', error);
        await interaction.followUp({
            content: '❌ Nastala chyba při zpracování odpovědi na pozvánku.',
            ephemeral: true
        });
    }
}

async function processRoleAccept(interaction, fractionName, makeDeputy) {
    // Check if user is already in any fraction
    const member = interaction.member;
    const hasAnyFraction = member.roles.cache.some(r => 
        fs.existsSync(path.join(__dirname, '../../files/Fractions', r.name))
    );

    if (hasAnyFraction) {
        return await interaction.followUp({
            content: '❌ Již jste členem jiné frakce.',
            ephemeral: true
        });
    }

    try {
        // Get roles
        const fractionRole = interaction.guild.roles.cache.find(r => r.name === fractionName);
        const roles = [fractionRole];

        if (makeDeputy) {
            const deputyRole = interaction.guild.roles.cache.find(r => r.name === `Zástupce ${fractionName}`);
            roles.push(deputyRole);
        }

        // Add roles
        await member.roles.add(roles);

        // Update embed
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00FF00)
            .setTitle('✅ Pozvánka přijata')
            .addFields({
                name: 'Status',
                value: `Přijato uživatelem ${interaction.user.tag}`,
                inline: true
            });

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });

        await interaction.followUp({
            content: `✅ Byli jste úspěšně přidáni do frakce ${fractionName}${makeDeputy ? ' jako zástupce' : ''}.`,
            ephemeral: true
        });

    } catch (error) {
        console.error('Error processing role accept:', error);
        await interaction.followUp({
            content: '❌ Nastala chyba při přidávání rolí.',
            ephemeral: true
        });
    }
}

async function processRoleDecline(interaction, fractionName) {
    try {
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF0000)
            .setTitle('❌ Pozvánka odmítnuta')
            .addFields({
                name: 'Status',
                value: `Odmítnuto uživatelem ${interaction.user.tag}`,
                inline: true
            });

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });

        await interaction.followUp({
            content: `❌ Odmítli jste pozvánku do frakce ${fractionName}.`,
            ephemeral: true
        });

    } catch (error) {
        console.error('Error processing role decline:', error);
        await interaction.followUp({
            content: '❌ Nastala chyba při odmítnutí pozvánky.',
            ephemeral: true
        });
    }
}

module.exports = { handleRoleResponse };