const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spawnfraction')
        .setDescription('Zobrazí seznam frakcí a jejich itemů')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            if (fractions.length === 0) {
                return await interaction.editReply({ content: '❌ Žádné frakce nenalezeny.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('Seznam frakcí a jejich itemů')
                .setColor(0x00FF00)
                .setTimestamp();

            for (const fraction of fractions) {
                let fractionText = '';
                const fractionPath = path.join(fractionsDir, fraction);
                const sections = fs.readdirSync(fractionPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                for (const section of sections) {
                    const sectionPath = path.join(fractionPath, section);
                    const items = fs.readdirSync(sectionPath)
                        .filter(file => file.endsWith('.json'))
                        .map(file => {
                            const itemData = JSON.parse(fs.readFileSync(path.join(sectionPath, file)));
                            let itemText = `**${itemData.name}** - `;
                            
                            // Add modifications
                            if (itemData.selectedMods && itemData.selectedMods.length > 0) {
                                const mods = itemData.selectedMods.map(mod => {
                                    let modText = mod.selected.split(':')[1];
                                    if (mod.subSelections && Object.keys(mod.subSelections).length > 0) {
                                        modText += ': ' + Object.entries(mod.subSelections)
                                            .map(([name, opt]) => `${opt.name}`)
                                            .join(', ');
                                    }
                                    return modText;
                                }).join(' | ');
                                itemText += mods;
                            } else {
                                itemText += 'Žádné modifikace';
                            }
                            return itemText;
                        });

                    if (items.length > 0) {
                        fractionText += `\n__${section}:__\n${items.join('\n')}\n`;
                    }
                }

                if (fractionText) {
                    embed.addFields({
                        name: `📍 ${fraction}`,
                        value: fractionText || 'Žádné itemy',
                        inline: false
                    });
                }
            }

            // Split embed if it's too long
            if (embed.data.fields?.join('\n').length > 6000) {
                const embeds = [];
                let currentEmbed = new EmbedBuilder()
                    .setTitle('Seznam frakcí a jejich itemů (1)')
                    .setColor(0x00FF00)
                    .setTimestamp();
                let currentLength = 0;
                let embedCount = 1;

                for (const field of embed.data.fields) {
                    if (currentLength + field.value.length > 5900) {
                        embeds.push(currentEmbed);
                        embedCount++;
                        currentEmbed = new EmbedBuilder()
                            .setTitle(`Seznam frakcí a jejich itemů (${embedCount})`)
                            .setColor(0x00FF00)
                            .setTimestamp();
                        currentLength = 0;
                    }
                    currentEmbed.addFields(field);
                    currentLength += field.value.length;
                }
                embeds.push(currentEmbed);

                await interaction.editReply({ embeds });
            } else {
                await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Error in spawnfraction command:', error);
            await interaction.editReply({
                content: '❌ Nastala chyba při zpracování příkazu.',
            });
        }
    }
};