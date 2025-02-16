const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

let activeCollectors = new Map(); // Uložíme collectory pro každého uživatele

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fractioninfo')
        .setDescription('Zobrazí informace o frakci'),
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const userId = interaction.user.id;

            // Pokud uživatel má aktivní collector, ukončíme ho
            if (activeCollectors.has(userId)) {
                activeCollectors.get(userId).stop('new_interaction');
            }

            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (fractions.length === 0) {
                return await interaction.followUp({ content: '❌ Žádné frakce k zobrazení.', ephemeral: true });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`select-fraction-info-${userId}`)
                .setPlaceholder('Vyberte frakci k zobrazení informací')
                .addOptions(fractions.map(fraction => ({
                    label: fraction,
                    value: fraction
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Informace o frakci')
                .setDescription('Vyberte frakci z dropdown menu pro zobrazení informací.');

            await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });

            const filter = i => i.customId === `select-fraction-info-${userId}` && i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            // Uložíme nový collector
            activeCollectors.set(userId, collector);

            collector.on('collect', async i => {
                try {
                    const selectedFraction = i.values[0];
                    const fractionFilePath = path.join(fractionsDir, selectedFraction, `${selectedFraction}.json`);
                    const fractionData = JSON.parse(fs.readFileSync(fractionFilePath, 'utf8'));

                    const { nazev, popis, roomId, leaderRoleId, deputyRoleId, fractionRoleId, money, warns, creationDate } = fractionData;

                    if (!nazev || !popis || !roomId || !leaderRoleId || !deputyRoleId || !fractionRoleId || money === undefined || warns === undefined || !creationDate) {
                        throw new Error('Invalid fraction data format');
                    }

                    const guild = interaction.guild;
                    const room = guild.channels.cache.get(roomId);
                    const leaderRole = guild.roles.cache.get(leaderRoleId);
                    const deputyRole = guild.roles.cache.get(deputyRoleId);
                    const fractionRole = guild.roles.cache.get(fractionRoleId);

                    const leader = leaderRole ? leaderRole.members.map(member => member.user.tag).join(', ') : 'N/A';
                    const deputy = deputyRole ? deputyRole.members.map(member => member.user.tag).join(', ') : 'N/A';
                    const fractionMembersCount = fractionRole ? fractionRole.members.size : 0;

                    const creationDateObj = new Date(creationDate);
                    const now = new Date();
                    const diffTime = Math.abs(now - creationDateObj);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    const fractionEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle(nazev)
                        .setDescription(popis)
                        .addFields(
                            { name: 'Zkratka frakce', value: selectedFraction, inline: true },
                            { name: 'Room', value: room ? `<#${room.id}>` : 'N/A', inline: true },
                            { name: 'Velitel', value: leader, inline: true },
                            { name: 'Zástupce', value: deputy, inline: true },
                            { name: 'Členové frakce', value: `${fractionMembersCount}`, inline: true },
                            { name: 'Peníze', value: money.toString(), inline: true },
                            { name: 'Frakční warny', value: warns.toString(), inline: true },
                            { name: 'Doba existence', value: `${diffDays} dní`, inline: true }
                        );

                    await i.update({ embeds: [fractionEmbed], components: [] });

                    // Po úspěšné interakci collector ukončíme
                    collector.stop('completed');

                } catch (error) {
                    console.error('Chyba při zobrazení informací o frakci:', error);
                    await interaction.followUp({ content: '❌ Chyba při zobrazení informací o frakci.', ephemeral: true });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({ content: '⌛ Časový limit vypršel. Akce byla zrušena.', components: [], ephemeral: true });
                }

                // Odebereme collector z paměti, protože skončil
                activeCollectors.delete(userId);
            });

        } catch (error) {
            console.error('Chyba v příkazu fractioninfo:', error);
            await interaction.followUp({ content: '❌ Chyba při zpracování příkazu.', ephemeral: true });
        }
    }
};