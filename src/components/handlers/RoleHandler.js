const { EmbedBuilder } = require('discord.js');
const { getFractionByName, addAuditLog } = require('../../Database/database');

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
    
    // Zkontrolujeme, zda má uživatel nějakou roli frakce v databázi
    let hasAnyFraction = false;
    
    // Získáme seznam všech frakcí z rolí uživatele
    const userRoles = member.roles.cache;
    
    // Pro každou roli zkontrolujeme, zda existuje frakce s tímto názvem
    for (const role of userRoles.values()) {
        try {
            const fraction = await new Promise((resolve) => {
                getFractionByName(role.name, (err, fraction) => {
                    if (err) {
                        console.error(`Error checking fraction for role ${role.name}:`, err);
                        resolve(null);
                    } else {
                        resolve(fraction);
                    }
                });
            });
            
            if (fraction) {
                hasAnyFraction = true;
                break;
            }
        } catch (error) {
            console.error(`Error checking fraction for role ${role.name}:`, error);
        }
    }
    
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
        
        // Přidat audit log
        addAuditLog(
            interaction.user.id,
            'accept_role_invite',
            'role',
            fractionName,
            JSON.stringify({
                fraction: fractionName,
                makeDeputy: makeDeputy
            })
        );

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
        // Přidat audit log
        addAuditLog(
            interaction.user.id,
            'decline_role_invite',
            'role',
            fractionName,
            JSON.stringify({
                fraction: fractionName
            })
        );
        
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

async function handlePermissionResponse(interaction) {
    const [action, userId, fractionName, requestType] = interaction.customId.split(':');
    
    if (!['perm-accept', 'perm-deny'].includes(action)) return;

    try {
        await interaction.deferUpdate();

        // Verify leader permissions
        const leaderRole = interaction.guild.roles.cache.find(r => r.name === `Velitel ${fractionName}`);
        if (!interaction.member.roles.cache.has(leaderRole.id)) {
            return await interaction.followUp({
                content: '❌ Nemáte oprávnění odpovědět na tuto žádost.',
                ephemeral: true
            });
        }

        const targetMember = await interaction.guild.members.fetch(userId);
        if (!targetMember) {
            return await interaction.followUp({
                content: '❌ Uživatel nebyl nalezen.',
                ephemeral: true
            });
        }

        if (action === 'perm-accept') {
            await processPermissionAccept(interaction, targetMember, fractionName, requestType);
        } else {
            await processPermissionDeny(interaction, targetMember, fractionName, requestType);
        }

    } catch (error) {
        console.error('Error handling permission response:', error);
        await interaction.followUp({
            content: '❌ Nastala chyba při zpracování odpovědi na žádost.',
            ephemeral: true
        });
    }
}

async function processPermissionAccept(interaction, targetMember, fractionName, requestType) {
    try {
        if (requestType === 'deputy') {
            const deputyRole = interaction.guild.roles.cache.find(r => r.name === `Zástupce ${fractionName}`);
            await targetMember.roles.add(deputyRole);
        }
        
        // Přidat audit log
        addAuditLog(
            interaction.user.id,
            'accept_permission_request',
            'permission',
            targetMember.id,
            JSON.stringify({
                fraction: fractionName,
                requestType: requestType,
                userId: targetMember.id
            })
        );

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00FF00)
            .setTitle('✅ Žádost schválena')
            .addFields({
                name: 'Status',
                value: `Schváleno uživatelem ${interaction.user.tag}`,
                inline: true
            });

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });

        await interaction.followUp({
            content: `✅ Žádost uživatele ${targetMember} byla schválena.`,
            ephemeral: false
        });

    } catch (error) {
        console.error('Error processing permission accept:', error);
        await interaction.followUp({
            content: '❌ Nastala chyba při udělování oprávnění.',
            ephemeral: true
        });
    }
}

async function processPermissionDeny(interaction, targetMember, fractionName, requestType) {
    try {
        // Přidat audit log
        addAuditLog(
            interaction.user.id,
            'deny_permission_request',
            'permission',
            targetMember.id,
            JSON.stringify({
                fraction: fractionName,
                requestType: requestType,
                userId: targetMember.id
            })
        );
        
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF0000)
            .setTitle('❌ Žádost zamítnuta')
            .addFields({
                name: 'Status',
                value: `Zamítnuto uživatelem ${interaction.user.tag}`,
                inline: true
            });

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: []
        });

        await interaction.followUp({
            content: `❌ Žádost uživatele ${targetMember} byla zamítnuta.`,
            ephemeral: false
        });

    } catch (error) {
        console.error('Error processing permission deny:', error);
        await interaction.followUp({
            content: '❌ Nastala chyba při zamítnutí žádosti.',
            ephemeral: true
        });
    }
}

module.exports = { handleRoleResponse, handlePermissionResponse };