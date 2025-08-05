const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { db, getFractionByName, addPermission, addAuditLog } = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('managefractionroles')
        .setDescription('Spravuje role členů frakce')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Přidá uživatele do frakce')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Uživatel k přidání')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option
                        .setName('deputy')
                        .setDescription('Přidat jako zástupce')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Odebere uživatele z frakce')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Uživatel, kterému chcete odebrat roli')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            
            // Get user's fraction from database
            const member = interaction.member;
            
            // Get all fractions from database
            const fractions = [];
            await new Promise((resolve) => {
                db.all(`SELECT name FROM fractions`, [], (err, rows) => {
                    if (!err && rows) {
                        rows.forEach(row => fractions.push(row.name));
                    }
                    resolve();
                });
            });
            
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

    // Get fraction data from database
    let fractionData;
    await new Promise((resolve) => {
        getFractionByName(userFraction, (err, fraction) => {
            fractionData = fraction;
            resolve();
        });
    });

    if (!fractionData) {
        return await interaction.editReply('❌ Nastala chyba při načítání dat frakce.');
    }

    // Check if user is already in any fraction
    const hasAnyFraction = targetMember.roles.cache.some(r => {
        return new Promise((resolve) => {
            getFractionByName(r.name, (err, fraction) => {
                resolve(fraction !== undefined);
            });
        });
    });

    // Check if user is already in this fraction
    if (targetMember.roles.cache.has(fractionRole.id)) {
        if (makeDeputy && !targetMember.roles.cache.has(deputyRole.id)) {
            await targetMember.roles.add(deputyRole);
            
            // Add permission to database
            addPermission(
                targetMember.id,
                fractionData.id,
                'deputy',
                interaction.user.id
            );
            
            // Log action
            addAuditLog(
                interaction.user.id,
                'promote_deputy',
                'fraction_role',
                targetMember.id,
                JSON.stringify({ fraction: userFraction })
            );
            
            return await interaction.editReply(`✅ ${targetMember} byl povýšen na zástupce.`);
        } else if (!makeDeputy && targetMember.roles.cache.has(deputyRole.id)) {
            await targetMember.roles.remove(deputyRole);
            
            // Log action
            addAuditLog(
                interaction.user.id,
                'demote_deputy',
                'fraction_role',
                targetMember.id,
                JSON.stringify({ fraction: userFraction })
            );
            
            // Remove permission from database
            db.run(
                `DELETE FROM permissions WHERE user_id = ? AND fraction_id = ? AND role = 'deputy'`,
                [targetMember.id, fractionData.id]
            );
            
            return await interaction.editReply(`✅ ${targetMember} byl degradován z pozice zástupce.`);
        }
        return await interaction.editReply(`❌ ${targetMember} je již členem frakce ${userFraction}.`);
    }

    if (hasAnyFraction) {
        return await interaction.editReply(`❌ ${targetMember} je již členem jiné frakce.`);
    }

    // Create confirmation embed
    const embed = new EmbedBuilder()
        .setColor(fractionData.color ? `#${fractionData.color}` : 0x0099FF)
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
                .setCustomId(`accept-invite:${targetMember.id}:${userFraction}:${makeDeputy}:${fractionData.id}`)
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

    // Get fraction data from database
    let fractionData;
    await new Promise((resolve) => {
        getFractionByName(userFraction, (err, fraction) => {
            fractionData = fraction;
            resolve();
        });
    });

    if (!fractionData) {
        return await interaction.editReply('❌ Nastala chyba při načítání dat frakce.');
    }

    if (!targetMember.roles.cache.has(fractionRole.id)) {
        return await interaction.editReply(`❌ ${targetMember} není členem frakce ${userFraction}.`);
    }

    await targetMember.roles.remove([fractionRole.id, deputyRole.id]);
    
    // Remove permissions from database
    db.run(
        `DELETE FROM permissions WHERE user_id = ? AND fraction_id = ?`,
        [targetMember.id, fractionData.id]
    );
    
    // Log action
    addAuditLog(
        interaction.user.id,
        'remove_member',
        'fraction_role',
        targetMember.id,
        JSON.stringify({ fraction: userFraction })
    );
    
    await interaction.editReply(`✅ ${targetMember} byl odebrán z frakce ${userFraction}.`);
}